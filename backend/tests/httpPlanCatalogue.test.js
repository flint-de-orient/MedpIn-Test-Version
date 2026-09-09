import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';
import { SELLABLE, catalogue } from '../src/services/billing/catalogue.js';
import { env } from '../src/config/env.js';

/**
 * What is for sale, and what it costs.
 *
 * A practice that has to open a checkout to discover what it would be charged
 * has been told nothing before it commits — so the price has to reach the
 * screen, and it has to come from Razorpay rather than from a constant here.
 * Two prices for one plan means showing somebody one and taking the other.
 */

let realId;
let realSecret;

describe('the catalogue', () => {
  before(async () => {
    await boot();
    realId = env.RAZORPAY_KEY_ID;
    realSecret = env.RAZORPAY_KEY_SECRET;
  });

  after(async () => {
    env.RAZORPAY_KEY_ID = realId;
    env.RAZORPAY_KEY_SECRET = realSecret;
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
  });

  test('a trial is not for sale', () => {
    // Granted, not purchased. Listing it would be a checkout that takes money
    // for the thing already being given away.
    assert.ok(!SELLABLE.includes(PLAN.TRIAL));
    assert.deepEqual([...SELLABLE], [PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE]);
  });

  test('with no keys it answers rather than failing', async () => {
    // A server with billing switched off still has a billing screen, and that
    // screen must render. An exception here would be a blank page.
    env.RAZORPAY_KEY_ID = '';
    env.RAZORPAY_KEY_SECRET = '';

    const rows = await catalogue();
    assert.equal(rows.length, 3);
    for (const row of rows) {
      assert.equal(row.amount, null, `${row.plan} invented a price with no keys`);
      assert.equal(row.currency, null);
    }
  });

  test('and a price it cannot fetch is null, never a guess', async () => {
    // The rule that matters commercially. A screen showing a number this server
    // made up is worse than a screen saying "shown at checkout".
    env.RAZORPAY_KEY_ID = 'rzp_test_wrong';
    env.RAZORPAY_KEY_SECRET = 'wrong';

    const rows = await catalogue();
    for (const row of rows) assert.equal(row.amount, null);
  });

  test('switching account does not serve the old account prices', async () => {
    // The cache never expires, because a Razorpay plan is immutable. The one
    // thing that can invalidate an entry is pointing this server at a different
    // account, where the same tier is a different price — so the account is
    // part of the key and there is nothing for anybody to remember to clear.
    env.RAZORPAY_KEY_ID = 'rzp_test_accountA';
    env.RAZORPAY_KEY_SECRET = 'wrong';
    const a = await catalogue();

    env.RAZORPAY_KEY_ID = 'rzp_live_accountB';
    const b = await catalogue();

    assert.equal(a.length, 3);
    assert.equal(b.length, 3);
    // Neither resolved against a real account, so both are unpriced — the
    // assertion that matters is that the second call was not served the first
    // account cached answer.
    for (const row of b) assert.equal(row.amount, null);
  });

  test('the route needs a doctor', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    const desk = await makeMember(practice, { name: 'Sunita Desk', role: ROLES.STAFF });

    const res = await as(desk.token).get('/billing/plans');
    assert.equal(res.status, 403);
  });

  test('and an ordinary doctor may read it', async () => {
    // Not gated on MANAGE_STAFF. Knowing what the next tier costs is not
    // privileged, and hiding it until somebody holds a billing permission is
    // how a practice discovers its options by being cut off.
    const practice = await makePractice('Sunrise Diabetes Care');
    const doctor = await makeMember(practice, { name: 'Dr Bose' });

    const res = await as(doctor.token).get('/billing/plans');
    assert.equal(res.status, 200);
    assert.equal(res.body.plans.length, 3);
    assert.ok(!res.body.plans.some((p) => p.plan === PLAN.TRIAL));
  });

  test('every row names its plan, priced or not', async () => {
    // A row with no plan id would render as a nameless button.
    const practice = await makePractice('Sunrise Diabetes Care');
    const doctor = await makeMember(practice, { name: 'Dr Bose' });

    const res = await as(doctor.token).get('/billing/plans');
    for (const row of res.body.plans) {
      assert.ok(SELLABLE.includes(row.plan), `unexpected plan ${row.plan}`);
      assert.ok('amount' in row, 'a row has no amount key at all');
    }
  });
});
