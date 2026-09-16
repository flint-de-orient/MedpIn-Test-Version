import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { pdfText } from './helpers/pdfText.js';
import { Practice, PLAN, PRACTICE_TYPE, PRACTICE_STATUS } from '../src/models/Practice.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../src/models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Patient } from '../src/models/Patient.js';
import { Prescription } from '../src/models/Prescription.js';
import { Appointment } from '../src/models/Appointment.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/models/User.js';
import { RECORD_STATE } from '../src/models/plugins/clinicalRecord.js';
import { clinicDateTime } from '../src/utils/clinicTime.js';
import { clinicToday } from '../src/services/dailyReport.js';

/**
 * A doctor's day, taken out of the app.
 *
 * ---- What these hold ------------------------------------------------------
 *
 * `GET /doctor/reports/daily` summarises the patients a doctor saw on a date,
 * as a preview (`format=json`) and as a PDF made to be passed on through a
 * phone's share sheet. Because it leaves the app, the things that matter are
 * whose patients are on it and what is printed about them:
 *
 *   - "seen" is a checked-in, in-consultation or completed appointment with
 *     this doctor at this practice on that day, or a prescription this doctor
 *     issued there that day — nothing else;
 *   - another practice's patients never appear, nor a colleague's day, nor a
 *     patient whose enrolment was withdrawn or began after the visit;
 *   - the page carries name, age and sex, complaint, diagnosis, vitals,
 *     prescription, advice and follow-up, and no record ids, phone numbers or
 *     reference numbers;
 *   - every generation is written to the audit log, one row per patient named.
 */

const day = (() => {
  const d = clinicDateTime(clinicToday(), '00:00').subtract(1, 'day');
  return d.format('YYYY-MM-DD');
})();
const at = (time, date = day) => clinicDateTime(date, time).toDate();
const monthAgo = clinicDateTime(clinicToday(), '00:00').subtract(30, 'day').toDate();

let n = 0;
const ref = () => `RX-TEST-${String((n += 1)).padStart(6, '0')}`;

let practice;
let otherPractice;
let doctor;
let colleague;
let otherDoctor;
let desk;
let dietician;
let people;
let knownIds;

async function enrolEarlier(patient) {
  await Enrollment.updateMany({ patient: patient.user._id }, { $set: { enrolledOn: monthAgo } });
}

async function pdfOf(token, query, headers = {}) {
  const res = await fetch(`${await boot()}/doctor/reports/daily?${query}`, {
    headers: { Authorization: `Bearer ${token}`, ...headers },
  });
  return { res, buf: Buffer.from(await res.arrayBuffer()) };
}

describe('the daily patient summary', () => {
  before(boot);
  after(shutdown);

  beforeEach(async () => {
    await wipe();
    const extra = { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL };
    practice = await makePractice('Lake Town Heart Centre', extra);
    otherPractice = await makePractice('Salt Lake Diabetes Care', extra);

    doctor = await makeMember(practice, { name: 'Dr. Meera Iyer', isOwner: true });
    colleague = await makeMember(practice, { name: 'Dr. Rina Sen' });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    dietician = await makeMember(practice, { name: 'Diet Person', role: ROLES.DIETICIAN });
    otherDoctor = await makeMember(otherPractice, { name: 'Dr. Other Practice', isOwner: true });

    const mk = async (name, practices) => {
      const p = await makePatient({ name, practices });
      await enrolEarlier(p);
      return p;
    };

    people = {
      seenWithVisit: await mk('Rahul Das', [practice]),
      walkIn: await mk('Priya Nair', [practice]),
      onlyBooked: await mk('Booked Notseen', [practice]),
      colleaguesPatient: await mk('Colleague Patient', [practice]),
      otherPracticesPatient: await mk('Other Practice Patient', [otherPractice]),
      withdrew: await mk('Withdrawn Consent', [practice]),
      yesterdayBefore: await mk('Seen Day Before', [practice]),
      enrolledAfter: await makePatient({ name: 'Enrolled Later', practices: [practice] }),
      bothPractices: await mk('Shared Patient', [practice, otherPractice]),
    };

    // Rahul: a completed visit, a prescription, clinic vitals, and a home reading.
    await Patient.updateOne(
      { _id: people.seenWithVisit.user._id },
      { $set: { dateOfBirth: new Date('1971-03-02'), gender: 'male' } },
    );
    const visit = await Appointment.create({
      patient: people.seenWithVisit.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      scheduledFor: at('10:30'),
      status: 'completed',
      reason: 'Chest tightness when walking',
    });
    const rahulRx = await Prescription.create({
      patient: people.seenWithVisit.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      referenceNo: ref(),
      issuedOn: at('10:50'),
      complaint: 'Chest tightness on exertion for two weeks',
      diagnosis: ['Stable angina', 'Hypertension'],
      items: [{ name: 'Atorvastatin', strength: '20 mg', frequency: 'HS', durationDays: 30 }],
      labTestsAdvised: ['Lipid profile'],
      generalAdvice: 'Avoid exertion until reviewed.',
      followUpOn: at('10:00', clinicToday()),
    });
    await VitalRecord.create({
      patient: people.seenWithVisit.user._id,
      recordedAt: at('10:35'),
      systolic: 150,
      diastolic: 94,
      pulse: 88,
    });
    await GlucoseReading.create({
      patient: people.seenWithVisit.user._id,
      valueMgDl: 162,
      context: 'random',
      source: 'clinic',
      measuredAt: at('10:36'),
    });
    await GlucoseReading.create({
      patient: people.seenWithVisit.user._id,
      valueMgDl: 99,
      context: 'fasting',
      source: 'manual',
      measuredAt: at('07:00'),
    });

    // Priya: no booking, a prescription — and one voided before it.
    await Prescription.create({
      patient: people.walkIn.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      referenceNo: ref(),
      issuedOn: at('12:00'),
      diagnosis: ['Wrong patient'],
      items: [{ name: 'Glimepiride', strength: '4 mg', frequency: 'OD' }],
      recordState: RECORD_STATE.VOIDED,
      endedReason: 'Issued to the wrong patient.',
    });
    const priyaRx = await Prescription.create({
      patient: people.walkIn.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      referenceNo: ref(),
      issuedOn: at('12:10'),
      diagnosis: ['Type 2 diabetes'],
      items: [{ name: 'Metformin', strength: '500 mg', frequency: 'BD', relationToMeal: 'after_meal' }],
    });

    // Booked, never came in; and cancelled.
    await Appointment.create({
      patient: people.onlyBooked.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      scheduledFor: at('11:00'),
      status: 'confirmed',
    });
    await Appointment.create({
      patient: people.onlyBooked.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      scheduledFor: at('11:30'),
      status: 'cancelled',
    });

    // The colleague's day.
    await Appointment.create({
      patient: people.colleaguesPatient.user._id,
      doctor: colleague.user._id,
      practice: practice._id,
      scheduledFor: at('09:30'),
      status: 'completed',
    });

    // Another practice's patient, and a shared patient seen at the other practice.
    await Prescription.create({
      patient: people.otherPracticesPatient.user._id,
      doctor: otherDoctor.user._id,
      practice: otherPractice._id,
      referenceNo: ref(),
      issuedOn: at('10:00'),
      items: [{ name: 'Insulin glargine' }],
    });
    await Prescription.create({
      patient: people.bothPractices.user._id,
      doctor: otherDoctor.user._id,
      practice: otherPractice._id,
      referenceNo: ref(),
      issuedOn: at('15:00'),
      items: [{ name: 'Telmisartan', strength: '40 mg' }],
    });

    // Consent withdrawn after the visit.
    await Prescription.create({
      patient: people.withdrew.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      referenceNo: ref(),
      issuedOn: at('13:00'),
      items: [{ name: 'Amlodipine', strength: '5 mg' }],
    });
    await Enrollment.updateOne(
      { patient: people.withdrew.user._id, practice: practice._id },
      { $set: { status: ENROLLMENT_STATUS.REVOKED, revokedAt: new Date() } },
    );

    // The day before.
    const dayBefore = clinicDateTime(day, '00:00').subtract(1, 'day').format('YYYY-MM-DD');
    await Prescription.create({
      patient: people.yesterdayBefore.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      referenceNo: ref(),
      issuedOn: at('16:00', dayBefore),
      items: [{ name: 'Vildagliptin', strength: '50 mg' }],
    });

    // A record from before the practice's access began (enrolled today).
    await Prescription.create({
      patient: people.enrolledAfter.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      referenceNo: ref(),
      issuedOn: at('17:00'),
      items: [{ name: 'Pioglitazone', strength: '15 mg' }],
    });

    knownIds = [
      practice._id,
      otherPractice._id,
      doctor.user._id,
      colleague.user._id,
      visit._id,
      rahulRx._id,
      priyaRx._id,
      ...Object.values(people).map((p) => p.user._id),
    ].map(String);
  });

  test('the preview lists exactly the patients this doctor saw that day, in order', async () => {
    const res = await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const { report } = res.body;
    assert.equal(report.date, day);
    assert.deepEqual(
      report.patients.map((p) => p.name),
      ['Rahul Das', 'Priya Nair'],
      'the wrong patients are on the day',
    );
    assert.equal(report.totals.patients, 2);
    assert.equal(report.practice.name, 'Lake Town Heart Centre');
    assert.equal(report.doctor.name, 'Dr. Meera Iyer');
  });

  test('each patient carries what the summary is for', async () => {
    const { report } = (await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`)).body;
    const rahul = report.patients.find((p) => p.name === 'Rahul Das');

    assert.equal(rahul.sex, 'Male');
    assert.ok(rahul.age >= 54 && rahul.age <= 56, `age ${rahul.age}`);
    assert.deepEqual(rahul.complaint, {
      text: 'Chest tightness on exertion for two weeks',
      source: 'prescription',
    });
    assert.deepEqual(rahul.diagnosis, ['Stable angina', 'Hypertension']);
    assert.equal(rahul.vitals.length, 1);
    assert.equal(rahul.vitals[0].bloodPressure, '150/94');
    assert.equal(rahul.vitals[0].pulse, 88);
    // The clinic's glucose only — the fasting reading from home is not a vital
    // the doctor took.
    assert.deepEqual(rahul.glucose.map((g) => g.valueMgDl), [162]);
    assert.equal(rahul.prescriptions.length, 1);
    assert.equal(rahul.prescriptions[0].items[0].name, 'Atorvastatin');
    assert.deepEqual(rahul.prescriptions[0].investigations, ['Lipid profile']);
    assert.equal(rahul.advice, 'Avoid exertion until reviewed.');
    assert.ok(rahul.followUpOn);
    assert.equal(rahul.visit, 'completed');

    const priya = report.patients.find((p) => p.name === 'Priya Nair');
    assert.equal(priya.voidedPrescriptions, 1);
    assert.deepEqual(priya.diagnosis, ['Type 2 diabetes'], 'a voided prescription’s diagnosis is on the page');
    assert.deepEqual(priya.prescriptions.map((r) => r.items[0].name), ['Metformin']);
    assert.equal(priya.complaint, null);
    assert.equal(priya.age, null, 'an age was invented for somebody with no birth date');
  });

  test('neither the preview nor the PDF carries a record id, a phone number or a reference', async () => {
    const preview = await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`);
    const previewText = JSON.stringify(preview.body);
    assert.ok(!/\b[0-9a-f]{24}\b/.test(previewText), 'an object id is in the preview');
    for (const id of knownIds) assert.ok(!previewText.includes(id));
    assert.ok(!previewText.includes('RX-TEST-'), 'a prescription reference is in the preview');
    assert.ok(!previewText.includes(String(people.seenWithVisit.user.phone)), 'a phone number is in the preview');

    const { res, buf } = await pdfOf(doctor.token, `date=${day}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /application\/pdf/);
    assert.equal(res.headers.get('content-disposition'), `attachment; filename="daily-summary-${day}.pdf"`);
    assert.equal(res.headers.get('cache-control'), 'no-store');

    const text = pdfText(buf);
    const raw = buf.toString('latin1');
    for (const id of knownIds) {
      assert.ok(!text.includes(id), `object id ${id} printed on the PDF`);
      assert.ok(!raw.includes(id), `object id ${id} inside the PDF file`);
    }
    assert.ok(!/\b[0-9a-f]{24}\b/.test(text), 'an object id is printed on the PDF');
    assert.ok(!text.includes('RX-TEST-'), 'a prescription reference is printed on the PDF');
    assert.ok(!text.includes(String(people.seenWithVisit.user.phone)));

    // And what it is for is there.
    for (const expected of [
      'Lake Town Heart Centre',
      'Dr. Meera Iyer',
      'Rahul Das',
      'Priya Nair',
      'Chest tightness on exertion for two weeks',
      'Stable angina; Hypertension',
      'BP 150/94 mmHg',
      'Glucose 162 mg/dL',
      'Atorvastatin 20 mg',
      'Avoid exertion until reviewed.',
      'FOLLOW-UP',
      'Male',
    ]) {
      assert.ok(text.includes(expected), `"${expected}" is not on the PDF`);
    }
    for (const absent of [
      'Booked Notseen',
      'Colleague Patient',
      'Other Practice Patient',
      'Withdrawn Consent',
      'Seen Day Before',
      'Enrolled Later',
      'Shared Patient',
      'Glimepiride',
    ]) {
      assert.ok(!text.includes(absent), `"${absent}" is on the PDF`);
    }
  });

  test('a colleague’s day and another practice’s day are their own', async () => {
    const theirs = (await as(colleague.token).get(`/doctor/reports/daily?date=${day}&format=json`)).body.report;
    assert.deepEqual(theirs.patients.map((p) => p.name), ['Colleague Patient']);

    const elsewhere = (await as(otherDoctor.token).get(`/doctor/reports/daily?date=${day}&format=json`)).body.report;
    assert.deepEqual(
      elsewhere.patients.map((p) => p.name).sort(),
      ['Other Practice Patient', 'Shared Patient'],
    );
    assert.ok(!allText(elsewhere).includes('Rahul Das'));
  });

  test('a doctor at two practices names which, and gets that one', async () => {
    await Membership.create({
      user: doctor.user._id,
      practice: otherPractice._id,
      role: ROLES.DOCTOR,
      permissions: presetFor({ role: ROLES.DOCTOR }),
      status: MEMBERSHIP_STATUS.ACTIVE,
    });
    const unnamed = await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`);
    assert.equal(unnamed.status, 409);
    assert.equal(unnamed.body.error.code, 'PRACTICE_REQUIRED');

    const there = await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`, {
      'x-medpin-practice': String(otherPractice._id),
    });
    assert.equal(there.status, 200);
    assert.deepEqual(there.body.report.patients, [], 'the other practice’s report carried this practice’s day');
    assert.equal(there.body.report.practice.name, 'Salt Lake Diabetes Care');
  });

  test('an empty day says so, as a preview and on paper', async () => {
    const empty = clinicDateTime(day, '00:00').subtract(10, 'day').format('YYYY-MM-DD');
    const res = await as(doctor.token).get(`/doctor/reports/daily?date=${empty}&format=json`);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.report.patients, []);
    assert.equal(res.body.report.totals.patients, 0);

    const { res: pdfRes, buf } = await pdfOf(doctor.token, `date=${empty}`);
    assert.equal(pdfRes.status, 200);
    assert.match(pdfText(buf), /No patients seen on this date\./);

    // Still recorded, with nobody named.
    const rows = await AuditLog.find({ resource: 'DailyReport', 'meta.date': empty }).lean();
    assert.equal(rows.length, 2);
    assert.ok(rows.every((r) => !r.subjectPatient));
  });

  test('every generation and share is in the audit log, per patient named', async () => {
    await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`);
    await pdfOf(doctor.token, `date=${day}&purpose=share`);
    await pdfOf(doctor.token, `date=${day}`);

    const rows = await AuditLog.find({ resource: 'DailyReport' }).lean();
    const byAction = (action) => rows.filter((r) => r.action === action);

    const expected = [String(people.seenWithVisit.user._id), String(people.walkIn.user._id)].sort();
    for (const [action, purpose] of [
      ['read', 'preview'],
      ['share', 'share'],
      ['export', 'download'],
    ]) {
      const these = byAction(action);
      assert.deepEqual(these.map((r) => String(r.subjectPatient)).sort(), expected, `${action} rows name the wrong patients`);
      for (const r of these) {
        assert.equal(String(r.actor), String(doctor.user._id));
        assert.equal(r.meta.date, day);
        assert.equal(r.meta.purpose, purpose);
        assert.equal(r.meta.patients, 2);
        assert.equal(r.meta.practice, String(practice._id));
      }
    }
  });

  test('only a doctor, with VIEW_PATIENT, at a working practice', async () => {
    for (const [who, token] of [
      ['the desk', desk.token],
      ['a dietician', dietician.token],
      ['a patient', people.seenWithVisit.token],
    ]) {
      const res = await as(token).get(`/doctor/reports/daily?date=${day}&format=json`);
      assert.equal(res.status, 403, `${who} was given a doctor's day`);
    }
    assert.equal((await as(null).get(`/doctor/reports/daily?date=${day}`)).status, 401);

    await Membership.updateOne(
      { user: doctor.user._id, practice: practice._id },
      { $set: { permissions: [PERMISSIONS.PRESCRIBE, PERMISSIONS.EDIT_RECORD] } },
    );
    const withoutView = await as(doctor.token).get(`/doctor/reports/daily?date=${day}&format=json`);
    assert.equal(withoutView.status, 403, 'a doctor without VIEW_PATIENT read the day');

    await Practice.updateOne({ _id: otherPractice._id }, { $set: { status: PRACTICE_STATUS.SUSPENDED } });
    const suspended = await as(otherDoctor.token).get(`/doctor/reports/daily?date=${day}&format=json`);
    assert.equal(suspended.status, 403);
    assert.equal(suspended.body.error.code, 'PRACTICE_SUSPENDED');

    // No row written for anything refused.
    assert.equal(await AuditLog.countDocuments({ resource: 'DailyReport' }), 0);
  });

  test('a date is a real past or present day', async () => {
    const future = clinicDateTime(clinicToday(), '00:00').add(2, 'day').format('YYYY-MM-DD');
    assert.equal((await as(doctor.token).get(`/doctor/reports/daily?date=${future}`)).status, 400);
    assert.equal((await as(doctor.token).get('/doctor/reports/daily?date=16-09-2026')).status, 400);
    assert.equal((await as(doctor.token).get('/doctor/reports/daily?format=xml')).status, 400);

    // No date is today.
    const today = await as(doctor.token).get('/doctor/reports/daily?format=json');
    assert.equal(today.status, 200);
    assert.equal(today.body.report.date, clinicToday());
  });
});
