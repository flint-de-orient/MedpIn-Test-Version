import crypto from 'node:crypto';

import { AppError, badRequest } from './errors.js';

/**
 * Retrying a clinical write without writing it twice.
 *
 * ---- The failure ----------------------------------------------------------
 *
 * A doctor finishes a consultation and taps "Issue". On a clinic's 4G the
 * request reaches the server, the vitals and the prescription are written, and
 * the response is lost on the way back. The app shows a timeout. The doctor
 * taps again — and the patient now has two prescriptions from one visit, two
 * blood-pressure readings from one cuff, and a trend chart and a risk score
 * built on both. Nothing refused the second request, because nothing could
 * tell it was the first one again.
 *
 * ---- The contract ---------------------------------------------------------
 *
 * The client names each logical request with an `Idempotency-Key` header and
 * sends the same key when it retries that request. The server stores the key on
 * the record it writes, behind a unique index, together with a hash of what was
 * asked for:
 *
 *   same key, same request   → the record already written, not a second one
 *   same key, other request  → refused: IDEMPOTENCY_KEY_REUSED
 *   no key                   → a new record, exactly as before
 *
 * The middle case is the one that protects a clinical record. A key replayed
 * with different values is a correction the client did not mean to discard —
 * a doctor who fixed a typo after a failed attempt — and silently answering
 * with the old values would lose it. Refusing says so.
 *
 * No key keeps working unchanged, so an older app is no worse off than today.
 */

/** Printable, bounded, and not a place to smuggle anything else. */
const KEY_RE = /^[A-Za-z0-9._:-]{8,128}$/;

/**
 * JSON with its keys in a fixed order, so the same request hashes the same way
 * however the client happened to build the object.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Read the key, if the request carries one, and fingerprint what it asks for.
 *
 * ---- Mounted before `validate()`, over what the client sent -------------
 *
 * It was mounted after, on the reasoning that the parsed body is what the route
 * acts on. But parsing fills in defaults, and a prescription's `issuedOn`
 * defaults to the moment of parsing — so the same prescription retried a second
 * later fingerprinted differently, and a genuine retry was refused as a
 * different request. What identifies a retry is what the client sent; the key
 * order is normalised below, and nothing else needs to be.
 */
export function idempotencyKey() {
  return (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key) {
      req.idempotency = null;
      return next();
    }
    if (!KEY_RE.test(key)) {
      return next(badRequest('Idempotency-Key must be 8 to 128 letters, digits, dots, colons, dashes or underscores.'));
    }

    const hash = crypto
      .createHash('sha256')
      .update(`${req.method} ${req.baseUrl}${req.route?.path ?? req.path}\n${canonical(req.body ?? {})}`)
      .digest('hex');

    req.idempotency = { key, hash };
    next();
  };
}

/**
 * Decide what a stored record means for this request.
 *
 * @returns {boolean} true when `existing` is this very request, already done;
 *   throws when the key was used for something else; false when there is none.
 */
export function isReplayOf(req, existing) {
  if (!existing) return false;
  if (existing.idempotencyHash === req.idempotency?.hash) return true;
  throw new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'This request key was already used with different details. Nothing was changed.',
  );
}

/** Whether an error is the unique index refusing a second write with this key. */
export function isKeyCollision(err) {
  return err?.code === 11000 && Object.keys(err?.keyPattern ?? {}).includes('idempotencyKey');
}
