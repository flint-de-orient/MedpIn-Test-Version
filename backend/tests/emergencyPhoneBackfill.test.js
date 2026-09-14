import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { Practice } from '../src/models/Practice.js';
import { planEmergencyPhone, applyEmergencyPhone } from '../scripts/backfillEmergencyPhone.js';

/**
 * The configured number becomes one practice's — once, on purpose, and only
 * the practice the operator names.
 *
 * The release that made the emergency number per practice left the live clinic
 * with no number of its own. This is the step that gives it back, and a step an
 * operator runs against production has to be provably unable to do anything
 * else: not pick a practice, not copy a placeholder, not overwrite a number the
 * practice saved itself.
 */

const LIVE = '+918981540690';

describe('moving the configured number onto a practice', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('the plan names the change and writes nothing', async () => {
    const dey = await makePractice('Dey Diabetes Care');

    const plan = await planEmergencyPhone(dey._id, LIVE);

    assert.equal(plan.ok, true);
    assert.equal(plan.change, true);
    assert.equal(plan.phone, LIVE);
    assert.equal((await Practice.findById(dey._id).lean()).emergencyPhone, null, 'a dry run wrote');
  });

  test('applying sets it on the named practice and no other', async () => {
    const dey = await makePractice('Dey Diabetes Care');
    const other = await makePractice('Behala Family Clinic');

    assert.equal(await applyEmergencyPhone(dey._id, LIVE), 1);

    assert.equal((await Practice.findById(dey._id).lean()).emergencyPhone, LIVE);
    assert.equal((await Practice.findById(other._id).lean()).emergencyPhone, null);
  });

  test('a number the practice already saved is kept', async () => {
    const dey = await makePractice('Dey Diabetes Care', { emergencyPhone: '+913324001234' });

    const plan = await planEmergencyPhone(dey._id, LIVE);
    assert.equal(plan.change, false);

    assert.equal(await applyEmergencyPhone(dey._id, LIVE), 0);
    assert.equal((await Practice.findById(dey._id).lean()).emergencyPhone, '+913324001234');
  });

  test('a placeholder is refused rather than copied', async () => {
    const dey = await makePractice('Dey Diabetes Care');
    const plan = await planEmergencyPhone(dey._id, '+91-0000000000');
    assert.equal(plan.ok, false);
    assert.match(plan.reason, /not a number anybody could ring/);
  });

  test('and an id that is not a practice is refused', async () => {
    assert.equal((await planEmergencyPhone('not-an-id', LIVE)).ok, false);
    assert.equal((await planEmergencyPhone('000000000000000000000000', LIVE)).ok, false);
  });
});
