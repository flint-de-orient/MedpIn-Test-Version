import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildAttention } from '../src/services/nutritionAttention.js';
import { dayjs } from '../src/utils/clinicTime.js';

/**
 * The dietician home's "who needs me" list.
 *
 * Worth testing rather than eyeballing: it decides which patients a dietician
 * sees first, it picks exactly one reason per patient out of three competing
 * ones, and every input is a date. All three are places where a plausible-
 * looking implementation is quietly wrong for a fortnight before anyone spots
 * the patient who never surfaced.
 */

const daysAgo = (n) => dayjs().startOf('day').subtract(n, 'day').add(9, 'hour').toDate();

/**
 * A logged meal. Read by default, because "unread" is the interesting state
 * and a fixture should have to ask for it.
 *
 * Whether a meal is waiting is now the meal's own flag. It used to be derived
 * by comparing each log against the patient's last review date, which is why
 * these fixtures previously had to stamp a review *after* their own logs to
 * test anything but the unread branch.
 */
const meal = (patient, n, { unread = false } = {}) => ({
  patient,
  createdAt: daysAgo(n),
  reviewedAt: unread ? null : daysAgo(n),
});

/** A week of read meals — the shape of a patient who is doing fine. */
const goodWeek = (patient) => [0, 1, 2, 3, 4, 5].map((d) => meal(patient, d));

function profile({ id = 'p1', name = 'Rahul Das', lastReview = null, interval = null } = {}) {
  return {
    user: { _id: id, name, avatarAssetId: null },
    lastDietReviewAt: lastReview,
    dietReviewIntervalDays: interval,
    createdAt: daysAgo(90),
  };
}

function run({ profiles, logs = {}, defaultDays = 14 }) {
  return buildAttention({
    assigned: profiles,
    defaultDays,
    logsByPatient: new Map(Object.entries(logs)),
    planBy: new Map(),
  });
}

describe('buildAttention', () => {
  test('an unread meal outranks every other reason', () => {
    // This patient qualifies on all three counts at once: an unread log, a
    // week with barely any logging, and a review falling due. One row must
    // come out, and it must be the unread meal — that is the one with a
    // patient's own submission attached to it.
    const out = run({
      profiles: [profile({ lastReview: daysAgo(13), interval: 14 })],
      logs: { p1: [meal('p1', 0, { unread: true })] },
    });

    assert.equal(out.length, 1, 'one patient must produce one row, never three');
    assert.equal(out[0].kind, 'log_review');
    assert.equal(out[0].label, 'Food log needs review');
  });

  test('a meal a dietician has already ticked is not waiting', () => {
    const out = run({
      profiles: [profile({ lastReview: daysAgo(2), interval: 30 })],
      logs: { p1: [meal('p1', 1)] },
    });

    assert.notEqual(out[0]?.kind, 'log_review');
  });

  test('replying is no longer what marks a meal read', () => {
    // The regression this whole change exists to prevent. The review date is
    // recent — under the old rule that alone cleared every plate — but the
    // meal itself was never ticked, so it is still waiting.
    const out = run({
      profiles: [profile({ lastReview: new Date(), interval: 30 })],
      logs: { p1: [meal('p1', 1, { unread: true })] },
    });

    assert.equal(out[0]?.kind, 'log_review');
  });

  test('low adherence counts days without a log, not logs', () => {
    // Four meals photographed, all on the same day. A count-based measure
    // would read that as an adherent week; what is being asked is "how many
    // days did this person engage".
    const out = run({
      profiles: [profile({ interval: 30, lastReview: daysAgo(1) })],
      logs: { p1: [0, 0, 0, 0].map(() => meal('p1', 1)) },
    });

    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'adherence');
    assert.equal(out[0].missedLogs, 6, 'one day logged out of seven');
  });

  test('a patient logging most days does not surface at all', () => {
    const out = run({
      profiles: [profile({ interval: 30, lastReview: daysAgo(1) })],
      logs: { p1: goodWeek('p1') },
    });

    assert.deepEqual(out, [], 'six of seven days is not a patient who needs chasing');
  });

  test('the spark is seven presence flags, oldest first', () => {
    const out = run({
      profiles: [profile({ interval: 30, lastReview: daysAgo(1) })],
      logs: { p1: [meal('p1', 0, { unread: true })] },
    });

    assert.equal(out[0].spark.length, 7);
    assert.equal(out[0].spark.at(-1), 1, 'today is the last entry');
    assert.equal(out[0].spark[0], 0, 'six days ago is the first');
    assert.ok(out[0].spark.every((v) => v === 0 || v === 1), 'presence, not counts');
  });

  test('a review falling inside three days surfaces, one further out does not', () => {
    const soon = run({
      profiles: [profile({ id: 'a', lastReview: daysAgo(1), interval: 3 })],
      logs: { a: goodWeek('a') },
    });
    assert.equal(soon[0]?.kind, 'review_soon');
    assert.match(soon[0].detail, /Review due/);

    const later = run({
      profiles: [profile({ id: 'a', lastReview: daysAgo(1), interval: 30 })],
      logs: { a: goodWeek('a') },
    });
    assert.deepEqual(later, [], 'a month out is not attention-worthy');
  });

  test('an already-lapsed review never surfaces as "due soon"', () => {
    // Negative days remaining must not be mistaken for imminent. A lapsed
    // review belongs to the hero's "reviews due" count; here the patient shows
    // up under whatever they are actually doing wrong instead.
    const out = run({
      profiles: [profile({ id: 'a', lastReview: daysAgo(40), interval: 14 })],
      logs: { a: goodWeek('a') },
    });
    assert.notEqual(out[0]?.kind, 'review_soon');
  });

  test('a patient with no review date and no logs is not silently skipped', () => {
    const out = run({ profiles: [profile({ lastReview: null })], logs: {} });

    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'adherence');
    assert.equal(out[0].missedLogs, 7);
    assert.match(out[0].detail, /No meals logged/);
  });

  test('unread meals sort above low adherence, and the worst adherence first', () => {
    const out = run({
      profiles: [
        profile({ id: 'quiet', name: 'Quiet', interval: 30, lastReview: daysAgo(1) }),
        profile({ id: 'unread', name: 'Unread', interval: 30, lastReview: daysAgo(3) }),
        profile({ id: 'partial', name: 'Partial', interval: 30, lastReview: daysAgo(1) }),
      ],
      logs: {
        quiet: [],
        unread: [meal('unread', 0, { unread: true })],
        partial: [0, 1, 2].map((d) => meal('partial', d)),
      },
    });

    assert.deepEqual(
      out.map((r) => r.name),
      ['Unread', 'Quiet', 'Partial'],
      'unread first, then the emptiest week',
    );
  });

  test('an interval of zero does not divide the screen by zero', () => {
    // dietReviewIntervalDays is nullable and the clinic default can be unset.
    const out = run({
      profiles: [profile({ interval: 0, lastReview: daysAgo(1) })],
      logs: { p1: goodWeek('p1') },
      defaultDays: 0,
    });
    assert.deepEqual(out, []);
  });
});
