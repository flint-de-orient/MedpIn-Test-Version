import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN, Practice } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { env } from '../src/config/env.js';

/**
 * The console's billing surface.
 *
 * ---- The rule these mostly exist to hold -------------------------------
 *
 * Every manual billing action requires a reason. An operator reaching into a
 * practice's arrangement is doing something the customer did not ask for, and
 * the record of it is worth nothing without why — so `reason` is enforced by
 * the validator rather than encouraged by a placeholder, and the tests here
 * check that a request without one is refused rather than defaulted.
 */

const ADMIN_SECRET = 'an_admin_secret_for_the_billing_console_tests';
let origin;
let realAdminSecret;
let token;

async function call(method, path, body) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

describe('the console can read the plans', () => {
  before(async () => {
    origin = await boot();
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

  test('every tier, including the one nobody can buy', async () => {
    // A trial is a plan an operator grants and a customer cannot purchase, so
    // it belongs on the page and not in the checkout list.
    const res = await call('GET', '/admin/billing/plans');
    assert.equal(res.status, 200);

    const names = res.body.plans.map((p) => p.plan);
    assert.deepEqual([...names].sort(), [...Object.values(PLAN)].sort());

    const trial = res.body.plans.find((p) => p.plan === PLAN.TRIAL);
    assert.equal(trial.sellable, false);
  });

  test('capabilities come from the resolver, not a list kept by hand', async () => {
    // The page must not be able to disagree with what a practice experiences.
    const res = await call('GET', '/admin/billing/plans');
    const essential = res.body.plans.find((p) => p.plan === PLAN.ESSENTIAL);

    assert.ok(essential.capabilities.includes('PRESCRIPTION'));
    assert.ok(!essential.capabilities.includes('MULTI_LOCATION'));
    assert.equal(essential.limits.locations, 1, 'the limits disagree with the capability set');
  });

  test('and an unfetchable price is null rather than a guess', async () => {
    const res = await call('GET', '/admin/billing/plans');
    for (const row of res.body.plans) {
      assert.ok(row.amount === null || typeof row.amount === 'number');
    }
    assert.ok('canPrice' in res.body, 'the page cannot explain a blank price');
  });

  test('there is no way to create one', async () => {
    // A tier is an enum entry that gates capabilities and a plan object in
    // Razorpay. A row written from a web form would be a plan the resolver has
    // never heard of — and unknown means unrestricted everywhere here.
    const res = await call('POST', '/admin/billing/plans', { plan: 'platinum' });
    assert.equal(res.status, 404);
  });
});

describe('a manual action must say why', () => {
  before(async () => {
    origin = await boot();
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

  const later = () => new Date(Date.now() + 14 * 86_400_000).toISOString();

  test('extending a trial without a reason is refused', async () => {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.TRIAL });
    const res = await call('POST', `/admin/billing/practices/${practice._id}/extend-trial`, {
      until: later(),
    });
    assert.equal(res.status, 400);
  });

  test('and with one, it moves the date and records both sides', async () => {
    const practice = await makePractice('Sunrise Diabetes Care', {
      plan: PLAN.TRIAL,
      planRenewsOn: new Date('2026-09-15'),
    });

    const res = await call('POST', `/admin/billing/practices/${practice._id}/extend-trial`, {
      until: later(),
      reason: 'Onboarding slipped past their Puja closure.',
    });
    assert.equal(res.status, 200);

    const entry = await AdminAuditLog.findOne({ action: 'admin.practice.trial.extend' }).lean();
    assert.ok(entry, 'nothing was recorded');
    assert.match(entry.reason, /Puja/);
    // Before and after, because "the trial was extended" without the old date
    // cannot be reviewed — only believed.
    assert.ok(entry.before.planRenewsOn);
    assert.ok(entry.after.planRenewsOn);
    assert.notEqual(
      new Date(entry.before.planRenewsOn).getTime(),
      new Date(entry.after.planRenewsOn).getTime(),
    );
  });

  test('a date in the past is refused', async () => {
    // It would not end the trial today. It ended it whenever that was,
    // silently, and the practice finds out by being cut off.
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.TRIAL });
    const res = await call('POST', `/admin/billing/practices/${practice._id}/extend-trial`, {
      until: new Date(Date.now() - 86_400_000).toISOString(),
      reason: 'Typo in the date field.',
    });
    assert.equal(res.status, 400);
  });

  test('and a paying practice cannot be put back onto a trial by accident', async () => {
    // A console that could do that would withdraw capabilities somebody is
    // paying for, from a form whose label says "extend".
    const practice = await makePractice('Sunrise Diabetes Care', {
      plan: PLAN.PROFESSIONAL,
    });
    const res = await call('POST', `/admin/billing/practices/${practice._id}/extend-trial`, {
      until: later(),
      reason: 'Meant to pick the other practice.',
    });
    assert.equal(res.status, 409);

    const after = await Practice.findById(practice._id).lean();
    assert.equal(after.plan, PLAN.PROFESSIONAL);
  });

  test('pausing without a reason is refused before Razorpay is called', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_admin',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    const res = await call('POST', `/admin/billing/practices/${practice._id}/subscription/pause`, {});
    assert.equal(res.status, 400);
    assert.equal(await AdminAuditLog.countDocuments({ action: 'admin.subscription.pause' }), 0);
  });

  test('the grace window can be moved, and the move is recorded', async () => {
    // The override that exists because a policy cannot know a practice
    // manager is in hospital.
    const practice = await makePractice('Sunrise Diabetes Care');
    const sub = await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_grace_admin',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.HALTED,
      graceEndsAt: new Date(Date.now() + 86_400_000),
    });

    const until = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const res = await call('POST', `/admin/billing/practices/${practice._id}/subscription/grace`, {
      until,
      reason: 'Practice manager is in hospital; agreed a month by phone.',
    });
    assert.equal(res.status, 200);

    const after = await Subscription.findById(sub._id).lean();
    assert.equal(new Date(after.graceEndsAt).toISOString(), until);

    const entry = await AdminAuditLog.findOne({ action: 'admin.subscription.grace' }).lean();
    assert.match(entry.reason, /hospital/);
    assert.ok(entry.before.graceEndsAt, 'the old deadline was not kept');
  });

  test('a subscription that is not halted has no grace window to move', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_ok',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    const res = await call('POST', `/admin/billing/practices/${practice._id}/subscription/grace`, {
      until: new Date(Date.now() + 86_400_000).toISOString(),
      reason: 'Trying it on the wrong practice.',
    });
    assert.equal(res.status, 409);
  });
});

describe('the subscriptions list', () => {
  before(async () => {
    origin = await boot();
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

  test('names the practice, because an id is not something to act on', async () => {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.PROFESSIONAL });
    await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_list',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    const res = await call('GET', '/admin/billing/subscriptions');
    assert.equal(res.status, 200);
    assert.equal(res.body.subscriptions[0].practice.name, 'Sunrise Diabetes Care');
    assert.equal(res.body.subscriptions[0].disagrees, false);
  });

  test('the counts are of everything, not of the current filter', async () => {
    /*
     * The counts go on the filter buttons and are the reason to press one:
     * "Payment failed (8)" is a decision, "Payment failed" is a guess.
     *
     * Counting within the filter would show the selected chip's own total
     * beside every other chip reading zero — worse than no counts at all,
     * because it looks like an answer.
     */
    const a = await makePractice('Sunrise Diabetes Care');
    const b = await makePractice('Meridian Family Clinic');
    const c = await makePractice('Riverside Polyclinic');
    await Subscription.create([
      {
        practice: a._id,
        providerSubscriptionId: 'sub_a',
        plan: PLAN.PROFESSIONAL,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      },
      {
        practice: b._id,
        providerSubscriptionId: 'sub_b',
        plan: PLAN.ESSENTIAL,
        status: SUBSCRIPTION_STATUS.HALTED,
      },
      {
        practice: c._id,
        providerSubscriptionId: 'sub_c',
        plan: PLAN.ESSENTIAL,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      },
    ]);

    // Filtered to one row, and the counts still describe the platform.
    const res = await call('GET', '/admin/billing/subscriptions?status=halted');
    assert.equal(res.body.subscriptions.length, 1);
    assert.equal(res.body.counts.active, 2, 'the counts followed the filter');
    assert.equal(res.body.counts.halted, 1);
    assert.equal(res.body.counts.all, 3);
  });

  test('an empty platform counts nothing rather than omitting the key', async () => {
    // The console reads `counts.all` to decide whether to draw the chips at
    // all. An absent key would render "All undefined".
    const res = await call('GET', '/admin/billing/subscriptions');
    assert.equal(res.body.counts.all, 0);
  });

  test('filters to the support queue', async () => {
    const a = await makePractice('Sunrise Diabetes Care');
    const b = await makePractice('Meridian Family Clinic');
    await Subscription.create([
      {
        practice: a._id,
        providerSubscriptionId: 'sub_a',
        plan: PLAN.PROFESSIONAL,
        status: SUBSCRIPTION_STATUS.ACTIVE,
      },
      {
        practice: b._id,
        providerSubscriptionId: 'sub_b',
        plan: PLAN.ESSENTIAL,
        status: SUBSCRIPTION_STATUS.HALTED,
      },
    ]);

    const res = await call('GET', '/admin/billing/subscriptions?status=halted');
    assert.equal(res.body.subscriptions.length, 1);
    assert.equal(res.body.subscriptions[0].providerSubscriptionId, 'sub_b');
  });

  test('and flags a practice paying for one plan while on another', async () => {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.ESSENTIAL });
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_mismatch',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    const res = await call('GET', '/admin/billing/subscriptions');
    assert.equal(res.body.subscriptions[0].disagrees, true);
  });

  test('the whole surface refuses an unauthenticated caller', async () => {
    // It is nested inside the admin router precisely so this cannot be
    // forgotten for one route.
    for (const path of [
      '/admin/billing/plans',
      '/admin/billing/subscriptions',
    ]) {
      const res = await fetch(origin + path);
      assert.equal(res.status, 401, `${path} answered without a session`);
    }
  });
});
