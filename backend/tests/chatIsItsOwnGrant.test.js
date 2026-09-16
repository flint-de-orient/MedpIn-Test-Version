import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PERMISSIONS } from '../src/models/Membership.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Who may read what a patient wrote, and who may answer as the clinic.
 *
 * The care thread sat behind `requireClinician`, which admits every clinical
 * role a practice employs. So the technician at the bench — whose job is to
 * process a sample and record what came back — could open a patient's account
 * of their symptoms in their own words, and reply to it under the clinic's
 * name. Nothing in the record would say they were not the person the patient
 * thought they were talking to.
 *
 * Reading a record and reading a conversation are different acts, and the
 * grants are now separate.
 */

let practice;
let patient;
let doctor;
let desk;
let labTech;
let labManager;

async function thread() {
  const session = await ChatSession.create({
    patient: patient.user._id,
    kind: 'care',
    language: 'en',
  });
  await ChatMessage.create({
    session: session._id,
    patient: patient.user._id,
    seq: 1,
    role: 'user',
    content: 'My foot has been sore since Tuesday and I am frightened.',
  });
  return session;
}

describe('the care thread is its own grant', () => {
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
    labTech = await makeMember(practice, { name: 'Bench', role: ROLES.LAB_TECHNICIAN });
    labManager = await makeMember(practice, { name: 'Lab Head', role: ROLES.LAB_MANAGER });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
    await thread();
  });

  test('the laboratory holds VIEW_PATIENT and still cannot read it', async () => {
    // Not a technicality: they can open the patient's record, because a result
    // has to be filed against somebody. The conversation is a different thing.
    assert.ok(labTech.membership.can(PERMISSIONS.VIEW_PATIENT));
    assert.ok(!labTech.membership.can(PERMISSIONS.CHAT_READ));

    const res = await as(labTech.token).get(`/chat/patients/${patient.user._id}/thread`);
    assert.equal(res.status, 403, 'the bench read a patient’s own words');
    assert.ok(
      !JSON.stringify(res.body).includes('frightened'),
      'the refusal carried the message it refused',
    );
  });

  test('and cannot answer as the clinic', async () => {
    const res = await as(labTech.token).post(
      `/chat/patients/${patient.user._id}/clinician-message`,
      { content: 'Try soaking it in warm water.' },
    );
    assert.equal(res.status, 403, 'the bench answered a patient as the clinic');
    assert.equal(
      await ChatMessage.countDocuments({ content: 'Try soaking it in warm water.' }),
      0,
    );
  });

  test('nor can the lab manager, who runs the bench rather than the clinic', async () => {
    const read = await as(labManager.token).get(`/chat/patients/${patient.user._id}/thread`);
    assert.equal(read.status, 403);
  });

  test('the desk reads and answers, because that is the job', async () => {
    // The front desk fields "when should I come in" all day. Taking that away
    // would be a fix that broke the clinic.
    const read = await as(desk.token).get(`/chat/patients/${patient.user._id}/thread`);
    assert.equal(read.status, 200);

    const sent = await as(desk.token).post(
      `/chat/patients/${patient.user._id}/clinician-message`,
      { content: 'Come in tomorrow at ten and the doctor will look at it.' },
    );
    assert.equal(sent.status, 201);
  });

  test('and so does the doctor', async () => {
    const read = await as(doctor.token).get(`/chat/patients/${patient.user._id}/thread`);
    assert.equal(read.status, 200);
    assert.ok(JSON.stringify(read.body).includes('frightened'));
  });

  test('the summary of a conversation needs both grants', async () => {
    /*
     * A summary names a patient and is made of what they wrote. Somebody who
     * may see patients but not read their conversations has no business in
     * either half of it.
     */
    const res = await as(labTech.token).get('/chat-summaries');
    assert.equal(res.status, 403);
  });
});
