import crypto from 'node:crypto';

import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Razorpay, over `fetch` and `crypto`.
 *
 * ---- Why no SDK ---------------------------------------------------------
 *
 * Their API is REST with basic auth and their signatures are HMAC-SHA256. Node
 * has both. An SDK here would be a dependency to keep current for two calls and
 * one comparison, and the one thing that must be exactly right — the signature
 * check — is the thing a wrapper makes hardest to read.
 *
 * ---- Unconfigured is a state, not an error ------------------------------
 *
 * With no key id nothing here reaches the network and `configured()` says so.
 * The billing surface is off and the clinic is unaffected, the same way the
 * console is off without `ADMIN_JWT_SECRET`. A half-configured payment
 * integration is worse than an absent one: it can take money it cannot confirm.
 */

const API = 'https://api.razorpay.com/v1';

/** Whether this deployment can talk to Razorpay at all. */
export function configured() {
  return Boolean(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
}

/** Whether it can verify a callback — a separate secret and a separate question. */
export function webhooksConfigured() {
  return Boolean(env.RAZORPAY_WEBHOOK_SECRET);
}

/** Test keys are prefixed `rzp_test_`; that prefix is the only thing that says which. */
export function isTestMode() {
  return env.RAZORPAY_KEY_ID.startsWith('rzp_test_');
}

/** The provider plan id for one of ours, or null where none is configured. */
export function planIdFor(plan) {
  return (
    {
      solo: env.RAZORPAY_PLAN_SOLO,
      clinic: env.RAZORPAY_PLAN_CLINIC,
      hospital: env.RAZORPAY_PLAN_HOSPITAL,
    }[plan] || null
  );
}

async function call(method, path, body) {
  if (!configured()) throw new Error('Razorpay is not configured on this server');

  const auth = Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Their error pages are HTML. Falling through with the status is more use
    // than a parse failure that hides it.
  }

  if (!res.ok) {
    const message = json?.error?.description ?? `Razorpay returned ${res.status}`;
    logger.warn({ status: res.status, path, code: json?.error?.code }, 'razorpay call failed');
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }

  return json;
}

/**
 * Start a subscription. Returns the provider's row, whose id the client needs
 * to open checkout.
 *
 * `total_count` is required by their API and is the number of billing cycles.
 * Twelve months, renewed rather than perpetual, because a subscription with no
 * end is one nobody reviews.
 */
export function createSubscription({ planId, notes, totalCount = 12 }) {
  return call('POST', '/subscriptions', {
    plan_id: planId,
    total_count: totalCount,
    customer_notify: 1,
    // Our own ids, so a row in their dashboard can be traced back here without
    // a lookup. Notes come back on every webhook for this subscription.
    notes,
  });
}

export function fetchSubscription(id) {
  return call('GET', `/subscriptions/${encodeURIComponent(id)}`);
}

export function cancelSubscription(id, { atCycleEnd = true } = {}) {
  return call('POST', `/subscriptions/${encodeURIComponent(id)}/cancel`, {
    cancel_at_cycle_end: atCycleEnd ? 1 : 0,
  });
}

/**
 * Is this callback really from Razorpay?
 *
 * ---- The three ways this is got wrong -----------------------------------
 *
 * **The wrong secret.** The webhook secret is not the API key secret; it is
 * typed separately when the endpoint is created. Using the API secret makes
 * every genuine callback fail, and the usual fix for that is to stop checking —
 * at which point every forged "payment succeeded" is accepted.
 *
 * **The wrong bytes.** The signature covers the exact body sent. Re-serialising
 * a parsed object does not reproduce it: key order, spacing and number
 * formatting all differ. So this takes a Buffer, and [app.js] keeps one for
 * this path only.
 *
 * **The wrong comparison.** `a === b` on a hex digest leaks how much of it
 * matched, through time. `timingSafeEqual` does not, and it throws on a length
 * mismatch, so the lengths are checked first.
 *
 * Returns a boolean and never throws. A verification that throws gets caught by
 * an error handler somewhere and turns into a 500, which Razorpay retries —
 * so a signature bug becomes a retry storm rather than a refusal.
 */
export function verifyWebhook(rawBody, signature) {
  if (!webhooksConfigured()) return false;
  if (!Buffer.isBuffer(rawBody) || !signature) return false;

  try {
    const expected = crypto
      .createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest('hex');

    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(String(signature), 'utf8');
    if (a.length !== b.length) return false;

    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    logger.warn({ err }, 'could not verify a razorpay signature');
    return false;
  }
}
