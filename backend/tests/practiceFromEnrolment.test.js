import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { User, ROLES } from '../src/models/User.js';

/**
 * A patient's practice is the one they are enrolled at.
 *
 * ---- The proxy that stopped being one ------------------------------------
 *
 * `practiceOfPatient` answers through the patient's assigned doctor, and
 * practiceScope.js says why: it was "the right proxy until Enrollment exists".
 * Enrollment exists. And the path that brings a patient into a second practice
 * — the desk enrolling them by phone — records the practice on the enrolment
 * and never assigns a doctor. So for exactly the patients multi-practice exists
 * for, the proxy answers null, and null meant everybody:
 *
 *   - an urgent alert pushed to every doctor and receptionist on the platform,
 *     carrying the patient's name and the start of what is wrong with them;
 *   - tomorrow's digest and visit reminders sent to every doctor on it;
 *   - the assistant introducing them to the first clinic on the platform.
 *
 * `practiceOfPatient` itself stays as it is. The tenant guards want its single,
 * conservative answer, and the allowance counts by it; changing what either
 * does is a different decision from telling the right people.
 *
 * ---- Why no app boot -----------------------------------------------------
 *
 * These are questions about who a patient belongs to and who is told, asked of
 * the services directly against a throwaway database.
 */

let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('medpin_enrolment_practice_test'));
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

/** Loaded per test, so a missing export fails the test that needs it. */
async function scope() {
  return import('../src/middleware/practiceScope.js');
}

const day = (n) => new Date(Date.UTC(2026, 0, n));

/** A patient enrolled nowhere, so every enrolment here is one the test wrote. */
async function patient(name = 'Enrolled Patient') {
  const p = await makePatient({ name });
  return p.user._id;
}

const enrol = (patientId, practice, { status = ENROLLMENT_STATUS.ACTIVE, on = day(1) } = {}) =>
  Enrollment.create({ patient: patientId, practice: practice._id, status, enrolledOn: on });

async function threePractices() {
  const salt = await makePractice('Salt Lake');
  const behala = await makePractice('Behala');
  const garia = await makePractice('Garia');
  return { salt, behala, garia };
}

describe('whose patient this is', () => {
  test('a patient the desk enrolled, with no doctor assigned, belongs to that practice', async () => {
    const { behala } = await threePractices();
    const p = await patient();
    await enrol(p, behala);

    const { practiceForPatient } = await scope();
    assert.equal(typeof practiceForPatient, 'function', 'no enrolment-aware resolver is exported');
    assert.equal(await practiceForPatient(p), String(behala._id));
  });

  test('their assigned doctor’s practice first, when they are enrolled there too', async () => {
    const { salt, behala } = await threePractices();
    const doctor = await makeMember(salt, { name: 'Dr Salt', isOwner: true });
    const p = await patient();
    await PatientProfile.create({ user: p, assignedDoctor: doctor.user._id });
    await enrol(p, behala, { on: day(1) });
    await enrol(p, salt, { on: day(9) });

    const { practiceForPatient } = await scope();
    assert.equal(typeof practiceForPatient, 'function', 'no enrolment-aware resolver is exported');
    assert.equal(await practiceForPatient(p), String(salt._id));
  });

  test('not the assigned doctor’s practice when that enrolment is not active', async () => {
    const { salt, behala } = await threePractices();
    const doctor = await makeMember(salt, { name: 'Dr Salt', isOwner: true });
    const p = await patient();
    await PatientProfile.create({ user: p, assignedDoctor: doctor.user._id });
    await enrol(p, salt, { status: ENROLLMENT_STATUS.PENDING });
    await enrol(p, behala);

    const { practiceForPatient } = await scope();
    assert.equal(typeof practiceForPatient, 'function', 'no enrolment-aware resolver is exported');
    assert.equal(await practiceForPatient(p), String(behala._id));
  });

  test('the earliest enrolment when nothing else decides', async () => {
    const { behala, garia } = await threePractices();
    const p = await patient();
    await enrol(p, garia, { on: day(20) });
    await enrol(p, behala, { on: day(3) });

    const { practiceForPatient } = await scope();
    assert.equal(typeof practiceForPatient, 'function', 'no enrolment-aware resolver is exported');
    assert.equal(await practiceForPatient(p), String(behala._id));
  });

  test('with no active enrolment, the assigned doctor, as before', async () => {
    const { salt } = await threePractices();
    const doctor = await makeMember(salt, { name: 'Dr Salt', isOwner: true });
    const p = await patient();
    await PatientProfile.create({ user: p, assignedDoctor: doctor.user._id });

    const { practiceForPatient } = await scope();
    assert.equal(typeof practiceForPatient, 'function', 'no enrolment-aware resolver is exported');
    assert.equal(await practiceForPatient(p), String(salt._id));
  });

  test('every practice actively caring for them, and no other', async () => {
    const { salt, behala, garia } = await threePractices();
    const p = await patient();
    await enrol(p, salt);
    await enrol(p, behala);
    await enrol(p, garia, { status: ENROLLMENT_STATUS.PENDING });

    const { practicesOfPatient } = await scope();
    assert.equal(typeof practicesOfPatient, 'function', 'no enrolment-aware resolver is exported');
    assert.deepEqual(
      (await practicesOfPatient(p)).map(String).sort(),
      [String(salt._id), String(behala._id)].sort(),
    );
  });
});

describe('whose phones ring', () => {
  /** A doctor and a desk at each of three practices. */
  async function staffed() {
    const { salt, behala, garia } = await threePractices();
    const people = {};
    for (const [key, practice] of Object.entries({ salt, behala, garia })) {
      people[key] = [
        await makeMember(practice, { name: `Dr ${key}`, isOwner: true }),
        await makeMember(practice, { name: `${key} desk`, role: ROLES.STAFF }),
      ].map((m) => String(m.user._id));
    }
    return { salt, behala, garia, people };
  }

  async function staffForFn() {
    const notifications = await import('../src/services/notifications.js');
    assert.equal(typeof notifications.staffFor, 'function', 'staffFor is not exported to be asked');
    return notifications.staffFor;
  }

  test('an alert about a patient the desk enrolled wakes that practice, and nobody else', async () => {
    const { behala, people } = await staffed();
    const p = await patient();
    await enrol(p, behala);

    const staffFor = await staffForFn();
    const woken = (await staffFor(p, [ROLES.DOCTOR, ROLES.STAFF])).map((u) => String(u._id)).sort();

    assert.deepEqual(woken, [...people.behala].sort(), 'another practice’s phones rang about this patient');
  });

  test('a patient cared for by two practices wakes both, and not a third', async () => {
    const { salt, behala, people } = await staffed();
    const p = await patient();
    await enrol(p, salt);
    await enrol(p, behala);

    const staffFor = await staffForFn();
    const woken = (await staffFor(p, [ROLES.DOCTOR, ROLES.STAFF])).map((u) => String(u._id)).sort();

    assert.deepEqual(woken, [...people.salt, ...people.behala].sort());
  });
});

describe('whose day an appointment is', () => {
  test('its doctor’s practice, not the patient’s', async () => {
    const { salt, behala } = await threePractices();
    const doctor = await makeMember(behala, { name: 'Dr Behala', isOwner: true });
    const p = await patient();
    await enrol(p, salt);

    const { practiceOfAppointment } = await scope();
    assert.equal(typeof practiceOfAppointment, 'function', 'no appointment resolver is exported');
    assert.equal(await practiceOfAppointment({ doctor: doctor.user._id, patient: p }), String(behala._id));
  });

  test('and the patient’s when the doctor belongs to no practice', async () => {
    const { behala } = await threePractices();
    const departed = await User.create({ name: 'Dr Gone', phone: '+918800000003', role: ROLES.DOCTOR, isActive: true });
    const p = await patient();
    await enrol(p, behala);

    const { practiceOfAppointment } = await scope();
    assert.equal(typeof practiceOfAppointment, 'function', 'no appointment resolver is exported');
    assert.equal(await practiceOfAppointment({ doctor: departed._id, patient: { _id: p } }), String(behala._id));
  });
});

describe('the callers ask the new question', () => {
  const src = (rel) => readFileSync(new URL(`../src/${rel}`, import.meta.url), 'utf8');
  const count = (text, re) => (text.match(re) ?? []).length;

  test('the assistant and the readers name the practice the conversation or patient is with', () => {
    // The assistant speaks for the practice its conversation is with — see
    // services/conversationPractice.js — which for a patient with one practice
    // is the practice they are enrolled at, and never the assigned-doctor proxy
    // where an enrolment decides.
    assert.equal(
      count(src('services/ai/assistant.js'), /clinicIdentity\(null, \{ practiceId: relationship\.practiceId \}\)/g),
      2,
      'the assistant names a clinic other than the one its conversation is with',
    );
    assert.equal(count(src('routes/care.js'), /practiceId: await practiceForPatient\(req\.patientId\)/g), 2);
    assert.match(src('routes/chat.js'), /practiceId: relationship\.practiceId/);
    assert.match(src('services/ai/labReport.js'), /extractLabValues\(doc\.photo, await practiceForPatient\(doc\.patient\)\)/);
    assert.match(src('services/prescriptionPdf.js'), /practiceOfMember\(prescription\.doctor\)/);
    assert.match(src('services/prescriptionPdf.js'), /practiceForPatient\(prescription\.patient\)/);
  });

  test('and the allowance counts against that same practice', () => {
    // Decided: the allowance follows the enrolled practice. It counted by the
    // assigned doctor, which a desk-enrolled patient does not have — so their
    // replies were counted nowhere, and a practice whose type has no assistant
    // had one anyway. httpChatByPractice.test.js proves both over HTTP.
    assert.equal(count(src('services/ai/assistant.js'), /countReply\(relationship\.practiceId, usage\)/g), 2);
  });

  test('and the digest and the reminders follow the appointment', () => {
    assert.match(src('services/notifications.js'), /practicesOfPatient\(patientId\)/);
    assert.match(src('services/notifications.js'), /await practiceOfAppointment\(appt\)/);
    assert.match(src('services/scheduler.js'), /await practiceOfAppointment\(/);
  });
});
