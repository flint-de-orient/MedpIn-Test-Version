import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { LifestyleLog } from '../src/models/LifestyleLog.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * A date the caller names does not reach past the enrolment.
 *
 * ---- The shape of the leak -------------------------------------------------
 *
 *     { patient, ...recordWindow(req, 'measuredAt'), ...dateRange('measuredAt', { from, to }) }
 *
 * Both halves are `{ measuredAt: {...} }`. Spread one after the other, the
 * second replaces the first — so `?from=2020-01-01` on a practice's read of a
 * patient's readings swapped "since this practice enrolled them" for "since
 * 2020", and returned everything. The glucose list, the blood pressure list and
 * the lifestyle list took a range that way; the weight trend's own `days` and a
 * day's lifestyle summary did the same with a key of their own.
 *
 * Every check in the suite passed throughout, because each of those filters did
 * contain a window. It was simply overwritten on the next line.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

let doctor;
let patient;

describe('a named date range stays inside the enrolment', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    const practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    doctor = await makeMember(practice, { name: 'Dr Salt Lake', isOwner: true });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await Enrollment.updateOne({ _id: patient.enrollments[0]._id }, { $set: { enrolledOn: ago(10) } });

    const id = patient.user._id;
    await GlucoseReading.create({ patient: id, valueMgDl: 287, measuredAt: ago(30) });
    await GlucoseReading.create({ patient: id, valueMgDl: 131, measuredAt: ago(2) });
    await VitalRecord.create({ patient: id, systolic: 171, diastolic: 99, weightKg: 82, recordedAt: ago(30) });
    await VitalRecord.create({ patient: id, systolic: 128, diastolic: 82, weightKg: 79, recordedAt: ago(2) });
    await LifestyleLog.create({ patient: id, kind: 'water', volumeMl: 750, loggedAt: ago(30) });
    await LifestyleLog.create({ patient: id, kind: 'water', volumeMl: 500, loggedAt: ago(2) });
  });

  const read = (path) => as(doctor.token).get(`/patients/${patient.user._id}${path}`);
  const from = () => ago(365).toISOString();

  test('the glucose list', async () => {
    const res = await read(`/glucose?from=${from()}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((g) => g.valueMgDl), [131], 'a date range reached past the enrolment');
  });

  test('the blood pressure list', async () => {
    const res = await read(`/vitals?from=${from()}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((v) => v.systolic), [128], 'a date range reached past the enrolment');
  });

  test('the lifestyle list', async () => {
    const res = await read(`/lifestyle?from=${from()}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items.map((l) => l.volumeMl), [500], 'a date range reached past the enrolment');
  });

  test('the weight trend, however many days it asks for', async () => {
    const res = await read('/vitals/weight-trend?days=365');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.series.map((s) => s.weightKg), [79], 'the trend reached past the enrolment');
  });

  test('a day’s summary, for a day before the enrolment', async () => {
    // Midday, so the day named is the day logged whatever this machine's zone.
    const day = ago(40).toISOString().slice(0, 10);
    await LifestyleLog.create({ patient: patient.user._id, kind: 'water', volumeMl: 640, loggedAt: new Date(`${day}T12:00:00Z`) });
    const res = await read(`/lifestyle/summary?date=${day}`);
    assert.equal(res.status, 200);
    assert.equal(res.body.water.totalMl, 0, 'a day from before the enrolment was read by naming it');
  });

  test('and a range inside the enrolment still narrows it', async () => {
    // The fix must not trade one bug for its mirror: a range still applies.
    const res = await read(`/glucose?from=${ago(1).toISOString()}`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
  });

  test('the patient’s own reads are not bounded at all', async () => {
    const res = await as(patient.token).get(`/patients/me/glucose?from=${from()}`);
    assert.deepEqual(res.body.items.map((g) => g.valueMgDl).sort(), [131, 287]);
  });
});
