import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { Membership } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';
import {
  planAppointmentPractice,
  applyAppointmentPractice,
} from '../scripts/backfillAppointmentPractice.js';

/**
 * Appointments written before an appointment said whose diary it was in.
 *
 * The clinic answers it where there is one — a building belongs to exactly one
 * practice. A teleconsult has no building, so the doctor's membership answers
 * instead. A doctor who has left answers nothing, and that row is reported
 * rather than guessed: an appointment filed under the wrong practice is one
 * clinic reading another's diary.
 */

let a;
let b;

async function twoPractices() {
  const mk = async (name) => {
    const practice = await makePractice(name);
    const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
    const clinic = await Clinic.create({
      name: `${name} Clinic`,
      practice: practice._id,
      doctor: doctor.user._id,
      isActive: true,
    });
    return { practice, doctor, clinic };
  };
  a = await mk('Salt Lake');
  b = await mk('Behala');
}

/** An appointment as the old code wrote one: no practice on it. */
async function legacy(fields) {
  const row = await Appointment.create({ status: 'confirmed', ...fields });
  await Appointment.collection.updateOne({ _id: row._id }, { $unset: { practice: '' } });
  return row;
}

describe('appointments that do not say whose they are', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('a booking at a clinic belongs to that clinic’s practice', async () => {
    const patient = await makePatient({ name: 'Rahul', practices: [a.practice] });
    const row = await legacy({
      patient: patient.user._id,
      doctor: a.doctor.user._id,
      clinic: a.clinic._id,
      scheduledFor: new Date('2026-06-01T10:00:00Z'),
    });

    const plan = await planAppointmentPractice();
    assert.equal(plan.place.length, 1);
    assert.equal(await applyAppointmentPractice(plan), 1);

    const after = await Appointment.findById(row._id).lean();
    assert.equal(String(after.practice), String(a.practice._id));
  });

  test('a teleconsult belongs to the doctor’s practice', async () => {
    const patient = await makePatient({ name: 'Mira', practices: [b.practice] });
    const row = await legacy({
      patient: patient.user._id,
      doctor: b.doctor.user._id,
      mode: 'teleconsult',
      scheduledFor: new Date('2026-06-02T10:00:00Z'),
    });

    await applyAppointmentPractice(await planAppointmentPractice());

    const after = await Appointment.findById(row._id).lean();
    assert.equal(String(after.practice), String(b.practice._id));
  });

  test('a doctor who has left leaves the row unplaced, and says so', async () => {
    /*
     * Guessing here would file the appointment under whichever practice the
     * script could find, which is how one clinic ends up reading another's
     * diary. Left as it is: every route still scopes by doctor, so the row
     * keeps behaving exactly as it does today.
     */
    const gone = await makeMember(a.practice, { name: 'Dr Gone', role: ROLES.DOCTOR });
    await Membership.updateOne({ user: gone.user._id }, { $set: { endedOn: new Date() } });

    const patient = await makePatient({ name: 'Anup', practices: [a.practice] });
    const row = await legacy({
      patient: patient.user._id,
      doctor: gone.user._id,
      mode: 'teleconsult',
      scheduledFor: new Date('2026-06-03T10:00:00Z'),
    });

    const plan = await planAppointmentPractice();
    assert.equal(plan.place.length, 0);
    assert.equal(plan.unplaceable.length, 1);

    await applyAppointmentPractice(plan);
    const after = await Appointment.findById(row._id).lean();
    assert.equal(after.practice ?? null, null);
  });

  test('two open requests that land on one practice are reported, not written', async () => {
    /*
     * Exactly the state the old query produced, and exactly what the new index
     * forbids. Writing either would be choosing for the desk which of a
     * patient's two requests is the real one.
     */
    const patient = await makePatient({ name: 'Rita', practices: [a.practice] });
    const one = await legacy({
      patient: patient.user._id,
      doctor: a.doctor.user._id,
      status: 'requested',
      preferredFor: new Date('2026-06-04'),
    });
    const two = await legacy({
      patient: patient.user._id,
      doctor: a.doctor.user._id,
      status: 'requested',
      preferredFor: new Date('2026-06-06'),
    });

    const plan = await planAppointmentPractice();
    assert.equal(plan.contested.length, 1);
    assert.equal(plan.place.length, 0);

    await applyAppointmentPractice(plan);
    for (const row of [one, two]) {
      const after = await Appointment.findById(row._id).lean();
      assert.equal(after.practice ?? null, null, 'a contested request was placed anyway');
    }
  });

  test('a request and a rescheduled booking are not a collision', async () => {
    // Both are 'requested'. Only the one asking for a day is unique — the
    // other carries a time the patient already holds.
    const patient = await makePatient({ name: 'Sujoy', practices: [a.practice] });
    await legacy({
      patient: patient.user._id,
      doctor: a.doctor.user._id,
      status: 'requested',
      preferredFor: new Date('2026-06-04'),
    });
    await legacy({
      patient: patient.user._id,
      doctor: a.doctor.user._id,
      clinic: a.clinic._id,
      status: 'requested',
      scheduledFor: new Date('2026-06-09T10:00:00Z'),
    });

    const plan = await planAppointmentPractice();
    assert.equal(plan.contested.length, 0);
    assert.equal(plan.place.length, 2);
  });

  test('running it twice changes nothing the second time', async () => {
    const patient = await makePatient({ name: 'Dev', practices: [a.practice] });
    await legacy({
      patient: patient.user._id,
      doctor: a.doctor.user._id,
      clinic: a.clinic._id,
      scheduledFor: new Date('2026-06-05T10:00:00Z'),
    });

    await applyAppointmentPractice(await planAppointmentPractice());

    const second = await planAppointmentPractice();
    assert.equal(second.place.length, 0);
    assert.equal(await applyAppointmentPractice(second), 0);
  });
});
