import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  normaliseTestName,
  reportedNames,
  isReported,
  outstandingTests,
} from '../src/utils/testNames.js';

/**
 * Whether an advised lab test has been reported.
 *
 * A patient uploaded their Vitamin D report and was then pushed "Your doctor
 * advised Vitamin D. Upload the report when it's ready" twice in one morning.
 * Three places answered this question and all three answered differently; the
 * reminder did not compare names at all.
 */
describe('matching an advised test to an uploaded report', () => {
  test('the same test written two ways is the same test', () => {
    // What the doctor types against what the lab prints.
    assert.equal(
      normaliseTestName('Vitamin D'),
      normaliseTestName('Vitamin D (25-Hydroxy)'),
    );
    assert.equal(normaliseTestName('HbA1c'), normaliseTestName('Glycated Haemoglobin'));
    assert.equal(normaliseTestName('hba1c'), normaliseTestName('HbA1c '));
    assert.equal(
      normaliseTestName('Lipid Profile'),
      normaliseTestName('lipid-profile'),
    );
  });

  test('different tests stay different', () => {
    // The failure that matters more than a repeated nudge: marking a test done
    // that is not hides an outstanding result from the doctor.
    assert.notEqual(normaliseTestName('Vitamin D'), normaliseTestName('Vitamin B12'));
    assert.notEqual(normaliseTestName('HbA1c'), normaliseTestName('CBC'));
    assert.notEqual(
      normaliseTestName('Serum Electrolytes'),
      normaliseTestName('Serum Creatinine'),
    );
  });

  test('an empty or missing name matches nothing', () => {
    const reported = reportedNames([{ testName: '' }, { testName: null }, {}]);
    assert.equal(reported.size, 0);
    assert.equal(isReported('', reported), false);
    assert.equal(isReported(null, reported), false);
  });

  test('an uploaded report ticks off the advice it answers', () => {
    const reported = reportedNames([
      { testName: 'Vitamin D (25-Hydroxy) Total' },
      { testName: 'Vitamin B12' },
    ]);
    assert.equal(isReported('Vitamin D', reported), true);
    assert.equal(isReported('Vitamin B12', reported), true);
    assert.equal(isReported('HbA1c', reported), false);
  });

  test('only the tests still missing are named', () => {
    // The nudge used to list everything the doctor advised, including the
    // three of four already uploaded.
    const advised = ['Vitamin D', 'Vitamin B12', 'HbA1c', 'Lipid Profile'];
    const results = [
      { testName: 'Vitamin D (25-Hydroxy)' },
      { testName: 'vitamin b12' },
      { testName: 'Lipid profile' },
    ];
    assert.deepEqual(outstandingTests(advised, results), ['HbA1c']);
  });

  test('nothing outstanding means nothing to send', () => {
    // The bug as reported: everything uploaded, still nudged.
    const advised = ['Vitamin D', 'Vitamin B12'];
    const results = [{ testName: 'Vitamin D' }, { testName: 'Vitamin B12' }];
    assert.deepEqual(outstandingTests(advised, results), []);
  });

  test('a report uploaded before the advice still counts', () => {
    // The specific reason the old check failed: it asked whether anything had
    // been uploaded *since* the prescription. A report sent to the clinic
    // before the doctor typed the advice — the normal order when a test is
    // discussed in the room — matched nothing. Names carry no date, which is
    // exactly why they are the right thing to compare.
    assert.deepEqual(outstandingTests(['Vitamin D'], [{ testName: 'Vitamin D' }]), []);
  });

  test('no uploads at all leaves everything outstanding', () => {
    assert.deepEqual(outstandingTests(['HbA1c', 'CBC'], []), ['HbA1c', 'CBC']);
    assert.deepEqual(outstandingTests(['HbA1c'], null), ['HbA1c']);
  });

  test('no advised tests is nothing outstanding, not a crash', () => {
    assert.deepEqual(outstandingTests(null, [{ testName: 'CBC' }]), []);
    assert.deepEqual(outstandingTests([], []), []);
  });
});
