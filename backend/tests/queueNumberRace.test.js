import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * The token a patient is handed at the counter.
 *
 * ---- What went wrong ----------------------------------------------------
 *
 * The next number was "read today's highest in this queue, add one, save".
 * Two receptionists checking two people in at the same moment both read seven
 * and both handed out eight — two patients in one waiting room holding the same
 * token, and nothing anywhere to say so. No unique index sat behind it, so not
 * even a refusal.
 *
 * And a patient checking themselves in to a teleconsult had their queue worked
 * out from *their own* practice membership, which a patient does not have: the
 * scope came back empty, so every such patient was number one.
 */

let practice;
let doctor;
let desk;
let clinic;

const now = () => new Date(Date.now() + 60 * 60 * 1000);

async function confirmedAt(where, patientName, extra = {}) {
  const patient = await makePatient({ name: patientName, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  const appt = await Appointment.create({
    patient: patient.user._id,
    doctor: doctor.user._id,
    practice: practice._id,
    ...(where ? { clinic: where._id, mode: 'in_clinic' } : { mode: 'teleconsult' }),
    scheduledFor: now(),
    status: 'confirmed',
    ...extra,
  });
  return { patient, appt };
}

describe('checking people in at the same moment', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    clinic = await Clinic.create({
      name: 'Salt Lake Clinic',
      practice: practice._id,
      doctor: doctor.user._id,
      isActive: true,
    });
  });

  test('six people checked in at once hold six different tokens', async () => {
    const appts = [];
    for (let i = 0; i < 6; i += 1) appts.push((await confirmedAt(clinic, `Patient ${i}`)).appt);

    const answers = await Promise.all(
      appts.map((a) => as(desk.token).post(`/appointments/${a._id}/check-in`, {})),
    );

    assert.deepEqual(answers.map((r) => r.status), Array(6).fill(200));
    const tokens = answers.map((r) => r.body.queueNumber);
    assert.equal(new Set(tokens).size, 6, `two patients were handed the same token: ${tokens.join(', ')}`);
  });

  test('the same person tapped in twice keeps one token', async () => {
    /*
     * The desk taps, nothing visibly happens on a slow connection, the desk taps
     * again. Both requests must end with the appointment holding one number,
     * and both must be told that number.
     */
    const { appt } = await confirmedAt(clinic, 'Double Tap');

    const [one, two] = await Promise.all([
      as(desk.token).post(`/appointments/${appt._id}/check-in`, {}),
      as(desk.token).post(`/appointments/${appt._id}/check-in`, {}),
    ]);

    assert.equal(one.status, 200);
    assert.equal(two.status, 200);
    assert.equal(one.body.queueNumber, two.body.queueNumber, 'the two taps were told different tokens');

    const stored = await Appointment.findById(appt._id).lean();
    assert.equal(stored.queueNumber, one.body.queueNumber);
  });

  test('numbering carries on from people already checked in today', async () => {
    // Deployed mid-morning, the counter must follow the tokens already handed
    // out rather than starting a second number one in the same room.
    const { appt: earlier } = await confirmedAt(clinic, 'Earlier');
    const today = new Date().toLocaleDateString('en-CA');
    await Appointment.updateOne(
      { _id: earlier._id },
      { $set: { status: 'checked_in', queueDate: today, queueNumber: 7 } },
    );

    const { appt } = await confirmedAt(clinic, 'Next');
    const res = await as(desk.token).post(`/appointments/${appt._id}/check-in`, {});
    assert.equal(res.status, 200);
    assert.equal(res.body.queueNumber, 8);
  });

  test('a patient checking in to their own teleconsult joins their practice’s queue', async () => {
    const { appt: first } = await confirmedAt(null, 'Remote One');
    await as(desk.token).post(`/appointments/${first._id}/check-in`, {});

    const { patient, appt } = await confirmedAt(null, 'Remote Two');
    const res = await as(patient.token).post(`/appointments/${appt._id}/check-in`, {});

    assert.equal(res.status, 200);
    assert.equal(
      res.body.queueNumber,
      2,
      'a patient’s own check-in was numbered as if nobody else were waiting',
    );
  });
});
