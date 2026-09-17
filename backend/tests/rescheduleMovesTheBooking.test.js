import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { Clinic } from '../src/models/Clinic.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { inClinicTz, clinicDateTime } from '../src/utils/clinicTime.js';

/**
 * "Move to another time", end to end on the server.
 *
 * ---- What it did -----------------------------------------------------------
 *
 * The original was cancelled and the replacement written as `requested`. The
 * desk moved a booking and watched it leave the booked list and come back under
 * "Waiting for a time" as a request with no day on it, to be given a time all
 * over again. A patient who moved their own confirmed visit turned it back into
 * a question. Nobody was told either way, a request with no time could be
 * "moved" into one while losing the day the patient asked for, two taps moved a
 * visit twice, and a teleconsult lost the room its link pointed at.
 */

const EVERY_DAY = (start, end) =>
  [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start, end }));

/** A clinic-local date `plus` days from today, and an instant on it. */
const day = (plus = 1) => inClinicTz(new Date()).add(plus, 'day').format('YYYY-MM-DD');
const at = (time, plus = 1) => clinicDateTime(day(plus), time).toDate();

let w;

async function practiceNamed(name) {
  const practice = await makePractice(name, {
    practiceType: PRACTICE_TYPE.POLYCLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
  const desk = await makeMember(practice, { name: `${name} Desk`, role: ROLES.STAFF });
  const main = await Clinic.create({
    name: `${name} Main`,
    practice: practice._id,
    doctor: doctor.user._id,
    slotMinutes: 30,
    weeklyHours: EVERY_DAY('09:00', '21:00'),
  });
  // A second branch that only opens in the evening, so "checked against that
  // location's hours" has hours to be checked against.
  const evening = await Clinic.create({
    name: `${name} Evening`,
    practice: practice._id,
    doctor: doctor.user._id,
    slotMinutes: 20,
    weeklyHours: EVERY_DAY('17:00', '21:00'),
  });
  const patient = await makePatient({ name: `${name} Patient`, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  // The conversation a note from the practice lands in.
  await ChatSession.create({
    patient: patient.user._id,
    enrollment: patient.enrollments[0]._id,
    kind: 'care',
    language: 'en',
    lastMessageAt: new Date(),
  });
  return { practice, doctor, desk, main, evening, patient };
}

const bookAt = async (who, clinic, when) => {
  const res = await as(w.desk.token).post('/appointments', {
    patientId: String(who.user._id),
    clinicId: String(clinic._id),
    scheduledFor: when.toISOString(),
  });
  assert.equal(res.status, 201, `could not book the appointment to move: ${JSON.stringify(res.body)}`);
  return res.body.appointment;
};

const move = (token, id, body) => as(token).patch(`/appointments/${id}/reschedule`, body);

describe('moving a booking leaves a booking', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await practiceNamed('Salt Lake');
  });

  test('the desk moves it: confirmed at the new time, in the diary, and the patient is told', async () => {
    const booked = await bookAt(w.patient, w.main, at('10:00'));

    const res = await move(w.desk.token, booked.id, { scheduledFor: at('11:00').toISOString() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.appointment.status, 'confirmed', 'the moved booking became a request again');
    assert.equal(new Date(res.body.appointment.scheduledFor).getTime(), at('11:00').getTime());

    // The history: the original kept, cancelled, and pointed at.
    const original = await Appointment.findById(booked.id).lean();
    assert.equal(original.status, 'cancelled');
    assert.equal(original.cancellationReason, 'Rescheduled by the clinic');
    const replacement = await Appointment.findById(res.body.appointment.id).lean();
    assert.equal(String(replacement.rescheduledFrom), String(booked.id));
    assert.equal(String(replacement.clinic), String(w.main._id));
    assert.equal(String(replacement.practice), String(w.practice._id));

    // Where the desk looks: among the booked, not among the requests.
    const requests = await as(w.desk.token).get('/appointments?status=requested');
    assert.equal(requests.body.items.length, 0, 'the moved booking is waiting for a time again');
    const confirmed = await as(w.desk.token).get('/appointments?status=confirmed');
    assert.deepEqual(confirmed.body.items.map((a) => a.id), [res.body.appointment.id]);

    const notes = await ChatMessage.countDocuments({
      patient: w.patient.user._id,
      content: { $regex: /^Your appointment has been moved to/ },
    });
    assert.equal(notes, 1, 'the patient was not told their appointment moved');
  });

  test('the patient moves their own, and it stays confirmed without a note about their own action', async () => {
    const booked = await bookAt(w.patient, w.main, at('10:00'));

    const res = await move(w.patient.token, booked.id, { scheduledFor: at('12:30').toISOString() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.appointment.status, 'confirmed');
    assert.equal((await Appointment.findById(booked.id).lean()).cancellationReason, 'Rescheduled by patient');
    assert.equal(await ChatMessage.countDocuments({ patient: w.patient.user._id }), 0);
  });

  test('a request with no time is given one, not moved', async () => {
    const request = await Appointment.create({
      patient: w.patient.user._id,
      doctor: w.doctor.user._id,
      practice: w.practice._id,
      status: 'requested',
      preferredFor: at('00:00', 2),
      preferredTime: '18:00',
    });

    const res = await move(w.desk.token, request._id, { scheduledFor: at('11:00').toISOString() });
    assert.equal(res.status, 400);
    const kept = await Appointment.findById(request._id).lean();
    assert.equal(kept.status, 'requested');
    assert.equal(kept.preferredTime, '18:00', 'the day and hour the patient asked for were dropped');
    assert.equal(await Appointment.countDocuments({}), 1, 'a copy of the request was written');
  });

  test('a no-show stays a no-show', async () => {
    const missed = await Appointment.create({
      patient: w.patient.user._id,
      doctor: w.doctor.user._id,
      practice: w.practice._id,
      clinic: w.main._id,
      status: 'no_show',
      scheduledFor: at('10:00', -1),
    });

    const res = await move(w.desk.token, missed._id, { scheduledFor: at('11:00').toISOString() });
    assert.equal(res.status, 400);
    assert.equal((await Appointment.findById(missed._id).lean()).status, 'no_show');
    assert.equal(await Appointment.countDocuments({}), 1);
  });

  test('two taps at once move it once', async () => {
    await Appointment.createIndexes();
    const booked = await bookAt(w.patient, w.main, at('10:00'));
    const body = { scheduledFor: at('15:00').toISOString() };

    const answers = await Promise.all([
      move(w.desk.token, booked.id, body),
      move(w.desk.token, booked.id, body),
    ]);

    const statuses = answers.map((r) => r.status).sort();
    assert.equal(statuses[0], 200, `neither tap moved it: ${statuses}`);
    assert.ok([400, 409].includes(statuses[1]), `both taps moved it: ${statuses}`);
    const live = await Appointment.find({ patient: w.patient.user._id, status: 'confirmed' }).lean();
    assert.equal(live.length, 1, `one visit, ${live.length} bookings`);
  });

  test('moved to another of the practice’s locations, against that location’s own hours', async () => {
    const booked = await bookAt(w.patient, w.main, at('10:00'));

    const closedThen = await move(w.desk.token, booked.id, {
      scheduledFor: at('11:00').toISOString(),
      clinicId: String(w.evening._id),
    });
    assert.equal(closedThen.status, 400, 'moved to a time the evening branch is not open');
    assert.equal((await Appointment.findById(booked.id).lean()).status, 'confirmed');

    const res = await move(w.desk.token, booked.id, {
      scheduledFor: at('18:00').toISOString(),
      clinicId: String(w.evening._id),
    });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const replacement = await Appointment.findById(res.body.appointment.id).lean();
    assert.equal(String(replacement.clinic), String(w.evening._id));
    assert.equal(replacement.durationMinutes, 20, 'kept the old location’s slot length');
  });

  test('not into a closed location, and not to a new time within one', async () => {
    const booked = await bookAt(w.patient, w.main, at('10:00'));

    await Clinic.updateOne({ _id: w.evening._id }, { isActive: false });
    const into = await move(w.desk.token, booked.id, {
      scheduledFor: at('18:00').toISOString(),
      clinicId: String(w.evening._id),
    });
    assert.equal(into.status, 400);

    await Clinic.updateOne({ _id: w.main._id }, { isActive: false });
    const within = await move(w.desk.token, booked.id, { scheduledFor: at('11:00').toISOString() });
    assert.equal(within.status, 400);

    // The history is untouched by either refusal.
    const kept = await Appointment.findById(booked.id).lean();
    assert.equal(kept.status, 'confirmed');
    assert.equal(await Appointment.countDocuments({}), 1);
  });

  test('the doctor’s other commitments still count', async () => {
    const booked = await bookAt(w.patient, w.main, at('10:00'));
    const other = await makePatient({ name: 'Other Patient', practices: [w.practice] });
    await bookAt(other, w.evening, at('18:00'));

    // Dr Salt Lake is at the evening branch at six; the morning branch is open
    // then, and the doctor is not.
    const res = await move(w.desk.token, booked.id, { scheduledFor: at('18:00').toISOString() });
    assert.equal(res.status, 400, 'the doctor was moved into a time they are spending elsewhere');
    assert.equal((await Appointment.findById(booked.id).lean()).status, 'confirmed');
  });

  test('a teleconsult keeps its room', async () => {
    const remote = await Appointment.create({
      patient: w.patient.user._id,
      doctor: w.doctor.user._id,
      practice: w.practice._id,
      mode: 'teleconsult',
      status: 'confirmed',
      scheduledFor: at('10:00'),
      teleconsult: { roomId: 'room-kept-across-a-move' },
    });

    const res = await move(w.desk.token, remote._id, { scheduledFor: at('14:00').toISOString() });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.appointment.teleconsult?.roomId, 'room-kept-across-a-move');
    assert.equal(res.body.appointment.mode, 'teleconsult');
  });

  test('another practice cannot move it, and nothing changes', async () => {
    const booked = await bookAt(w.patient, w.main, at('10:00'));
    const behala = await practiceNamed('Behala');

    for (const who of [behala.desk, behala.doctor]) {
      const res = await move(who.token, booked.id, { scheduledFor: at('11:00').toISOString() });
      assert.equal(res.status, 404);
    }
    assert.equal((await Appointment.findById(booked.id).lean()).status, 'confirmed');
    assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 1);
  });
});
