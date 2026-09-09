import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PLAN, defaultLimitsFor } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';
import { Clinic } from '../src/models/Clinic.js';

/**
 * What a practice is told about its own plan.
 *
 * The limits were already sent and were unreadable on their own: "10 people" is
 * a fact about the plan, "7 of 10" is the one that tells a practice manager
 * whether to act. So usage travels with them — and it has to be counted the
 * same way the guards count, or the screen shows room where the next hire is
 * about to be refused.
 */

describe('a practice sees its own numbers', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('usage is reported beside the limits', async () => {
    const practice = await makePractice('Sunrise Diabetes Care', { plan: PLAN.ESSENTIAL });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await makeMember(practice, { name: 'Sunita Desk', role: ROLES.STAFF });
    await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    await Clinic.create({ name: 'Sunrise Salt Lake', practice: practice._id });

    const res = await as(owner.token).get('/billing');
    assert.equal(res.status, 200);

    // Two memberships, the owner included — the same rule the staff cap uses.
    assert.equal(res.body.usage.staff, 2);
    assert.equal(res.body.usage.patients, 1);
    assert.equal(res.body.usage.locations, 1);
  });

  test('and the counts stop at the practice boundary', async () => {
    // The `countsFromRoles` bug, in its natural home: a headcount that falls
    // back to the platform reports somebody else's clinic as your own.
    const sunrise = await makePractice('Sunrise Diabetes Care', { plan: PLAN.ESSENTIAL });
    const meridian = await makePractice('Meridian Family Clinic', { plan: PLAN.PROFESSIONAL });

    const bose = await makeMember(sunrise, { name: 'Dr Bose', isOwner: true });
    await makeMember(meridian, { name: 'Dr Iyer', isOwner: true });
    await makeMember(meridian, { name: 'Ravi Desk', role: ROLES.STAFF });
    await makePatient({ name: 'Farida Rahman', practices: [meridian] });
    await Clinic.create({ name: 'Meridian Ballygunge', practice: meridian._id });

    const res = await as(bose.token).get('/billing');
    assert.equal(res.body.usage.staff, 1, 'another practice’s people were counted');
    assert.equal(res.body.usage.patients, 0, 'another practice’s patients were counted');
    assert.equal(res.body.usage.locations, 0, 'another practice’s locations were counted');
  });

  test('the plan’s limits arrive with it', async () => {
    const practice = await makePractice('Sunrise Diabetes Care', {
      plan: PLAN.ESSENTIAL,
      limits: defaultLimitsFor(PLAN.ESSENTIAL),
    });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });

    const res = await as(owner.token).get('/billing');
    assert.equal(res.body.plan, PLAN.ESSENTIAL);
    assert.equal(res.body.limits.staff, defaultLimitsFor(PLAN.ESSENTIAL).staff);
  });

  test('a practice with no cap is not shown a zero', async () => {
    // Null is unlimited and must survive the trip as null. Serialised as 0 it
    // would read on screen as "no places left", which is the opposite.
    const practice = await makePractice('Meridian Family Clinic');
    const owner = await makeMember(practice, { name: 'Dr Iyer', isOwner: true });

    const res = await as(owner.token).get('/billing');
    assert.equal(res.body.limits.staff, null);
    assert.equal(res.body.limits.patients, null);
  });

  test('and a doctor with no practice is answered, not refused', async () => {
    // The pre-backfill account. A 500 here would be a billing screen that
    // cannot open for the one person most likely to try it.
    const { User } = await import('../src/models/User.js');
    const { signAccessToken } = await import('../src/services/tokens.js');
    const stray = await User.create({
      name: 'Dr Nobody',
      phone: '+919812340000',
      role: ROLES.DOCTOR,
      isActive: true,
    });

    const res = await as(signAccessToken(stray)).get('/billing');
    assert.equal(res.status, 200);
    assert.equal(res.body.plan, null);
    assert.equal(res.body.canPay, false);
  });
});
