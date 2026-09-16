import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { generateSlots } from '../src/services/scheduling.js';

/**
 * Who is busy at ten o'clock: the doctor, or the building?
 *
 * A clash was judged per clinic. So two doctors who both sit at the Salt Lake
 * branch could not both see somebody at ten — the second booking was refused as
 * "that time slot is no longer available" though their diaries were separate —
 * while one doctor who sits at Salt Lake in the morning and Behala in the
 * evening could be booked at ten in both, with nothing to say they cannot be in
 * two places.
 *
 * A doctor is the thing that cannot be in two places. Different doctors at one
 * location work side by side; one doctor at two locations at once is a clash.
 */

let practice;
let drA;
let drB;
let desk;
let saltLake;
let behala;

/** A clinic open all week, with this doctor's name on it. */
const clinicFor = (name, doctor) =>
  Clinic.create({
    name,
    practice: practice._id,
    doctor: doctor.user._id,
    slotMinutes: 30,
    isActive: true,
    weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '00:00', end: '23:30' })),
  });

/** Tomorrow at 10:00 in the clinic's zone. */
function tenTomorrow() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(10, 0, 0, 0);
  return d;
}

async function patientNamed(name) {
  const p = await makePatient({ name, practices: [practice] });
  await PatientProfile.create({ user: p.user._id, assignedDoctor: drA.user._id });
  return p;
}

const book = (who, clinic, doctor, at) =>
  as(desk.token).post('/appointments', {
    patientId: String(who.user._id),
    clinicId: String(clinic._id),
    doctorId: String(doctor.user._id),
    scheduledFor: at.toISOString(),
  });

describe('a clash belongs to a doctor, not to a building', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    drA = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    drB = await makeMember(practice, { name: 'Dr Roy', role: ROLES.DOCTOR });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    saltLake = await clinicFor('Salt Lake Clinic', drA);
    behala = await clinicFor('Behala Clinic', drA);
  });

  test('two doctors at one location can each see somebody at ten', async () => {
    const rahul = await patientNamed('Rahul');
    const mira = await patientNamed('Mira');
    const at = tenTomorrow();

    const first = await book(rahul, saltLake, drA, at);
    const second = await book(mira, saltLake, drB, at);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201, 'a second doctor at the same building was refused their own ten o’clock');
  });

  test('one doctor cannot be booked at ten in two places', async () => {
    const rahul = await patientNamed('Rahul');
    const mira = await patientNamed('Mira');
    const at = tenTomorrow();

    const first = await book(rahul, saltLake, drA, at);
    const second = await book(mira, behala, drA, at);

    assert.equal(first.status, 201);
    assert.equal(second.status, 400, 'the same doctor was booked in two buildings at once');
    assert.equal(
      await Appointment.countDocuments({ doctor: drA.user._id, scheduledFor: at }),
      1,
    );
  });

  test('and the slot list says so before anybody tries', async () => {
    // The desk books from the list. A list that offers a time the doctor is
    // already spending in another building is the clash, one tap early.
    const rahul = await patientNamed('Rahul');
    const at = tenTomorrow();
    await book(rahul, saltLake, drA, at);

    const dateStr = at.toLocaleDateString('en-CA');
    const time = at.toTimeString().slice(0, 5);

    const atBehala = await generateSlots(behala, dateStr, { doctorId: drA.user._id });
    assert.equal(atBehala.find((s) => s.time === time)?.available, false, 'Behala offered a time Dr Sen is at Salt Lake');

    const forDrB = await generateSlots(saltLake, dateStr, { doctorId: drB.user._id });
    assert.equal(forDrB.find((s) => s.time === time)?.available, true, 'Dr Roy was shown Dr Sen’s appointment as their own');
  });

  test('an appointment that runs into the next slot holds that slot too', async () => {
    /*
     * A 45-minute consultation at ten is still going at half past. Matching
     * slots by their exact start time would offer 10:30 to the same doctor.
     */
    const rahul = await patientNamed('Rahul');
    const at = tenTomorrow();
    await Appointment.create({
      patient: rahul.user._id,
      doctor: drA.user._id,
      practice: practice._id,
      clinic: saltLake._id,
      scheduledFor: at,
      durationMinutes: 45,
      status: 'confirmed',
    });

    const halfPast = new Date(at.getTime() + 30 * 60 * 1000);
    const mira = await patientNamed('Mira');
    const res = await book(mira, behala, drA, halfPast);
    assert.equal(res.status, 400, 'a doctor still in a consultation was booked into the next one elsewhere');
  });
});
