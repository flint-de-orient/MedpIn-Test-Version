import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Prescription } from '../src/models/Prescription.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Two server fixes behind bugs the doctor saw in the app's previous design.
 */

let clinic;
let patient;

async function setUp() {
  const practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  clinic = { practice, doctor: await makeMember(practice, { name: 'Dr Sen', isOwner: true }) };
  patient = await makePatient({ name: 'Withdrew A Message', practices: [practice] });
}

describe('a message the patient deleted for everyone', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('is not previewed with its words in the doctor’s patient list', async () => {
    const session = await ChatSession.create({
      patient: patient.user._id,
      kind: 'care',
      language: 'en',
      enrollment: patient.enrollments[0]._id,
    });
    await ChatMessage.create({
      session: session._id,
      patient: patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Something I should not have sent',
      deletedForEveryoneAt: new Date(),
    });

    const res = await as(clinic.doctor.token).get('/doctor/patients');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const row = res.body.items.find((p) => String(p.id ?? p._id) === String(patient.user._id));
    assert.ok(row, 'the patient is not on the list');
    assert.equal(row.lastMessage?.preview, 'Message deleted');
    assert.ok(!JSON.stringify(res.body).includes('Something I should not have sent'), 'the withdrawn words were sent');
  });
});

describe('a prescription that no longer stands', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('says so in the list, with the reason', async () => {
    const issued = await as(clinic.doctor.token).post(`/patients/${patient.user._id}/prescriptions`, {
      items: [{ name: 'Metformin', strength: '500mg', frequency: '1-0-1', durationDays: 30 }],
    });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    const [rx] = await Prescription.find({ patient: patient.user._id }).lean();
    await Prescription.updateOne(
      { _id: rx._id },
      { $set: { recordState: 'voided', isActive: false, endedAt: new Date(), endedReason: 'Written for the wrong patient' } },
    );

    const res = await as(clinic.doctor.token).get(`/patients/${patient.user._id}/prescriptions`);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const item = res.body.items.find((i) => String(i.id) === String(rx._id));
    assert.equal(item.recordState, 'voided');
    assert.equal(item.endedReason, 'Written for the wrong patient');
    assert.ok(item.endedAt);
  });

  test('and a current one says it is current', async () => {
    await as(clinic.doctor.token).post(`/patients/${patient.user._id}/prescriptions`, {
      items: [{ name: 'Metformin', strength: '500mg', frequency: '1-0-1', durationDays: 30 }],
    });
    const res = await as(clinic.doctor.token).get(`/patients/${patient.user._id}/prescriptions`);
    assert.equal(res.body.items[0].recordState, 'current');
    assert.equal(res.body.items[0].endedReason, null);
  });
});
