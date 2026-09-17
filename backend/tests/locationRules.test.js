import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Availability } from '../src/models/Availability.js';
import { Clinic } from '../src/models/Clinic.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { generateSlots } from '../src/services/scheduling.js';
import { inClinicTz, clinicDateTime, clinicDayOfWeek } from '../src/utils/clinicTime.js';

/**
 * Location is optional, scheduling is doctor + location + date + time, and a
 * practice's diary is its own.
 *
 *   0 locations   the core workflow runs; nothing asks for one
 *   1 location    implicit — nobody is asked which
 *   2+            the caller says which, and is told so clearly when they do not
 *
 * A doctor may sit at several locations and is never in two at once; two doctors
 * at one location work side by side; a closed location publishes nothing and
 * takes no new work but keeps its history; opening a location never hides what
 * came before it; and a clash is judged inside a practice and says nothing about
 * anybody else's.
 */

const ALL_WEEK = (start = '09:00', end = '21:00') =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start, end }));

const dayFromNow = (plus) => inClinicTz(new Date()).add(plus, 'day').format('YYYY-MM-DD');
const at = (time, plus = 1) => clinicDateTime(dayFromNow(plus), time).toDate();
const iso = (time, plus = 1) => at(time, plus).toISOString();

/** The next clinic-local date, from tomorrow on, that falls on a weekday (0 = Sunday). */
function next(dow) {
  for (let plus = 1; plus <= 7; plus += 1) {
    if (clinicDayOfWeek(dayFromNow(plus)) === dow) return dayFromNow(plus);
  }
  throw new Error('unreachable');
}

async function practiceWith(name, { type = PRACTICE_TYPE.POLYCLINIC, plan = PLAN.PROFESSIONAL } = {}) {
  const practice = await makePractice(name, { practiceType: type, plan });
  const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
  const desk = await makeMember(practice, { name: `${name} Desk`, role: ROLES.STAFF });
  const patient = await makePatient({ name: `${name} Patient`, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  return { practice, doctor, desk, patient };
}

const locationAt = (p, name, extra = {}) =>
  Clinic.create({
    name,
    practice: p.practice._id,
    doctor: p.doctor.user._id,
    slotMinutes: 30,
    weeklyHours: ALL_WEEK(),
    ...extra,
  });

const newPatientOf = async (p, name) => {
  const patient = await makePatient({ name, practices: [p.practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: p.doctor.user._id });
  return patient;
};

const requestFor = (p, patient, plus = 2) =>
  Appointment.create({
    patient: patient.user._id,
    doctor: p.doctor.user._id,
    practice: p.practice._id,
    status: 'requested',
    preferredFor: clinicDateTime(dayFromNow(plus), '00:00').toDate(),
  });

describe('no locations: the practice still runs', () => {
  let p;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Solo', { type: PRACTICE_TYPE.CLINIC, plan: PLAN.ESSENTIAL });
  });

  test('the desk books a visit, the doctor gives a request a time, and both go through the waiting room', async () => {
    const booked = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(booked.body.appointment.clinicId, null);
    assert.equal(booked.body.appointment.status, 'confirmed');
    assert.equal(String(booked.body.appointment.doctorId), String(p.doctor.user._id));
    assert.equal(String((await Appointment.findById(booked.body.appointment.id).lean()).practice), String(p.practice._id));

    const other = await newPatientOf(p, 'Second Patient');
    const request = await as(other.token).post('/appointments/request', { preferredFor: dayFromNow(2) });
    assert.equal(request.status, 201, JSON.stringify(request.body));
    const confirmed = await as(p.doctor.token).patch(`/appointments/${request.body.appointment.id}/confirm`, {
      scheduledFor: iso('11:00', 2),
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.appointment.status, 'confirmed');
    assert.equal(confirmed.body.appointment.clinicId, null);

    const checkedIn = await as(p.desk.token).post(`/appointments/${booked.body.appointment.id}/check-in`, {});
    assert.equal(checkedIn.status, 200);
    assert.equal(checkedIn.body.queueNumber, 1);
    const done = await as(p.doctor.token).patch(`/appointments/${booked.body.appointment.id}/status`, {
      status: 'completed',
    });
    assert.equal(done.status, 200);

    assert.equal(await Clinic.countDocuments({}), 0, 'something created a location on the way');
  });

  test('the doctor’s own diary is still the rule', async () => {
    const first = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(first.status, 201);

    const other = await newPatientOf(p, 'Clashing Patient');
    const clash = await as(p.desk.token).post('/appointments', {
      patientId: String(other.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(clash.status, 400, 'the doctor was booked twice at ten');

    const request = await requestFor(p, other, 1);
    const confirmClash = await as(p.doctor.token).patch(`/appointments/${request._id}/confirm`, {
      scheduledFor: iso('10:00'),
    });
    assert.equal(confirmClash.status, 400);
    assert.equal(await Appointment.countDocuments({ status: 'confirmed' }), 1);
  });

  test('a patient is pointed to asking, not handed an hour of their choosing', async () => {
    const clinics = await as(p.patient.token).get('/clinics');
    assert.equal(clinics.status, 200);
    assert.deepEqual(clinics.body.items, []);

    const res = await as(p.patient.token).post('/appointments', { scheduledFor: iso('03:00') });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /ask for an appointment/i);
    assert.equal(await Appointment.countDocuments({}), 0);
  });
});

describe('one location: nobody is asked which', () => {
  let p;
  let only;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Salt Lake', { type: PRACTICE_TYPE.CLINIC });
    only = await locationAt(p, 'Salt Lake Clinic', { weeklyHours: ALL_WEEK('09:00', '13:00') });
  });

  test('booking and confirming without naming it use it, against its own hours', async () => {
    const desk = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(desk.status, 201, JSON.stringify(desk.body));
    assert.equal(String(desk.body.appointment.clinicId), String(only._id));

    const shut = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('15:00'),
    });
    assert.equal(shut.status, 400, 'a time the only location is closed was booked without it');

    const self = await as(p.patient.token).post('/appointments', { scheduledFor: iso('11:00', 2) });
    assert.equal(self.status, 201, JSON.stringify(self.body));
    assert.equal(String(self.body.appointment.clinicId), String(only._id));

    const other = await newPatientOf(p, 'Asked Patient');
    const request = await requestFor(p, other, 3);
    const confirmed = await as(p.desk.token).patch(`/appointments/${request._id}/confirm`, {
      scheduledFor: iso('12:00', 3),
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(String(confirmed.body.appointment.clinicId), String(only._id));
  });
});

describe('two or more locations: the caller says which', () => {
  let p;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Salt Lake');
    await locationAt(p, 'Clinic A');
    await locationAt(p, 'Clinic B');
  });

  test('a booking or confirmation that names none is refused with LOCATION_REQUIRED, and nothing is written', async () => {
    const desk = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(desk.status, 400);
    assert.equal(desk.body.error.code, 'LOCATION_REQUIRED');
    assert.match(desk.body.error.message, /more than one location/);

    const self = await as(p.patient.token).post('/appointments', { scheduledFor: iso('10:00') });
    assert.equal(self.body.error.code, 'LOCATION_REQUIRED');
    assert.equal(await Appointment.countDocuments({}), 0);

    const request = await requestFor(p, p.patient);
    const confirmed = await as(p.desk.token).patch(`/appointments/${request._id}/confirm`, {
      scheduledFor: iso('10:00', 2),
    });
    assert.equal(confirmed.body.error.code, 'LOCATION_REQUIRED');
    assert.equal((await Appointment.findById(request._id).lean()).status, 'requested');
  });

  test('a teleconsult is at no location, and is not asked for one', async () => {
    const res = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('10:00'),
      mode: 'teleconsult',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.appointment.clinicId, null);
  });
});

describe('a doctor across several locations', () => {
  let p;
  let a;
  let b;
  let c;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Group');
    // The buildings are open all week; the doctor's own diary says when they
    // are in each one.
    a = await locationAt(p, 'Clinic A');
    b = await locationAt(p, 'Clinic B');
    c = await locationAt(p, 'Clinic C');
    const diary = (location, days, start, end) =>
      Availability.create({
        doctor: p.doctor.user._id,
        location: location._id,
        slotMinutes: 30,
        weeklyHours: days.map((dayOfWeek) => ({ dayOfWeek, start, end })),
      });
    await diary(a, [1, 3], '09:00', '13:00'); // Mon/Wed 9–1
    await diary(b, [2, 4], '17:00', '21:00'); // Tue/Thu 5–9
    await diary(c, [6], '10:00', '14:00'); // Sat 10–2
  });

  const times = async (location, date, query = '') => {
    const res = await as(p.desk.token).get(`/clinics/${location._id}/slots?date=${date}${query}`);
    assert.equal(res.status, 200);
    return res.body.slots.map((s) => s.time);
  };

  test('each location publishes that doctor’s own hours there, and none on other days', async () => {
    const hours = (from, count) =>
      Array.from({ length: count }, (_, i) =>
        inClinicTz(clinicDateTime('2026-01-01', from).toDate()).add(i * 30, 'minute').format('HH:mm'),
      );
    const doctor = `&doctorId=${p.doctor.user._id}`;

    assert.deepEqual(await times(a, next(1), doctor), hours('09:00', 8));
    assert.deepEqual(await times(a, next(2), doctor), []);
    assert.deepEqual(await times(b, next(2), doctor), hours('17:00', 8));
    assert.deepEqual(await times(b, next(1), doctor), []);
    assert.deepEqual(await times(c, next(6), doctor), hours('10:00', 8));

    // Without naming the doctor the list answers for the doctor a booking there
    // goes to — the same hours, not the building's.
    assert.deepEqual(await times(a, next(1)), hours('09:00', 8));
  });

  test('and is booked at each, in its own hours only', async () => {
    const book = (location, date, time) =>
      as(p.desk.token).post('/appointments', {
        patientId: String(p.patient.user._id),
        clinicId: String(location._id),
        scheduledFor: clinicDateTime(date, time).toDate().toISOString(),
      });

    assert.equal((await book(a, next(1), '10:00')).status, 201);
    assert.equal((await book(b, next(2), '18:00')).status, 201);
    assert.equal((await book(c, next(6), '11:00')).status, 201);
    assert.equal((await book(b, next(1), '18:00')).status, 400, 'booked at B on a day the doctor is at A');
  });

  test('but is never in two of them at once', async () => {
    // A one-off: the doctor covers B on Monday morning as well as A.
    const monday = next(1);
    await Availability.updateOne(
      { doctor: p.doctor.user._id, location: b._id },
      { $push: { overrides: { date: monday, isClosed: false, windows: [{ start: '09:00', end: '13:00' }] } } },
    );

    const book = (location) =>
      as(p.desk.token).post('/appointments', {
        patientId: String(p.patient.user._id),
        clinicId: String(location._id),
        scheduledFor: clinicDateTime(monday, '10:00').toDate().toISOString(),
      });
    assert.equal((await book(a)).status, 201);
    assert.equal((await book(b)).status, 400, 'one doctor was booked at ten in two buildings');

    const atB = await as(p.desk.token).get(`/clinics/${b._id}/slots?date=${monday}`);
    const byTime = Object.fromEntries(atB.body.slots.map((s) => [s.time, s.available]));
    assert.equal(byTime['10:00'], false);
    assert.equal(byTime['11:00'], true);
  });
});

describe('two doctors at one location', () => {
  let p;
  let roy;
  let clinic;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Salt Lake', { type: PRACTICE_TYPE.CLINIC });
    roy = await makeMember(p.practice, { name: 'Dr Roy' });
    clinic = await locationAt(p, 'Salt Lake Clinic');
  });

  test('work side by side — in the diary and in the list a patient books from', async () => {
    const other = await newPatientOf(p, 'Roy Patient');
    const royAtTen = await as(p.desk.token).post('/appointments', {
      patientId: String(other.user._id),
      clinicId: String(clinic._id),
      doctorId: String(roy.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(royAtTen.status, 201);

    // The patient's list is the location's own doctor's diary, which Dr Roy's
    // ten o'clock is not in.
    const listed = await as(p.patient.token).get(`/clinics/${clinic._id}/slots?date=${dayFromNow(1)}`);
    const ten = listed.body.slots.find((s) => s.time === '10:00');
    assert.equal(ten.available, true, 'another doctor’s appointment hid this doctor’s slot');

    const royList = await as(p.desk.token).get(
      `/clinics/${clinic._id}/slots?date=${dayFromNow(1)}&doctorId=${roy.user._id}`,
    );
    assert.equal(royList.body.slots.find((s) => s.time === '10:00').available, false);

    const booked = await as(p.patient.token).post('/appointments', {
      clinicId: String(clinic._id),
      scheduledFor: ten.iso,
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(await Appointment.countDocuments({ clinic: clinic._id, scheduledFor: at('10:00') }), 2);
  });
});

describe('closing a location', () => {
  let p;
  let a;
  let b;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Salt Lake');
    a = await locationAt(p, 'Clinic A');
    b = await locationAt(p, 'Clinic B');
  });

  test('keeps everything it holds, and takes no new work', async () => {
    const past = await Appointment.create({
      patient: p.patient.user._id,
      doctor: p.doctor.user._id,
      practice: p.practice._id,
      clinic: a._id,
      scheduledFor: at('10:00', -3),
      status: 'completed',
    });
    const upcoming = await Appointment.create({
      patient: p.patient.user._id,
      doctor: p.doctor.user._id,
      practice: p.practice._id,
      clinic: a._id,
      scheduledFor: at('10:00'),
      status: 'confirmed',
    });

    const closed = await as(p.doctor.token).del(`/clinics/${a._id}`);
    assert.equal(closed.status, 200);
    assert.equal(closed.body.clinic.isActive, false);
    assert.equal(closed.body.upcomingAppointments, 1, 'the desk was not told who is still booked there');

    // History: nothing lost, and still named.
    for (const token of [p.desk.token, p.patient.token]) {
      const diary = await as(token).get('/appointments');
      const ids = diary.body.items.map((i) => i.id);
      assert.ok(ids.includes(String(past._id)) && ids.includes(String(upcoming._id)), 'a closed location’s history vanished');
      assert.ok(diary.body.items.every((i) => i.clinic?.name === 'Clinic A'));
    }
    assert.equal((await as(p.desk.token).get(`/clinics/${a._id}`)).status, 200);

    // No slots, to anybody.
    const deskSlots = await as(p.desk.token).get(`/clinics/${a._id}/slots?date=${dayFromNow(1)}`);
    assert.equal(deskSlots.status, 200);
    assert.deepEqual(deskSlots.body.slots, [], 'a closed location published its week to the desk');
    assert.equal(deskSlots.body.isActive, false);
    assert.equal((await as(p.patient.token).get(`/clinics/${a._id}/slots?date=${dayFromNow(1)}`)).status, 404);
    assert.deepEqual(await generateSlots(await Clinic.findById(a._id), dayFromNow(1)), []);

    // No new work there.
    const book = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      clinicId: String(a._id),
      scheduledFor: iso('12:00', 2),
    });
    assert.equal(book.status, 400);
    const request = await requestFor(p, p.patient, 3);
    const confirm = await as(p.desk.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(a._id),
      scheduledFor: iso('12:00', 3),
    });
    assert.equal(confirm.status, 400);
    const within = await as(p.desk.token).patch(`/appointments/${upcoming._id}/reschedule`, {
      scheduledFor: iso('11:00'),
    });
    assert.equal(within.status, 400);
    const checkIn = await as(p.desk.token).post(`/appointments/${upcoming._id}/check-in`, {});
    assert.equal(checkIn.status, 400);
    assert.equal((await Appointment.findById(upcoming._id).lean()).status, 'confirmed');

    // The way out is another location.
    const moved = await as(p.desk.token).patch(`/appointments/${upcoming._id}/reschedule`, {
      scheduledFor: iso('11:00'),
      clinicId: String(b._id),
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    // And reopening it publishes its hours again.
    assert.equal((await as(p.doctor.token).patch(`/clinics/${a._id}`, { isActive: true })).status, 200);
    const reopened = await as(p.desk.token).get(`/clinics/${a._id}/slots?date=${dayFromNow(1)}`);
    assert.ok(reopened.body.slots.length > 0);
  });
});

describe('opening a location', () => {
  let p;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    p = await practiceWith('Solo', { type: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  });

  test('never hides what came before it', async () => {
    const before = await as(p.desk.token).post('/appointments', {
      patientId: String(p.patient.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(before.status, 201);
    const id = before.body.appointment.id;

    const opened = await as(p.doctor.token).post('/clinics', { name: 'New Clinic', weeklyHours: ALL_WEEK() });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));

    for (const token of [p.desk.token, p.doctor.token, p.patient.token]) {
      const diary = await as(token).get('/appointments');
      assert.ok(diary.body.items.some((i) => i.id === id), 'an appointment from before the location vanished');
    }

    // A desk narrowed to the new location still has the practice's older work.
    await Membership.updateOne({ _id: p.desk.membership._id }, { locations: [opened.body.clinic.id] });
    const narrowed = await as(p.desk.token).get('/appointments');
    assert.ok(narrowed.body.items.some((i) => i.id === id));

    // And it can still be moved and completed where it is.
    const moved = await as(p.doctor.token).patch(`/appointments/${id}/reschedule`, { scheduledFor: iso('12:00') });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.appointment.clinicId, null);
    const done = await as(p.doctor.token).patch(`/appointments/${moved.body.appointment.id}/status`, {
      status: 'completed',
    });
    assert.equal(done.status, 200);
  });
});

describe('a clash is judged inside a practice, and says nothing about another', () => {
  let sl;
  let be;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    sl = await practiceWith('Salt Lake');
    be = await practiceWith('Behala');
    sl.clinic = await locationAt(sl, 'Salt Lake Clinic');
    be.clinic = await locationAt(be, 'Behala Clinic');
  });

  test('another practice’s appointment at the same hour blocks nothing', async () => {
    const theirs = await as(sl.desk.token).post('/appointments', {
      patientId: String(sl.patient.user._id),
      clinicId: String(sl.clinic._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(theirs.status, 201);

    const slots = await as(be.desk.token).get(`/clinics/${be.clinic._id}/slots?date=${dayFromNow(1)}`);
    assert.equal(slots.body.slots.find((s) => s.time === '10:00').available, true);
    const ours = await as(be.desk.token).post('/appointments', {
      patientId: String(be.patient.user._id),
      clinicId: String(be.clinic._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(ours.status, 201, 'a platform-wide clash check refused another practice’s ten o’clock');
  });

  test('a doctor who works at both is not double-booked, and the refusal names nobody', async () => {
    // One doctor, a member of both practices.
    const shared = await makeMember(sl.practice, { name: 'Dr Shared' });
    await Membership.create({
      user: shared.user._id,
      practice: be.practice._id,
      role: ROLES.DOCTOR,
      status: MEMBERSHIP_STATUS.ACTIVE,
    });

    const salt = await as(sl.desk.token).post('/appointments', {
      patientId: String(sl.patient.user._id),
      clinicId: String(sl.clinic._id),
      doctorId: String(shared.user._id),
      scheduledFor: iso('10:00'),
      reason: 'Private: foot ulcer review',
    });
    assert.equal(salt.status, 201);
    const secret = [
      'Salt Lake',
      'Private: foot ulcer review',
      String(salt.body.appointment.id),
      String(sl.patient.user._id),
    ];
    const tellsNothing = (res, what) => {
      const text = allText(res.body);
      for (const s of secret) assert.ok(!text.includes(s), `${what} disclosed “${s}”: ${text}`);
    };

    const booking = await as(be.desk.token).post('/appointments', {
      patientId: String(be.patient.user._id),
      clinicId: String(be.clinic._id),
      doctorId: String(shared.user._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(booking.status, 400, 'the shared doctor was booked into two practices at once');
    tellsNothing(booking, 'the booking refusal');

    const request = await Appointment.create({
      patient: be.patient.user._id,
      doctor: shared.user._id,
      practice: be.practice._id,
      status: 'requested',
      preferredFor: clinicDateTime(dayFromNow(1), '00:00').toDate(),
    });
    const confirm = await as(be.desk.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(be.clinic._id),
      scheduledFor: iso('10:00'),
    });
    assert.equal(confirm.status, 400);
    tellsNothing(confirm, 'the confirmation refusal');

    const own = await Appointment.create({
      patient: be.patient.user._id,
      doctor: shared.user._id,
      practice: be.practice._id,
      clinic: be.clinic._id,
      status: 'confirmed',
      scheduledFor: at('15:00'),
    });
    const move = await as(be.desk.token).patch(`/appointments/${own._id}/reschedule`, { scheduledFor: iso('10:00') });
    assert.equal(move.status, 400);
    tellsNothing(move, 'the reschedule refusal');

    const slots = await as(be.desk.token).get(
      `/clinics/${be.clinic._id}/slots?date=${dayFromNow(1)}&doctorId=${shared.user._id}`,
    );
    assert.equal(slots.body.slots.find((s) => s.time === '10:00').available, false);
    tellsNothing(slots, 'the slot list');
  });
});
