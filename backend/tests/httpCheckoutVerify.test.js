import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN, Practice } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { PERMISSIONS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';
import { env } from '../src/config/env.js';

/**
 * "Flutter payment success is not payment truth."
 *
 * The app's success callback arrives over a channel the app controls, on a
 * device somebody else owns. A patched build can call it with any three strings
 * it likes. These are the tests that the server does not take its word for it.
 */

const KEY_ID = 'rzp_test_harness';
const KEY_SECRET = 'a_test_api_key_secret_not_from_your_env';

let realId;
let realSecret;

/** Signed the way Razorpay signs a subscription checkout: payment|subscription. */
function sign(paymentId, subscriptionId, secret = KEY_SECRET) {
  return crypto
    .createHmac('sha256', secret)
    .update(`${paymentId}|${subscriptionId}`)
    .digest('hex');
}

describe('a checkout callback is verified, not believed', () => {
  before(async () => {
    await boot();
    realId = env.RAZORPAY_KEY_ID;
    realSecret = env.RAZORPAY_KEY_SECRET;
    env.RAZORPAY_KEY_ID = KEY_ID;
    env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  });

  after(async () => {
    env.RAZORPAY_KEY_ID = realId;
    env.RAZORPAY_KEY_SECRET = realSecret;
    await shutdown();
  });

  beforeEach(wipe);

  async function setup({ status = SUBSCRIPTION_STATUS.CREATED, subId = 'sub_one' } = {}) {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.TRIAL });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    const sub = await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: subId,
      plan: PLAN.PROFESSIONAL,
      status,
    });
    return { practice, owner, sub };
  }

  test('a genuine signature moves it to authenticated', async () => {
    const { owner } = await setup();

    const res = await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one'),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.verified, true);
    assert.equal(res.body.status, SUBSCRIPTION_STATUS.AUTHENTICATED);

    const after = await Subscription.findOne({ providerSubscriptionId: 'sub_one' }).lean();
    assert.equal(after.providerPaymentId, 'pay_1');
    assert.ok(after.checkoutVerifiedAt, 'the verification was not recorded');
  });

  test('but it does NOT put the practice on the plan', async () => {
    // The architectural rule, at its sharpest. A verified signature proves a
    // human authorised a mandate; it does not prove money moved. The first
    // charge on a subscription can still fail.
    const { practice, owner } = await setup();

    await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one'),
    });

    const after = await Practice.findById(practice._id).lean();
    assert.equal(after.plan, PLAN.TRIAL, 'verification granted the plan; only the webhook may');
  });

  test('a forged signature changes nothing', async () => {
    const { owner } = await setup();

    const res = await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one', 'not-the-api-secret'),
    });

    assert.equal(res.status, 400);

    const after = await Subscription.findOne({ providerSubscriptionId: 'sub_one' }).lean();
    assert.equal(after.status, SUBSCRIPTION_STATUS.CREATED);
    assert.equal(after.checkoutVerifiedAt, null);
    assert.equal(after.providerPaymentId, null);
  });

  test('and so does a transposed one', async () => {
    // The ordering trap. A one-off order signs `order|payment`; a subscription
    // signs `payment|subscription`. Getting it backwards produces a signature
    // that never matches, and the usual "fix" for that is to stop checking.
    const { owner } = await setup();
    const backwards = crypto
      .createHmac('sha256', KEY_SECRET)
      .update(`sub_one|pay_1`)
      .digest('hex');

    const res = await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: backwards,
    });
    assert.equal(res.status, 400, 'the wrong field order was accepted');
  });

  test('a valid signature for another practice’s subscription is refused', async () => {
    // A doctor holding a genuine receipt of their own must not be able to mark
    // somebody else's subscription authenticated. The practice is in the lookup
    // filter, so this is a 404 before the signature is ever checked.
    await setup({ subId: 'sub_theirs' });

    const mine = await makePractice('Meridian Family Clinic');
    const iyer = await makeMember(mine, { name: 'Dr Iyer', isOwner: true });

    const res = await as(iyer.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_theirs',
      signature: sign('pay_1', 'sub_theirs'),
    });

    assert.equal(res.status, 404);

    const after = await Subscription.findOne({ providerSubscriptionId: 'sub_theirs' }).lean();
    assert.equal(after.status, SUBSCRIPTION_STATUS.CREATED, 'another practice authenticated it');
  });

  test('verifying twice does not walk an active subscription backwards', async () => {
    // The phone that lost its connection retries on next launch, by which time
    // the webhook may have arrived. A retry must not undo an activation.
    const { owner } = await setup({ status: SUBSCRIPTION_STATUS.ACTIVE });

    const res = await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one'),
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, SUBSCRIPTION_STATUS.ACTIVE);
    assert.equal(res.body.activated, true);
  });

  test('and the first verification time is kept, not overwritten', async () => {
    const { owner } = await setup();
    const body = {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one'),
    };

    await as(owner.token).post('/billing/verify', body);
    const first = await Subscription.findOne({ providerSubscriptionId: 'sub_one' }).lean();

    await as(owner.token).post('/billing/verify', body);
    const second = await Subscription.findOne({ providerSubscriptionId: 'sub_one' }).lean();

    assert.equal(
      new Date(first.checkoutVerifiedAt).getTime(),
      new Date(second.checkoutVerifiedAt).getTime(),
      'a retry rewrote when the customer actually paid',
    );
  });

  test('a doctor without MANAGE_STAFF may not verify', async () => {
    // Same guard as starting the checkout. Committing a practice to a monthly
    // charge is not an ordinary clinical act, and neither is confirming one.
    const practice = await makePractice('Sunrise Diabetes Care');
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_one',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.CREATED,
    });
    const plain = await makeMember(practice, {
      name: 'Dr Junior',
      role: ROLES.DOCTOR,
      permissions: [PERMISSIONS.VIEW_PATIENT, PERMISSIONS.PRESCRIBE],
    });

    const res = await as(plain.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one'),
    });
    assert.equal(res.status, 403);
  });

  test('an unknown subscription is a 404, not a 500', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });

    const res = await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_never_created',
      signature: sign('pay_1', 'sub_never_created'),
    });
    assert.equal(res.status, 404);
  });

  test('no card detail is stored, whatever the client sends', async () => {
    // The property that keeps this server out of PCI scope. The schema has no
    // field for it and the validator rejects anything extra, so a client that
    // helpfully forwarded a card number could not persist one.
    const { owner } = await setup();

    await as(owner.token).post('/billing/verify', {
      paymentId: 'pay_1',
      subscriptionId: 'sub_one',
      signature: sign('pay_1', 'sub_one'),
      card: '4111111111111111',
      cvv: '123',
    });

    const after = await Subscription.findOne({ providerSubscriptionId: 'sub_one' }).lean();
    assert.doesNotMatch(JSON.stringify(after), /4111111111111111|"cvv"/);
  });
});
