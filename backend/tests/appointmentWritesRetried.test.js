import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { Clinic } from '../src/models/Clinic.js';
import { Counter } from '../src/models/Counter.js';
import { IdempotentWrite } from '../src/models/IdempotentWrite.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { signAccessToken } from '../src/services/tokens.js';
import { inClinicTz, clinicDateTime } from '../src/utils/clinicTime.js';

/**
 * An appointment write sent again because the first answer never came back.
 *
 * On a clinic's connection the write lands and the answer is lost; the app
 * shows a timeout and the desk taps again, or the phone reconnects and resends,
 * or the token expired and the app refreshed it and sent the request once more.
 * Every one of those is the same request a second time, and none of them may
 * leave a second appointment, a second queue token, or a second message to the
 * patient.
 *
 *   same Idempotency-Key, same request   → the first answer again
 *   same key, sent together              → one write, every copy told the same
 *   same key, different request          → 409 IDEMPOTENCY_KEY_REUSED, nothing written
 *   no key                               → as before — and a cancel is still once
 */

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '21:00' }));
const tomorrow = () => inClinicTz(new Date()).add(1, 'day').format('YYYY-MM-DD');
const at = (time) => clinicDateTime(tomorrow(), time).toDate().toISOString();
const KEY = (what) => `desk-5c1e9a07:${what}`;

let w;

async function setUp() {
  await Promise.all([IdempotentWrite.createIndexes(), Appointment.createIndexes()]);
  const practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  const doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  const desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
  const otherDesk = await makeMember(practice, { name: 'Evening Desk', role: ROLES.STAFF });
  const clinic = await Clinic.create({
    name: 'Salt Lake Clinic',
    practice: practice._id,
    doctor: doctor.user._id,
    slotMinutes: 30,
    weeklyHours: ALL_DAY,
  });
  const patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  // The conversation the clinic's notes land in, so "told once" can be counted.
  await ChatSession.create({
    patient: patient.user._id,
    enrollment: patient.enrollments[0]._id,
    kind: 'care',
    language: 'en',
    lastMessageAt: new Date(),
  });
  return { practice, doctor, desk, otherDesk, clinic, patient };
}

const keyed = (key) => (key ? { 'Idempotency-Key': key } : {});

const book = (token, time, key, extra = {}) =>
  as(token).post(
    '/appointments',
    { patientId: String(w.patient.user._id), clinicId: String(w.clinic._id), scheduledFor: at(time), ...extra },
    keyed(key),
  );

const notes = (pattern) => ChatMessage.countDocuments({ patient: w.patient.user._id, content: { $regex: pattern } });

const booked = async (time) => {
  const res = await book(w.desk.token, time);
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.appointment;
};

const request = () =>
  Appointment.create({
    patient: w.patient.user._id,
    doctor: w.doctor.user._id,
    practice: w.practice._id,
    status: 'requested',
    preferredFor: clinicDateTime(tomorrow(), '00:00').toDate(),
  });

describe('an appointment write sent again', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await setUp();
  });

  describe('booking', () => {
    test('retried after a lost answer is the booking already made', async () => {
      const first = await book(w.desk.token, '10:00', KEY('book'));
      const again = await book(w.desk.token, '10:00', KEY('book'));

      assert.equal(first.status, 201);
      assert.equal(again.status, 201, `the retry answered ${again.status}: ${JSON.stringify(again.body)}`);
      assert.equal(again.body.appointment.id, first.body.appointment.id);
      assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 1);
    });

    test('retried with a refreshed token is still the booking already made', async () => {
      // The app's 401 path: the access token expired, the app fetched a new one
      // and sent the same request, with the same key, again.
      const first = await book(w.desk.token, '10:00', KEY('book'));
      const refreshed = signAccessToken(w.desk.user);
      const again = await book(refreshed, '10:00', KEY('book'));

      assert.equal(again.status, 201);
      assert.equal(again.body.appointment.id, first.body.appointment.id);
      assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 1);
    });

    test('sent four times at once with one key is one booking, and every copy is told it', async () => {
      const answers = await Promise.all([1, 2, 3, 4].map(() => book(w.desk.token, '11:00', KEY('book'))));

      assert.deepEqual(answers.map((r) => r.status), [201, 201, 201, 201]);
      assert.equal(new Set(answers.map((r) => r.body.appointment.id)).size, 1);
      assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 1);
    });

    test('with the same key and another time is refused, and nothing is written', async () => {
      await book(w.desk.token, '10:00', KEY('book'));
      const changed = await book(w.desk.token, '12:00', KEY('book'));

      assert.equal(changed.status, 409);
      assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 1);
    });

    test('a refused first attempt gives its key back for the corrected one', async () => {
      // Nothing was written by a refusal, so there is nothing to answer with.
      const refused = await book(w.desk.token, '23:00', KEY('book'));
      assert.equal(refused.status, 400);
      const corrected = await book(w.desk.token, '13:00', KEY('book'));
      assert.equal(corrected.status, 201, JSON.stringify(corrected.body));
    });

    test('another person’s key answers nothing of theirs', async () => {
      const mine = await book(w.desk.token, '10:00', KEY('book'));
      const theirs = await book(w.otherDesk.token, '10:00', KEY('book'));

      assert.equal(mine.status, 201);
      assert.notEqual(theirs.status, 201, 'another desk was handed this desk’s booking');
      assert.ok(!JSON.stringify(theirs.body).includes(mine.body.appointment.id));
    });

    test('a key that is not a key is refused before anything is written', async () => {
      const res = await book(w.desk.token, '10:00', 'x');
      assert.equal(res.status, 400);
      assert.equal(await Appointment.countDocuments({}), 0);
    });
  });

  test('a request retried is the request already made, acknowledged once', async () => {
    const body = { patientId: String(w.patient.user._id), preferredFor: tomorrow(), preferredTime: '17:00' };
    const answers = await Promise.all([1, 2, 3].map(() => as(w.desk.token).post('/appointments/request', body, keyed(KEY('ask')))));
    const again = await as(w.desk.token).post('/appointments/request', body, keyed(KEY('ask')));

    assert.ok([...answers, again].every((r) => [200, 201].includes(r.status)), `answered ${answers.map((r) => r.status)}`);
    assert.equal(new Set([...answers, again].map((r) => r.body.appointment.id)).size, 1);
    assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 1);
    assert.equal(await notes(/^We have your appointment request/), 1, 'the patient was acknowledged once per copy');
  });

  test('a confirmation retried is the confirmation already given, and the patient is told once', async () => {
    const r = await request();
    const url = `/appointments/${r._id}/confirm`;
    const body = { clinicId: String(w.clinic._id), scheduledFor: at('15:00') };

    const answers = await Promise.all([1, 2, 3].map(() => as(w.desk.token).patch(url, body, keyed(KEY('confirm')))));
    const late = await as(w.desk.token).patch(url, body, keyed(KEY('confirm')));

    assert.deepEqual([...answers, late].map((x) => x.status), [200, 200, 200, 200]);
    assert.ok([...answers, late].every((x) => x.body.appointment.status === 'confirmed'));
    assert.equal(await notes(/^Your appointment is confirmed/), 1);
  });

  test('a move retried is the move already made: one replacement, one note', async () => {
    const appt = await booked('10:00');
    const url = `/appointments/${appt.id}/reschedule`;
    const body = { scheduledFor: at('16:00') };

    const answers = await Promise.all([1, 2, 3].map(() => as(w.desk.token).patch(url, body, keyed(KEY('move')))));
    const late = await as(w.desk.token).patch(url, body, keyed(KEY('move')));

    assert.deepEqual([...answers, late].map((x) => x.status), [200, 200, 200, 200]);
    assert.equal(new Set([...answers, late].map((x) => x.body.appointment.id)).size, 1);
    // The original, kept and cancelled, and one replacement.
    assert.equal(await Appointment.countDocuments({ patient: w.patient.user._id }), 2);
    assert.equal(await notes(/^Your appointment has been moved/), 1);
  });

  describe('cancelling', () => {
    test('retried with a key is the cancellation already made, told once', async () => {
      const appt = await booked('10:00');
      const url = `/appointments/${appt.id}/cancel`;

      const answers = await Promise.all([1, 2, 3].map(() => as(w.desk.token).patch(url, { reason: 'Doctor away' }, keyed(KEY('cancel')))));
      assert.deepEqual(answers.map((x) => x.status), [200, 200, 200]);
      assert.equal(await notes(/has been cancelled/), 1);
    });

    test('resent by an app with no key is still called off once, and the patient told once', async () => {
      const appt = await booked('10:00');
      const url = `/appointments/${appt.id}/cancel`;

      const together = await Promise.all([1, 2, 3].map(() => as(w.desk.token).patch(url, {})));
      const later = await as(w.desk.token).patch(url, {});

      assert.deepEqual([...together, later].map((x) => x.status), [200, 200, 200, 200]);
      assert.ok([...together, later].every((x) => x.body.appointment.status === 'cancelled'));
      assert.equal(await notes(/has been cancelled/), 1, 'the patient was told their appointment was cancelled more than once');
    });

    test('the same key for another appointment is refused, not answered with the first one', async () => {
      // Same body, same route — a different appointment in the path. Answering
      // with the first cancellation would tell the desk the second was called
      // off when nothing had touched it.
      const first = await booked('10:00');
      const second = await booked('12:00');

      const one = await as(w.desk.token).patch(`/appointments/${first.id}/cancel`, {}, keyed(KEY('cancel')));
      const two = await as(w.desk.token).patch(`/appointments/${second.id}/cancel`, {}, keyed(KEY('cancel')));

      assert.equal(one.status, 200);
      assert.equal(two.status, 409);
      assert.equal(two.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
      assert.equal((await Appointment.findById(second.id).lean()).status, 'confirmed');
    });

    test('a completed visit is still not cancelled', async () => {
      const appt = await booked('10:00');
      await Appointment.updateOne({ _id: appt.id }, { status: 'completed' });
      const res = await as(w.desk.token).patch(`/appointments/${appt.id}/cancel`, {});
      assert.equal(res.status, 400);
      assert.equal((await Appointment.findById(appt.id).lean()).status, 'completed');
    });
  });

  test('a check-in retried keeps one token and draws no second one', async () => {
    const appt = await booked('10:00');
    const url = `/appointments/${appt.id}/check-in`;

    const answers = await Promise.all([1, 2, 3, 4].map(() => as(w.desk.token).post(url, {}, keyed(KEY('arrive')))));
    const late = await as(w.desk.token).post(url, {}, keyed(KEY('arrive')));

    assert.ok([...answers, late].every((x) => x.status === 200));
    assert.deepEqual([...new Set([...answers, late].map((x) => x.body.queueNumber))], [1]);
    const counter = await Counter.findOne({ _id: { $regex: `^queue:clinic:${w.clinic._id}:` } }).lean();
    assert.equal(counter.seq, 1, 'a retry drew a second token from the room’s counter');
  });
});
