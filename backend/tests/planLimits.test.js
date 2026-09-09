import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { as } from './helpers/httpHarness.js';
import { signPhoneToken } from '../src/services/otp.js';
import { ROLES } from '../src/models/User.js';
import { Practice, PLAN, PLAN_LIMITS, defaultLimitsFor } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { CAPABILITIES as C, capabilitiesOfPractice } from '../src/services/capabilities.js';
import { env } from '../src/config/env.js';

/**
 * What a tier actually restrains.
 *
 * Until this existed, nothing. Every practice starts on all-null limits and
 * nothing derived them from the plan, so Essential and Enterprise were the same
 * product plus a capability list — unless an operator typed three numbers in by
 * hand, per customer, and remembered to. A pricing page promising "up to 500
 * patients" would have been describing a number the software had never heard of.
 */

describe('the table itself', () => {
  test('every plan has a decision', () => {
    for (const plan of Object.values(PLAN)) {
      assert.ok(PLAN_LIMITS[plan], `${plan} has no limits row`);
    }
  });

  test('a plan nobody wrote down gets no limit, not a zero', () => {
    // The rule the rest of this codebase runs on. A tier added to the enum and
    // forgotten here must not refuse a practice its second member.
    assert.deepEqual(defaultLimitsFor('something_new'), {
      patients: null,
      staff: null,
      locations: null,
    });
    assert.deepEqual(defaultLimitsFor(undefined), {
      patients: null,
      staff: null,
      locations: null,
    });
  });

  test('a plan that cannot do multi-location is capped at one', () => {
    // The invariant most likely to drift, because the two facts live in
    // different files. Selling five locations on a plan whose capability set
    // has no MULTI_LOCATION is a promise the resolver refuses to keep.
    for (const plan of Object.values(PLAN)) {
      const held = capabilitiesOfPractice({ plan });
      if (held.has(C.MULTI_LOCATION)) continue;
      const { locations } = defaultLimitsFor(plan);
      assert.equal(
        locations,
        1,
        `${plan} has no MULTI_LOCATION but is given ${locations} locations`,
      );
    }
  });

  test('the paid tiers do not shrink as they get dearer', () => {
    const order = [PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE];
    for (const key of ['patients', 'staff', 'locations']) {
      for (let i = 1; i < order.length; i += 1) {
        const lower = defaultLimitsFor(order[i - 1])[key];
        const upper = defaultLimitsFor(order[i])[key];
        if (upper === null) continue; // unlimited, which is larger than anything
        assert.ok(
          lower !== null && upper > lower,
          `${order[i]} gives ${upper} ${key} where ${order[i - 1]} gives ${lower}`,
        );
      }
    }
  });

  test('enterprise is negotiated, not numbered', () => {
    assert.deepEqual(defaultLimitsFor(PLAN.ENTERPRISE), {
      patients: null,
      staff: null,
      locations: null,
    });
  });
});

describe('paying for a plan grants it', () => {
  const SECRET = 'test_webhook_secret_not_from_your_env';
  let realSecret;
  let origin;

  before(async () => {
    origin = await boot();
    // Set rather than read. A test that used the developer's real secret
    // passes on their machine and fails in CI, and one that asserted the
    // secret was blank failed the moment they pasted a real one — this file
    // has been written both wrong ways before.
    realSecret = env.RAZORPAY_WEBHOOK_SECRET;
    env.RAZORPAY_WEBHOOK_SECRET = SECRET;
  });

  after(async () => {
    env.RAZORPAY_WEBHOOK_SECRET = realSecret;
    await shutdown();
  });

  beforeEach(wipe);

  /** A delivery signed the way Razorpay signs one: over the exact bytes sent. */
  async function deliver(event, subscriptionId, { secret = SECRET, eventId = null } = {}) {
    const body = JSON.stringify({
      event,
      payload: { subscription: { entity: { id: subscriptionId } } },
    });
    const signature = crypto.createHmac('sha256', secret).update(body).digest('hex');

    const res = await fetch(`${origin}/billing/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-razorpay-signature': signature,
        ...(eventId ? { 'x-razorpay-event-id': eventId } : {}),
      },
      body,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  async function setup(plan = PLAN.PROFESSIONAL) {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.TRIAL });
    await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    const sub = await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: `sub_${Date.now()}`,
      plan,
      status: SUBSCRIPTION_STATUS.CREATED,
    });
    return { practice, sub };
  }

  test('an activation moves the practice onto the plan it bought', async () => {
    const { practice, sub } = await setup();

    const res = await deliver('subscription.activated', sub.providerSubscriptionId);
    assert.equal(res.status, 200);

    const after = await Practice.findById(practice._id).lean();
    assert.equal(after.plan, PLAN.PROFESSIONAL, 'the money moved and the product did not');
  });

  test('and the tier’s limits come with it', async () => {
    const { practice, sub } = await setup();
    await deliver('subscription.activated', sub.providerSubscriptionId);

    const after = await Practice.findById(practice._id).lean();
    const expected = defaultLimitsFor(PLAN.PROFESSIONAL);
    assert.equal(after.limits.patients, expected.patients);
    assert.equal(after.limits.staff, expected.staff);
    assert.equal(after.limits.locations, expected.locations);
  });

  test('a forged delivery changes nothing', async () => {
    // The whole security argument for the endpoint, over the wire rather than
    // by reading the comparison.
    const { practice, sub } = await setup();

    const res = await deliver('subscription.activated', sub.providerSubscriptionId, {
      secret: 'not-the-webhook-secret',
    });
    assert.notEqual(res.status, 200, 'a bad signature was accepted');

    const after = await Practice.findById(practice._id).lean();
    assert.equal(after.plan, PLAN.TRIAL, 'a forged webhook upgraded a practice');
  });

  test('a halt does not downgrade anybody', async () => {
    // Pinning a deliberate non-decision. What a lapse costs a practice is an
    // open product question with a clinical cost attached — a doctor unable to
    // open a record mid-consultation because a card expired. Until somebody
    // chooses, the honest behaviour is to record the status and touch nothing,
    // and this test is what stops that being quietly answered by an edit.
    const { practice, sub } = await setup();
    await deliver('subscription.activated', sub.providerSubscriptionId, { eventId: 'evt_1' });
    await deliver('subscription.halted', sub.providerSubscriptionId, { eventId: 'evt_2' });

    const after = await Practice.findById(practice._id).lean();
    assert.equal(after.plan, PLAN.PROFESSIONAL, 'a halt silently downgraded a practice');

    const subAfter = await Subscription.findById(sub._id).lean();
    assert.equal(subAfter.status, SUBSCRIPTION_STATUS.HALTED, 'the halt was not recorded');
  });

  test('a redelivery is not a second upgrade', async () => {
    const { practice, sub } = await setup();
    await deliver('subscription.activated', sub.providerSubscriptionId, { eventId: 'evt_same' });
    const second = await deliver('subscription.activated', sub.providerSubscriptionId, {
      eventId: 'evt_same',
    });

    assert.equal(second.body?.duplicate, true, 'a redelivery was processed again');
    const after = await Practice.findById(practice._id).lean();
    assert.equal(after.plan, PLAN.PROFESSIONAL);
  });
});

describe('and the console applies them the same way', () => {
  // A source test, and said plainly: the admin router authenticates by cookie
  // and CSRF header, so reaching it over the wire needs a session harness this
  // file does not have. What it pins is the two things that would be silently
  // wrong — the gate and the ordering — and neither is a claim about behaviour
  // this file has observed.
  const admin = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
  const body = admin.slice(admin.indexOf("'/practices/:id/plan'"));

  test('the defaults are written only when the plan actually changes', () => {
    // Not on every save. Editing `planRenewsOn` must not silently discard a
    // limit somebody negotiated.
    assert.match(body, /const planChanged = Boolean\(req\.body\.plan\) && req\.body\.plan !== practice\.plan;/);
    assert.match(body, /if \(planChanged\) \{[\s\S]{0,200}defaultLimitsFor\(practice\.plan\)/);
  });

  test('and an explicit limit in the same request still wins', () => {
    // Ordering is the whole of it: defaults first, the operator's numbers
    // after. Reversed, "this plan but these numbers" silently becomes "this
    // plan", and the negotiated case the per-practice field exists for is gone.
    const defaults = body.indexOf('defaultLimitsFor(practice.plan)');
    const explicit = body.indexOf('req.body.limits?.[k] !== undefined');
    assert.ok(defaults > -1 && explicit > -1, 'the plan block moved');
    assert.ok(defaults < explicit, 'plan defaults are applied after the operator’s own numbers');
  });
});

describe('the staff cap counts people, not non-clinicians', () => {
  // The field is called `staff` and the counter has never had a role filter,
  // so the owner and every doctor count towards it. That is the honest reading
  // of "how many people is this practice" and it is what the refusal message
  // says — but the name invites somebody to "fix" the query to exclude
  // clinicians, which would silently widen every cap by however many doctors a
  // practice has. This is a behavioural test so that change fails here.
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('the owner occupies one of the places', async () => {
    // Cap of two, and the owner is already one of them: exactly one hire fits.
    const practice = await makePractice('Sunrise Diabetes Care', {
      plan: PLAN.ESSENTIAL,
      limits: { patients: null, staff: 2, locations: null },
    });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });

    const hire = (name) =>
      as(owner.token).post('/team', {
        role: ROLES.STAFF,
        name,
        phoneToken: signPhoneToken(`+9198${String(Date.now()).slice(-6)}${name.length}`),
      });

    const first = await hire('Sunita Desk');
    assert.ok(first.status < 400, `the one available place was refused: ${JSON.stringify(first.body)}`);

    const second = await hire('Ravi Desk');
    assert.equal(second.status, 409, 'the cap did not bite once the practice was full');
    assert.match(
      JSON.stringify(second.body),
      /limit of 2 people/,
      'the refusal does not say how many people are allowed',
    );
  });

  test('and a practice with no cap is not capped', async () => {
    // Every practice today, the founding clinic included.
    const practice = await makePractice('Meridian Family Clinic');
    const owner = await makeMember(practice, { name: 'Dr Iyer', isOwner: true });

    for (const name of ['One Desk', 'Two Desk', 'Three Desk']) {
      const res = await as(owner.token).post('/team', {
        role: ROLES.STAFF,
        name,
        phoneToken: signPhoneToken(`+9197${String(Date.now()).slice(-6)}${name.length}`),
      });
      assert.ok(res.status < 400, `an uncapped practice was refused a hire: ${JSON.stringify(res.body)}`);
    }
  });
});
