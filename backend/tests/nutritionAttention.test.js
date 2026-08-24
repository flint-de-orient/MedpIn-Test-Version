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
 * A review stamped after every log in the fixture.
 *
 * Needed more often than it looks. Any log newer than the last review is by
 * definition unread, and unread wins over both other reasons — so a fixture
 * that wants to exercise adherence or an upcoming review has to have been
 * reviewed *since* its own logs, exactly as a real caught-up patient would be.
 */
const reviewedJustNow = () => new Date();

/** A patient profile as the route hands it over. */
function profile({ id = 'p1', name = 'Rahul Das', lastReview = null, interval = null } = {}) {
  return {
    user: { _id: id, name, avatarAssetId: null },
    lastDietReviewAt: lastReview,
    dietReviewIntervalDays: interval,
    createdAt: daysAgo(90),
  };
}

function run({ profiles, logs = {}, defaultDays = 14 }) {
  const logsByPatient = new Map(Object.entries(logs));
  return buildAttention({
    assigned: profiles,
    defaultDays,
    logsByPatient,
    planBy: new Map(),
  });
}

describe('buildAttention', () => {
  test('a log submitted since the last review outranks everything else', () => {
    // This patient qualifies on all three counts at once: an unread log, a week
    // with barely any logging, and a review falling due. Only one row should
    // come out, and it must be the unread log — that is the one with a
    // patient's words attached to it.
    const out = run({
      profiles: [profile({ lastReview: daysAgo(13), interval: 14 })],
      logs: { p1: [{ patient: 'p1', createdAt: daysAgo(0) }] },
    });

    assert.equal(out.length, 1, 'one patient must produce one row, never three');
    assert.equal(out[0].kind, 'log_review');
    assert.equal(out[0].label, 'Food log needs review');
  });

  test('a log older than the last review is not waiting to be read', () => {
    const out = run({
      profiles: [profile({ lastReview: daysAgo(2), interval: 30 })],
      logs: { p1: [{ patient: 'p1', createdAt: daysAgo(5) }] },
    });

    // It falls through to adherence rather than surfacing as unread: the
    // dietician has already seen that meal.
    assert.notEqual(out[0]?.kind, 'log_review');
  });

  test('low adherence counts days without a log, not logs', () => {
    // Four meals photographed, all on the same day. A count-based measure would
    // read that as an adherent week; what is actually being asked is "how many
    // days did this person engage".
    const sameDay = [0, 0, 0, 0].map(() => ({ patient: 'p1', createdAt: daysAgo(1) }));
    const out = run({
      profiles: [profile({ lastReview: daysAgo(1), interval: 30 })],
      logs: { p1: sameDay },
    });

    assert.equal(out.length, 1);
    assert.equal(out[0].kind, 'adherence');
    assert.equal(out[0].missedLogs, 6, 'one day logged out of seven');
  });

  test('a patient logging most days does not surface at all', () => {
    const most = [0, 1, 2, 3, 4, 5].map((d) => ({ patient: 'p1', createdAt: daysAgo(d) }));
    const out = run({
      profiles: [profile({ lastReview: reviewedJustNow(), interval: 30 })],
      logs: { p1: most },
    });

    assert.deepEqual(out, [], 'six of seven days is not a patient who needs chasing');
  });

  test('the spark is seven presence flags, oldest first', () => {
    const out = run({
      profiles: [profile({ lastReview: daysAgo(1), interval: 30 })],
      logs: { p1: [{ patient: 'p1', createdAt: daysAgo(0) }] },
    });

    assert.equal(out[0].spark.length, 7);
    assert.equal(out[0].spark.at(-1), 1, 'today is the last entry');
    assert.equal(out[0].spark[0], 0, 'six days ago is the first');
    assert.ok(out[0].spark.every((v) => v === 0 || v === 1), 'presence, not counts');
  });

  test('a review falling inside three days surfaces, one further out does not', () => {
    const logs = { a: [0, 1, 2, 3, 4, 5].map((d) => ({ patient: 'a', createdAt: daysAgo(d) })) };

    // A short interval, because that is the only shape this branch is
    // reachable in — see the test below.
    const soon = run({
      profiles: [profile({ id: 'a', lastReview: reviewedJustNow(), interval: 2 })],
      logs,
    });
    assert.equal(soon[0]?.kind, 'review_soon');
    assert.match(soon[0].detail, /Review due/);

    const later = run({
      profiles: [profile({ id: 'a', lastReview: reviewedJustNow(), interval: 30 })],
      logs,
    });
    assert.deepEqual(later, [], 'a month out is not attention-worthy');
  });

  test('review_soon only fires for short review intervals, by construction', () => {
    // Documenting a real narrowness rather than pretending it is not there.
    //
    // To reach this branch a patient must have no unread logs (so their last
    // review is newer than their newest log) AND be logging most days AND have
    // a review due within three days. A review stamped in the last day or two
    // puts the next one a full interval away — so on the clinic default of 14
    // days the branch cannot fire at all, and the patient surfaces through the
    // hero's "reviews due" count instead once it lapses.
    const logs = { a: [0, 1, 2, 3, 4, 5].map((d) => ({ patient: 'a', createdAt: daysAgo(d) })) };
    const onDefault = run({
      profiles: [profile({ id: 'a', lastReview: reviewedJustNow(), interval: 14 })],
      logs,
    });
    assert.deepEqual(onDefault, []);
  });

  test('an already-lapsed review never surfaces as "due soon"', () => {
    // Negative days remaining must not be mistaken for imminent. A lapsed
    // review belongs to the hero's "reviews due" count; here the patient shows
    // up under whatever they are actually doing wrong instead.
    const out = run({
      profiles: [profile({ id: 'a', lastReview: daysAgo(40), interval: 14 })],
      logs: { a: [0, 1, 2, 3, 4, 5].map((d) => ({ patient: 'a', createdAt: daysAgo(d) })) },
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

  test('unread logs sort above low adherence, and the worst adherence first', () => {
    const out = run({
      profiles: [
        profile({ id: 'quiet', name: 'Quiet', lastReview: reviewedJustNow(), interval: 30 }),
        profile({ id: 'unread', name: 'Unread', lastReview: daysAgo(3), interval: 30 }),
        profile({ id: 'partial', name: 'Partial', lastReview: reviewedJustNow(), interval: 30 }),
      ],
      logs: {
        quiet: [],
        unread: [{ patient: 'unread', createdAt: daysAgo(0) }],
        partial: [0, 1, 2].map((d) => ({ patient: 'partial', createdAt: daysAgo(d) })),
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
      profiles: [profile({ lastReview: reviewedJustNow(), interval: 0 })],
      logs: { p1: [0, 1, 2, 3, 4, 5].map((d) => ({ patient: 'p1', createdAt: daysAgo(d) })) },
      defaultDays: 0,
    });
    assert.deepEqual(out, []);
  });
});
