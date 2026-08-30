import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  tidyStrength,
  splitCombination,
  mergeDuplicates,
  normaliseScannedItems,
} from '../src/services/prescriptionItems.js';

/**
 * Built from one real prescription — a Kolkata municipal slip a patient
 * photographed into the app. Four written lines, seven drugs, and the app
 * created four medicines: the patient's metformin, which is on two of those
 * lines, had no entry and no reminder at all.
 */
describe('a line that names two drugs', () => {
  test('becomes two medicines, both on the line\'s timing', () => {
    const out = splitCombination({
      name: 'Teneligliptin + MF500(SR)',
      strength: '20mg',
      frequency: '1 tab each AF Lunch',
      relationToMeal: 'after_meal',
    });

    assert.equal(out.length, 2, 'one item per drug');
    assert.equal(out[0].name, 'Teneligliptin');
    // Left exactly as the doctor wrote it. 'MF500' is his shorthand for
    // metformin 500, and prising the number out would leave a reminder that
    // says 'MF' — which tells a patient nothing.
    assert.match(out[1].name, /MF500/i);
    // The timing was written once, for both tablets.
    for (const item of out) {
      assert.equal(item.frequency, '1 tab each AF Lunch');
      assert.equal(item.relationToMeal, 'after_meal');
    }
  });

  test('each drug keeps its own strength', () => {
    const out = splitCombination({
      name: 'Telma 40 + ADB',
      frequency: '1 tab each 10 AM',
    });
    assert.equal(out[0].name, 'Telma');
    assert.equal(out[0].strength, '40');
    assert.equal(out[1].name, 'ADB');
  });

  test('a single branded combination is NOT split', () => {
    // One tablet, whatever is inside it. Splitting would invent a medicine the
    // patient was never handed.
    const out = splitCombination({ name: 'Glycomet GP2', strength: '500mg' });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Glycomet GP2');
  });

  test('brand equivalents after "=" are not a second prescription', () => {
    // "Teneligliptin + MF500 = GIP2 + MF500" is the doctor naming the generics
    // and then the brands to dispense. Reading both halves doubles the dose.
    const out = splitCombination({
      name: 'Teneligliptin + MF500(SR) = GIP2 + MF500(SR)',
      frequency: 'AF Lunch',
    });
    assert.equal(out.length, 2, 'two drugs, not four');
    assert.equal(out[0].name, 'Teneligliptin');
    assert.match(out[1].name, /MF500/i);
  });
});

describe('the strength field holds a strength', () => {
  test('an amount with a unit survives whole', () => {
    assert.equal(tidyStrength('500mg SR').strength, '500 mg SR');
    assert.equal(tidyStrength('20mg').strength, '20 mg');
    assert.equal(tidyStrength('40').strength, '40');
  });

  test('a whole prescription line is cut back to its amount', () => {
    // What was actually stored, and why the list printed a giant "40" with a
    // sentence spilling out beside it.
    const { strength, leftover } = tidyStrength('40T (TD 12.5) + ADB 1 tab each 10 AM');
    assert.equal(strength, '40');
    assert.ok(leftover?.includes('ADB'), 'the rest is kept, not dropped');
  });

  test('an instruction is never mistaken for a strength', () => {
    assert.equal(tidyStrength('1 tab before meal').strength, '1');
    assert.equal(tidyStrength('after dinner').strength, undefined);
  });

  test('nothing in, nothing out', () => {
    assert.equal(tidyStrength('').strength, undefined);
    assert.equal(tidyStrength(null).strength, undefined);
  });
});

describe('the same drug on two lines', () => {
  test('is one medicine, and neither dose is lost', () => {
    // Metformin is on two lines of that slip — after lunch and after dinner.
    // Keyed by name alone, the second write overwrote the first and a dose
    // silently disappeared.
    const out = mergeDuplicates([
      { name: 'MF500', strength: '500 mg SR', frequency: 'AF Lunch' },
      { name: 'MF500', strength: '500 mg SR', frequency: 'A Dinner' },
    ]);

    assert.equal(out.length, 1, 'one drug, not two records');
    assert.match(out[0].frequency, /Lunch/);
    assert.match(out[0].frequency, /Dinner/, 'the second dose survives');
  });

  test('the same name at a different strength stays separate', () => {
    // Two genuinely different prescriptions, and merging them would erase one.
    const out = mergeDuplicates([
      { name: 'Metformin', strength: '500 mg' },
      { name: 'Metformin', strength: '1000 mg' },
    ]);
    assert.equal(out.length, 2);
  });
});

describe('the whole slip, end to end', () => {
  test('four written lines yield every drug on them', () => {
    const parsed = [
      { name: 'Teneligliptin + MF500(SR)', strength: '20mg', frequency: '1 tab each AF Lunch' },
      { name: 'Dapagliflozin + MF500(SR)', strength: '10mg', frequency: '1 tab A Dinner' },
      { name: 'Pan', strength: '40', frequency: '1 tab before meal' },
      { name: 'Telma 40 + ADB', frequency: '1 tab each 10 AM' },
    ];

    const out = normaliseScannedItems(parsed);
    const names = out.map((i) => i.name.toLowerCase());

    // The one that was missing, and the reason this file exists.
    assert.ok(names.some((n) => n.includes('mf500')), 'the metformin must exist');
    assert.ok(names.includes('adb'), 'and so must the ADB');
    assert.ok(names.includes('teneligliptin'));
    assert.ok(names.includes('dapagliflozin'));
    assert.ok(names.includes('pan'));
    assert.ok(names.includes('telma'));

    // Metformin was on two lines and is one medicine taking both timings.
    const mf = out.filter((i) => i.name.toLowerCase().includes('mf500'));
    assert.equal(mf.length, 1, 'one metformin record');
    assert.match(mf[0].frequency, /Lunch/);
    assert.match(mf[0].frequency, /Dinner/);
  });
});
