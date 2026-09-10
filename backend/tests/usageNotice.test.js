import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { Practice } from '../src/models/Practice.js';
import { bandFor, noticeUsage } from '../src/services/billing/usageNotice.js';

/**
 * Telling a practice it is running out of room, once.
 *
 * ---- What these mostly guard against -----------------------------------
 *
 * Repetition. A practice at 85% of its patient cap crosses no new line when it
 * registers the next patient, and a check that fires on every add sends four
 * notifications in an afternoon all saying the same thing. What that teaches is
 * that this app's notifications are noise — a cost paid later by a clinical
 * alert nobody opens.
 *
 * So most of what follows is about the second call doing nothing.
 */

describe('which band a practice is in', () => {
  test('the thresholds are 80, 90 and 100', () => {
    assert.equal(bandFor(79, 100), 0);
    assert.equal(bandFor(80, 100), 80);
    assert.equal(bandFor(89, 100), 80);
    assert.equal(bandFor(90, 100), 90);
    assert.equal(bandFor(99, 100), 90);
    assert.equal(bandFor(100, 100), 100);
  });

  test('over the cap is still the top band, not a fourth one', () => {
    // A practice can be over a cap somebody lowered on them. That is not a new
    // kind of problem and does not deserve a new kind of message.
    assert.equal(bandFor(140, 100), 100);
  });

  test('no cap is no band', () => {
    // Every practice today. Nothing to approach.
    assert.equal(bandFor(500, null), 0);
    assert.equal(bandFor(500, undefined), 0);
    assert.equal(bandFor(0, 0), 0);
  });

  test('and a cap of one works', () => {
    // Essential allows one location, which makes 100% the first band anybody
    // ever crosses. An off-by-one here would silently never warn them.
    assert.equal(bandFor(0, 1), 0);
    assert.equal(bandFor(1, 1), 100);
  });
});

describe('a practice is told once per band', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  async function capped(patients = 100) {
    return makePractice('Sunrise Diabetes Care', {
      limits: { patients, staff: null, locations: null },
    });
  }

  test('nothing at all below eighty', async () => {
    const p = await capped();
    assert.equal(await noticeUsage(p._id, 'patients', 79), null);

    const after = await Practice.findById(p._id).lean();
    assert.equal(after.limitNotices.patients, 0);
  });

  test('once on the way past eighty', async () => {
    const p = await capped();
    const first = await noticeUsage(p._id, 'patients', 80);
    assert.equal(first.band, 80);

    // The second registration at 81% is the one that would have spammed.
    assert.equal(await noticeUsage(p._id, 'patients', 81), null);
    assert.equal(await noticeUsage(p._id, 'patients', 85), null);
    assert.equal(await noticeUsage(p._id, 'patients', 89), null);
  });

  test('and again at ninety, and again at a hundred', async () => {
    const p = await capped();
    assert.equal((await noticeUsage(p._id, 'patients', 80)).band, 80);
    assert.equal((await noticeUsage(p._id, 'patients', 90)).band, 90);
    assert.equal((await noticeUsage(p._id, 'patients', 100)).band, 100);
    // And no fourth message when they go over.
    assert.equal(await noticeUsage(p._id, 'patients', 110), null);
  });

  test('a practice that jumps straight to full is told once, not three times', async () => {
    // A bulk import, or a cap lowered onto an existing practice. Three
    // notifications in a second is the same noise problem from the other end.
    const p = await capped();
    const only = await noticeUsage(p._id, 'patients', 100);
    assert.equal(only.band, 100);
    assert.equal(await noticeUsage(p._id, 'patients', 100), null);
  });

  test('raising the cap re-arms the warning', async () => {
    /*
     * The case that matters most and is easiest to miss. A practice warned at
     * 90%, upgraded, and grown back to 90% must be warned again — they have
     * already been told once that this is how it goes, so the second time is
     * when they act.
     */
    const p = await capped(100);
    assert.equal((await noticeUsage(p._id, 'patients', 90)).band, 90);

    await Practice.updateOne({ _id: p._id }, { $set: { 'limits.patients': 1000 } });
    // 90 of 1000 is comfortably below: the mark steps down.
    assert.equal(await noticeUsage(p._id, 'patients', 90), null);
    assert.equal((await Practice.findById(p._id).lean()).limitNotices.patients, 0);

    // And grown back into the band, they are told again.
    assert.equal((await noticeUsage(p._id, 'patients', 900)).band, 90);
  });

  test('people leaving lowers it too', async () => {
    const p = await makePractice('Sunrise Diabetes Care', {
      limits: { patients: null, staff: 10, locations: null },
    });
    assert.equal((await noticeUsage(p._id, 'staff', 10)).band, 100);

    // Somebody left.
    assert.equal(await noticeUsage(p._id, 'staff', 7), null);
    assert.equal((await Practice.findById(p._id).lean()).limitNotices.staff, 0);

    // Back up to full: told again, because it is a new event.
    assert.equal((await noticeUsage(p._id, 'staff', 10)).band, 100);
  });

  test('an uncapped practice is never told anything', async () => {
    // Every practice on the platform today, the founding clinic included.
    const p = await makePractice('Meridian Family Clinic');
    for (const n of [1, 50, 500, 5000]) {
      assert.equal(await noticeUsage(p._id, 'patients', n), null);
    }
  });

  test('the three limits are counted apart', async () => {
    // Being full of people says nothing about room for patients, and one mark
    // for all three would silence two real warnings.
    const p = await makePractice('Sunrise Diabetes Care', {
      limits: { patients: 100, staff: 10, locations: 1 },
    });

    assert.equal((await noticeUsage(p._id, 'staff', 10)).band, 100);
    assert.equal((await noticeUsage(p._id, 'patients', 80)).band, 80);
    assert.equal((await noticeUsage(p._id, 'locations', 1)).band, 100);
  });

  test('a limit nobody has heard of is ignored rather than guessed at', async () => {
    const p = await capped();
    assert.equal(await noticeUsage(p._id, 'departments', 99), null);
  });

  test('and a practice that does not exist does not throw', async () => {
    // This runs after a patient registration. Throwing here would roll back
    // somebody standing at the desk.
    assert.equal(await noticeUsage('not-an-id', 'patients', 100), null);
  });
});
