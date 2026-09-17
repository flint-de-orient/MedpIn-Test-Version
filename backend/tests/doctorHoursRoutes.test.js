import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Availability } from '../src/models/Availability.js';
import { Clinic } from '../src/models/Clinic.js';
import { Membership } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { inClinicTz, clinicDateTime, clinicDayOfWeek } from '../src/utils/clinicTime.js';

/**
 * A doctor's hours at a location, entered by the practice.
 *
 * The slot engine reads a diary per doctor per location first and falls back to
 * the location's hours — and nothing could write one, so every doctor at a
 * location had the building's hours. These routes write them: doctor ×
 * location × weekday × time windows, set by the people who set the practice
 * up, at a location they run, for one of their own practice's doctors.
 */

const ALL_WEEK = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '21:00' }));
const dayFromNow = (plus) => inClinicTz(new Date()).add(plus, 'day').format('YYYY-MM-DD');

/** The next clinic-local date, from tomorrow on, that falls on a weekday (0 = Sunday). */
function next(dow) {
  for (let plus = 1; plus <= 7; plus += 1) {
    if (clinicDayOfWeek(dayFromNow(plus)) === dow) return dayFromNow(plus);
  }
  throw new Error('unreachable');
}

const MON_WED_MORNINGS = [
  { dayOfWeek: 1, start: '09:00', end: '13:00' },
  { dayOfWeek: 3, start: '09:00', end: '13:00' },
];

let w;

async function practiceNamed(name) {
  const practice = await makePractice(name, { practiceType: PRACTICE_TYPE.POLYCLINIC, plan: PLAN.PROFESSIONAL });
  const head = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
  const roy = await makeMember(practice, { name: `Dr Roy ${name}` });
  const desk = await makeMember(practice, { name: `${name} Desk`, role: ROLES.STAFF });
  const clinic = (n) =>
    Clinic.create({ name: n, practice: practice._id, doctor: head.user._id, slotMinutes: 15, weeklyHours: ALL_WEEK });
  const patient = await makePatient({ name: `${name} Patient`, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: head.user._id });
  return { practice, head, roy, desk, patient, a: await clinic(`${name} A`), b: await clinic(`${name} B`) };
}

const hoursUrl = (clinic, doctor) => `/clinics/${clinic._id}/availability/${doctor.user._id}`;
const setHours = (who, clinic, doctor, body) => as(who.token).put(hoursUrl(clinic, doctor), body);
const times = async (who, clinic, doctor, date) => {
  const res = await as(who.token).get(`/clinics/${clinic._id}/slots?date=${date}&doctorId=${doctor.user._id}`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.slots.map((s) => s.time);
};

describe('a doctor’s hours at a location', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await practiceNamed('Salt Lake');
  });

  test('set by the desk, they are the doctor’s slots there — and the other doctor keeps the location’s', async () => {
    const saved = await setHours(w.desk, w.a, w.roy, { slotMinutes: 30, weeklyHours: MON_WED_MORNINGS });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.usesLocationHours, false);
    assert.deepEqual(saved.body.diary.weeklyHours, MON_WED_MORNINGS);

    assert.deepEqual(await times(w.desk, w.a, w.roy, next(1)), [
      '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
    ]);
    assert.deepEqual(await times(w.desk, w.a, w.roy, next(2)), [], 'the doctor was offered on a day they are not there');

    // Dr Salt Lake has no diary at A, so keeps the building's hours.
    assert.equal((await times(w.desk, w.a, w.head, next(2))).length, 48);

    const listed = await as(w.desk.token).get(`/clinics/${w.a._id}/availability`);
    assert.equal(listed.status, 200);
    const byName = Object.fromEntries(listed.body.items.map((i) => [i.doctor.name, i]));
    assert.equal(byName['Dr Roy Salt Lake'].usesLocationHours, false);
    assert.equal(byName['Dr Roy Salt Lake'].diary.slotMinutes, 30);
    assert.equal(byName['Dr Salt Lake'].usesLocationHours, true);
    assert.equal(byName['Dr Salt Lake'].diary, null);
  });

  test('bookings follow them', async () => {
    await setHours(w.desk, w.a, w.roy, { slotMinutes: 30, weeklyHours: MON_WED_MORNINGS });
    const book = (date) =>
      as(w.desk.token).post('/appointments', {
        patientId: String(w.patient.user._id),
        clinicId: String(w.a._id),
        doctorId: String(w.roy.user._id),
        scheduledFor: clinicDateTime(date, '10:00').toDate().toISOString(),
      });

    assert.equal((await book(next(2))).status, 400, 'booked on a day the doctor is not at this location');
    assert.equal((await book(next(1))).status, 201);
  });

  test('saved again they replace the old hours; given back, the location’s hours apply again', async () => {
    await setHours(w.desk, w.a, w.roy, { slotMinutes: 30, weeklyHours: MON_WED_MORNINGS });
    const evenings = [{ dayOfWeek: 2, start: '17:00', end: '19:00' }];
    const replaced = await setHours(w.desk, w.a, w.roy, { slotMinutes: 60, weeklyHours: evenings });
    assert.equal(replaced.status, 200);
    assert.deepEqual(await times(w.desk, w.a, w.roy, next(1)), []);
    assert.deepEqual(await times(w.desk, w.a, w.roy, next(2)), ['17:00', '18:00']);
    assert.equal(await Availability.countDocuments({}), 1, 'a second diary was written for one doctor at one location');

    const back = await as(w.desk.token).del(hoursUrl(w.a, w.roy));
    assert.equal(back.status, 200);
    assert.equal(back.body.usesLocationHours, true);
    assert.equal((await times(w.desk, w.a, w.roy, next(1))).length, 48);
    // Kept, switched off, not deleted.
    assert.equal((await Availability.findOne({}).lean()).isActive, false);
  });

  test('no sittings at all means the doctor is not at this location', async () => {
    const res = await setHours(w.desk, w.b, w.roy, { slotMinutes: 15, weeklyHours: [] });
    assert.equal(res.status, 200);
    for (const dow of [0, 1, 2, 3, 4, 5, 6]) {
      assert.deepEqual(await times(w.desk, w.b, w.roy, next(dow)), []);
    }
  });

  test('a sitting that ends before it starts, or a day that is not one, is refused and nothing is written', async () => {
    const backwards = await setHours(w.desk, w.a, w.roy, {
      slotMinutes: 30,
      weeklyHours: [{ dayOfWeek: 1, start: '13:00', end: '09:00' }],
    });
    const noSuchDay = await setHours(w.desk, w.a, w.roy, {
      slotMinutes: 30,
      weeklyHours: [{ dayOfWeek: 7, start: '09:00', end: '13:00' }],
    });
    assert.deepEqual([backwards.status, noSuchDay.status], [400, 400]);
    assert.equal(await Availability.countDocuments({}), 0);
  });

  test('says where else the doctor already sits at the same hours', async () => {
    await setHours(w.desk, w.b, w.roy, { slotMinutes: 30, weeklyHours: [{ dayOfWeek: 1, start: '09:00', end: '13:00' }] });
    const res = await setHours(w.desk, w.a, w.roy, {
      slotMinutes: 30,
      weeklyHours: [{ dayOfWeek: 1, start: '12:00', end: '15:00' }, { dayOfWeek: 4, start: '09:00', end: '10:00' }],
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.overlapsElsewhere, [
      { location: { id: String(w.b._id), name: 'Salt Lake B' }, dayOfWeek: 1, start: '09:00', end: '13:00' },
    ]);
  });

  test('four saves at once are one diary', async () => {
    await Availability.createIndexes();
    const body = { slotMinutes: 30, weeklyHours: MON_WED_MORNINGS };
    const answers = await Promise.all([1, 2, 3, 4].map(() => setHours(w.desk, w.a, w.roy, body)));
    assert.deepEqual(answers.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(await Availability.countDocuments({ doctor: w.roy.user._id, location: w.a._id }), 1);
  });
});

describe('who may set a doctor’s hours, and where', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await practiceNamed('Salt Lake');
  });

  const body = { slotMinutes: 30, weeklyHours: MON_WED_MORNINGS };

  test('another practice cannot read or set them, at their location or for their doctor', async () => {
    const other = await practiceNamed('Behala');

    const read = await as(other.desk.token).get(`/clinics/${w.a._id}/availability`);
    const theirLocation = await setHours(other.desk, w.a, w.roy, body);
    const theirDoctor = await setHours(w.desk, w.a, other.roy, body);
    const clearTheirs = await as(other.desk.token).del(hoursUrl(w.a, w.roy));

    assert.deepEqual([read.status, theirLocation.status, theirDoctor.status, clearTheirs.status], [404, 404, 404, 404]);
    assert.ok(!JSON.stringify(read.body).includes('Dr Roy Salt Lake'));
    assert.equal(await Availability.countDocuments({}), 0);
  });

  test('roles that do not set the practice up are refused, and so is a patient', async () => {
    const bench = await makeMember(w.practice, { name: 'Bench', role: ROLES.LAB_TECHNICIAN });
    const dietician = await makeMember(w.practice, { name: 'Diet', role: ROLES.DIETICIAN });

    for (const who of [bench, dietician, w.patient]) {
      assert.equal((await setHours(who, w.a, w.roy, body)).status, 403, 'refused');
      assert.equal((await as(who.token).del(hoursUrl(w.a, w.roy))).status, 403);
    }
    assert.equal((await as(w.patient.token).get(`/clinics/${w.a._id}/availability`)).status, 403);
    assert.equal(await Availability.countDocuments({}), 0);
  });

  test('a desk that runs only Clinic B cannot set hours at Clinic A, and can at B', async () => {
    await Membership.updateOne({ _id: w.desk.membership._id }, { locations: [w.b._id] });

    const atA = await setHours(w.desk, w.a, w.roy, body);
    assert.equal(atA.status, 403);
    assert.equal(atA.body.error.code, 'LOCATION_NOT_MANAGED');
    assert.equal((await as(w.desk.token).del(hoursUrl(w.a, w.roy))).status, 403);
    assert.equal(await Availability.countDocuments({ location: w.a._id }), 0);

    assert.equal((await setHours(w.desk, w.b, w.roy, body)).status, 200);

    // Reading every location's hours is still fine; which one they run is said.
    const listed = await as(w.desk.token).get(`/clinics/${w.a._id}/availability`);
    assert.equal(listed.status, 200);
    assert.equal(listed.body.location.managedByYou, false);
  });

  test('a doctor at the practice may set them', async () => {
    assert.equal((await setHours(w.roy, w.a, w.roy, body)).status, 200);
    assert.equal((await setHours(w.head, w.a, w.roy, { ...body, slotMinutes: 20 })).status, 200);
  });

  test('a doctor who has left the practice is not one whose hours can be set', async () => {
    await Membership.updateOne({ _id: w.roy.membership._id }, { endedOn: new Date() });
    assert.equal((await setHours(w.desk, w.a, w.roy, body)).status, 404);
    assert.equal(await Availability.countDocuments({}), 0);
    // And no longer listed among the doctors here.
    const listed = await as(w.desk.token).get(`/clinics/${w.a._id}/availability`);
    assert.ok(!listed.body.items.some((i) => i.doctor.name === 'Dr Roy Salt Lake'));
  });

  test('setting hours never changes an appointment already booked', async () => {
    const monday = next(1);
    const booked = await as(w.desk.token).post('/appointments', {
      patientId: String(w.patient.user._id),
      clinicId: String(w.a._id),
      doctorId: String(w.roy.user._id),
      scheduledFor: clinicDateTime(monday, '18:00').toDate().toISOString(),
    });
    assert.equal(booked.status, 201);

    await setHours(w.desk, w.a, w.roy, body);
    const kept = await Appointment.findById(booked.body.appointment.id).lean();
    assert.equal(kept.status, 'confirmed');
  });
});
