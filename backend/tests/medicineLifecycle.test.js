import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Medication } from '../src/models/Medication.js';
import { MedicationLog } from '../src/models/MedicationLog.js';
import { Prescription } from '../src/models/Prescription.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { inClinicTz } from '../src/utils/clinicTime.js';
import { doseExpected, occursOn } from '../src/services/medicationLifecycle.js';
import {
  remindsDaily,
  reminderIdFor,
  medReminderNotificationId,
  medOccurrenceNotificationId,
} from '../src/utils/medReminderId.js';

/**
 * C3 — a medicine's two lives, kept apart.
 *
 * The prescription is the doctor's: active, completed, stopped by the doctor,
 * cancelled. The taking is the patient's: taking, or stopped. A patient's
 * "Stop" used to write the same `isActive: false` a doctor's stop wrote, a
 * finished course stayed on the list with its reminders, and a new prescription
 * matched the running list by name alone — so metformin 1000 replaced
 * metformin 500 and one practice's prescription overwrote another's.
 */

let a;
let b;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return {
    practice: p,
    doctor: await makeMember(p, { name: `Dr ${name}`, isOwner: true }),
    desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
  };
}

const prescribe = (where, patient, items, extra = {}) =>
  as(where.doctor.token).post(`/patients/${patient.user._id}/prescriptions`, { items, ...extra });

const rowsOf = (patient, filter = {}) =>
  Medication.find({ patient: patient.user._id, ...filter }).sort({ createdAt: 1 }).lean();

const metformin500 = { name: 'Metformin', strength: '500mg', frequency: '1-0-1', durationDays: 30 };

/** Clinic-local midnight `n` days ago, plus a minute: a dose time already past today. */
const clinicDay = (n) => inClinicTz(new Date()).subtract(n, 'day').startOf('day');

describe('the patient stops taking a medicine', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  test('the prescription stays as the doctor wrote it; the stop is the patient’s, with their reason', async () => {
    const patient = await makePatient({ name: 'Upset Stomach', practices: [a.practice] });
    assert.equal((await prescribe(a, patient, [metformin500])).status, 201);
    const [before] = await rowsOf(patient);

    const res = await as(patient.token).post(`/patients/me/medications/${before._id}/stop-taking`, {
      reason: 'Stomach upset every morning',
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.medication.takingState, 'stopped_by_patient');
    assert.equal(res.body.medication.prescriptionState, 'active');
    assert.equal(res.body.medication.stoppedTaking.reason, 'Stomach upset every morning');

    const [after] = await rowsOf(patient);
    assert.equal(after.isActive, false, 'the reminders were left armed');
    assert.equal(after.prescriptionState, 'active', 'the patient’s stop rewrote the doctor’s prescription');
    for (const field of ['strength', 'dose', 'endDate', 'startDate', 'prescribedBy', 'prescription', 'practice']) {
      assert.deepEqual(after[field], before[field], `the patient’s stop changed ${field}`);
    }
    assert.equal(after.stoppedByDoctor?.at, undefined, 'recorded as the doctor’s stop');
    assert.equal(after.patientStops.length, 1);

    const rx = await Prescription.findById(before.prescription).lean();
    assert.equal(rx.recordState ?? 'current', 'current', 'the prescription itself was ended');

    const alerts = await ClinicalAlert.find({ patient: patient.user._id }).lean();
    assert.equal(alerts.length, 1, 'the doctor was not told');
    assert.equal(alerts[0].type, 'medication_nonadherence');
    assert.equal(alerts[0].severity, 'warning');
    assert.match(alerts[0].detail, /Stomach upset every morning/);
  });

  test('the Stop button older builds send is the same stop, never the doctor’s', async () => {
    const patient = await makePatient({ name: 'Old App', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    const [med] = await rowsOf(patient);

    assert.equal((await as(patient.token).del(`/patients/me/medications/${med._id}`)).status, 204);

    const [after] = await rowsOf(patient);
    assert.equal(after.takingState, 'stopped_by_patient');
    assert.equal(after.prescriptionState, 'active');
    assert.equal(after.stoppedByDoctor?.at, undefined);
  });

  test('stopping twice is one stop, and tells the doctor once', async () => {
    const patient = await makePatient({ name: 'Two Taps', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    const [med] = await rowsOf(patient);

    const url = `/patients/me/medications/${med._id}/stop-taking`;
    const [one, two] = await Promise.all([as(patient.token).post(url, {}), as(patient.token).post(url, {})]);

    assert.deepEqual([one.status, two.status], [200, 200]);
    assert.equal((await rowsOf(patient))[0].patientStops.length, 1, 'two stops were recorded for one');
    assert.equal(await ClinicalAlert.countDocuments({ patient: patient.user._id }), 1);
  });

  test('they can start again while it stands, and not once the course has ended', async () => {
    const patient = await makePatient({ name: 'Changed Mind', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    const [med] = await rowsOf(patient);
    const base = `/patients/me/medications/${med._id}`;

    await as(patient.token).post(`${base}/stop-taking`, {});
    const resumed = await as(patient.token).post(`${base}/resume-taking`);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.medication.isActive, true);
    const [again] = await rowsOf(patient);
    assert.ok(again.patientStops[0].resumedAt, 'the stop was left open');

    await as(patient.token).post(`${base}/stop-taking`, {});
    await Medication.updateOne({ _id: med._id }, { endDate: daysAgo(1) });
    const late = await as(patient.token).post(`${base}/resume-taking`);
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'PRESCRIPTION_ENDED');
    assert.equal((await rowsOf(patient))[0].isActive, false, 'a finished course was restarted');
  });

  test('the patient may re-time a reminder, and may not change what was prescribed', async () => {
    const patient = await makePatient({ name: 'Early Riser', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    const [med] = await rowsOf(patient);

    const dose = await as(patient.token).patch(`/patients/me/medications/${med._id}`, { dose: '2 tablets' });
    assert.equal(dose.status, 403);
    assert.equal(dose.body.error.code, 'DOCTOR_OWNED');
    assert.equal((await rowsOf(patient))[0].dose, med.dose ?? null);

    const times = await as(patient.token).patch(`/patients/me/medications/${med._id}`, {
      schedule: [{ time: '07:15', relationToMeal: 'after_meal' }],
    });
    assert.equal(times.status, 200);
    assert.equal((await rowsOf(patient))[0].timesCustomized, true);
  });

  test('a medicine the patient added is theirs: they change it, no doctor is told, and no doctor stops it', async () => {
    const patient = await makePatient({ name: 'Own Vitamins', practices: [a.practice] });
    const added = await as(patient.token).post('/patients/me/medications', {
      name: 'Vitamin D3',
      strength: '60000 IU',
      schedule: [{ time: '10:00' }],
    });
    assert.equal(added.status, 201);
    assert.equal(added.body.medication.ownedBy, 'patient');
    const [med] = await rowsOf(patient);
    assert.equal(med.source, 'manual', 'a medicine the patient typed was recorded as the clinic’s');
    assert.equal(med.practice, null);

    assert.equal((await as(patient.token).patch(`/patients/me/medications/${med._id}`, { dose: '1 capsule' })).status, 200);
    assert.equal((await as(patient.token).post(`/patients/me/medications/${med._id}/stop-taking`, {})).status, 200);
    assert.equal(await ClinicalAlert.countDocuments({ patient: patient.user._id }), 0);

    const byDoctor = await as(a.doctor.token).del(`/patients/${patient.user._id}/medications/${med._id}`);
    assert.equal(byDoctor.status, 403);
    assert.equal(byDoctor.body.error.code, 'PATIENT_OWNED');
  });
});

describe('the doctor stops a prescription', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('stopped by the doctor, with the reason, and the course’s own end date kept', async () => {
    const patient = await makePatient({ name: 'Switched Over', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    const [med] = await rowsOf(patient);

    const res = await as(a.doctor.token).post(`/patients/${patient.user._id}/medications/${med._id}/stop`, {
      reason: 'Started on insulin instead',
    });

    assert.equal(res.status, 200);
    const [after] = await rowsOf(patient);
    assert.equal(after.prescriptionState, 'stopped_by_doctor');
    assert.equal(after.isActive, false);
    assert.equal(after.stoppedByDoctor.reason, 'Started on insulin instead');
    assert.equal(String(after.stoppedByDoctor.by), String(a.doctor.user._id));
    assert.deepEqual(after.endDate, med.endDate, 'the stop rewrote what was prescribed');

    const byPatient = await as(patient.token).post(`/patients/me/medications/${med._id}/stop`, { reason: 'Not me' });
    assert.equal(byPatient.status, 403);

    const restart = await as(a.doctor.token).patch(`/patients/${patient.user._id}/medications/${med._id}`, { isActive: true });
    assert.equal(restart.status, 409, 'a stopped prescription was switched back on');
  });

  test('practice B cannot stop or change practice A’s medicine, by any route, for a patient both see', async () => {
    const patient = await makePatient({ name: 'Two Clinics', practices: [a.practice, b.practice] });
    await prescribe(a, patient, [{ name: 'Warfarin', strength: '5mg', frequency: '0-0-1' }]);
    const [med] = await rowsOf(patient);
    const url = `/patients/${patient.user._id}/medications/${med._id}`;
    const behala = as(b.doctor.token);

    const attempts = [
      await behala.post(`${url}/stop`, { reason: 'Behala stopping it' }),
      await behala.del(url),
      await behala.patch(url, { isActive: false }),
      await behala.patch(url, { dose: '10mg' }),
    ];

    assert.deepEqual(attempts.map((r) => r.status), [404, 404, 404, 404]);
    const [after] = await rowsOf(patient);
    assert.equal(after.isActive, true);
    assert.equal(after.prescriptionState, 'active');
    assert.equal(after.dose ?? null, med.dose ?? null);

    // And both still read it: what a patient is on is not one practice's secret.
    // Each is told whether it may change it, so neither app offers a Stop the
    // server would refuse.
    const theirs = (await behala.get(`/patients/${patient.user._id}/medications`)).body.items.find((m) => m.name === 'Warfarin');
    assert.ok(theirs, 'Behala could not see what the patient takes');
    assert.equal(theirs.changeableByYou, false);
    const ours = (await as(a.doctor.token).get(`/patients/${patient.user._id}/medications`)).body.items.find((m) => m.name === 'Warfarin');
    assert.equal(ours.changeableByYou, true);
  });
});

describe('a course completes', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  async function finishedCourse(patient) {
    await prescribe(a, patient, [{ name: 'Amoxicillin', strength: '500mg', frequency: '1-1-1', durationDays: 7 }]);
    const [med] = await rowsOf(patient);
    await Medication.updateOne(
      { _id: med._id },
      { startDate: daysAgo(10), endDate: daysAgo(3), schedule: [{ time: '00:01', relationToMeal: 'any' }] },
    );
    return Medication.findById(med._id).lean();
  }

  test('a finished course leaves the list, stops its reminders, and stays in the history', async () => {
    const patient = await makePatient({ name: 'Course Done', practices: [a.practice] });
    const med = await finishedCourse(patient);

    const active = await as(patient.token).get('/patients/me/medications');
    assert.ok(!active.body.items.some((m) => m.name === 'Amoxicillin'), 'a finished course stayed on the list');

    const all = await as(patient.token).get('/patients/me/medications?view=all');
    const done = all.body.items.find((m) => m.name === 'Amoxicillin');
    assert.equal(done.prescriptionState, 'completed');
    assert.equal(new Date(done.completedAt).getTime(), new Date(med.endDate).getTime());

    const today = await as(patient.token).get('/patients/me/medications/schedule/today');
    assert.ok(!today.body.slots.some((s) => s.name === 'Amoxicillin'), 'a dose was due after the course ended');

    const stored = await Medication.findById(med._id).lean();
    assert.equal(doseExpected(stored, new Date()), false, 'the reminder push would still fire');

    const history = await as(patient.token).get('/patients/me/medications/schedule/history?days=14');
    const doses = history.body.doses.filter((d) => d.name === 'Amoxicillin');
    assert.ok(doses.length >= 6, 'the course vanished from the history');
    assert.ok(doses.every((d) => new Date(d.scheduledFor) <= new Date(med.endDate)), 'doses after the end were listed');
  });

  test('prescribing it again is a new medicine on a new prescription, not the old one reopened', async () => {
    const patient = await makePatient({ name: 'Second Course', practices: [a.practice] });
    const old = await finishedCourse(patient);
    await as(patient.token).get('/patients/me/medications'); // completes it

    const again = await prescribe(a, patient, [{ name: 'Amoxicillin', strength: '500mg', frequency: '1-1-1', durationDays: 5 }]);
    assert.equal(again.status, 201);

    const rows = await rowsOf(patient, { name: 'Amoxicillin' });
    assert.equal(rows.length, 2, 'the completed course was reopened');
    const first = rows.find((r) => String(r._id) === String(old._id));
    assert.equal(first.prescriptionState, 'completed');
    assert.equal(String(first.prescription), String(old.prescription), 'the finished course was re-pointed');
    const second = rows.find((r) => String(r._id) !== String(old._id));
    assert.equal(second.prescriptionState, 'active');
    assert.equal(String(second.prescription), String(again.body.prescription.id));
  });
});

describe('what counts as the same medicine', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('metformin 1000 beside metformin 500 is a second medicine, and each says the other is there', async () => {
    const patient = await makePatient({ name: 'Two Strengths', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    await prescribe(a, patient, [{ name: 'Metformin', strength: '1000mg', frequency: '0-0-1' }]);

    const rows = await rowsOf(patient, { isActive: true });
    assert.deepEqual(rows.map((r) => r.strength).sort(), ['1000mg', '500mg'], 'one strength replaced the other');

    const list = await as(a.doctor.token).get(`/patients/${patient.user._id}/medications`);
    for (const item of list.body.items) {
      assert.equal(item.alsoOnList.length, 1, `${item.strength} did not say the other strength stands`);
      assert.equal(item.alsoOnList[0].samePractice, true);
    }
  });

  test('the same medicine prescribed again continues its row, and keeps the trail', async () => {
    const patient = await makePatient({ name: 'Renewed Monthly', practices: [a.practice] });
    const first = await prescribe(a, patient, [metformin500]);
    const [before] = await rowsOf(patient);

    const second = await prescribe(a, patient, [{ name: 'metformin', strength: '500MG', frequency: '1-0-1' }]);

    const rows = await rowsOf(patient);
    assert.equal(rows.length, 1, 'a renewal made a second metformin 500');
    const [after] = rows;
    assert.equal(String(after.prescription), String(second.body.prescription.id));
    assert.deepEqual(
      after.prescriptionHistory.map((h) => String(h.prescription)),
      [String(first.body.prescription.id)],
      'the earlier prescription was forgotten',
    );
    assert.deepEqual(after.startDate, before.startDate, 'the renewal moved the start, and the history before it with it');
    assert.equal(after.endDate, null, 'the old course end survived a renewal with none');
  });

  test('another practice’s prescription never overwrites this practice’s', async () => {
    const patient = await makePatient({ name: 'Shared Patient', practices: [a.practice, b.practice] });
    await prescribe(a, patient, [metformin500]);
    const [salt] = await rowsOf(patient);

    await prescribe(b, patient, [metformin500]);

    const rows = await rowsOf(patient, { isActive: true });
    assert.equal(rows.length, 2, 'Behala’s prescription overwrote Salt Lake’s');
    const kept = rows.find((r) => String(r._id) === String(salt._id));
    assert.equal(String(kept.practice), String(a.practice._id));
    assert.equal(String(kept.prescribedBy), String(a.doctor.user._id), 'Salt Lake’s medicine was re-attributed');
    assert.equal(String(kept.prescription), String(salt.prescription));

    const list = await as(patient.token).get('/patients/me/medications');
    assert.ok(list.body.items.every((m) => m.alsoOnList.length === 1 && m.alsoOnList[0].samePractice === false));
  });

  test('a medicine the patient added is never taken over by a prescription', async () => {
    const patient = await makePatient({ name: 'Already On It', practices: [a.practice] });
    await as(patient.token).post('/patients/me/medications', {
      name: 'Metformin',
      strength: '500mg',
      schedule: [{ time: '08:00' }],
    });

    await prescribe(a, patient, [metformin500]);

    const rows = await rowsOf(patient);
    assert.equal(rows.length, 2);
    const own = rows.find((r) => r.source === 'manual');
    assert.ok(own, 'the patient’s own entry was turned into the clinic’s');
    assert.equal(own.prescribedBy ?? null, null);
  });

  test('a paper prescription the doctor filed from another prescriber is not taken over by their own', async () => {
    // Filed at this practice by this doctor — the same practice and the same
    // prescriber a new prescription carries. Only where it came from differs:
    // it is another doctor's metformin, read off paper, and it keeps saying so.
    const patient = await makePatient({ name: 'Brought A Paper', practices: [a.practice] });
    const filed = await as(a.doctor.token).post(`/patients/${patient.user._id}/medications/scan/confirm`, {
      items: [{ name: 'Metformin', strength: '500mg', schedule: [{ time: '08:00' }] }],
      prescriber: { name: 'Dr Elsewhere', clinic: 'City Hospital' },
    });
    assert.equal(filed.status, 201);

    await prescribe(a, patient, [metformin500]);

    const rows = await rowsOf(patient);
    assert.equal(rows.length, 2, 'the doctor’s prescription took over the paper one');
    const paper = rows.find((r) => r.source === 'scan');
    assert.equal(paper.externalPrescriber.name, 'Dr Elsewhere');
    assert.equal(paper.prescription ?? null, null, 'the paper prescription was re-pointed at this practice’s');
  });

  test('a photographed paper prescription never rewrites the clinic’s medicine', async () => {
    const patient = await makePatient({ name: 'Old Paper', practices: [a.practice] });
    await prescribe(a, patient, [metformin500]);
    const [clinic] = await rowsOf(patient);

    const res = await as(patient.token).post('/patients/me/medications/scan/confirm', {
      items: [{ name: 'Metformin', strength: '500mg', schedule: [{ time: '08:00' }] }],
    });
    assert.equal(res.status, 201);

    const kept = await Medication.findById(clinic._id).lean();
    assert.equal(kept.source, 'clinic', 'the scan turned the doctor’s prescription into the patient’s');
    assert.equal(String(kept.prescribedBy), String(a.doctor.user._id));
    assert.equal(await Medication.countDocuments({ patient: patient.user._id, source: 'scan' }), 1);
  });
});

describe('ending a prescription ends what it put on the list', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  test('superseded: what the new one carries over continues, and what it leaves out stops', async () => {
    const patient = await makePatient({ name: 'Dose Increased', practices: [a.practice] });
    const first = await prescribe(a, patient, [metformin500, { name: 'Amlodipine', strength: '5mg', frequency: '1-0-0' }]);
    const amlodipine = (await rowsOf(patient, { name: 'Amlodipine' }))[0];

    const second = await prescribe(
      a,
      patient,
      [{ name: 'Metformin', strength: '1000mg', frequency: '1-0-1' }, { name: 'Amlodipine', strength: '5mg', frequency: '1-0-0' }],
      { supersedes: String(first.body.prescription.id) },
    );
    assert.equal(second.status, 201);

    const m500 = (await rowsOf(patient, { name: 'Metformin', strength: '500mg' }))[0];
    assert.equal(m500.prescriptionState, 'stopped_by_doctor', 'the replaced 500 mg kept reminding');
    assert.equal(m500.isActive, false);
    assert.match(m500.stoppedByDoctor.reason, new RegExp(second.body.prescription.referenceNo));

    const aml = await Medication.findById(amlodipine._id).lean();
    assert.equal(aml.prescriptionState, 'active', 'a medicine the new prescription carried over was stopped');
    assert.equal(String(aml.prescription), String(second.body.prescription.id));

    assert.equal((await rowsOf(patient, { name: 'Metformin', strength: '1000mg', isActive: true })).length, 1);
  });

  test('voided: its medicines are cancelled — they should never have been taken', async () => {
    const patient = await makePatient({ name: 'Wrong Patient', practices: [a.practice] });
    const rx = await prescribe(a, patient, [{ name: 'Atorvastatin', strength: '10mg', frequency: '0-0-1' }]);

    const voided = await as(a.doctor.token).post(`/records/prescriptions/${rx.body.prescription.id}/end`, {
      state: 'voided',
      reason: 'Issued to the wrong patient',
    });
    assert.equal(voided.status, 200);

    const [med] = await rowsOf(patient);
    assert.equal(med.prescriptionState, 'cancelled');
    assert.equal(med.isActive, false, 'a voided prescription’s reminders kept ringing');
    assert.equal(med.cancelled.reason, 'Issued to the wrong patient');
  });
});

describe('the dose calendar', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  const clinicMedicine = (patient, fields) =>
    Medication.create({
      patient: patient.user._id,
      name: 'Folic acid',
      strength: '5mg',
      schedule: [{ time: '00:01', relationToMeal: 'any' }],
      prescribedBy: a.doctor.user._id,
      practice: a.practice._id,
      source: 'clinic',
      ...fields,
    });

  test('an every-other-day medicine is due on its days only — today, in the history, and in adherence', async () => {
    const patient = await makePatient({ name: 'Alternate Days', practices: [a.practice] });
    const med = await clinicMedicine(patient, { dayInterval: 2, startDate: clinicDay(6).toDate() });

    // Taken on every day it was due: six, four and two days ago, and today.
    for (const n of [6, 4, 2, 0]) {
      const scheduledFor = clinicDay(n).add(1, 'minute').toDate();
      const logged = await as(patient.token).post(`/patients/me/medications/${med._id}/log`, {
        scheduledFor: scheduledFor.toISOString(),
        status: 'taken',
        takenAt: scheduledFor.toISOString(),
      });
      assert.equal(logged.status, 201, `the dose ${n} days ago was refused`);
    }

    const history = await as(patient.token).get('/patients/me/medications/schedule/history?days=7');
    const doses = history.body.doses.filter((d) => d.name === 'Folic acid');
    assert.equal(doses.length, 4, 'doses were listed on the days in between');
    assert.ok(doses.every((d) => d.status === 'taken'), 'a day it was not due was listed as missed');

    const adherence = await as(patient.token).get('/patients/me/medications/adherence?days=7');
    assert.equal(adherence.body.percentage, 100, 'an alternate-day tablet taken perfectly scored less than perfect');

    const tomorrow = clinicDay(-1).format('YYYY-MM-DD');
    const next = await as(patient.token).get(`/patients/me/medications/schedule/today?date=${tomorrow}`);
    assert.ok(!next.body.slots.some((s) => s.name === 'Folic acid'), 'it was due on its day off');
  });

  test('a dose that is not one of the medicine’s doses is refused', async () => {
    const patient = await makePatient({ name: 'Wrong Time', practices: [a.practice] });
    const med = await clinicMedicine(patient, { dayInterval: 2, startDate: clinicDay(6).toDate() });
    const url = `/patients/me/medications/${med._id}/log`;

    const offTime = await as(patient.token).post(url, {
      scheduledFor: clinicDay(2).add(9, 'hour').add(37, 'minute').toDate().toISOString(),
      status: 'taken',
    });
    assert.equal(offTime.status, 400, 'a dose at a time it is never taken was recorded');

    const offDay = await as(patient.token).post(url, {
      scheduledFor: clinicDay(3).add(1, 'minute').toDate().toISOString(),
      status: 'taken',
    });
    assert.equal(offDay.status, 400, 'a dose on its day off was recorded');
    assert.equal(await MedicationLog.countDocuments({}), 0);
  });

  test('a dose taken hours after it was due is recorded as late', async () => {
    const patient = await makePatient({ name: 'Slept In', practices: [a.practice] });
    const med = await clinicMedicine(patient, { startDate: clinicDay(3).toDate() });
    const due = clinicDay(1).add(1, 'minute');

    const res = await as(patient.token).post(`/patients/me/medications/${med._id}/log`, {
      scheduledFor: due.toDate().toISOString(),
      status: 'taken',
      takenAt: due.add(5, 'hour').toDate().toISOString(),
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.log.late, true);
    assert.equal(res.body.log.status, 'taken', 'older builds would no longer read it as taken');

    const history = await as(patient.token).get('/patients/me/medications/schedule/history?days=3');
    const dose = history.body.doses.find((d) => new Date(d.scheduledFor).getTime() === due.valueOf());
    assert.equal(dose.late, true);
  });

  test('no dose is due while the patient has stopped taking it, and none is counted missed', async () => {
    const patient = await makePatient({ name: 'Paused', practices: [a.practice] });
    const med = await clinicMedicine(patient, {
      startDate: clinicDay(5).toDate(),
      isActive: false,
      takingState: 'stopped_by_patient',
      patientStops: [{ at: clinicDay(3).toDate(), reason: 'Ran out' }],
    });

    const adherence = await as(patient.token).get('/patients/me/medications/adherence?days=7');
    const mine = adherence.body.perMedication.find((m) => String(m.medicationId) === String(med._id));
    assert.equal(mine.expected, 2, 'doses after the patient stopped were counted as missed');
  });
});

describe('reminders', () => {
  test('one repeating alarm only for a medicine taken every day with no end', () => {
    assert.equal(remindsDaily({ daysOfWeek: [], dayInterval: 1, endDate: null }), true);
    assert.equal(remindsDaily({ daysOfWeek: [1], dayInterval: 1, endDate: null }), false, 'a weekly medicine rang daily');
    assert.equal(remindsDaily({ daysOfWeek: [], dayInterval: 2, endDate: null }), false, 'an alternate-day medicine rang daily');
    assert.equal(remindsDaily({ daysOfWeek: [], dayInterval: 1, endDate: new Date() }), false, 'a course rang past its end');
  });

  test('the push carries the id the phone armed, for either kind of alarm', () => {
    const daily = { _id: '66b1f2a4c9e11a0012345678', daysOfWeek: [], dayInterval: 1, endDate: null };
    const course = { ...daily, endDate: new Date() };
    assert.equal(reminderIdFor(daily, '08:00', '2026-09-16'), medReminderNotificationId(daily._id, '08:00'));
    assert.equal(reminderIdFor(course, '08:00', '2026-09-16'), medOccurrenceNotificationId(daily._id, '08:00', '2026-09-16'));
  });

  test('the ids agree with the numbers the Dart implementation is pinned to', () => {
    // The same fixtures as mobile/test/med_reminder_id_contract_test.dart.
    assert.equal(medReminderNotificationId('66b1f2a4c9e11a0012345678', '08:00'), 748075);
    assert.equal(medReminderNotificationId('66b1f2a4c9e11a0012345678', '21:30'), 701751);
    assert.equal(medReminderNotificationId('aaaaaaaaaaaaaaaaaaaaaaaa', '13:05'), 725448);
    assert.equal(medReminderNotificationId('5f9d1b', '00:00'), 758770);
    assert.equal(medOccurrenceNotificationId('66b1f2a4c9e11a0012345678', '08:00', '2026-09-16'), 987727319);
    assert.equal(medOccurrenceNotificationId('66b1f2a4c9e11a0012345678', '08:00', '2026-09-17'), 970949700);
    assert.equal(medOccurrenceNotificationId('aaaaaaaaaaaaaaaaaaaaaaaa', '21:30', '2027-01-01'), 535574948);
    assert.equal(medOccurrenceNotificationId('5f9d1b', '00:00', '2026-12-31'), 845916719);
  });

  test('the push asks the dose calendar: no reminder for a stopped, finished or paused medicine, or on a day off', () => {
    const now = new Date();
    const base = { schedule: [{ time: '08:00' }], daysOfWeek: [], dayInterval: 1, startDate: daysAgo(10) };
    assert.equal(doseExpected(base, now), true);
    assert.equal(doseExpected({ ...base, endDate: daysAgo(1) }, now), false, 'a finished course');
    assert.equal(doseExpected({ ...base, stoppedByDoctor: { at: daysAgo(1) } }, now), false, 'a doctor’s stop');
    assert.equal(doseExpected({ ...base, patientStops: [{ at: daysAgo(1), resumedAt: null }] }, now), false, 'a patient’s stop');
    const today = inClinicTz(now);
    const offDay = { ...base, daysOfWeek: [(today.day() + 1) % 7] };
    assert.equal(occursOn(offDay, today), false, 'a weekly medicine on another weekday');
  });
});
