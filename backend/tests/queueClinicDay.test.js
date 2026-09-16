import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { Counter } from '../src/models/Counter.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { inClinicTz, clinicDateTime, CLINIC_TZ } from '../src/utils/clinicTime.js';

/**
 * Whose "today" a waiting room is numbered by.
 *
 * `queueDate` was `dayjs().format('YYYY-MM-DD')`, the server's date. The clinic
 * runs in Kolkata and the server in UTC, so the date turned over at half past
 * five in the morning: a patient checked in after midnight was filed under the
 * previous day's queue, the room's counter started again at 05:30 with a second
 * number one, and the screen in the waiting room showed last night's patients.
 * The same-day warning on a confirmation cut its day at the server's midnight
 * too.
 *
 * Every developer machine here is in IST, which is why no test ever saw it. So
 * this suite moves the process clock to a zone whose date is not the clinic's at
 * the moment it runs — UTC−11 before four in the afternoon in Kolkata, UTC+14
 * after — and checks that nothing reads the server's date.
 */

let world;
let savedTz;

/** A server clock whose calendar date is not the clinic's, whenever this runs. */
function zoneOnAnotherDate() {
  const hour = Number(inClinicTz(new Date()).format('H'));
  // 16½ hours behind Kolkata: still yesterday there until 16:30 in Kolkata.
  // 8½ hours ahead: already tomorrow there from 15:30 in Kolkata.
  return hour < 16 ? 'Pacific/Pago_Pago' : 'Pacific/Kiritimati';
}

const clinicToday = () => inClinicTz(new Date()).format('YYYY-MM-DD');
const serverToday = () => new Date().toLocaleDateString('en-CA');
const clinicDay = (plus) => inClinicTz(new Date()).add(plus, 'day').format('YYYY-MM-DD');

async function setUp() {
  const practice = await makePractice('Salt Lake', {
    practiceType: PRACTICE_TYPE.CLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  const desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
  const clinic = await Clinic.create({
    name: 'Salt Lake Clinic',
    practice: practice._id,
    doctor: doctor.user._id,
    slotMinutes: 30,
    weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '21:00' })),
  });
  return { practice, doctor, desk, clinic };
}

async function patientWithBooking(name) {
  const patient = await makePatient({ name, practices: [world.practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: world.doctor.user._id });
  const appointment = await Appointment.create({
    patient: patient.user._id,
    doctor: world.doctor.user._id,
    practice: world.practice._id,
    clinic: world.clinic._id,
    scheduledFor: new Date(Date.now() + 60 * 60 * 1000),
    status: 'confirmed',
  });
  return { patient, appointment };
}

describe('a waiting room is numbered by the clinic’s day, not the server’s', () => {
  before(async () => {
    await boot();
    savedTz = process.env.TZ;
    process.env.TZ = zoneOnAnotherDate();
  });
  after(async () => {
    if (savedTz === undefined) delete process.env.TZ;
    else process.env.TZ = savedTz;
    await shutdown();
  });
  beforeEach(async () => {
    await wipe();
    world = await setUp();
  });

  test('the server’s clock really is on another date', () => {
    // Without this the suite could pass for the reason every other one did.
    assert.equal(CLINIC_TZ, 'Asia/Kolkata');
    assert.notEqual(serverToday(), clinicToday(), `server ${serverToday()}, clinic ${clinicToday()}`);
  });

  test('check-in files the patient under the clinic’s today, and the room shows them', async () => {
    const { patient, appointment } = await patientWithBooking('Early Patient');

    const res = await as(world.desk.token).post(`/appointments/${appointment._id}/check-in`, {});
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.queueNumber, 1);

    const stored = await Appointment.findById(appointment._id).lean();
    assert.equal(stored.queueDate, clinicToday(), 'the check-in was filed under the server’s date');
    assert.ok(
      await Counter.exists({ _id: `queue:clinic:${world.clinic._id}:${clinicToday()}` }),
      'the token was drawn from a counter named for the server’s date',
    );

    const room = await as(world.desk.token).get('/appointments/queue/today');
    assert.equal(room.status, 200);
    assert.equal(room.body.date, clinicToday());
    assert.deepEqual(room.body.entries.map((e) => e.patientName), ['Early Patient']);

    // And the patient, on their own phone, is standing in the same room.
    const mine = await as(patient.token).get('/appointments/queue/today');
    assert.equal(mine.body.date, clinicToday());
    assert.equal(mine.body.entries.length, 1);
    assert.equal(mine.body.entries[0].isYou, true);
  });

  test('numbers carry on through the clinic’s day', async () => {
    const first = await patientWithBooking('First');
    const second = await patientWithBooking('Second');

    const one = await as(world.desk.token).post(`/appointments/${first.appointment._id}/check-in`, {});
    const two = await as(world.desk.token).post(`/appointments/${second.appointment._id}/check-in`, {});
    assert.deepEqual([one.body.queueNumber, two.body.queueNumber], [1, 2]);
    assert.equal(two.body.position, 2);
  });

  test('the same-day warning reads the clinic’s calendar', async () => {
    const patient = await makePatient({ name: 'Two Visits', practices: [world.practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: world.doctor.user._id });

    // Tomorrow evening at six, clinic time — the same clinic day as a morning
    // appointment tomorrow, and on the server's other side of midnight.
    await Appointment.create({
      patient: patient.user._id,
      doctor: world.doctor.user._id,
      practice: world.practice._id,
      clinic: world.clinic._id,
      scheduledFor: clinicDateTime(clinicDay(1), '18:00').toDate(),
      status: 'confirmed',
    });
    const request = await Appointment.create({
      patient: patient.user._id,
      doctor: world.doctor.user._id,
      practice: world.practice._id,
      status: 'requested',
      preferredFor: clinicDateTime(clinicDay(1), '00:00').toDate(),
    });

    const res = await as(world.desk.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(world.clinic._id),
      scheduledFor: clinicDateTime(clinicDay(1), '10:00').toDate().toISOString(),
    });
    assert.equal(res.status, 409, `no warning for a second visit on one clinic day: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.details?.[0]?.path, 'SAME_DAY_APPOINTMENT');
  });

  test('and does not warn about the evening before', async () => {
    const patient = await makePatient({ name: 'Last Night', practices: [world.practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: world.doctor.user._id });

    // Tonight at eight, clinic time: another clinic day, which a day cut at the
    // server's midnight counted as the same one.
    await Appointment.create({
      patient: patient.user._id,
      doctor: world.doctor.user._id,
      practice: world.practice._id,
      clinic: world.clinic._id,
      scheduledFor: clinicDateTime(clinicDay(0), '20:00').toDate(),
      status: 'confirmed',
    });
    const request = await Appointment.create({
      patient: patient.user._id,
      doctor: world.doctor.user._id,
      practice: world.practice._id,
      status: 'requested',
      preferredFor: clinicDateTime(clinicDay(1), '00:00').toDate(),
    });

    const res = await as(world.desk.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(world.clinic._id),
      scheduledFor: clinicDateTime(clinicDay(1), '10:00').toDate().toISOString(),
    });
    assert.equal(res.status, 200, `warned about another day's visit: ${JSON.stringify(res.body)}`);
  });
});
