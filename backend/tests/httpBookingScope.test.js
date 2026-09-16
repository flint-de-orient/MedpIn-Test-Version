import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Clinic } from '../src/models/Clinic.js';
import { Appointment } from '../src/models/Appointment.js';
import { AppointmentWaitlist } from '../src/models/AppointmentWaitlist.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';
import { inClinicTz, clinicDateTime } from '../src/utils/clinicTime.js';

/**
 * Booking reached across practices, from both sides of the counter.
 *
 * ---- The patient side ----------------------------------------------------
 *
 * `practiceClinics` answers from the caller's membership, and a patient has
 * none. So the clinic list a patient picks from was every active location on
 * the platform — `tenantLeaks.test.js` checks that the list *calls*
 * `practiceClinics`, which it does, and cannot see that the call returns `{}`
 * for a patient. Booking took any `clinicId` the list offered, and the
 * appointment landed in that other practice's diary with this patient's name
 * and phone number on it.
 *
 * ---- The desk side -------------------------------------------------------
 *
 * `POST /appointments` and `POST /appointments/request` take `patientId` from
 * the body for a clinician and never asked whose patient it was, and a named
 * `doctorId` could be any doctor anywhere. A receptionist could book another
 * practice's patient into their own diary and read the name and number back
 * from the response — and a request posts a line into that patient's care
 * thread. Confirming a request took any practice's `clinicId`.
 *
 * ---- What stays permissive -----------------------------------------------
 *
 * A patient enrolled nowhere is one no practice has taken on yet, and the
 * house rule is that absence permits: they still see locations and can book.
 * Once a patient has an enrolment, the locations are their practices'.
 */

const ABSENT = '000000000000000000000000';

/* No outbound calls — see httpCrossTenantAudit.test.js. */
const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

let a;
let b;

/** Open every day, so "tomorrow at ten" is always a real slot. */
const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '17:00' }));

const tomorrow = () => inClinicTz(new Date()).add(1, 'day').format('YYYY-MM-DD');
const slot = (time = '10:00') => clinicDateTime(tomorrow(), time).toDate().toISOString();

async function side(label) {
  const practice = await makePractice(label, {
    practiceType: PRACTICE_TYPE.CLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const doctor = await makeMember(practice, { name: `Dr ${label}`, isOwner: true });
  const desk = await makeMember(practice, { name: `${label} Desk`, role: ROLES.STAFF });
  const patient = await makePatient({ name: `${label} Patient`, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  const clinic = await Clinic.create({
    name: `${label} Clinic`,
    practice: practice._id,
    doctor: doctor.user._id,
    slotMinutes: 15,
    weeklyHours: EVERY_DAY,
  });
  return { label, practice, doctor, desk, patient, clinic };
}

function lifecycle() {
  before(async () => {
    globalThis.fetch = localOnly;
    await boot();
  });
  after(async () => {
    await shutdown();
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    await wipe();
    a = await side('Salt Lake');
    b = await side('Behala');
  });
}

describe('a patient books at their own practice’s locations', () => {
  lifecycle();

  test('the clinic list holds their practice’s locations and no other’s', async () => {
    const res = await as(a.patient.token).get('/clinics');
    assert.equal(res.status, 200);
    const names = res.body.items.map((c) => c.name);
    assert.ok(names.includes('Salt Lake Clinic'));
    assert.ok(!names.includes('Behala Clinic'), 'another practice’s location is in the booking list');
  });

  test('another practice’s location is not found by id, the same as one that does not exist', async () => {
    const real = await as(a.patient.token).get(`/clinics/${b.clinic._id}`);
    const absent = await as(a.patient.token).get(`/clinics/${ABSENT}`);
    assert.equal(real.status, 404);
    assert.deepEqual(real.body, absent.body);
  });

  test('nor are its slots', async () => {
    const res = await as(a.patient.token).get(`/clinics/${b.clinic._id}/slots?date=${tomorrow()}`);
    assert.equal(res.status, 404);
  });

  test('booking there is refused, the same as a location that does not exist, and nothing is written', async () => {
    const real = await as(a.patient.token).post('/appointments', {
      clinicId: String(b.clinic._id),
      scheduledFor: slot(),
    });
    const absent = await as(a.patient.token).post('/appointments', {
      clinicId: ABSENT,
      scheduledFor: slot(),
    });
    assert.equal(real.status, 400, 'a patient booked into another practice’s diary');
    assert.deepEqual(real.body, absent.body);
    assert.equal(await Appointment.countDocuments({}), 0);
  });

  test('joining another practice’s waitlist is refused', async () => {
    const res = await as(a.patient.token).post('/appointments/waitlist', {
      clinicId: String(b.clinic._id),
      date: tomorrow(),
    });
    assert.equal(res.status, 400);
    assert.equal(await AppointmentWaitlist.countDocuments({}), 0);
  });

  test('a practice the patient has not yet consented to is not offered', async () => {
    // Enrolled by that practice's desk, consent still pending: not theirs yet.
    await Enrollment.create({
      patient: a.patient.patient._id,
      practice: b.practice._id,
      status: ENROLLMENT_STATUS.PENDING,
    });
    const res = await as(a.patient.token).get('/clinics');
    assert.equal(res.status, 200);
    assert.ok(!res.body.items.map((c) => c.name).includes('Behala Clinic'));
  });

  test('a closed location is refused the same way', async () => {
    await Clinic.updateOne({ _id: a.clinic._id }, { isActive: false });
    const res = await as(a.patient.token).post('/appointments', {
      clinicId: String(a.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 400);
    assert.equal(await Appointment.countDocuments({}), 0);
  });

  test('but their own practice’s location can be booked', async () => {
    const res = await as(a.patient.token).post('/appointments', {
      clinicId: String(a.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 201);
    assert.equal(await Appointment.countDocuments({ clinic: a.clinic._id }), 1);
  });

  test('a patient enrolled nowhere sees no locations, and books nowhere', async () => {
    /*
     * This asserted the opposite, and the reasoning held while the migration
     * was running: a patient with no enrolment row had no clinic *recorded*
     * rather than no clinic, and refusing them would have left the whole
     * deployment unable to book.
     *
     * What it actually produced was every active location on the platform —
     * each one's name, address and phone number — listed to somebody no
     * practice had taken on, who could then book into any of them. A patient
     * with no enrolment belongs nowhere, and nowhere is the honest list.
     */
    const walkIn = await makePatient({ name: 'Walk-in Patient' });

    const list = await as(walkIn.token).get('/clinics');
    assert.equal(list.status, 200);
    assert.equal(
      list.body.items.length,
      0,
      'a patient nobody has taken on was shown other practices’ locations',
    );

    const booked = await as(walkIn.token).post('/appointments', {
      clinicId: String(a.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(booked.status, 400, 'an unenrolled patient booked into a practice’s diary');
  });
});

describe('the desk books its own practice’s patients, with its own doctors, at its own locations', () => {
  lifecycle();

  test('another practice’s patient cannot be booked, and their name does not come back', async () => {
    const res = await as(a.desk.token).post('/appointments', {
      patientId: String(b.patient.user._id),
      clinicId: String(a.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 404);
    assert.ok(!JSON.stringify(res.body).includes('Behala Patient'));
    assert.equal(await Appointment.countDocuments({}), 0);
  });

  test('another practice’s doctor cannot be named, the same as a doctor who does not exist', async () => {
    const booking = (doctorId) =>
      as(a.desk.token).post('/appointments', {
        patientId: String(a.patient.user._id),
        clinicId: String(a.clinic._id),
        doctorId,
        scheduledFor: slot(),
      });
    const real = await booking(String(b.doctor.user._id));
    const absent = await booking(ABSENT);
    assert.notEqual(real.status, 201, 'another practice’s doctor was booked');
    assert.equal(real.status, absent.status);
    assert.deepEqual(real.body, absent.body);
    assert.equal(await Appointment.countDocuments({}), 0);
  });

  test('another practice’s location cannot be used', async () => {
    const res = await as(a.desk.token).post('/appointments', {
      patientId: String(a.patient.user._id),
      clinicId: String(b.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 400);
    assert.equal(await Appointment.countDocuments({}), 0);
  });

  test('another practice’s location cannot be opened by id', async () => {
    const res = await as(a.desk.token).get(`/clinics/${b.clinic._id}`);
    assert.equal(res.status, 404);
  });

  test('but the desk books its own patient at its own location', async () => {
    const res = await as(a.desk.token).post('/appointments', {
      patientId: String(a.patient.user._id),
      clinicId: String(a.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 201);
  });

  test('a request cannot be raised for another practice’s patient, nor written into their thread', async () => {
    const res = await as(a.desk.token).post('/appointments/request', {
      patientId: String(b.patient.user._id),
      preferredFor: tomorrow(),
    });
    assert.equal(res.status, 404);
    assert.equal(await Appointment.countDocuments({ patient: b.patient.user._id }), 0);
    assert.equal(await ChatMessage.countDocuments({}), 0, 'a note went into another practice’s patient thread');
  });

  test('a request is confirmed only at the practice’s own location', async () => {
    const request = await Appointment.create({
      patient: a.patient.user._id,
      doctor: a.doctor.user._id,
      status: 'requested',
      preferredFor: clinicDateTime(tomorrow(), '00:00').toDate(),
    });
    const res = await as(a.desk.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(b.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 400, 'a request was confirmed into another practice’s location');
    assert.equal((await Appointment.findById(request._id).lean()).status, 'requested');
  });

  test('and at its own location it confirms', async () => {
    const request = await Appointment.create({
      patient: a.patient.user._id,
      doctor: a.doctor.user._id,
      status: 'requested',
      preferredFor: clinicDateTime(tomorrow(), '00:00').toDate(),
    });
    const res = await as(a.desk.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(a.clinic._id),
      scheduledFor: slot(),
    });
    assert.equal(res.status, 200);
    assert.equal((await Appointment.findById(request._id).lean()).status, 'confirmed');
  });
});
