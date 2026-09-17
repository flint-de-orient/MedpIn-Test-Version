import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { Prescription } from '../src/models/Prescription.js';
import { Condition } from '../src/models/Condition.js';
import { PatientCondition } from '../src/models/PatientCondition.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { Hba1cRecord } from '../src/models/Hba1cRecord.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { User, ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * The panels a general physician, a cardiologist and a diabetologist open onto.
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

const sugar = (who, valueMgDl, at) => GlucoseReading.create({ patient: who.user._id, valueMgDl, measuredAt: at });
const a1c = (who, percentage, testedOn) => Hba1cRecord.create({ patient: who.user._id, percentage, testedOn });

describe('glucose: lows and very highs', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('counts every low and every very high in the window, the severe ones first', async () => {
    const mild = await enrolled(a, 'Mild Low');
    const severe = await enrolled(a, 'Severe Low');
    const soaring = await enrolled(a, 'Very High');
    const steady = await enrolled(a, 'Steady');
    await enrolled(a, 'Never Logged');

    await sugar(mild, 64, daysAgo(2));
    await sugar(mild, 66, daysAgo(4));
    await sugar(severe, 48, daysAgo(6)); // below 54: severe
    await sugar(severe, 140, daysAgo(1)); // a normal reading after does not answer it
    await sugar(soaring, 420, daysAgo(3));
    await sugar(soaring, 260, daysAgo(1));
    await sugar(steady, 110, daysAgo(1));
    await sugar(steady, 150, daysAgo(2));
    await sugar(steady, 60, daysAgo(40)); // outside the fourteen days

    const res = await as(a.doctor.token).get('/doctor/panels/glucose');
    assert.equal(res.status, 200);
    assert.equal(res.body.caseload, 5);
    assert.equal(res.body.withReadings, 4);
    assert.equal(res.body.withoutReadings, 1, 'a patient who logged nothing was counted as measured');
    assert.equal(res.body.readings, 8);
    // 70–180: the two steady readings and the severe patient's 140.
    assert.equal(res.body.inRange, 3);

    assert.deepEqual(
      res.body.lows.map((x) => [x.name, x.count, x.severe, x.lowest]),
      [
        ['Severe Low', 1, 1, 48],
        ['Mild Low', 2, 0, 64],
      ],
    );
    assert.equal(res.body.lowsTotal, 2);
    assert.deepEqual(
      res.body.highs.map((x) => [x.name, x.count, x.critical, x.highest]),
      [['Very High', 2, 1, 420]],
    );
    assert.equal(res.body.thresholds.low, 70);
    assert.equal(res.body.thresholds.veryHigh, 250);
  });

  test('shows nobody from another practice, and nothing from before enrolment', async () => {
    const theirs = await enrolled(b, 'Behala Hypo');
    await sugar(theirs, 40, daysAgo(1));
    // Enrolled here yesterday; the low was logged five days ago.
    const joined = await enrolled(a, 'Joined Yesterday', 1);
    await sugar(joined, 45, daysAgo(5));

    const res = await as(a.doctor.token).get('/doctor/panels/glucose');
    assert.equal(res.body.lowsTotal, 0, 'a reading this practice may not read was counted');
    assert.equal(res.body.readings, 0);
    assert.equal(res.body.withoutReadings, 1);
    assert.ok(!JSON.stringify(res.body).includes('Behala Hypo'), 'another practice’s patient was named');
  });

  test('a practice with nobody enrolled answers with nothing, not an error', async () => {
    const res = await as(a.doctor.token).get('/doctor/panels/glucose');
    assert.equal(res.status, 200);
    assert.equal(res.body.caseload, 0);
    assert.equal(res.body.readings, 0);
  });
});

describe('HbA1c control', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('each patient’s latest result against their own target, and who has none in the window', async () => {
    const poor = await enrolled(a, 'Poor Control', 400);
    const above = await enrolled(a, 'Above Target', 400);
    const eased = await enrolled(a, 'Eased Target', 400);
    const fine = await enrolled(a, 'At Target', 400);
    const stale = await enrolled(a, 'Tested Long Ago', 400);
    await enrolled(a, 'Never Tested', 400);

    await a1c(poor, 7.2, daysAgo(200));
    await a1c(poor, 10.4, daysAgo(20)); // the latest one counts
    await a1c(above, 7.9, daysAgo(30));
    await a1c(eased, 7.6, daysAgo(10));
    // Their doctor set 8%: 7.6 is on target for them.
    await PatientProfile.create({ user: eased.user._id, targets: { hba1cMax: 8 } });
    await a1c(fine, 6.4, daysAgo(60));
    await a1c(stale, 8.8, daysAgo(300)); // outside the 180 days

    const res = await as(a.doctor.token).get('/doctor/panels/hba1c');
    assert.equal(res.status, 200);
    assert.equal(res.body.caseload, 6);
    assert.equal(res.body.withResult, 4);
    assert.equal(res.body.atTarget, 2, 'a patient on their own eased target was called above it');
    assert.equal(res.body.aboveTarget, 1);
    assert.equal(res.body.poorControl, 1);
    assert.deepEqual(
      res.body.above.map((x) => [x.name, x.percentage, x.poorControl]),
      [
        ['Poor Control', 10.4, true],
        ['Above Target', 7.9, false],
      ],
    );
    // Never tested before tested long ago; the last result is said, not hidden.
    assert.deepEqual(
      res.body.untested.map((x) => [x.name, x.lastPercentage]),
      [
        ['Never Tested', null],
        ['Tested Long Ago', 8.8],
      ],
    );
    assert.equal(res.body.untestedTotal, 2);
    assert.equal(res.body.target.default, 7);
  });

  test('shows nobody from another practice, and no result from before enrolment', async () => {
    const theirs = await enrolled(b, 'Behala Patient');
    await a1c(theirs, 12.1, daysAgo(5));
    const joined = await enrolled(a, 'Joined Last Week', 7);
    await a1c(joined, 11.5, daysAgo(30)); // tested before this practice took them on

    const res = await as(a.doctor.token).get('/doctor/panels/hba1c');
    assert.equal(res.body.withResult, 0, 'a pre-enrolment HbA1c was read');
    assert.deepEqual(res.body.untested.map((x) => [x.name, x.lastPercentage]), [['Joined Last Week', null]]);
    assert.ok(!JSON.stringify(res.body).includes('Behala Patient'), 'another practice’s patient was named');
    assert.ok(!JSON.stringify(res.body).includes('11.5'), 'a pre-enrolment value leaked as the last result');
  });
});

describe('the home the panels are drawn on, from what the practice says it is', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('a diabetology practice’s doctor opens onto sugars and HbA1c', async () => {
    const p = await makePractice('Dey Diabetes', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
      specialty: 'diabetology',
    });
    const doctor = await makeMember(p, { name: 'Dr Dey', isOwner: true });

    const res = await as(doctor.token).get('/auth/me/capabilities');
    assert.equal(res.status, 200);
    assert.equal(res.body.ui.specialty, 'diabetology');
    assert.equal(res.body.ui.source, 'practiceSpecialty');
    assert.ok(res.body.ui.widgets.includes('GLUCOSE_FLAGS'));
    assert.ok(res.body.ui.widgets.includes('HBA1C_CONTROL'));
    assert.deepEqual(res.body.ui.quickActions, ['START_CONSULTATION', 'ADD_PATIENT']);
  });

  test('a cardiologist at a general practice opens onto their own specialty', async () => {
    const p = await makePractice('Town Practice', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
      specialty: 'general_physician',
    });
    const cardiologist = await makeMember(p, { name: 'Dr Sen', isOwner: true });
    await User.updateOne({ _id: cardiologist.user._id }, { specialty: 'Consultant Cardiologist' });
    const physician = await makeMember(p, { name: 'Dr Roy' });

    const theirs = await as(cardiologist.token).get('/auth/me/capabilities');
    assert.equal(theirs.body.ui.specialty, 'cardiology');
    assert.ok(theirs.body.ui.widgets.includes('RECENT_ECGS'));

    const colleague = await as(physician.token).get('/auth/me/capabilities');
    assert.equal(colleague.body.ui.specialty, 'general_physician');
    assert.ok(colleague.body.ui.widgets.includes('BP_CONTROL'));
    assert.ok(!colleague.body.ui.widgets.includes('RECENT_ECGS'));
  });

  test('no diet-review panel where nobody answers in nutrition, and one once a dietician is hired', async () => {
    // A diagnostic centre has no assistant by type.
    const p = await makePractice('Scan Centre', {
      practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
      plan: PLAN.PROFESSIONAL,
    });
    const doctor = await makeMember(p, { name: 'Dr Pal', isOwner: true });

    const before_ = await as(doctor.token).get('/auth/me/capabilities');
    assert.equal(before_.body.hasDietician, false);
    assert.ok(!before_.body.ui.widgets.includes('NUTRITION_REVIEWS'), 'a panel with nothing behind it was offered');

    await makeMember(p, { name: 'Scan Centre Dietician', role: ROLES.DIETICIAN });
    const after_ = await as(doctor.token).get('/auth/me/capabilities');
    assert.ok(after_.body.ui.widgets.includes('NUTRITION_REVIEWS'));
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
    '/doctor/panels/glucose',
    '/doctor/panels/hba1c',
  ]) {
    test(`${path}: the desk yes; the practice manager and the dietician no`, async () => {
      assert.equal((await as(a.desk.token).get(path)).status, 200);
      assert.equal((await as(a.manager.token).get(path)).status, 403, 'a practice manager read patients by name');
      assert.equal((await as(a.dietician.token).get(path)).status, 403, 'a dietician read the whole caseload');
    });
  }
});
