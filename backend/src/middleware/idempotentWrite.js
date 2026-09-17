import crypto from 'node:crypto';

import { IdempotentWrite } from '../models/IdempotentWrite.js';
import { logger } from '../config/logger.js';
import { AppError } from './errors.js';
import { idempotencyKey } from './idempotency.js';

/**
 * A write that a retry cannot perform twice.
 *
 * ---- The failure ------------------------------------------------------------------
 *
 * The desk taps "Give a time". On the clinic's connection the confirmation is
 * written and the answer is lost, so the app shows a timeout and the desk taps
 * again — or the phone reconnects and resends, or the token has expired and the
 * app refreshes it and sends the request once more. The second attempt was a new
 * request as far as the server knew: a move wrote a second replacement's worth
 * of notes, a cancel told the patient twice, and a confirmation that had
 * succeeded answered "Only a request can be confirmed", so the desk believed it
 * had failed.
 *
 * ---- The contract ------------------------------------------------------------------
 *
 * The one in middleware/idempotency.js, which prescriptions and vitals keep: the
 * client names a logical request with an `Idempotency-Key` and repeats the key
 * when it repeats the request.
 *
 *   same key, same request       → the answer the first attempt gave, not a second write
 *   same key, while it is running → waits for that answer
 *   same key, other request      → 409 IDEMPOTENCY_KEY_REUSED, nothing written
 *   no key                       → exactly as before
 *
 * "Same request" is the method, the path with its ids, and the body as sent.
 *
 * ---- How ------------------------------------------------------------------------------
 *
 * The key is claimed in IdempotentWrite before the route runs, behind a unique
 * index, so two copies arriving together cannot both run. The route's answer is
 * recorded before it is sent. An answer that was a refusal is not kept — it
 * wrote nothing — so the key is free to be tried again. A claim whose request
 * died without answering lapses after LEASE_MS and is taken over.
 *
 * Mount it after the guards that decide who may make the request, so a replay
 * is never an answer somebody could not have been given; and before `validate()`
 * and `audit()` — the fingerprint is of what the client sent, and a replay did
 * not write anything that needs a second audit row.
 */

const LEASE_MS = 30_000;
const WAIT_MS = 10_000;
const POLL_MS = 40;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function idempotentWrite() {
  const readKey = idempotencyKey();

  return (req, res, next) => {
    readKey(req, res, (err) => {
      if (err) return next(err);
      if (!req.idempotency || !req.user?._id) return next();
      claim(req, res, next).catch(next);
    });
  };
}

async function claim(req, res, next) {
  const actor = req.user._id;
  const { key } = req.idempotency;
  // The route's own hash has the path template, not the ids in it: a confirm of
  // one appointment and a confirm of another would otherwise be "the same
  // request".
  const fingerprint = crypto
    .createHash('sha256')
    .update(`${req.idempotency.hash}\n${req.originalUrl.split('?')[0]}`)
    .digest('hex');
  const holder = crypto.randomUUID();
  const giveUpAt = Date.now() + WAIT_MS;

  for (;;) {
    if (Date.now() >= giveUpAt) {
      throw new AppError(
        409,
        'IDEMPOTENCY_IN_PROGRESS',
        'This request is still being processed. Please look again in a moment.',
      );
    }
    const now = new Date();
    let row = null;

    try {
      row = await IdempotentWrite.create({
        actor,
        key,
        fingerprint,
        holder,
        leaseUntil: new Date(now.getTime() + LEASE_MS),
      });
    } catch (err) {
      if (err?.code !== 11000) throw err;
    }

    if (!row) {
      const existing = await IdempotentWrite.findOne({ actor, key }).lean();
      // Gone between the insert and the read: a first attempt that failed and
      // gave its key back. Try to claim it again.
      if (!existing) continue;

      if (existing.fingerprint !== fingerprint) {
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'This request key was already used with different details. Nothing was changed.',
        );
      }

      if (existing.state === 'done') {
        return res.status(existing.status).set('Idempotent-Replayed', 'true').json(existing.body);
      }

      // Still running somewhere — unless the request that claimed it died.
      if (existing.leaseUntil && existing.leaseUntil < now) {
        row = await IdempotentWrite.findOneAndUpdate(
          { _id: existing._id, state: 'pending', holder: existing.holder },
          { $set: { holder, leaseUntil: new Date(now.getTime() + LEASE_MS) } },
          { new: true },
        );
      }

      if (!row) {
        await sleep(POLL_MS);
        continue;
      }
    }

    // Claimed: record the answer before it goes out, so a retry that arrives
    // the moment the first answer does is given the same one.
    const send = res.json.bind(res);
    res.json = (body) => {
      const status = res.statusCode;
      const kept = status >= 200 && status < 300;
      const settle = kept
        ? IdempotentWrite.updateOne(
            { _id: row._id, holder },
            {
              $set: { state: 'done', status, body: JSON.parse(JSON.stringify(body ?? null)) },
              $unset: { holder: 1, leaseUntil: 1 },
            },
          )
        : // A refusal wrote nothing. The key is free for the corrected request.
          IdempotentWrite.deleteOne({ _id: row._id, holder });

      settle
        .catch((err) => logger.error({ err, key }, 'could not record an idempotent write'))
        .finally(() => send(body));
      return res;
    };

    return next();
  }
}
