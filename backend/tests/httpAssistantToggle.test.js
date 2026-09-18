import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Department } from '../src/models/Department.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * The specialty assistants with no approval step, over real HTTP.
 *
 *   - each patient is answered by their own doctor's specialty, so one practice
 *     with a cardiologist and a general physician answers both;
 *   - a patient with no assigned doctor has no doctor's chat, and no assistant;
 *   - a patient whose doctor's specialty has no assistant gets none, rather
 *     than another specialty's;
 *   - the chat-screen toggle is the switch, per patient: off for one patient
 *     silences that conversation and nobody else's.
 *
 * The model is never called — every outbound request is refused — so a reply
 * that comes back is the scripted fallback, which is enough to tell an
 * assistant that answered from one that stayed silent.
 */

const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

let w;

async function guidanceFor(department, prefix) {
  for (let i = 0; i < 10; i += 1) {
    await KnowledgeChunk.create({
      docId: `${prefix}-${i}`,
      title: `${prefix} passage ${i}`,
      content: `Plain-language ${prefix} guidance number ${i}, long enough to be a real passage.`,
      category: i === 0 ? 'emergency' : 'preventive_care',
      language: 'en',
      status: 'approved',
      origin: 'ai_draft',
      practice: null,
      department: department._id,
      embedding: [0.1, 0.2, 0.3],
      embeddedAt: new Date(),
    });
  }
}

async function world() {
  const scope = (role) => ({ role, covers: ['Its specialty.'], refuses: ['Dose changes.'], redFlags: ['Chest pain.'] });
  const cardiology = await Department.create({ key: 'cardiology', names: { en: 'Cardiologist' }, practice: null, assistantScope: scope('the cardiology assistant') });
  const gp = await Department.create({ key: 'general_physician', names: { en: 'General Physician' }, practice: null, assistantScope: scope('the general medicine assistant') });
  const dermatology = await Department.create({ key: 'dermatology', names: { en: 'Dermatologist' }, practice: null });
  const diabetology = await Department.create({ key: 'diabetology', names: { en: 'Diabetes & Endocrinology' }, practice: null, assistantScope: { role: 'the AI health assistant' } });
  await guidanceFor(cardiology, 'cardio');
  await guidanceFor(gp, 'gp');
  await guidanceFor(diabetology, 'diab');

  // One practice, no specialty of its own, three kinds of doctor.
  const practice = await makePractice('Salt Lake Polyclinic', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  const cardiologist = await makeMember(practice, { name: 'Dr Sen', department: cardiology._id });
  const physician = await makeMember(practice, { name: 'Dr Roy', department: gp._id });
  const dermatologist = await makeMember(practice, { name: 'Dr Das', department: dermatology._id });
  // A doctor the practice has placed in no department.
  const generalist = await makeMember(practice, { name: 'Dr Bose' });
  const desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });

  const patientOf = async (name, doctor) => {
    const p = await makePatient({ name, practices: [practice], primaryDoctor: doctor?.user ?? null });
    await PatientProfile.create({ user: p.user._id });
    return p;
  };
  return {
    practice,
    cardiologist,
    physician,
    desk,
    heart: await patientOf('Heart Patient', cardiologist),
    general: await patientOf('General Patient', physician),
    skin: await patientOf('Skin Patient', dermatologist),
    unplaced: await patientOf('Unplaced Doctor’s Patient', generalist),
    unassigned: await patientOf('Unassigned Patient', null),
  };
}

const say = (patient, text) => as(patient.token).post('/chat/message', { text });
const toggle = (member, patient, enabled) =>
  as(member.token).patch(`/chat/patients/${patient.user._id}/assistant`, { kind: 'care', enabled });

describe('specialty assistants answer each patient as their own doctor’s specialty, and the toggle is the switch', () => {
  before(async () => {
    globalThis.fetch = localOnly;
    await boot();
  });
  after(async () => {
    await shutdown();
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    await wipe();
    w = await world();
  });

  test('a cardiologist’s and a GP’s patients at one practice are both answered, with no approval step', async () => {
    for (const patient of [w.heart, w.general]) {
      const sent = await say(patient, 'I have a question about my health');
      assert.equal(sent.status, 200);
      assert.ok(sent.body.reply, `${patient.name} was not answered`);
      assert.deepEqual(sent.body.assistant, { enabled: true, reason: 'enabled' });
    }
  });

  test('a patient with no assigned doctor has no doctor’s chat, and no assistant', async () => {
    const sent = await say(w.unassigned, 'what is a normal sugar');
    assert.equal(sent.status, 200, 'the message still reaches the clinic');
    assert.equal(sent.body.reply, null, 'an unassigned patient was answered by an assistant');
    assert.deepEqual(sent.body.assistant, { enabled: false, reason: 'no_assigned_doctor' });

    const threads = await as(w.unassigned.token).get('/chat/threads');
    assert.equal(threads.body.groups.flatMap((g) => g.threads)[0].hasAssistant, false);
  });

  test('a doctor placed in no department practises the practice’s specialty — here none, so diabetes', async () => {
    const sent = await say(w.unplaced, 'what is a normal sugar');
    assert.ok(sent.body.reply, 'the patient of a doctor in no department was not answered');
  });

  test('a dermatologist’s patient gets no assistant, not another specialty’s', async () => {
    // The practice has no specialty, so before routing by doctor this patient
    // was answered by the diabetes assistant.
    const sent = await say(w.skin, 'I have a rash on my arm');
    assert.equal(sent.status, 200);
    assert.equal(sent.body.reply, null, 'a skin patient was answered by an assistant for another specialty');
    assert.equal(sent.body.assistant.enabled, false);
    assert.equal(sent.body.assistant.reason, 'no_scope');

    const threads = await as(w.skin.token).get('/chat/threads');
    const thread = threads.body.groups.flatMap((g) => g.threads)[0];
    assert.equal(thread.hasAssistant, false, 'the patient’s app would promise an assistant that does not answer');
  });

  test('the toggle switches one patient’s conversation off and on, and nobody else’s', async () => {
    await say(w.heart, 'first message');
    const off = await toggle(w.cardiologist, w.heart, false);
    assert.equal(off.status, 200, JSON.stringify(off.body));

    assert.equal((await say(w.heart, 'are you there')).body.reply, null, 'the assistant answered with its toggle off');
    assert.ok((await say(w.general, 'are you there')).body.reply, 'turning one patient’s toggle off silenced another patient');
    const read = await as(w.cardiologist.token).get(`/chat/patients/${w.heart.user._id}/assistant?kind=care`);
    assert.equal(read.body.assistantEnabled, false, 'the toggle does not read back as off');

    assert.equal((await toggle(w.cardiologist, w.heart, true)).status, 200);
    assert.ok((await say(w.heart, 'and now')).body.reply, 'the assistant stayed quiet with its toggle back on');
  });

  test('the front desk can use the toggle too, and a patient cannot', async () => {
    await say(w.general, 'first message');
    assert.equal((await toggle(w.desk, w.general, false)).status, 200);
    assert.equal((await say(w.general, 'hello')).body.reply, null);
    assert.equal((await toggle(w.general, w.general, true)).status, 403, 'a patient switched the assistant back on');
  });
});
