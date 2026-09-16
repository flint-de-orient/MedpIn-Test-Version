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

/**
 * Two receptionists answering the same appointment request at the same moment.
 *
 * Confirming read the request, checked it was still a request, changed it and
 * saved it. Two desks doing that together both read "requested", both passed,
 * and both saved — the second silently replacing the first desk's time and
 * clinic. The patient was sent a confirmation for each: two times, possibly at
 * two buildings, for one appointment, with the later one quietly true.
 *
 * Exactly one of them may confirm it. The other is told somebody already has.
 */

let practice;
let doctor;
let deskOne;
let deskTwo;
let clinic;
let patient;

/** Tomorrow at the given hour. */
function tomorrowAt(hour) {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

describe('one request confirmed by two desks at once', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    deskOne = await makeMember(practice, { name: 'Morning Desk', role: ROLES.STAFF });
    deskTwo = await makeMember(practice, { name: 'Evening Desk', role: ROLES.STAFF });
    clinic = await Clinic.create({
      name: 'Salt Lake Clinic',
      practice: practice._id,
      doctor: doctor.user._id,
      slotMinutes: 30,
      isActive: true,
      weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '00:00', end: '23:30' })),
    });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });

    // The conversation the confirmation is posted into. Without one there is
    // nowhere for the note to go, and "told once" could not be counted.
    await ChatSession.create({
      patient: patient.user._id,
      enrollment: patient.enrollments[0]._id,
      kind: 'care',
      language: 'en',
      lastMessageAt: new Date(),
    });
  });

  test('is confirmed once, at one time, and the patient is told once', async () => {
    const request = await Appointment.create({
      patient: patient.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      status: 'requested',
      preferredFor: tomorrowAt(9),
    });

    const [one, two] = await Promise.all([
      as(deskOne.token).patch(`/appointments/${request._id}/confirm`, {
        clinicId: String(clinic._id),
        scheduledFor: tomorrowAt(10).toISOString(),
      }),
      as(deskTwo.token).patch(`/appointments/${request._id}/confirm`, {
        clinicId: String(clinic._id),
        scheduledFor: tomorrowAt(17).toISOString(),
      }),
    ]);

    const statuses = [one.status, two.status].sort();
    assert.deepEqual(statuses, [200, 409], `both desks confirmed it: ${one.status}, ${two.status}`);

    const winner = one.status === 200 ? one : two;
    const stored = await Appointment.findById(request._id).lean();
    assert.equal(stored.status, 'confirmed');
    assert.equal(
      new Date(stored.scheduledFor).toISOString(),
      new Date(winner.body.appointment.scheduledFor).toISOString(),
      'the stored time is not the time the winning desk was told',
    );

    const notes = await ChatMessage.countDocuments({
      patient: patient.user._id,
      content: { $regex: /^Your appointment is confirmed/ },
    });
    assert.equal(notes, 1, `the patient was told ${notes} different times for one appointment`);
  });

  test('and the desk that lost is told why, not shown a generic failure', async () => {
    const request = await Appointment.create({
      patient: patient.user._id,
      doctor: doctor.user._id,
      practice: practice._id,
      status: 'requested',
      preferredFor: tomorrowAt(9),
    });

    await as(deskOne.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(clinic._id),
      scheduledFor: tomorrowAt(10).toISOString(),
    });
    const late = await as(deskTwo.token).patch(`/appointments/${request._id}/confirm`, {
      clinicId: String(clinic._id),
      scheduledFor: tomorrowAt(17).toISOString(),
    });

    // Sequential, the existing status check answers — the same refusal the race
    // now gets, rather than a different one depending on timing.
    assert.ok([400, 409].includes(late.status));
    assert.match(late.body.error.message, /already|only a request/i);
  });
});
