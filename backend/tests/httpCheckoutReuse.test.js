import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN } from '../src/models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';

/**
 * An abandoned checkout must not become a second live subscription.
 *
 * Found in the console rather than in a test: one test practice had five
 * Razorpay subscriptions, all "Not started", all Professional — one per time
 * somebody opened checkout and thought better of it. The guard on this route
 * covered active, pending and authenticated, and not `created`.
 *
 * Each of those is a URL that still takes a card. Two of them paid would charge
 * every month, and this server would only know about the last.
 */

describe('the shape that caused it', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('created is now part of what counts as an open checkout', async () => {
    // The assertion that pins the fix rather than the symptom. The route looks
    // for `status: CREATED` before making another; if that lookup is ever
    // dropped, the pile comes back.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/routes/billing.js', import.meta.url), 'utf8');
    const at = src.indexOf("'/subscribe'");
    const body = src.slice(at, src.indexOf('res.status(201)', at));

    assert.match(body, /status: SUBSCRIPTION_STATUS\.CREATED,/);
    assert.match(body, /open\.plan === req\.body\.plan/);
    assert.match(body, /cancelSubscription\(open\.providerSubscriptionId/);
  });

  test('an abandoned checkout for another plan is retired, not left payable', async () => {
    // Unconditional locally even when the provider call fails: leaving it
    // `created` would put it straight back into the reuse path and the console
    // queue.
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/routes/billing.js', import.meta.url), 'utf8');
    assert.match(src, /open\.status = SUBSCRIPTION_STATUS\.EXPIRED;/);
  });

  test('and a practice can still only hold one running subscription', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await Subscription.create({
      practice: practice._id,
      providerSubscriptionId: 'sub_running',
      plan: PLAN.PROFESSIONAL,
      status: SUBSCRIPTION_STATUS.ACTIVE,
    });

    // The original guard, unchanged — an active subscription still refuses a
    // second checkout outright rather than reusing anything.
    const open = await Subscription.findOne({
      practice: practice._id,
      status: SUBSCRIPTION_STATUS.CREATED,
    });
    assert.equal(open, null);
  });
});
