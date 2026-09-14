import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { env } from '../src/config/env.js';

/**
 * A test run never texts, emails, pushes or bills anybody.
 *
 * ---- What happened --------------------------------------------------------
 *
 * The senders chose between sending and logging by whether credentials were
 * present, and the laptop the suite runs on has the clinic's live MSG91 and
 * Razorpay keys in its .env. So `httpDeskEnrolment.test.js` asked MSG91 to text
 * a one-time code to +91 98123 45671 and +91 98123 45672, and
 * `httpPracticeApplication.test.js` to +91 98123 45699 — from the clinic's
 * sender ID, on every run in which MSG91 accepted. It was caught only because
 * one day the request timed out and the tests failed with "Could not send the
 * SMS".
 *
 * ---- How this file stays safe while it proves the bug ---------------------
 *
 * `fetch` is replaced before anything is called, and answers every request
 * itself. Mail is pointed at a closed port on this machine. So even run against
 * senders with no guard at all — the red run — nothing leaves the laptop; this
 * file simply records that something tried.
 *
 * Configured the way that laptop is: credentials present.
 */

const realFetch = globalThis.fetch;
const reached = [];

function recordingFetch(input) {
  reached.push(String(input instanceof Request ? input.url : input));
  return Promise.resolve(
    new Response(JSON.stringify({ type: 'success', message: 'answered by the test' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
}

const reachedSince = (mark, host) => reached.slice(mark).filter((url) => url.includes(host));

const LIVE_LIKE = {
  MSG91_AUTH_KEY: 'configured-as-on-the-laptop',
  MSG91_SENDER_ID: 'MEDPIN',
  MSG91_TEMPLATE_REGISTER: 'template-register',
  SMTP_HOST: '127.0.0.1',
  SMTP_PORT: 9,
  SMTP_USER: 'nobody@example.invalid',
  RAZORPAY_KEY_ID: 'rzp_live_configured',
  RAZORPAY_KEY_SECRET: 'configured-as-on-the-laptop',
};

describe('a test run reaches nobody', () => {
  const saved = {};

  before(() => {
    globalThis.fetch = recordingFetch;
    for (const [key, value] of Object.entries({ ...LIVE_LIKE, GOOGLE_APPLICATION_CREDENTIALS: '' })) {
      saved[key] = env[key];
      env[key] = value;
    }
  });

  after(() => {
    globalThis.fetch = realFetch;
    Object.assign(env, saved);
  });

  test('the guard answers for the process, not for what the .env holds', async () => {
    const { outboundBlocked } = await import('../src/config/outbound.js');
    assert.equal(outboundBlocked(), true, 'the test runner is not recognised as a test run');
  });

  test('a one-time code is not sent to MSG91', async () => {
    const { sendOtpSms } = await import('../src/services/sms.js');
    const mark = reached.length;

    const out = await sendOtpSms({ phone: '+919812345671', code: '123456', purpose: 'enrol' });

    assert.deepEqual(reachedSince(mark, 'msg91'), [], 'a test run asked MSG91 to text a real number');
    assert.equal(out.delivered, false);
    assert.equal(out.simulated, true);
  });

  test('and the code request says it was not sent', async () => {
    // What the desk's screen reads. "We have texted them a code" about a code
    // nobody texted is the same lie in the other direction.
    const { requestOtp } = await import('../src/services/otp.js');
    const mongoose = (await import('mongoose')).default;
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('medpin_outbound_test'));
    try {
      const mark = reached.length;
      const out = await requestOtp({ phone: '+919812345672', purpose: 'enrol' });
      assert.deepEqual(reachedSince(mark, 'msg91'), []);
      assert.equal(out.simulated, true);
    } finally {
      await mongoose.disconnect();
      await mongod.stop();
    }
  });

  test('an email is not handed to a mail server', async () => {
    const { sendMail } = await import('../src/services/mailer.js');
    const out = await sendMail({ to: 'someone@example.invalid', subject: 'Reset', text: 'A link' });
    assert.equal(out.delivered, false);
  });

  test('Razorpay is not called with the practice’s keys', async () => {
    const razorpay = await import('../src/services/billing/razorpay.js');
    const mark = reached.length;
    await razorpay.fetchPlan('plan_from_a_test').catch(() => {});
    assert.deepEqual(reachedSince(mark, 'razorpay'), [], 'a test run called Razorpay with live-looking keys');
  });

  test('push is never initialised, even with a working service account', async () => {
    // Generated here so firebase-admin accepts it offline, which is exactly the
    // case where an unguarded sender would go on to push.
    const { privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'medpin-push-'));
    const file = path.join(dir, 'service-account.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        type: 'service_account',
        project_id: 'medpin-test',
        private_key: privateKey,
        client_email: 'push@medpin-test.iam.gserviceaccount.com',
      }),
    );
    env.GOOGLE_APPLICATION_CREDENTIALS = file;

    try {
      const { getMessaging } = await import('../src/config/firebase.js');
      assert.equal(getMessaging(), null, 'a test run initialised push with a working service account');
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
