import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Prescription } from '../src/models/Prescription.js';
import { Medication } from '../src/models/Medication.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { Appointment } from '../src/models/Appointment.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Clinic } from '../src/models/Clinic.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Phase C1, end to end: nobody at one practice can read or change another's.
 *
 * ---- Why one file on top of the ones that already exist ------------------
 *
 * Each C1 fix has its own suite, written against the one defect it closed. That
 * proves each door is shut. It does not prove the building is: a matrix is the
 * shape of the question "can anyone at Behala do anything to Salt Lake's
 * patient", and a defect in one cell looks exactly like a missing test in
 * another file.
 *
 * So one world, every role at Behala that could plausibly reach a patient, and
 * every C1 action against a Salt Lake patient — each expected to be refused,
 * and each followed by a check that nothing changed. A refusal that still wrote
 * is the failure that matters, and a status code alone cannot see it.
 *
 * The positive half sits beside it: Salt Lake's own doctor does every one of
 * these to their own patient. A matrix of refusals that also refuses the owner
 * proves only that everything is broken.
 */

let A;
let B;

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  const doctor = await makeMember(p, { name: `Dr ${name}`, isOwner: true });
  const desk = await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF });
  const dietician = await makeMember(p, { name: `${name} Dietician`, role: ROLES.DIETICIAN });
  const labTech = await makeMember(p, { name: `${name} Bench`, role: ROLES.LAB_TECHNICIAN });

  const clinic = await Clinic.create({
    name: `${name} Clinic`,
    practice: p._id,
    doctor: doctor.user._id,
    slotMinutes: 30,
    isActive: true,
    weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '00:00', end: '23:30' })),
  });

  const patient = await makePatient({ name: `${name} Patient`, practices: [p] });
  await PatientProfile.create({
    user: patient.user._id,
    assignedDoctor: doctor.user._id,
    assignedDietician: dietician.user._id,
  });

  const prescription = await Prescription.create({
    patient: patient.user._id,
    doctor: doctor.user._id,
    referenceNo: `E2E-${name.replace(/\s/g, '')}-000001`,
    issuedOn: new Date(),
    items: [{ name: 'Metformin', strength: '500mg', frequency: '1-0-1' }],
  });

  const medication = await Medication.create({
    patient: patient.user._id,
    name: 'Metformin',
    strength: '500mg',
    isActive: true,
    schedule: [{ time: '08:00' }],
  });

  const session = await ChatSession.create({ patient: patient.user._id, kind: 'care', language: 'en' });
  await ChatMessage.create({
    session: session._id,
    patient: patient.user._id,
    seq: 1,
    role: 'user',
    content: `${name}: my feet are numb in the mornings`,
  });

  const request = await Appointment.create({
    patient: patient.user._id,
    doctor: doctor.user._id,
    practice: p._id,
    status: 'requested',
    preferredFor: new Date(Date.now() + 24 * 60 * 60 * 1000),
  });

  return { practice: p, doctor, desk, dietician, labTech, clinic, patient, prescription, medication, request };
}

/** Tomorrow at six in the evening, on a half-hour a 30-minute clinic can book. */
function tomorrowEvening() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(18, 0, 0, 0);
  return d.toISOString();
}

/**
 * Every C1 action, aimed at Salt Lake's patient.
 *
 * Each names what it attempts, how to attempt it as a given caller, and what
 * would prove it got through even if the status code said otherwise.
 */
const ACTIONS = [
  {
    name: 'read their prescriptions',
    run: (who) => as(who.token).get(`/patients/${A.patient.user._id}/prescriptions`),
    unchanged: async () => true,
  },
  {
    name: 'read their glucose readings',
    run: (who) => as(who.token).get(`/patients/${A.patient.user._id}/glucose`),
    unchanged: async () => true,
  },
  {
    name: 'write a glucose reading into their record',
    run: (who) =>
      as(who.token).post(`/patients/${A.patient.user._id}/glucose`, {
        valueMgDl: 310,
        context: 'fasting',
        measuredAt: new Date().toISOString(),
      }),
    unchanged: async () => (await GlucoseReading.countDocuments({ patient: A.patient.user._id })) === 0,
  },
  {
    name: 'stop their medicine',
    run: (who) => as(who.token).del(`/patients/${A.patient.user._id}/medications/${A.medication._id}`),
    unchanged: async () => (await Medication.findById(A.medication._id).lean()).isActive === true,
  },
  {
    name: 'supersede their prescription from a prescription of their own',
    // Only a prescriber can even try this, and only from their own patient —
    // which is exactly how the original hole was reached.
    run: (who) =>
      as(who.token).post(`/patients/${B.patient.user._id}/prescriptions`, {
        items: [{ name: 'Metformin', strength: '1000mg', frequency: '1-0-1' }],
        supersedes: String(A.prescription._id),
      }),
    unchanged: async () =>
      (await Prescription.findById(A.prescription._id).lean()).recordState === 'current',
  },
  {
    name: 'read their care conversation',
    run: (who) => as(who.token).get(`/chat/patients/${A.patient.user._id}/thread`),
    unchanged: async () => true,
  },
  {
    name: 'answer their care conversation as the clinic',
    run: (who) =>
      as(who.token).post(`/chat/patients/${A.patient.user._id}/clinician-message`, {
        content: 'Cross-practice reply',
      }),
    unchanged: async () => (await ChatMessage.countDocuments({ content: 'Cross-practice reply' })) === 0,
  },
  {
    name: 'confirm their appointment request into a slot',
    run: (who) =>
      as(who.token).patch(`/appointments/${A.request._id}/confirm`, {
        clinicId: String(B.clinic._id),
        scheduledFor: tomorrowEvening(),
      }),
    unchanged: async () => (await Appointment.findById(A.request._id).lean()).status === 'requested',
  },
  {
    name: 'open them through the dietician panel',
    run: (who) => as(who.token).get(`/dietician/patients/${A.patient.user._id}/overview`),
    unchanged: async () => true,
  },
];

/** The roles at Behala worth trying. Each reaches patients by a different path. */
const ACTORS = ['doctor', 'desk', 'dietician', 'labTech'];

describe('C1: nobody at Behala can read or change Salt Lake’s patient', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    A = await practice('Salt Lake');
    B = await practice('Behala');
  });

  for (const actor of ACTORS) {
    for (const action of ACTIONS) {
      test(`Behala’s ${actor} cannot ${action.name}`, async () => {
        const res = await action.run(B[actor]);

        assert.ok(
          [400, 403, 404, 409].includes(res.status),
          `answered ${res.status} — Behala’s ${actor} could ${action.name}`,
        );
        assert.ok(
          await action.unchanged(),
          `refused with ${res.status}, and the change happened anyway`,
        );
        assert.ok(
          !JSON.stringify(res.body ?? '').includes('Salt Lake: my feet are numb'),
          'the refusal carried Salt Lake’s patient’s own words',
        );
      });
    }
  }

  test('and nobody at Behala sees Salt Lake’s patient in a list', async () => {
    for (const actor of ['doctor', 'desk']) {
      const res = await as(B[actor].token).get('/doctor/patients');
      assert.equal(res.status, 200);
      const names = (res.body.items ?? []).map((p) => p.name);
      assert.ok(!names.includes('Salt Lake Patient'), `Behala’s ${actor} was shown Salt Lake’s patient`);
    }

    const dietician = await as(B.dietician.token).get('/dietician/patients');
    const names = (dietician.body.items ?? dietician.body.patients ?? []).map((p) => p.name);
    assert.ok(!names.includes('Salt Lake Patient'), 'Behala’s dietician was shown Salt Lake’s patient');
  });
});

describe('C1: Salt Lake’s own doctor does every one of those things', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    A = await practice('Salt Lake');
    B = await practice('Behala');
  });

  test('reads, writes, prescribes, stops, supersedes, answers and confirms', async () => {
    const doctor = as(A.doctor.token);
    const pid = A.patient.user._id;

    assert.equal((await doctor.get(`/patients/${pid}/prescriptions`)).status, 200);
    assert.equal((await doctor.get(`/patients/${pid}/glucose`)).status, 200);

    const wrote = await doctor.post(`/patients/${pid}/glucose`, {
      valueMgDl: 180,
      context: 'fasting',
      measuredAt: new Date().toISOString(),
    });
    assert.equal(wrote.status, 201);

    const superseded = await doctor.post(`/patients/${pid}/prescriptions`, {
      items: [{ name: 'Metformin', strength: '1000mg', frequency: '1-0-1' }],
      supersedes: String(A.prescription._id),
    });
    assert.equal(superseded.status, 201);
    assert.equal((await Prescription.findById(A.prescription._id).lean()).recordState, 'superseded');

    const stopped = await doctor.del(`/patients/${pid}/medications/${A.medication._id}`);
    assert.equal(stopped.status, 204);

    assert.equal((await doctor.get(`/chat/patients/${pid}/thread`)).status, 200);
    const replied = await doctor.post(`/chat/patients/${pid}/clinician-message`, {
      content: 'Please come in on Thursday.',
    });
    assert.equal(replied.status, 201);

    const confirmed = await doctor.patch(`/appointments/${A.request._id}/confirm`, {
      clinicId: String(A.clinic._id),
      scheduledFor: tomorrowEvening(),
    });
    assert.equal(confirmed.status, 200);
  });

  test('and Salt Lake’s dietician opens the patient they were given', async () => {
    const res = await as(A.dietician.token).get(`/dietician/patients/${A.patient.user._id}/overview`);
    assert.equal(res.status, 200);
  });
});
