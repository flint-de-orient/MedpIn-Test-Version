import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN, Practice } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import {
  CHANGE,
  SCHEDULE,
  directionOf,
  describeChange,
  mayChangePlan,
  mayPause,
  mayResume,
} from '../src/services/billing/lifecycle.js';
import { env } from '../src/config/env.js';

/**
 * Moving between plans, pausing, and coming back.
 *
 * The policy, decided by the operator on 2026-09-10:
 *
 *   An upgrade takes effect immediately, with no proration.
 *   A downgrade takes effect at the end of the paid period.
 *
 * Both were chosen so money never moves backwards, and that is the property
 * these protect rather than the dates. The dates can be tuned; a refund path
 * cannot be un-built.
 */

const SECRET = 'lifecycle_test_webhook_secret';
let origin;
let realSecret;
let realId;
let realKeySecret;

async function deliver(event, subscriptionId, extra = {}) {
  const body = JSON.stringify({
    event,
    payload: { subscription: { entity: { id: subscriptionId, ...extra } } },
  });
  const signature = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await fetch(`${origin}/billing/webhook`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-razorpay-signature': signature,
      'x-razorpay-event-id': `evt_${Math.random().toString(16).slice(2)}`,
    },
    body,
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

describe('which way is this change', () => {
  test('by rank, not by price or declaration order', () => {
    assert.equal(directionOf(PLAN.ESSENTIAL, PLAN.PROFESSIONAL), CHANGE.UPGRADE);
    assert.equal(directionOf(PLAN.ENTERPRISE, PLAN.ESSENTIAL), CHANGE.DOWNGRADE);
    assert.equal(directionOf(PLAN.TRIAL, PLAN.ESSENTIAL), CHANGE.UPGRADE);
    assert.equal(directionOf(PLAN.PROFESSIONAL, PLAN.PROFESSIONAL), CHANGE.SAME);
  });

  test('a plan nobody ranked yields null, and the route refuses', () => {
    // Guessing upgrade bills somebody immediately for a tier we do not
    // understand; guessing downgrade gives it to them for a month for nothing.
    assert.equal(directionOf(PLAN.ESSENTIAL, 'platinum'), null);
    assert.equal(directionOf('platinum', PLAN.ESSENTIAL), null);
    assert.equal(describeChange(PLAN.ESSENTIAL, 'platinum'), null);
  });

  test('the schedule follows the direction and nothing else', () => {
    assert.equal(SCHEDULE[CHANGE.UPGRADE], 'now');
    assert.equal(SCHEDULE[CHANGE.DOWNGRADE], 'cycle_end');
  });

  test('and each direction explains itself in a sentence somebody reads', () => {
    const up = describeChange(PLAN.ESSENTIAL, PLAN.PROFESSIONAL);
    assert.match(up.effect, /nothing extra is charged today/i);

    const down = describeChange(PLAN.PROFESSIONAL, PLAN.ESSENTIAL);
    assert.match(down.effect, /Nothing changes until then/i);
  });

  test('only a running subscription may change plan', () => {
    assert.ok(mayChangePlan(SUBSCRIPTION_STATUS.ACTIVE));
    assert.ok(mayChangePlan(SUBSCRIPTION_STATUS.AUTHENTICATED));
    // Halted has money outstanding: moving it dearer stacks a second failing
    // charge on the first.
    assert.ok(!mayChangePlan(SUBSCRIPTION_STATUS.HALTED));
    assert.ok(!mayChangePlan(SUBSCRIPTION_STATUS.CANCELLED));
    assert.ok(!mayChangePlan(SUBSCRIPTION_STATUS.PAUSED));
  });

  test('pause and resume are opposites and neither is idempotent by accident', () => {
    assert.ok(mayPause(SUBSCRIPTION_STATUS.ACTIVE));
    assert.ok(!mayPause(SUBSCRIPTION_STATUS.PAUSED), 'pausing a paused subscription');
    assert.ok(mayResume(SUBSCRIPTION_STATUS.PAUSED));
    assert.ok(!mayResume(SUBSCRIPTION_STATUS.ACTIVE), 'resuming a running subscription');
  });
});

describe('over the wire', () => {
  before(async () => {
    origin = await boot();
    realSecret = env.RAZORPAY_WEBHOOK_SECRET;
    realId = env.RAZORPAY_KEY_ID;
    realKeySecret = env.RAZORPAY_KEY_SECRET;
    env.RAZORPAY_WEBHOOK_SECRET = SECRET;
    // Configured, but pointing nowhere real — every route below is refused
    // before it would reach the network.
    env.RAZORPAY_KEY_ID = 'rzp_test_lifecycle';
    env.RAZORPAY_KEY_SECRET = 'nope';
  });

  after(async () => {
    env.RAZORPAY_WEBHOOK_SECRET = realSecret;
    env.RAZORPAY_KEY_ID = realId;
    env.RAZORPAY_KEY_SECRET = realKeySecret;
    await shutdown();
  });

  beforeEach(wipe);

  async function setup({ status = SUBSCRIPTION_STATUS.ACTIVE, plan = PLAN.PROFESSIONAL } = {}) {
    const practice = await makePractice('Sunrise Diabetes Care', { plan });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    const sub = await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_life',
      plan,
      status,
    });
    return { practice, owner, sub };
  }

  test('changing to the plan you are already on is not a change', async () => {
    // Answered rather than sent to Razorpay. A no-op that costs a network call
    // is a no-op that can fail.
    const { owner } = await setup();
    const res = await as(owner.token).post('/billing/change-plan', {
      plan: PLAN.PROFESSIONAL,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.changed, false);
    assert.equal(res.body.direction, CHANGE.SAME);
  });

  test('a halted subscription is refused, and told why', async () => {
    const { owner } = await setup({ status: SUBSCRIPTION_STATUS.HALTED });
    const res = await as(owner.token).post('/billing/change-plan', {
      plan: PLAN.ENTERPRISE,
    });
    assert.equal(res.status, 409);
    assert.match(JSON.stringify(res.body), /payment outstanding/i);
  });

  test('a practice with no subscription gets a 404, not a 500', async () => {
    const practice = await makePractice('Meridian Family Clinic');
    const owner = await makeMember(practice, { name: 'Dr Iyer', isOwner: true });
    const res = await as(owner.token).post('/billing/change-plan', {
      plan: PLAN.ESSENTIAL,
    });
    assert.equal(res.status, 404);
  });

  test('pausing something already paused is refused', async () => {
    const { owner } = await setup({ status: SUBSCRIPTION_STATUS.PAUSED });
    const res = await as(owner.token).post('/billing/pause', {});
    assert.equal(res.status, 409);
  });

  test('and resuming something running is refused', async () => {
    const { owner } = await setup({ status: SUBSCRIPTION_STATUS.ACTIVE });
    const res = await as(owner.token).post('/billing/resume', {});
    assert.equal(res.status, 409);
  });

  test('a doctor without MANAGE_STAFF may not change the plan', async () => {
    const { practice } = await setup();
    const { PERMISSIONS } = await import('../src/models/Membership.js');
    const { ROLES } = await import('../src/models/User.js');
    const plain = await makeMember(practice, {
      name: 'Dr Junior',
      role: ROLES.DOCTOR,
      permissions: [PERMISSIONS.VIEW_PATIENT, PERMISSIONS.PRESCRIBE],
    });

    const res = await as(plain.token).post('/billing/change-plan', {
      plan: PLAN.ENTERPRISE,
    });
    assert.equal(res.status, 403);
  });
});

describe('a scheduled downgrade lands when the provider says so', () => {
  before(async () => {
    origin = await boot();
    realSecret = env.RAZORPAY_WEBHOOK_SECRET;
    env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });

  after(async () => {
    env.RAZORPAY_WEBHOOK_SECRET = realSecret;
    await shutdown();
  });

  beforeEach(wipe);

  async function pending() {
    const practice = await makePractice('Sunrise Diabetes Care', {
      plan: PLAN.PROFESSIONAL,
    });
    await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    const sub = await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_down',
      plan: PLAN.PROFESSIONAL,
      pendingPlan: PLAN.ESSENTIAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });
    return { practice, sub };
  }

  test('a charge still on the old plan does not land it early', async () => {
    // The ordinary state for every charge between the request and the period
    // end. Landing here would take the larger tier away weeks early.
    const { sub } = await pending();
    await deliver('subscription.charged', 'sub_down', {
      plan_id: env.RAZORPAY_PLAN_PROFESSIONAL || 'plan_professional',
    });

    const after = await Subscription.findById(sub._id).lean();
    assert.equal(after.plan, PLAN.PROFESSIONAL);
    assert.equal(after.pendingPlan, PLAN.ESSENTIAL, 'the pending change was lost');
  });

  test('and the practice keeps the larger tier meanwhile', async () => {
    // The reason `pendingPlan` is a separate field: every capability check
    // reads `Practice.plan`, so writing the downgrade there early would
    // withdraw features somebody has paid for.
    const { practice } = await pending();
    const row = await Practice.findById(practice._id).lean();
    assert.equal(row.plan, PLAN.PROFESSIONAL);
  });

  test('a paused subscription is recorded as paused', async () => {
    const { sub } = await pending();
    await deliver('subscription.paused', 'sub_down');
    const after = await Subscription.findById(sub._id).lean();
    assert.equal(after.status, SUBSCRIPTION_STATUS.PAUSED);
  });

  test('and resuming puts it back to active', async () => {
    const { sub } = await pending();
    await deliver('subscription.paused', 'sub_down');
    await deliver('subscription.resumed', 'sub_down');
    const after = await Subscription.findById(sub._id).lean();
    assert.equal(after.status, SUBSCRIPTION_STATUS.ACTIVE);
  });

  test('pausing does not restrict a practice', async () => {
    // A clinic that has told us it is pausing has not stopped paying, and
    // treating the two the same would make the honest thing the expensive one.
    const { practice } = await pending();
    await deliver('subscription.paused', 'sub_down');

    const { billingStateOf, BILLING_STATE } = await import(
      '../src/services/billing/lapse.js'
    );
    const state = await billingStateOf(practice._id);
    assert.equal(state.state, BILLING_STATE.OK);
    assert.deepEqual(state.blocks, []);
  });
});
