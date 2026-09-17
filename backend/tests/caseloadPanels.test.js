import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { Prescription } from '../src/models/Prescription.js';
import { Condition } from '../src/models/Condition.js';
import { PatientCondition } from '../src/models/PatientCondition.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * The panels a general physician and a cardiologist open onto.
 *
 * Each reads what the record already says, and each is bounded twice: by the
 * practice's own caseload, and by the date each patient's enrolment there began.
 * A panel is the easiest place to leak another clinic's patients — it is a list,
 * it is on the home screen, and nobody opens it looking for a stranger.
 */

let a;
let b;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);
const daysFromNow = (n) => new Date(Date.now() + n * DAY);

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  const doctor = await makeMember(p, { name: `Dr ${name}`, isOwner: true });
  const desk = await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF });
  const manager = await makeMember(p, { name: `${name} Manager`, role: ROLES.PRACTICE_MANAGER });
  const dietician = await makeMember(p, { name: `${name} Dietician`, role: ROLES.DIETICIAN });
  return { practice: p, doctor, desk, manager, dietician };
}

/** A patient enrolled here some days ago, so earlier readings are in the window. */
async function enrolled(where, name, since = 200) {
  const patient = await makePatient({ name, practices: [where.practice] });
  await Enrollment.updateOne({ patient: patient.patient._id, practice: where.practice._id }, { enrolledOn: daysAgo(since) });
  return patient;
}

const bp = (who, systolic, diastolic, at, flag) =>
  VitalRecord.create({ patient: who.user._id, systolic, diastolic, recordedAt: at, ...(flag ? { flag } : {}) });

let rxSeq = 0;
const rx = (who, doctor, fields) =>
  Prescription.create({
    patient: who.user._id,
    doctor: doctor.user._id,
    referenceNo: `PANEL-2026-${String(++rxSeq).padStart(6, '0')}`,
    items: [{ name: 'Amlodipine', strength: '5mg' }],
    ...fields,
  });

describe('blood pressure control', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('counts each patient’s latest reading by band, and names the ones needing attention', async () => {
    const crisis = await enrolled(a, 'Crisis Patient');
    const stage2 = await enrolled(a, 'Stage Two Patient');
    const normal = await enrolled(a, 'Normal Patient');
    await enrolled(a, 'Never Measured');

    await bp(crisis, 150, 95, daysAgo(10), 'stage2');
    await bp(crisis, 190, 120, daysAgo(1), 'hypertensive_crisis'); // the latest one counts
    // Unbanded, as the consulting room used to write it: banded from the numbers.
    await bp(stage2, 162, 102, daysAgo(2));
    await bp(normal, 118, 76, daysAgo(3), 'normal');

    const res = await as(a.doctor.token).get('/doctor/panels/blood-pressure');
    assert.equal(res.status, 200);
    assert.equal(res.body.caseload, 4);
    assert.equal(res.body.withReading, 3);
    assert.equal(res.body.withoutReading, 1, 'a patient nobody measured was folded into a band');
    assert.deepEqual(
      { crisis: res.body.bands.hypertensive_crisis, stage2: res.body.bands.stage2, normal: res.body.bands.normal },
      { crisis: 1, stage2: 1, normal: 1 },
    );
    assert.deepEqual(
      res.body.attention.map((x) => x.name),
      ['Crisis Patient', 'Stage Two Patient'],
      'a crisis was not listed first',
    );
  });

  test('shows nobody from another practice', async () => {
    const theirs = await enrolled(b, 'Behala Crisis');
    await bp(theirs, 200, 125, daysAgo(1), 'hypertensive_crisis');

    const res = await as(a.doctor.token).get('/doctor/panels/blood-pressure');
    assert.equal(res.body.bands.hypertensive_crisis, 0);
    assert.ok(!JSON.stringify(res.body).includes('Behala Crisis'), 'another practice’s patient was named');
  });

  test('does not read a reading from before this practice enrolled the patient', async () => {
    // Enrolled here yesterday; the crisis was recorded a week ago, elsewhere in
    // their history. This practice may not see it.
    const joined = await enrolled(a, 'Joined Yesterday', 1);
    await bp(joined, 195, 125, daysAgo(7), 'hypertensive_crisis');

    const res = await as(a.doctor.token).get('/doctor/panels/blood-pressure');
    assert.equal(res.body.bands.hypertensive_crisis, 0, 'a pre-enrolment reading was read');
    assert.equal(res.body.withoutReading, 1);
  });
});

describe('follow-ups due', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('splits overdue from due, and leaves out the long-missed and the answered', async () => {
    const dueSoon = await enrolled(a, 'Due Tomorrow');
    const late = await enrolled(a, 'Three Days Late');
    const ancient = await enrolled(a, 'Missed Long Ago');
    const answered = await enrolled(a, 'Seen Since');

    await rx(dueSoon, a.doctor, { issuedOn: daysAgo(10), followUpOn: daysFromNow(1) });
    await rx(late, a.doctor, { issuedOn: daysAgo(20), followUpOn: daysAgo(3) });
    await rx(ancient, a.doctor, { issuedOn: daysAgo(100), followUpOn: daysAgo(60) });
    // An older prescription asked for a follow-up; a newer visit answered it.
    await rx(answered, a.doctor, { issuedOn: daysAgo(30), followUpOn: daysAgo(2) });
    await rx(answered, a.doctor, { issuedOn: daysAgo(1) });

    const res = await as(a.doctor.token).get('/doctor/panels/follow-ups');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.due.map((x) => x.name), ['Due Tomorrow']);
    assert.deepEqual(res.body.overdue.map((x) => x.name), ['Three Days Late']);
  });

  test('an ended prescription asks for no follow-up', async () => {
    const who = await enrolled(a, 'Voided Rx');
    const ended = await rx(who, a.doctor, { issuedOn: daysAgo(5), followUpOn: daysFromNow(2) });
    ended.endAs('voided', { by: a.doctor.user._id, reason: 'Issued to the wrong patient.' });
    await ended.save();

    const res = await as(a.doctor.token).get('/doctor/panels/follow-ups');
    assert.equal(res.body.dueTotal, 0, 'a voided prescription’s follow-up was shown as due');
  });
});

describe('the condition register', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  test('counts diagnosed conditions, not suspicions', async () => {
    const htn = await Condition.create({ key: 'hypertension', names: { en: 'Hypertension', bn: 'উচ্চ রক্তচাপ' } });
    const t2 = await Condition.create({ key: 'type2_diabetes', names: { en: 'Type 2 diabetes' } });

    const one = await enrolled(a, 'One');
    const two = await enrolled(a, 'Two');
    await enrolled(a, 'Nothing Recorded');

    await PatientCondition.create({ patient: one.user._id, condition: htn._id, status: 'active' });
    await PatientCondition.create({ patient: two.user._id, condition: htn._id, status: 'active' });
    await PatientCondition.create({ patient: two.user._id, condition: t2._id, status: 'suspected' });

    const res = await as(a.doctor.token).get('/doctor/panels/conditions');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.conditions, [{ key: 'hypertension', name: 'Hypertension', count: 2 }]);
    assert.equal(res.body.withoutCondition, 1);

    const bengali = await as(a.doctor.token).get('/doctor/panels/conditions?language=bn');
    assert.equal(bengali.body.conditions[0].name, 'উচ্চ রক্তচাপ');
  });
});

describe('heart rate', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  test('flags pulses outside the triage engine’s own limits', async () => {
    const slow = await enrolled(a, 'Slow Pulse');
    const fast = await enrolled(a, 'Fast Pulse');
    const fine = await enrolled(a, 'Fine Pulse');
    await VitalRecord.create({ patient: slow.user._id, pulse: 44, recordedAt: daysAgo(1) });
    await VitalRecord.create({ patient: fast.user._id, pulse: 132, recordedAt: daysAgo(2) });
    await VitalRecord.create({ patient: fine.user._id, pulse: 78, recordedAt: daysAgo(1) });

    const res = await as(a.doctor.token).get('/doctor/panels/heart-rate');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.low.map((x) => x.name), ['Slow Pulse']);
    assert.deepEqual(res.body.high.map((x) => x.name), ['Fast Pulse']);
    assert.equal(res.body.withReading, 3);
    assert.ok(res.body.limits.low && res.body.limits.high);
  });
});

describe('who may open the panels', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  for (const path of [
    '/doctor/panels/blood-pressure',
    '/doctor/panels/follow-ups',
    '/doctor/panels/conditions',
    '/doctor/panels/heart-rate',
    '/doctor/panels/ecg',
    '/doctor/panels/lipids',
  ]) {
    test(`${path}: the desk yes; the practice manager and the dietician no`, async () => {
      assert.equal((await as(a.desk.token).get(path)).status, 200);
      assert.equal((await as(a.manager.token).get(path)).status, 403, 'a practice manager read patients by name');
      assert.equal((await as(a.dietician.token).get(path)).status, 403, 'a dietician read the whole caseload');
    });
  }
});
