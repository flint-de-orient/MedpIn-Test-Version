import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A trend beside a total has to be about that total.
 *
 * ---- The bug this exists to prevent --------------------------------------
 *
 * The overview showed "Locations 2 — ↓ 2 fewer" on a platform where nothing had
 * ever been deleted. Both locations were created between thirty and sixty days
 * ago, so the recent window held none and the older one held two, and the card
 * announced a loss that had not happened.
 *
 * Each half was defensible alone. The value was the total; the trend compared
 * arrivals in one thirty-day window against arrivals in the previous one. Put
 * side by side they measured different quantities, and the reader was left to
 * notice.
 *
 * That is the failure worth a test, because nothing errors: the numbers are
 * real, the arithmetic is right, and the sentence is false.
 */
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const usage = readFileSync(new URL('../src/services/practiceUsage.js', import.meta.url), 'utf8');
const card = readFileSync(new URL('../../web/src/components/metrics.tsx', import.meta.url), 'utf8');

/** `describe()` from the card, reimplemented so the test is not the code. */
function trend(current, previous) {
  const delta = current - previous;
  if (delta === 0) return { direction: 'flat', text: 'no change' };
  if (previous < 5) {
    return {
      direction: delta > 0 ? 'up' : 'down',
      text: `${Math.abs(delta)} ${delta > 0 ? 'more' : 'fewer'}`,
    };
  }
  return {
    direction: delta > 0 ? 'up' : 'down',
    text: `${Math.round((Math.abs(delta) / previous) * 100)}%`,
  };
}

describe('the comparison is now against the total, not arrivals', () => {
  test('`current` is the unfiltered count', () => {
    // Not `createdAt: { $gte: window30 }`. That is how many arrived, which is a
    // different number from how many there are.
    assert.match(routes, /Model\.countDocuments\(filter\),/);
  });

  test('`previous` is what existed a month ago', () => {
    assert.match(routes, /Model\.countDocuments\(\{ \.\.\.filter, createdAt: \{ \$lt: window30 \} \}\)/);
  });

  test('and the two-window version is gone', () => {
    // `window60` existed only to bound the older arrivals bucket.
    assert.ok(!routes.includes('window60'), 'the arrivals-per-window comparison is still here');
    assert.ok(!usage.includes('previousFrom'), 'enrolments still compare two windows');
  });

  test('enrolments moved the same way', () => {
    assert.match(usage, /Enrollment\.countDocuments\(active\),/);
    assert.match(usage, /createdAt: \{ \$lt: from \}/);
  });

  test('the label says what it compares', () => {
    assert.match(card, /vs 30 days ago/);
    assert.ok(!card.includes('vs previous 30 days'), 'the old label survives the fix');
  });
});

describe('what the card now says about real data', () => {
  /**
   * The numbers from the live platform on the day this was written, which is
   * where the bug was seen.
   */
  test('two locations, neither new, reads as no change', () => {
    // Was "↓ 2 fewer" — a deletion that never happened.
    assert.deepEqual(trend(2, 2), { direction: 'flat', text: 'no change' });
  });

  test('three staff, all joined this month, reads as three more', () => {
    assert.deepEqual(trend(3, 0), { direction: 'up', text: '3 more' });
  });

  test('one practice, new this month', () => {
    assert.deepEqual(trend(1, 0), { direction: 'up', text: '1 more' });
  });

  test('a small base never becomes a percentage', () => {
    // One against one is "+100%", which is arithmetic on noise.
    assert.equal(trend(2, 1).text, '1 more');
    assert.equal(trend(4, 2).text, '2 more');
    // Five is where a proportion starts meaning something.
    assert.equal(trend(6, 5).text, '20%');
  });

  test('append-only data can never read as a loss', () => {
    // Practices, locations and enrolments are never deleted, so the total now
    // is always at least the total a month ago — and `previous` is a subset of
    // `current` by construction, not by luck.
    for (const [now, then] of [[1, 0], [2, 2], [40, 31], [0, 0]]) {
      assert.notEqual(trend(now, then).direction, 'down', `${now} vs ${then} read as a fall`);
    }
  });

  test('but staff still can, and should', () => {
    // A membership that ends leaves the current count and stays out of both.
    // Somebody genuinely losing staff is a real fall and must be sayable.
    assert.equal(trend(3, 8).direction, 'down');
  });
});
