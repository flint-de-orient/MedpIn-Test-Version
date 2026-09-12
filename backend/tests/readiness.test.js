import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { env } from '../src/config/env.js';
import { readiness, readinessSummary } from '../src/config/readiness.js';

/**
 * Whether this deployment can do what it claims, and whether it says so.
 *
 * ---- The failure being prevented ---------------------------------------
 *
 * `ADMIN_CONSOLE_URL` unset. The server boots clean, every test passes, the
 * signup flow works end to end — and no applicant can ever confirm their email
 * address, because the code that builds the link correctly omits the paragraph
 * rather than sending a dead URL. `contactEmailVerified` stays false forever.
 *
 * Nothing was wrong. Nothing was logged. It was found by reading the code,
 * which is not a monitoring strategy.
 *
 * Every check below is written from that shape: a configuration that produces
 * a working-looking server which cannot do one of the things it offers.
 */

/** Swap env values for one test and put them back. */
const original = {};
function withEnv(values) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in original)) original[k] = env[k];
    env[k] = v;
  }
}

beforeEach(() => {
  for (const k of Object.keys(original)) delete original[k];
});
afterEach(() => {
  for (const [k, v] of Object.entries(original)) env[k] = v;
});

const find = (key) => readiness().find((c) => c.key === key);

describe('a half-configured payment integration is not quietly accepted', () => {
  test('keys without a webhook secret is degraded, not off', () => {
    /*
     * The one that fails open, and the reason this file exists.
     *
     * With no webhook secret there is nothing to verify a callback against.
     * Every forged POST is accepted, including "payment succeeded" — so a
     * deployment in this state hands out subscriptions to anybody who guesses
     * the URL, and boots perfectly while doing it.
     *
     * `off` would be the wrong answer: payments are switched on. That is the
     * whole problem.
     */
    withEnv({
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: '',
    });

    const check = find('payments');
    assert.equal(check.state, 'degraded');
    assert.match(check.affects, /forged callback/i);
  });

  test('and a webhook secret that is the API secret is degraded too', () => {
    // The commonest way this integration is got wrong. These are different
    // secrets in Razorpay; sharing the value rejects every genuine webhook, so
    // paid subscriptions silently never activate.
    withEnv({
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'same',
      RAZORPAY_WEBHOOK_SECRET: 'same',
      RAZORPAY_PLAN_ESSENTIAL: 'plan_a',
      RAZORPAY_PLAN_PROFESSIONAL: 'plan_b',
      RAZORPAY_PLAN_ENTERPRISE: 'plan_c',
      RAZORPAY_CALLBACK_URL: 'https://example.test/done',
    });

    assert.equal(find('payments').state, 'degraded');
  });

  test('a missing plan id is degraded, because checkout fails for that plan alone', () => {
    withEnv({
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: 'different',
      RAZORPAY_PLAN_ESSENTIAL: 'plan_a',
      RAZORPAY_PLAN_PROFESSIONAL: '',
      RAZORPAY_PLAN_ENTERPRISE: 'plan_c',
    });

    const check = find('payments');
    assert.equal(check.state, 'degraded');
    assert.match(check.because, /2 of 3/);
  });

  test('and no keys at all is off, which is a development machine', () => {
    // A signal that is always red is one nobody reads. A laptop with no
    // Razorpay account must not look broken.
    withEnv({ RAZORPAY_KEY_ID: '', RAZORPAY_KEY_SECRET: '' });
    assert.equal(find('payments').state, 'off');
  });

  test('fully configured is ready', () => {
    withEnv({
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: 'different',
      RAZORPAY_PLAN_ESSENTIAL: 'plan_a',
      RAZORPAY_PLAN_PROFESSIONAL: 'plan_b',
      RAZORPAY_PLAN_ENTERPRISE: 'plan_c',
      RAZORPAY_CALLBACK_URL: 'https://example.test/done',
    });
    assert.equal(find('payments').state, 'ready');
  });
});

describe('the console link is its own question', () => {
  test('SMTP configured and no console URL is degraded', () => {
    /*
     * The combination that cost the time: a real email that cannot do its job.
     * Mail goes out, looks right, and the one thing it exists to carry — the
     * confirmation link — is not in it.
     */
    withEnv({ SMTP_HOST: 'smtp.example.test', ADMIN_CONSOLE_URL: '' });

    const check = find('consoleLinks');
    assert.equal(check.state, 'degraded');
    assert.match(check.affects, /confirm their email/i);
  });

  test('and neither configured is off', () => {
    // A development machine. Nothing is being sent, so nothing is broken.
    withEnv({ SMTP_HOST: '', ADMIN_CONSOLE_URL: '' });
    assert.equal(find('consoleLinks').state, 'off');
  });

  test('both configured is ready', () => {
    withEnv({ SMTP_HOST: 'smtp.example.test', ADMIN_CONSOLE_URL: 'https://admin.example.test' });
    assert.equal(find('consoleLinks').state, 'ready');
  });
});

describe('the admin console cannot share the clinic signing key', () => {
  test('the same value as JWT_ACCESS_SECRET is degraded', () => {
    /*
     * The keys are separate so that a clinic token put in front of the admin
     * verifier fails *signature* verification rather than a role check —
     * because there is no role check to forget. Sharing the value defeats the
     * whole arrangement, and nothing at runtime would notice.
     */
    withEnv({
      ADMIN_JWT_SECRET: 'x'.repeat(40),
      JWT_ACCESS_SECRET: 'x'.repeat(40),
    });

    const check = find('adminConsole');
    assert.equal(check.state, 'degraded');
    assert.match(check.affects, /would verify against the platform admin API/i);
  });

  test('unset is off — the console is simply switched off', () => {
    withEnv({ ADMIN_JWT_SECRET: '' });
    assert.equal(find('adminConsole').state, 'off');
  });
});

describe('what is published and what is not', () => {
  test('the summary carries a count and never a reason', () => {
    /*
     * A deploy script needs to see that something is wrong without
     * authenticating. An unauthenticated reader learning "payments:
     * RAZORPAY_WEBHOOK_SECRET is not set" has been told exactly which forged
     * request to send and that it will be accepted.
     */
    withEnv({
      RAZORPAY_KEY_ID: 'rzp_test_abc',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: '',
    });

    const summary = readinessSummary();
    assert.equal(summary.config, 'degraded');
    assert.ok(summary.degradedCount >= 1);

    const text = JSON.stringify(summary);
    assert.ok(!/RAZORPAY/i.test(text), 'the summary names a variable');
    assert.ok(!/secret/i.test(text), 'the summary leaks a reason');
  });

  test('and "off" never counts as degraded', () => {
    // Otherwise every development machine reports degraded, and a signal that
    // is always red is one nobody reads.
    withEnv({
      SMTP_HOST: '',
      ADMIN_CONSOLE_URL: '',
      RAZORPAY_KEY_ID: '',
      RAZORPAY_KEY_SECRET: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      ADMIN_JWT_SECRET: '',
      PUBLIC_API_ORIGIN: '',
    });

    assert.equal(readinessSummary().config, 'ready');
    assert.equal(readinessSummary().degradedCount, 0);
  });
});

describe('every check says what breaks, not which variable is missing', () => {
  test('anything not ready explains the consequence', () => {
    /*
     * Written for whoever is reading this at 9pm wondering why a customer says
     * they never got an email. "ADMIN_CONSOLE_URL is not set" is a fact about
     * a config file; "applicants cannot confirm their email address" is the
     * thing they are actually looking for.
     */
    withEnv({
      SMTP_HOST: '',
      ADMIN_CONSOLE_URL: '',
      RAZORPAY_KEY_ID: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      ADMIN_JWT_SECRET: '',
    });

    for (const check of readiness()) {
      if (check.state === 'ready') continue;
      assert.ok(check.because, `${check.key} does not say why`);
      assert.ok(
        check.affects && check.affects.length > 30,
        `${check.key} does not say what it breaks`,
      );
    }
  });

  test('and every subsystem that depends on configuration is covered', () => {
    // A check that exists for five of six subsystems is a check somebody will
    // trust about the sixth.
    const keys = readiness().map((c) => c.key);
    for (const expected of [
      'email',
      'consoleLinks',
      'payments',
      'publicOrigin',
      'push',
      'adminConsole',
    ]) {
      assert.ok(keys.includes(expected), `nothing reports on ${expected}`);
    }
  });
});

describe('staging cannot quietly reach a real patient', () => {
  /*
   * The check this file was most worth writing.
   *
   * Staging runs NODE_ENV=production on purpose — half of what is worth
   * rehearsing is production-only behaviour — so nothing in the process knows
   * it is not the real thing. The fastest way to stand up a second environment
   * is to copy the first one's `.env`, and every outward channel here is
   * credential-gated in a way that fails silent-and-safe when omitted. Which
   * means omitting them looks exactly like forgetting to set them up, and
   * copying them looks like nothing at all.
   */
  test('live SMS credentials on staging are degraded', () => {
    withEnv({
      DEPLOY_ENV: 'staging',
      MSG91_AUTH_KEY: 'live-key',
      MSG91_SENDER_ID: 'MEDPIN',
    });

    const check = find('stagingIsolation');
    assert.equal(check.state, 'degraded');
    assert.match(check.because, /SMS/);
    assert.match(check.affects, /actual patients/i);
  });

  test('so are live push credentials', () => {
    withEnv({ DEPLOY_ENV: 'staging', GOOGLE_APPLICATION_CREDENTIALS: '/etc/fb.json' });
    assert.equal(find('stagingIsolation').state, 'degraded');
  });

  test('and live SMTP', () => {
    withEnv({ DEPLOY_ENV: 'staging', SMTP_HOST: 'smtp.example.test' });
    assert.equal(find('stagingIsolation').state, 'degraded');
  });

  test('every live channel is named, not just the first', () => {
    // Fixing one and redeploying, only to find the next one, is how a
    // half-hour job becomes an afternoon.
    withEnv({
      DEPLOY_ENV: 'staging',
      MSG91_AUTH_KEY: 'k',
      MSG91_SENDER_ID: 'S',
      GOOGLE_APPLICATION_CREDENTIALS: '/etc/fb.json',
      SMTP_HOST: 'smtp.example.test',
    });

    const { because } = find('stagingIsolation');
    assert.match(because, /SMS/);
    assert.match(because, /push/);
    assert.match(because, /email/);
  });

  test('a staging box with nothing configured is ready', () => {
    withEnv({
      DEPLOY_ENV: 'staging',
      MSG91_AUTH_KEY: '',
      MSG91_SENDER_ID: '',
      GOOGLE_APPLICATION_CREDENTIALS: '',
      SMTP_HOST: '',
    });
    assert.equal(find('stagingIsolation').state, 'ready');
  });

  test('and production is not asked the question at all', () => {
    /*
     * Production is *supposed* to hold live credentials. Reporting it as
     * degraded for doing its job is how a signal becomes noise — and the one
     * that matters here would then be sitting in a list of things everybody
     * has learned to scroll past.
     */
    withEnv({
      DEPLOY_ENV: 'production',
      MSG91_AUTH_KEY: 'live-key',
      MSG91_SENDER_ID: 'MEDPIN',
      SMTP_HOST: 'smtp.example.test',
    });
    assert.equal(find('stagingIsolation'), undefined);
  });
});
