import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { DiaryLock } from '../src/models/DiaryLock.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { ACTIVE_STATUSES } from '../src/services/scheduling.js';
import { inClinicTz, clinicDateTime } from '../src/utils/clinicTime.js';

/**
 * Requests that arrive in the same instant, sent in the same instant.
 *
 * Every rule about a doctor's diary was a check followed by a write: is the
 * hour free, then book it. Sequentially that holds. In parallel — a double tap,
 * two desks at two branches, a retry overlapping the original — each request
 * checked while nothing was written, each heard "free", and each wrote. One
 * doctor, several patients, one hour.
 *
 * These fire the requests together with Promise.all against the real server and
 * then count what the database holds, because a race is invisible to anything
 * that sends one request at a time.
 */

const ALL_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '21:00' }));
const tomorrow = () => inClinicTz(new Date()).add(1, 'day').format('YYYY-MM-DD');
const at = (time) => clinicDateTime(tomorrow(), time).toDate();

let w;

async function setUp() {
  const practice = await makePractice('Salt Lake Group', {
    practiceType: PRACTICE_TYPE.POLYCLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  const deskA = await makeMember(practice, { name: 'Clinic A Desk', role: ROLES.STAFF });
  const deskB = await makeMember(practice, { name: 'Clinic B Desk', role: ROLES.STAFF });
  const clinic = (name) =>
    Clinic.create({ name, practice: practice._id, doctor: doctor.user._id, slotMinutes: 30, weeklyHours: ALL_DAY });
  return { practice, doctor, deskA, deskB, clinicA: await clinic('Clinic A'), clinicB: await clinic('Clinic B') };
}

async function patients(n) {
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const p = await makePatient({ name: `Patient ${i}`, practices: [w.practice] });
    await PatientProfile.create({ user: p.user._id, assignedDoctor: w.doctor.user._id });
    out.push(p);
  }
  return out;
}

const book = (desk, patient, clinic, time, extra = {}) =>
  as(desk.token).post('/appointments', {
    patientId: String(patient.user._id),
    clinicId: clinic ? String(clinic._id) : undefined,
    doctorId: String(w.doctor.user._id),
    scheduledFor: at(time).toISOString(),
    ...extra,
  });

const statuses = (answers) => answers.map((r) => r.status).sort();

/** How many live appointments the doctor holds starting at `time`. */
const heldAt = (time) =>
  Appointment.countDocuments({
    doctor: w.doctor.user._id,
    status: { $in: ACTIVE_STATUSES },
    scheduledFor: at(time),
  });

describe('one doctor’s diary, written to in the same instant', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await setUp();
  });

  test('desks at two locations book one doctor into the same hour at once: one booking', async () => {
    const people = await patients(6);

    const answers = await Promise.all(
      people.map((p, i) =>
        i % 2 === 0 ? book(w.deskA, p, w.clinicA, '10:00') : book(w.deskB, p, w.clinicB, '10:00'),
      ),
    );

    assert.deepEqual(statuses(answers), [201, 400, 400, 400, 400, 400], `answered ${statuses(answers)}`);
    assert.equal(await heldAt('10:00'), 1, 'one doctor was booked into one hour more than once');
  });

  test('the same booking sent four times at once, with no key: one booking', async () => {
    const [rahul] = await patients(1);

    const answers = await Promise.all([1, 2, 3, 4].map(() => book(w.deskA, rahul, w.clinicA, '11:00')));

    assert.deepEqual(statuses(answers), [201, 400, 400, 400], `answered ${statuses(answers)}`);
    assert.equal(await Appointment.countDocuments({ patient: rahul.user._id }), 1);
  });

  test('in-person visits and overlapping teleconsults for one doctor at once: one', async () => {
    const people = await patients(6);

    // Half in the building at twelve, half by video at a quarter past — every
    // one of them overlaps every other, whichever way it is reached.
    const answers = await Promise.all(
      people.map((p, i) =>
        i % 2 === 0
          ? book(i % 4 === 0 ? w.deskA : w.deskB, p, i % 4 === 0 ? w.clinicA : w.clinicB, '12:00')
          : book(w.deskB, p, null, '12:15', { mode: 'teleconsult' }),
      ),
    );

    assert.deepEqual(statuses(answers), [201, 400, 400, 400, 400, 400], `answered ${statuses(answers)}`);
    assert.equal(
      await Appointment.countDocuments({ doctor: w.doctor.user._id, status: { $in: ACTIVE_STATUSES } }),
      1,
    );
  });

  test('two requests given one doctor’s hour at once: one confirmation, and the other still a request', async () => {
    const [rahul, mira] = await patients(2);
    const request = (p) =>
      Appointment.create({
        patient: p.user._id,
        doctor: w.doctor.user._id,
        practice: w.practice._id,
        status: 'requested',
        preferredFor: clinicDateTime(tomorrow(), '00:00').toDate(),
      });
    const [r1, r2] = [await request(rahul), await request(mira)];

    const answers = await Promise.all([
      as(w.deskA.token).patch(`/appointments/${r1._id}/confirm`, {
        clinicId: String(w.clinicA._id),
        scheduledFor: at('14:00').toISOString(),
      }),
      as(w.deskB.token).patch(`/appointments/${r2._id}/confirm`, {
        clinicId: String(w.clinicB._id),
        scheduledFor: at('14:00').toISOString(),
      }),
    ]);

    assert.deepEqual(statuses(answers), [200, 400], `answered ${statuses(answers)}`);
    assert.equal(await heldAt('14:00'), 1);
    const left = [await Appointment.findById(r1._id).lean(), await Appointment.findById(r2._id).lean()];
    assert.deepEqual(left.map((r) => r.status).sort(), ['confirmed', 'requested']);
  });

  test('two appointments moved into the same free hour at once: one move, and the other left where it was', async () => {
    const [rahul, mira] = await patients(2);
    const first = await book(w.deskA, rahul, w.clinicA, '10:00');
    const second = await book(w.deskB, mira, w.clinicB, '11:00');
    assert.deepEqual([first.status, second.status], [201, 201]);

    const answers = await Promise.all([
      as(w.deskA.token).patch(`/appointments/${first.body.appointment.id}/reschedule`, {
        scheduledFor: at('16:00').toISOString(),
      }),
      as(w.deskB.token).patch(`/appointments/${second.body.appointment.id}/reschedule`, {
        scheduledFor: at('16:00').toISOString(),
      }),
    ]);

    assert.deepEqual(statuses(answers), [200, 400], `answered ${statuses(answers)}`);
    assert.equal(await heldAt('16:00'), 1, 'one doctor was moved into one hour twice');
    // Whichever lost still holds its original time.
    assert.equal((await heldAt('10:00')) + (await heldAt('11:00')), 1);
  });

  test('waiting rooms at two locations checked into at once: each room one unbroken sequence', async () => {
    const people = await patients(10);
    const appts = [];
    for (const [i, p] of people.entries()) {
      appts.push(
        await Appointment.create({
          patient: p.user._id,
          doctor: w.doctor.user._id,
          practice: w.practice._id,
          clinic: i % 2 === 0 ? w.clinicA._id : w.clinicB._id,
          scheduledFor: new Date(Date.now() + (i + 1) * 60 * 60 * 1000),
          status: 'confirmed',
        }),
      );
    }

    const answers = await Promise.all(
      appts.map((a, i) => as((i % 2 === 0 ? w.deskA : w.deskB).token).post(`/appointments/${a._id}/check-in`, {})),
    );
    assert.ok(answers.every((r) => r.status === 200), `answered ${answers.map((r) => r.status)}`);

    const tokens = (clinic) =>
      appts
        .map((a, i) => ({ clinic: String(a.clinic), token: answers[i].body.queueNumber }))
        .filter((t) => t.clinic === String(clinic._id))
        .map((t) => t.token)
        .sort((x, y) => x - y);
    assert.deepEqual(tokens(w.clinicA), [1, 2, 3, 4, 5], 'Clinic A handed out a token twice or skipped one');
    assert.deepEqual(tokens(w.clinicB), [1, 2, 3, 4, 5], 'Clinic B counted Clinic A’s patients');

    // And the rows hold what the answers said.
    const stored = await Appointment.find({ _id: { $in: appts.map((a) => a._id) } }).lean();
    assert.equal(new Set(stored.map((a) => `${a.clinic}:${a.queueNumber}`)).size, 10);
  });

  test('a hold left behind by a request that died is taken over when its lease runs out', async () => {
    const [rahul] = await patients(1);
    await DiaryLock.create({
      _id: `doctor:${w.doctor.user._id}`,
      holder: 'a-process-that-crashed',
      until: new Date(Date.now() - 1000),
    });

    const res = await book(w.deskA, rahul, w.clinicA, '17:00');
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  test('a live hold makes the next write wait for it rather than skip it', async () => {
    const [rahul] = await patients(1);
    await DiaryLock.create({
      _id: `doctor:${w.doctor.user._id}`,
      holder: 'another-request',
      until: new Date(Date.now() + 10_000),
    });

    let settled = false;
    const pending = book(w.deskA, rahul, w.clinicA, '18:00').then((r) => {
      settled = true;
      return r;
    });

    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(settled, false, 'the booking wrote while somebody else held the diary');
    assert.equal(await Appointment.countDocuments({}), 0);

    await DiaryLock.updateOne({ _id: `doctor:${w.doctor.user._id}` }, { $set: { holder: null, until: null } });
    const res = await pending;
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });
});
