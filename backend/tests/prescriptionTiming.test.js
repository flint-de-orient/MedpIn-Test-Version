import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { frequencyToSlots, slotToTime, scheduleText, relationFromText, DEFAULT_MEAL_TIMES } from '../src/services/medicationSchedule.js';

/**
 * Timings as they are actually written on a Kolkata prescription.
 *
 * These lines are transcribed from a real slip a patient photographed into the
 * app. Every one of the four came back reminding at 08:00 — including the one
 * for after dinner — because frequencyToSlots recognises "OD", "BD", "TDS" and
 * "1-0-1" and silently falls through to ['morning'] for everything else.
 *
 * That fallback is the dangerous part. A reminder that says 08:00 looks exactly
 * as confident as one that is right, so nothing on the screen tells the patient
 * their dinner tablet has been scheduled for breakfast.
 */
describe('timings written in words, not codes', () => {
  const at = (freq) =>
    frequencyToSlots(freq).map((s) => slotToTime(s, DEFAULT_MEAL_TIMES));

  test('after lunch is midday, not morning', () => {
    // "Teneligliptin (20) + MF500(SR) — 1 tab each AF Lunch"
    assert.deepEqual(at('1 tab each AF Lunch'), ['13:30']);
  });

  test('after dinner is night, not morning', () => {
    // "Dapagliflozin (10) + MF500(SR) — 1 tab A Dinner"
    // The one that matters most: this was reminding at breakfast.
    assert.deepEqual(at('1 tab A Dinner'), ['20:30']);
  });

  test('an explicit clock time is kept', () => {
    // "Telma 40T (TD 12.5) + ADB — 1 tab each 10 AM"
    assert.deepEqual(at('1 tab each 10 AM'), ['10:00']);
  });

  test('the codes that already worked still work', () => {
    assert.deepEqual(frequencyToSlots('1-0-1'), ['morning', 'night']);
    assert.deepEqual(frequencyToSlots('BD'), ['morning', 'night']);
    assert.deepEqual(frequencyToSlots('TDS'), ['morning', 'noon', 'night']);
    assert.deepEqual(frequencyToSlots('OD'), ['morning']);
  });
});

describe('the timing survives the trip from photo to alarm', () => {
  test('a meal named in whenText decides the hour', () => {
    // The failure this is for. The prompt defines `frequency` as how OFTEN, so
    // a model filling it in returns "OD" and discards the word "Lunch" — and
    // the meal is the half that decides when the alarm rings. Every timing on
    // the prescription this was built from lived in that discarded half, and
    // all four medicines came back scheduled for 08:00.
    const at = (item) =>
      frequencyToSlots(scheduleText(item)).map((s) =>
        slotToTime(s, DEFAULT_MEAL_TIMES),
      );

    assert.deepEqual(
      at({ frequency: 'OD', whenText: '1 tab each AF Lunch' }),
      ['13:30'],
      'after lunch, even though frequency says only "OD"',
    );
    assert.deepEqual(
      at({ frequency: 'OD', whenText: '1 tab A Dinner' }),
      ['20:30'],
    );
    assert.deepEqual(
      at({ frequency: 'OD', whenText: '1 tab each 10 AM' }),
      ['10:00'],
    );
  });

  test('an explicit count still beats the meal', () => {
    // "1 tab BD after dinner" is twice a day. The count is the stronger
    // statement, and only when nothing has said how often does the named meal
    // get to choose the single slot.
    assert.deepEqual(
      frequencyToSlots(scheduleText({ frequency: 'BD', whenText: 'after dinner' })),
      ['morning', 'night'],
    );
  });

  test('nothing said at all still falls back to morning', () => {
    assert.deepEqual(frequencyToSlots(scheduleText({})), ['morning']);
  });
});

describe('before or after food, from the doctor\'s own words', () => {
  test('AF and after-food read as after the meal', () => {
    assert.equal(relationFromText('1 tab each AF Lunch'), 'after_meal');
    assert.equal(relationFromText('1 tab after food'), 'after_meal');
    assert.equal(relationFromText('1 tab PC'), 'after_meal');
  });

  test('BF and empty stomach read as before it', () => {
    assert.equal(relationFromText('1 tab BF'), 'before_meal');
    assert.equal(relationFromText('1 tab before meal'), 'before_meal');
    assert.equal(relationFromText('on empty stomach'), 'before_meal');
  });

  test('nothing said stays nothing', () => {
    // A medicine with no meal instruction genuinely has none. Inventing one
    // would be the same fault as the "Anytime" it replaces, pointing the other
    // way.
    assert.equal(relationFromText('1 tab each 10 AM'), null);
    assert.equal(relationFromText(''), null);
    assert.equal(relationFromText(null), null);
  });

  test('the prescription line resolves end to end', () => {
    // "Teneligliptin (20) + MF500(SR) — 1 tab each AF Lunch". Lunch decides the
    // slot; AF decides that it is taken after it. The patient's list showed
    // "Anytime" against a line that plainly says after food, which is the app
    // contradicting the prescription in front of them.
    const item = { frequency: 'OD', whenText: '1 tab each AF Lunch' };
    const text = scheduleText(item);
    assert.deepEqual(frequencyToSlots(text), ['noon']);
    assert.equal(relationFromText(text), 'after_meal');
  });
});
