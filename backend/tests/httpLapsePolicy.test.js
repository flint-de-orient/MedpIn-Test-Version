import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PLAN } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { ROLES } from '../src/models/User.js';
import { signPhoneToken } from '../src/services/otp.js';
import {
  BILLING_STATE,
  RESTRICTED,
  billingStateOf,
  graceEndsFrom,
} from '../src/services/billing/lapse.js';
import { env } from '../src/config/env.js';

/**
 * What a lapsed payment costs a practice.
 *
 * The policy, decided by the operator on 2026-09-09 and stated in their words:
 *
 *   "Payment lapse should restrict business growth and premium capabilities,
 *    but should not interrupt essential clinical continuity or put existing
 *    patient data at risk."
 *
 * So the tests that matter most here are the negative ones. Anybody can make a
 * paywall; the work is in making sure it never reaches a patient record, and
 * those assertions are the ones that must fail loudly if somebody widens
 * `RESTRICTED` without thinking.
 */

const DAY = 86_400_000;
let realGrace;

async function lapse(practice, { daysAgo = 30 } = {}) {
  // Halted, and the grace window closed `daysAgo - 7` days back.
  return Subscription.create({
    practice: practice._id,
    providerSubscriptionId: `sub_${practice._id}`,
    plan: PLAN.PROFESSIONAL,
    status: SUBSCRIPTION_STATUS.HALTED,
    confirmedAt: new Date(Date.now() - daysAgo * DAY),
    graceEndsAt: new Date(Date.now() - (daysAgo - 7) * DAY),
  });
}

describe('a lapse stops growth', () => {
  before(async () => {
    await boot();
    realGrace = env.BILLING_GRACE_DAYS;
    env.BILLING_GRACE_DAYS = 7;
  });

  after(async () => {
    env.BILLING_GRACE_DAYS = realGrace;
    await shutdown();
  });

  beforeEach(wipe);

  test('no subscription is not a lapse', async () => {
    // Every practice on the platform today, the founding clinic included.
    // Getting this wrong restricts the only real customer on the deploy.
    const practice = await makePractice('Sunrise Diabetes Care');
    const state = await billingStateOf(practice._id);
    assert.equal(state.state, BILLING_STATE.OK);
    assert.deepEqual(state.blocks, []);
  });

  test('a retrying card withholds nothing', async () => {
    // Cards expire and banks decline; most of these resolve on the second
    // attempt. Restricting during retries would punish an accident.
    const practice = await makePractice('Sunrise Diabetes Care');
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_pending',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.PENDING,
    });

    const state = await billingStateOf(practice._id);
    assert.equal(state.state, BILLING_STATE.PAST_DUE);
    assert.deepEqual(state.blocks, []);
  });

  test('inside the grace window, still nothing', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_grace',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.HALTED,
      graceEndsAt: new Date(Date.now() + 3 * DAY),
    });

    const state = await billingStateOf(practice._id);
    assert.equal(state.state, BILLING_STATE.GRACE);
    assert.deepEqual(state.blocks, []);
  });

  test('after it, growth is blocked', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    await lapse(practice);

    const state = await billingStateOf(practice._id);
    assert.equal(state.state, BILLING_STATE.RESTRICTED);
    assert.deepEqual([...state.blocks].sort(), [...RESTRICTED].sort());
  });

  test('a practice cannot add a person', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await lapse(practice);

    const res = await as(owner.token).post('/team', {
      role: ROLES.STAFF,
      name: 'Sunita Desk',
      phoneToken: signPhoneToken('+919812349999'),
    });

    assert.equal(res.status, 409);
    assert.match(JSON.stringify(res.body), /payment is outstanding/);
    // And it says what is unaffected, so a manager does not assume the worst.
    assert.match(JSON.stringify(res.body), /already here keeps working/);
  });

  test('nor a location', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await lapse(practice);

    const res = await as(owner.token).post('/clinics', { name: 'Sunrise Salt Lake' });
    assert.equal(res.status, 409);
    assert.match(JSON.stringify(res.body), /payment is outstanding/);
  });
});

describe('and a lapse never reaches the clinical work', () => {
  before(async () => {
    await boot();
    realGrace = env.BILLING_GRACE_DAYS;
    env.BILLING_GRACE_DAYS = 7;
  });

  after(async () => {
    env.BILLING_GRACE_DAYS = realGrace;
    await shutdown();
  });

  beforeEach(wipe);

  test('nothing clinical is on the blocked list', async () => {
    // The assertion that has to fail if somebody widens RESTRICTED without
    // thinking. Named actions rather than a count, so adding a growth action is
    // fine and adding a clinical one is not.
    for (const forbidden of [
      'PRESCRIPTION',
      'LAB_ORDER',
      'LAB_RESULT',
      'AI_ASSISTANT',
      'VIEW_PATIENT',
      'EDIT_RECORD',
    ]) {
      assert.ok(
        !RESTRICTED.includes(forbidden),
        `${forbidden} is withheld on a lapse, which makes an unpaid invoice a clinical problem`,
      );
    }
  });

  test('a doctor still reads their patients', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    await lapse(practice);

    const res = await as(owner.token).get('/team');
    assert.equal(res.status, 200, 'a lapsed practice could not read its own team');
  });

  test('a practice can always take its own records out', async () => {
    /*
     * The export is not a report. It is named patients, their phone numbers and
     * their readings — a copy of the clinic's own record — and withholding it
     * over an unpaid invoice holds medical records hostage. It does so to
     * exactly the practice that needs them most, because a customer who has
     * stopped paying is usually one who is leaving.
     *
     * This was on the restricted list until an operator caught it.
     */
    assert.ok(
      !RESTRICTED.includes('REPORT_EXPORT'),
      'a lapsed practice cannot get its own patient records out',
    );

    const practice = await makePractice('Sunrise Diabetes Care');
    await lapse(practice);
    const state = await billingStateOf(practice._id);
    assert.equal(state.state, BILLING_STATE.RESTRICTED, 'the fixture stopped being a lapse');
    assert.ok(!state.blocks.includes('REPORT_EXPORT'));
  });

  test('withholding insight is allowed; withholding access is not', async () => {
    // The line this policy holds. Analytics interpret data the practice can
    // still take with it in full; export IS the data.
    assert.ok(RESTRICTED.includes('ADVANCED_ANALYTICS'));
    assert.ok(!RESTRICTED.includes('REPORT_EXPORT'));
  });

  test('and the assistant is not silenced', async () => {
    // The one real marginal cost, and deliberately not withheld: a patient
    // asking whether a symptom matters is not party to their clinic's billing,
    // and silence is the one reply that could hurt them.
    assert.ok(!RESTRICTED.includes('AI_ASSISTANT'));
  });

  test('the whole thing is off when nobody configured it', async () => {
    // Zero days means no practice is ever restricted, whatever its state.
    const practice = await makePractice('Sunrise Diabetes Care');
    await lapse(practice);

    env.BILLING_GRACE_DAYS = 0;
    try {
      const state = await billingStateOf(practice._id);
      assert.equal(state.state, BILLING_STATE.GRACE, 'a practice was restricted with the policy off');
      assert.deepEqual(state.blocks, []);
    } finally {
      env.BILLING_GRACE_DAYS = 7;
    }
  });

  test('a broken database permits rather than restricts', async () => {
    // Fails open, like every other check here. One unbilled week costs less
    // than a working clinic told it cannot register a patient.
    const state = await billingStateOf('not-an-object-id');
    assert.equal(state.state, BILLING_STATE.OK);
  });
});

describe('the deadline is stamped, not recomputed', () => {
  before(boot);
  after(shutdown);

  test('graceEndsFrom respects the configured window', () => {
    const was = env.BILLING_GRACE_DAYS;
    env.BILLING_GRACE_DAYS = 7;
    try {
      const at = new Date('2026-09-09T00:00:00Z');
      const end = graceEndsFrom(at);
      assert.equal(end.toISOString().slice(0, 10), '2026-09-16');
    } finally {
      env.BILLING_GRACE_DAYS = was;
    }
  });

  test('and is null where the policy is off', () => {
    const was = env.BILLING_GRACE_DAYS;
    env.BILLING_GRACE_DAYS = 0;
    try {
      assert.equal(graceEndsFrom(), null);
    } finally {
      env.BILLING_GRACE_DAYS = was;
    }
  });
});
