import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import { env } from '../src/config/env.js';
import {
  verifyWebhook,
  configured,
  webhooksConfigured,
  isTestMode,
  planIdFor,
} from '../src/services/billing/razorpay.js';

/**
 * The one check that decides whether money is real.
 *
 * ---- Why this file computes actual HMACs --------------------------------
 *
 * A webhook endpoint has no session and no bearer token. Razorpay posts from
 * their own servers and the signature *is* the authentication — so this
 * function is the entire boundary between "Razorpay says this was paid" and
 * "somebody who found the URL says this was paid".
 *
 * Asserting that the source contains `createHmac` would prove nothing about
 * that. These sign bodies with a known secret and check what comes back.
 *
 * ---- The three ways it is got wrong -------------------------------------
 *
 * The wrong secret: the webhook secret is typed separately when the endpoint is
 * created and is not the API key secret. Using the API secret makes every
 * genuine callback fail, and the usual fix for that is to stop checking.
 *
 * The wrong bytes: the signature covers what was sent, and re-serialising a
 * parsed object does not reproduce it.
 *
 * The wrong comparison: `===` on a hex digest leaks how much matched, in time.
 */
const SECRET = 'whsec_test_0123456789';
const OTHER = 'whsec_test_9876543210';

/** What Razorpay would send for this body. */
const sign = (raw, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(raw).digest('hex');

let saved;

before(() => {
  saved = env.RAZORPAY_WEBHOOK_SECRET;
  env.RAZORPAY_WEBHOOK_SECRET = SECRET;
});

after(() => {
  env.RAZORPAY_WEBHOOK_SECRET = saved;
});

describe('a genuine callback is accepted', () => {
  test('the signature Razorpay would send verifies', () => {
    const raw = Buffer.from(JSON.stringify({ event: 'subscription.charged' }));
    assert.equal(verifyWebhook(raw, sign(raw)), true);
  });

  test('including a body with unicode in it', () => {
    // Hashing a string rather than the bytes gets this wrong the moment a
    // practice is called something outside ASCII.
    const raw = Buffer.from(JSON.stringify({ notes: { practice: 'ডে ক্লিনিক' } }));
    assert.equal(verifyWebhook(raw, sign(raw)), true);
  });
});

describe('and everything else is refused', () => {
  const raw = Buffer.from(JSON.stringify({ event: 'subscription.charged' }));

  test('a forged body with a real old signature', () => {
    // The attack this exists to stop: replay a signature against a body that
    // now says a different practice was paid for.
    const forged = Buffer.from(JSON.stringify({ event: 'subscription.charged', evil: true }));
    assert.equal(verifyWebhook(forged, sign(raw)), false);
  });

  test('a signature made with the API secret instead of the webhook one', () => {
    // The commonest misconfiguration, and the one that leads to the check
    // being removed rather than fixed.
    assert.equal(verifyWebhook(raw, sign(raw, OTHER)), false);
  });

  test('no signature at all', () => {
    assert.equal(verifyWebhook(raw, null), false);
    assert.equal(verifyWebhook(raw, ''), false);
    assert.equal(verifyWebhook(raw, undefined), false);
  });

  test('a signature of the wrong length', () => {
    // `timingSafeEqual` throws on mismatched lengths, and a throw here becomes
    // a 500, which Razorpay retries — so a truncated signature would turn into
    // a retry storm rather than a refusal.
    assert.equal(verifyWebhook(raw, 'abc'), false);
    assert.equal(verifyWebhook(raw, sign(raw) + '00'), false);
  });

  test('a parsed object rather than the raw bytes', () => {
    // The mistake app.js exists to prevent. Re-serialising loses the exact
    // bytes, so this must refuse rather than appear to work.
    assert.equal(verifyWebhook(JSON.stringify({ event: 'x' }), sign(raw)), false);
    assert.equal(verifyWebhook({ event: 'x' }, sign(raw)), false);
  });

  test('and it never throws, whatever it is handed', () => {
    // A verification that throws is caught by an error handler and answered
    // 500, which Razorpay retries. A signature bug must be a refusal.
    for (const bad of [null, undefined, 0, [], {}, Buffer.alloc(0)]) {
      assert.doesNotThrow(() => verifyWebhook(bad, 'x'));
      assert.doesNotThrow(() => verifyWebhook(Buffer.from('x'), bad));
    }
  });
});

describe('with no secret configured, nothing verifies', () => {
  test('a correct signature is still refused', () => {
    // Not "allow everything until configured". An unconfigured server that
    // accepted callbacks would take Razorpay's word for anything, including
    // anybody impersonating them.
    const raw = Buffer.from('{}');
    const good = sign(raw);

    const held = env.RAZORPAY_WEBHOOK_SECRET;
    env.RAZORPAY_WEBHOOK_SECRET = '';
    try {
      assert.equal(webhooksConfigured(), false);
      assert.equal(verifyWebhook(raw, good), false);
    } finally {
      env.RAZORPAY_WEBHOOK_SECRET = held;
    }
  });
});

describe('unconfigured is a state, not an error', () => {
  test('blank keys mean the integration is simply off', () => {
    /*
     * Set here rather than assumed.
     *
     * The first version asserted `configured() === false` against whatever was
     * in the developer's own .env — so it passed on a machine with no keys and
     * failed the moment somebody pasted their test credentials in, which is
     * exactly what a person setting this up does first.
     *
     * A test whose result depends on the config of the machine running it is
     * not testing the code.
     */
    const held = { id: env.RAZORPAY_KEY_ID, secret: env.RAZORPAY_KEY_SECRET, plan: env.RAZORPAY_PLAN_SOLO };
    try {
      env.RAZORPAY_KEY_ID = '';
      env.RAZORPAY_KEY_SECRET = '';
      env.RAZORPAY_PLAN_SOLO = '';

      assert.equal(configured(), false);
      assert.equal(planIdFor('solo'), null);
    } finally {
      env.RAZORPAY_KEY_ID = held.id;
      env.RAZORPAY_KEY_SECRET = held.secret;
      env.RAZORPAY_PLAN_SOLO = held.plan;
    }
  });

  test('and a key with no secret is still off', () => {
    // Half-configured is the dangerous middle: a key id alone would let a
    // checkout be offered that cannot then be completed or verified.
    const held = env.RAZORPAY_KEY_SECRET;
    try {
      env.RAZORPAY_KEY_SECRET = '';
      assert.equal(configured(), false);
    } finally {
      env.RAZORPAY_KEY_SECRET = held;
    }
  });

  test('and the mode is read from the key prefix', () => {
    // `rzp_test_` versus `rzp_live_` is the only thing that says which account
    // the keys belong to.
    const held = env.RAZORPAY_KEY_ID;
    try {
      env.RAZORPAY_KEY_ID = 'rzp_test_abc';
      assert.equal(isTestMode(), true);
      env.RAZORPAY_KEY_ID = 'rzp_live_abc';
      assert.equal(isTestMode(), false);
    } finally {
      env.RAZORPAY_KEY_ID = held;
    }
  });
});

describe('the raw body is kept for this path and no other', () => {
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');

  test('express.json captures it', () => {
    assert.match(app, /verify: \(req, _res, buf\) =>/);
    assert.match(app, /req\.rawBody = buf/);
  });

  test('only for the webhook, on a polling app', () => {
    // Holding a second copy of every request body to serve one endpoint is a
    // cost paid on the wrong requests.
    assert.match(app, /originalUrl\?\.startsWith\('\/api\/v1\/billing\/webhook'\)/);
  });
});
