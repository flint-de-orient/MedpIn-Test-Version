import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { frequencyToSlots, slotToTime, DEFAULT_MEAL_TIMES } from '../src/services/medicationSchedule.js';

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
