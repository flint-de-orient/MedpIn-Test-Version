import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { env } from '../src/config/env.js';

/**
 * What the operator can see about money.
 *
 * ---- Why this became urgent ---------------------------------------------
 *
 * Two things now write `practice.plan`: an operator in the console, and the
 * billing webhook. So "this practice is on Professional" stopped being a whole
 * answer — bought and granted look identical from the console, and support
 * cannot tell a webhook that never arrived from a deliberate comp.
 *
 * The console could see neither. `admin.js` had no reference to `Subscription`
 * at all, so the moment a practice could pay, the platform surface went blind
 * to it.
 *
 * ---- Reaching the admin API in a test -----------------------------------
 *
 * The guard takes a cookie or a bearer token, and CSRF is enforced only on the
 * cookie path — a bearer token is not attached by a browser, so a cross-site
 * request carrying one had to be written by somebody who already had it. That
 * makes a signed token the whole of the setup here.
 */

const ADMIN_SECRET = 'a_test_admin_secret_at_least_32_characters_long';

let origin;
let realAdminSecret;
let token;

async function get(path) {
  const res = await fetch(origin + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describe('the console can see a subscription', () => {
  before(async () => {
    origin = await boot();
    // Set rather than read, so this does not depend on a developer's .env —
    // and it must differ from the clinic key or the guard refuses outright.
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });

  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
    const admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });

  async function practiceWith(plan, sub) {
    const practice = await makePractice('Sunrise Diabetes Care', { plan });
    await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    if (sub) {
      await Subscription.create({
        practice: practice._id,
        providerSubscriptionId: 'sub_live_1',
        plan: sub.plan,
        status: sub.status,
        ...(sub.confirmedAt ? { confirmedAt: sub.confirmedAt } : {}),
      });
    }
    return practice;
  }

  test('a practice with none says so, rather than omitting the field', async () => {
    // Null and absent read the same in JSON but not in a client. An omitted key
    // is indistinguishable from an older server that never sent one.
    const practice = await practiceWith(PLAN.TRIAL, null);

    const res = await get(`/admin/practices/${practice._id}`);
    assert.equal(res.status, 200);
    assert.ok('subscription' in res.body, 'the key is missing entirely');
    assert.equal(res.body.subscription, null);
  });

  test('an active one is reported with the provider’s id', async () => {
    // The id is what an operator pastes into Razorpay's dashboard when a
    // customer asks about a charge. Without it, support is reading two systems
    // that share no visible key.
    const practice = await practiceWith(PLAN.PROFESSIONAL, {
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      confirmedAt: new Date(),
    });

    const res = await get(`/admin/practices/${practice._id}`);
    assert.equal(res.body.subscription.status, SUBSCRIPTION_STATUS.ACTIVE);
    assert.equal(res.body.subscription.providerSubscriptionId, 'sub_live_1');
    assert.equal(res.body.subscription.disagrees, false);
  });

  test('and a plan that does not match the practice is flagged', async () => {
    // The support question this exists for: they are paying for Professional
    // and sitting on Essential. Either a delivery was missed, or somebody
    // edited over it in this console.
    const practice = await practiceWith(PLAN.ESSENTIAL, {
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
      confirmedAt: new Date(),
    });

    const res = await get(`/admin/practices/${practice._id}`);
    assert.equal(res.body.subscription.disagrees, true);
    assert.equal(res.body.practice.plan, PLAN.ESSENTIAL);
    assert.equal(res.body.subscription.plan, PLAN.PROFESSIONAL);
  });

  test('a cancelled subscription on a different plan is not a disagreement', async () => {
    // Somebody who cancelled Professional and was put back on Essential is in
    // a correct state. Flagging it would train operators to ignore the flag.
    const practice = await practiceWith(PLAN.ESSENTIAL, {
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.CANCELLED,
    });

    const res = await get(`/admin/practices/${practice._id}`);
    assert.equal(res.body.subscription.disagrees, false);
    assert.equal(res.body.subscription.status, SUBSCRIPTION_STATUS.CANCELLED);
  });

  test('a cancelled one is still shown, because "why did they stop" is a question', async () => {
    const practice = await practiceWith(PLAN.TRIAL, {
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.CANCELLED,
    });

    const res = await get(`/admin/practices/${practice._id}`);
    assert.ok(res.body.subscription, 'a cancelled subscription was hidden');
  });

  test('an unconfirmed row does not get a confirmation date invented for it', async () => {
    const practice = await practiceWith(PLAN.TRIAL, {
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.CREATED,
    });

    const res = await get(`/admin/practices/${practice._id}`);
    assert.equal(res.body.subscription.confirmedAt, null);
  });

  test('the platform surface still cannot name a patient', async () => {
    // The rule the whole admin boundary rests on, re-checked from the outside
    // now that this route reaches for another model. A subscription names a
    // practice and a provider id; adding it must not have opened a door.
    const practice = await practiceWith(PLAN.PROFESSIONAL, {
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });
    const { makePatient } = await import('./helpers/factories.js');
    await makePatient({ name: 'Anita Sengupta', practices: [practice] });

    const res = await get(`/admin/practices/${practice._id}`);
    assert.doesNotMatch(
      JSON.stringify(res.body),
      /Anita Sengupta/,
      'the platform console named a patient',
    );
    // The count is legitimate and is what the console shows.
    assert.equal(res.body.usage.patients, 1);
  });

  test('an unauthenticated caller gets nothing', async () => {
    const practice = await practiceWith(PLAN.TRIAL, null);
    const res = await fetch(`${origin}/admin/practices/${practice._id}`);
    assert.equal(res.status, 401);
  });

  test('and a clinic token is not an admin token', async () => {
    // Signed with a different key. The failure is on the signature, so there is
    // no role check to forget.
    const practice = await practiceWith(PLAN.TRIAL, null);
    const doctor = await makeMember(practice, { name: 'Dr Stray' });

    const res = await fetch(`${origin}/admin/practices/${practice._id}`, {
      headers: { Authorization: `Bearer ${doctor.token}` },
    });
    assert.equal(res.status, 401);
  });
});
