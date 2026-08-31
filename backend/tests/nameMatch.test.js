import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { compareNames, normaliseName, needsConfirmation } from '../src/utils/nameMatch.js';

/**
 * The check that stops one patient's prescription landing on another's record.
 *
 * The clinic photographs fifty handwritten prescriptions during its pilot. A
 * misfiled one is a medicine list belonging to somebody else on a diabetic's
 * chart, and nothing about it looks wrong afterwards.
 */
describe('the same person, written differently', () => {
  const same = [
    ['Rahul Das', 'Rahul Das'],
    ['MR. RAHUL DAS', 'Rahul Das'],
    ['Dr. Amit Kumar Dey', 'Amit Kumar Dey'],
    ['Rahul  Das', 'Rahul Das'],
    ['Rahul Das.', 'Rahul Das'],
    // Forms in this clinic are filled surname-first about half the time.
    ['Das Rahul', 'Rahul Das'],
    ['Smt. Sunita  Sharma', 'sunita sharma'],
  ];
  for (const [paper, file] of same) {
    test(`"${paper}" is "${file}"`, () => {
      assert.equal(compareNames(paper, file).verdict, 'exact');
    });
  }
});

describe('a name that must be looked at', () => {
  test('a shared part is "partial", not "close enough"', () => {
    // "Rahul Das" vs "Rahul Kumar Das" is one person written twice.
    // "Rahul Das" vs "Rahul Dhara" is two people who may both be in the
    // waiting room. Nothing here can tell those apart, so both stop and ask.
    assert.equal(compareNames('Rahul Das', 'Rahul Kumar Das').verdict, 'partial');
    assert.equal(compareNames('Rahul Das', 'Rahul Dhara').verdict, 'partial');
    assert.ok(needsConfirmation('partial'));
  });

  test('nothing in common is "different"', () => {
    assert.equal(compareNames('Raj Dhara', 'Sunita Sharma').verdict, 'different');
    assert.ok(needsConfirmation('different'));
  });
});

describe('a page with no name on it', () => {
  test('is unknown, and does not block', () => {
    // Handwritten slips often carry only the medicines. The desk chose the
    // record before they took the photograph; a blank tells them nothing new,
    // and refusing to file would leave the pilot with no way to record it.
    for (const paper of ['', '   ', null, undefined]) {
      assert.equal(compareNames(paper, 'Rahul Das').verdict, 'unknown');
    }
    assert.ok(!needsConfirmation('unknown'));
  });

  test('and so is a record with no name', () => {
    assert.equal(compareNames('Rahul Das', '').verdict, 'unknown');
  });

  test('a single initial is not a name part', () => {
    // "R Das" should not match "Rahul Dhara" on the strength of an "R".
    assert.equal(compareNames('R Das', 'Rahul Dhara').verdict, 'different');
  });
});

describe('normalising', () => {
  test('strips titles, punctuation and extra spaces', () => {
    assert.equal(normaliseName('  Mr.  Rahul   Das. '), 'rahul das');
    assert.equal(normaliseName('Dr Amit Kumar Dey'), 'amit kumar dey');
  });

  test('an exact match never needs confirmation', () => {
    assert.ok(!needsConfirmation('exact'));
  });
});
