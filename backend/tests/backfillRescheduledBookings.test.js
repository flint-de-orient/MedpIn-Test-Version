import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import {
  planRescheduledBookings,
  applyRescheduledBookings,
} from '../scripts/backfillRescheduledBookings.js';

/**
 * The replacements the old reschedule route left as `requested`.
 *
 * Written straight to the collection, exactly as that route wrote them: the
 * original cancelled, the replacement a request with a time and no preferred day.
 */

const HOUR = 60 * 60 * 1000;
let practice;
let doctor;
let patient;

async function row(fields) {
  const { insertedId } = await Appointment.collection.insertOne({
    patient: patient.user._id,
    doctor: doctor.user._id,
    practice: practice._id,
    mode: 'in_clinic',
    durationMinutes: 15,
    isPriority: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...fields,
  });
  return insertedId;
}

/** An appointment moved the old way: the original, and what replaced it. */
async function movedTo(scheduledFor, { originalStatus = 'cancelled' } = {}) {
  const original = await row({
    status: originalStatus,
    scheduledFor: new Date(scheduledFor.getTime() - 24 * HOUR),
    ...(originalStatus === 'cancelled' ? { cancellationReason: 'Rescheduled by patient' } : {}),
  });
  const replacement = await row({ status: 'requested', scheduledFor, rescheduledFrom: original });
  return { original, replacement };
}

const statusOf = async (id) => (await Appointment.findById(id).lean()).status;

describe('backfilling moved appointments left as requests', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake');
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
  });

  test('an upcoming one is confirmed; a past one, a real request and an unexplained row are left', async () => {
    const upcoming = await movedTo(new Date(Date.now() + 48 * HOUR));
    const past = await movedTo(new Date(Date.now() - 48 * HOUR));
    const orphan = await movedTo(new Date(Date.now() + 72 * HOUR), { originalStatus: 'confirmed' });
    const request = await row({ status: 'requested', preferredFor: new Date(Date.now() + 24 * HOUR) });

    const plan = await planRescheduledBookings();
    assert.deepEqual(plan.confirm.map((r) => String(r._id)), [String(upcoming.replacement)]);
    assert.deepEqual(plan.past.map((r) => String(r._id)), [String(past.replacement)]);
    assert.deepEqual(plan.unexplained.map((r) => String(r._id)), [String(orphan.replacement)]);
    assert.equal(await statusOf(upcoming.replacement), 'requested', 'the report wrote something');

    assert.deepEqual(await applyRescheduledBookings(plan), { confirmed: 1 });

    assert.equal(await statusOf(upcoming.replacement), 'confirmed');
    assert.equal(await statusOf(upcoming.original), 'cancelled', 'the history was rewritten');
    assert.equal(await statusOf(past.replacement), 'requested', 'a past visit was declared booked');
    assert.equal(await statusOf(orphan.replacement), 'requested');
    assert.equal(await statusOf(request), 'requested', 'a patient’s own request was confirmed');
  });

  test('a row the desk changed between the report and the apply is kept as the desk left it', async () => {
    const declined = await movedTo(new Date(Date.now() + 48 * HOUR));
    const plan = await planRescheduledBookings();
    assert.equal(plan.confirm.length, 1);

    await Appointment.updateOne({ _id: declined.replacement }, { status: 'cancelled' });
    assert.deepEqual(await applyRescheduledBookings(plan), { confirmed: 0 });
    assert.equal(await statusOf(declined.replacement), 'cancelled');
  });

  test('a second run changes nothing', async () => {
    await movedTo(new Date(Date.now() + 48 * HOUR));
    await applyRescheduledBookings(await planRescheduledBookings());

    const again = await planRescheduledBookings();
    assert.equal(again.confirm.length, 0);
    assert.deepEqual(await applyRescheduledBookings(again), { confirmed: 0 });
  });
});
