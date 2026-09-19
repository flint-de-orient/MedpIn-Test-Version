import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { useMessagingForTests } from '../src/config/firebase.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { Department } from '../src/models/Department.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { Membership } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { User, ROLES } from '../src/models/User.js';
import { conversationAssistant } from '../src/services/ai/assistantAvailability.js';
import { forgetClinicIdentity } from '../src/services/clinicIdentity.js';

/**
 * A legacy patient, whose enrolment names no doctor and whose doctor is on the
 * profile, is answered like any other: their own doctor named, the diabetes
 * assistant answering, the old chat intact. Alongside them, the whole matrix:
 * new patients, the three specialties, two practices, a reassigned doctor, a
 * doctor switched off, an emergency the model fails on, the 30-minute repeat,
 * and who each push is addressed to.
 *
 * Google is replaced and records each system prompt. Firebase is replaced and
 * records each push: its tokens say whose phone it was for.
 */

const realFetch = globalThis.fetch;
let prompts = [];
let modelDown = false;
function google(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  if (url.includes(':embedContent')) return Promise.resolve(new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } })));
  if (url.includes('generateContent')) {
    prompts.push(JSON.parse(init.body).systemInstruction?.parts?.map((p) => p.text).join('\n') ?? '');
    if (modelDown) return Promise.resolve(new Response('{"error":{"code":403,"message":"down"}}', { status: 403 }));
    return Promise.resolve(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'An answer.' }] }, finishReason: 'STOP' }] })));
  }
  return Promise.reject(new Error(`unexpected request to ${url}`));
}
const lastPrompt = () => prompts.at(-1) ?? '';

let pushes = [];
const fcm = {
  sendEachForMulticast: async (message) => {
    pushes.push(message);
    return { successCount: message.tokens.length, failureCount: 0, responses: message.tokens.map(() => ({ success: true })) };
  },
};
const tokensPushed = () => pushes.flatMap((p) => p.tokens);

async function eventually(check, label) {
  for (let i = 0; i < 60; i += 1) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.fail(label);
}

async function corpus(department, prefix) {
  for (let i = 0; i < 10; i += 1) {
    await KnowledgeChunk.create({
      docId: `${prefix}-${i}`, title: `${prefix} ${i}`,
      content: `Plain-language ${prefix} guidance ${i}, long enough to be a real passage.`,
      category: i === 0 ? 'emergency' : 'preventive_care', language: 'en', status: 'approved', origin: 'ai_draft',
      practice: null, department: department?._id ?? null, embedding: [0.1, 0.2, 0.3], embeddedAt: new Date(),
    });
  }
}
const scope = (role) => ({ role, covers: ['Its specialty.'], refuses: ['Dose changes.'], redFlags: ['Chest pain.'] });

let w;
async function world() {
  const diabetology = await Department.create({ key: 'diabetology', names: { en: 'Diabetes & Endocrinology' }, practice: null, assistantScope: { role: 'the AI health assistant' } });
  const cardiology = await Department.create({ key: 'cardiology', names: { en: 'Cardiologist' }, practice: null, assistantScope: scope('the cardiology assistant') });
  const gp = await Department.create({ key: 'general_physician', names: { en: 'General Physician' }, practice: null, assistantScope: scope('the general medicine assistant') });
  await corpus(null, 'diab');
  await corpus(cardiology, 'cardio');
  await corpus(gp, 'gp');

  const a = await makePractice("Dr. Dey's Diabetes Obesity & Metabolic Clinic", { doctorDisplayName: 'Dr. Practice Display' });
  const dey = await makeMember(a, { name: 'Dr. Amit Kumar Dey', isOwner: true });
  const rahman = await makeMember(a, { name: 'Rahman' });
  const sen = await makeMember(a, { name: 'Dr. Sen' });
  const cardio = await makeMember(a, { name: 'Dr. Cardio', department: cardiology._id });
  const physician = await makeMember(a, { name: 'Dr. GP', department: gp._id });
  const gone = await makeMember(a, { name: 'Dr. Gone' });
  await Membership.updateOne({ _id: gone.membership._id }, { $set: { endedOn: new Date() } });
  const desk = await makeMember(a, { name: 'Front Desk', role: ROLES.STAFF });

  const b = await makePractice('Lake Town Clinic');
  const iyer = await makeMember(b, { name: 'Dr. Iyer', isOwner: true });

  const token = (m, t) => User.updateOne({ _id: m.user._id }, { $set: { deviceTokens: [t] } });
  await Promise.all([token(dey, 'tok-dey'), token(rahman, 'tok-rahman'), token(desk, 'tok-desk'), token(iyer, 'tok-iyer')]);

  const patient = async (name, practices, { primaryDoctor = null, legacyDoctor = null, tok = null } = {}) => {
    const p = await makePatient({ name, practices, primaryDoctor: primaryDoctor?.user ?? null });
    await PatientProfile.create({ user: p.user._id, ...(legacyDoctor ? { assignedDoctor: legacyDoctor.user._id } : {}) });
    if (tok) await User.updateOne({ _id: p.user._id }, { $set: { deviceTokens: [tok] } });
    return p;
  };

  // What backfillEnrollments.js left: enrolled, no primaryDoctor, the doctor
  // on the profile, and a chat from before enrolments.
  const legacy = await patient('Legacy Patient', [a], { legacyDoctor: dey, tok: 'tok-legacy' });
  const old = await ChatSession.create({ patient: legacy.user._id, kind: 'care', title: 'Old chat', messageCount: 1, lastMessageAt: new Date(Date.now() - 86_400_000) });
  await ChatMessage.create({ session: old._id, patient: legacy.user._id, seq: 0, role: 'user', content: 'An old message from before', language: 'en' });

  return {
    a, b, dey, rahman, sen, cardio, physician, desk, iyer, gone,
    legacy,
    fresh: await patient('New Patient', [a], { primaryDoctor: rahman, tok: 'tok-fresh' }),
    cardioPatient: await patient('Cardio Patient', [a], { primaryDoctor: cardio }),
    gpPatient: await patient('GP Patient', [a], { primaryDoctor: physician }),
    atB: await patient('Practice B Patient', [b], { primaryDoctor: iyer }),
    legacyFromB: await patient('Legacy Of Another Practice', [a], { legacyDoctor: iyer }),
    namedButLeft: await patient('Doctor Left', [a], { primaryDoctor: gone, legacyDoctor: dey }),
  };
}

async function say(p, text) {
  const s = await ChatSession.findOne({ patient: p.user._id }).sort({ lastMessageAt: -1 }).lean();
  return as(p.token).post('/chat/message', { ...(s ? { sessionId: String(s._id) } : {}), text, language: 'en' });
}
const header = async (p) => (await as(p.token).get('/chat/threads')).body.groups[0];
const assistantFor = async (p, practice = w.a) =>
  conversationAssistant({ session: null, patientId: p.user._id, practiceId: practice._id, language: 'en' });

describe('legacy and new patients, every specialty, over HTTP', () => {
  before(async () => {
    globalThis.fetch = google;
    useMessagingForTests(fcm);
    await boot();
  });
  after(async () => {
    await shutdown();
    useMessagingForTests(null);
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    await wipe();
    forgetClinicIdentity();
    prompts = [];
    pushes = [];
    modelDown = false;
    w = await world();
  });

  test('a legacy patient: their own doctor, the diabetes assistant, and the old chat intact', async () => {
    const g = await header(w.legacy);
    assert.equal(g.doctor?.name, 'Dr. Amit Kumar Dey', 'the header still shows the practice');
    assert.equal(g.threads[0].hasAssistant, true, 'the assistant is still "unavailable for your care team"');

    const res = await say(w.legacy, 'what is a normal sugar');
    assert.equal(res.status, 200);
    assert.ok(res.body.reply, 'the assistant did not answer');
    assert.ok(lastPrompt().includes('Dr. Amit Kumar Dey') && !lastPrompt().includes('Practice Display'));

    const answer = await assistantFor(w.legacy);
    assert.ok(answer.enabled && (answer.department == null || answer.department.key === 'diabetology'), `answered as ${answer.department?.key}`);

    const thread = await as(w.legacy.token).get('/chat/thread');
    assert.ok(JSON.stringify(thread.body).includes('An old message from before'), 'the old chat was lost');
  });

  test('a new patient: their doctor, the diabetes assistant', async () => {
    assert.equal((await header(w.fresh)).doctor?.name, 'Dr. Rahman');
    const res = await say(w.fresh, 'what is a normal sugar');
    assert.ok(res.body.reply);
    assert.ok(lastPrompt().includes('Dr. Rahman'));
    const answer = await assistantFor(w.fresh);
    assert.ok(answer.department == null || answer.department.key === 'diabetology');
  });

  test('a cardiologist’s and a GP’s patients get their own specialty, once its guidance is there', async () => {
    for (const [p, key, doctor] of [[w.cardioPatient, 'cardiology', 'Dr. Cardio'], [w.gpPatient, 'general_physician', 'Dr. GP']]) {
      const answer = await assistantFor(p);
      assert.equal(answer.enabled, true, `${key}: ${answer.reason}`);
      assert.equal(answer.department?.key, key);
      const res = await say(p, 'I have a question');
      assert.ok(res.body.reply, `${key} did not answer`);
      assert.ok(lastPrompt().includes(doctor));
    }
  });

  test('two practices: each names only its own doctor, and a legacy doctor at another practice is nobody here', async () => {
    await say(w.atB, 'what is a normal sugar');
    assert.ok(lastPrompt().includes('Dr. Iyer'));
    for (const name of ['Dey', 'Rahman', 'Sen']) assert.ok(!lastPrompt().includes(name), `${name} named at practice B`);

    const g = await header(w.legacyFromB);
    assert.equal(g.doctor, null, 'a doctor from another practice was named');
    assert.equal((await assistantFor(w.legacyFromB)).reason, 'no_assigned_doctor');
  });

  test('an enrolment naming a doctor who has left does not fall back to the old one', async () => {
    assert.equal((await header(w.namedButLeft)).doctor, null);
    assert.equal((await assistantFor(w.namedButLeft)).reason, 'no_assigned_doctor');
  });

  test('reassigned: the very next message names the new doctor, in the header, the prompt, the emergency and the fallback', async () => {
    await say(w.legacy, 'hello');
    assert.ok(lastPrompt().includes('Dr. Amit Kumar Dey'));

    await Enrollment.updateOne({ patient: w.legacy.user._id, practice: w.a._id }, { $set: { primaryDoctor: w.sen.user._id } });
    assert.equal((await header(w.legacy)).doctor?.name, 'Dr. Sen');
    await say(w.legacy, 'I have severe chest pain.');
    // "Dey" alone would match the practice's own name, which the prompt states.
    assert.ok(lastPrompt().includes('"Dr. Sen has been alerted."') && !lastPrompt().includes('Amit Kumar Dey'));

    modelDown = true;
    const res = await say(w.legacy, 'I have severe chest pain.');
    assert.ok(res.body.reply.content.includes('Dr. Sen has been alerted.') && !res.body.reply.content.includes('Amit Kumar Dey'));
  });

  test('a doctor switched off is nobody’s doctor: not named, not replaced by the head or anyone else', async () => {
    await User.updateOne({ _id: w.rahman.user._id }, { $set: { isActive: false } });
    const g = await header(w.fresh);
    assert.equal(g.doctor, null);
    const answer = await assistantFor(w.fresh);
    assert.equal(answer.reason, 'no_assigned_doctor');
  });

  test('an emergency the model fails on: the alert is saved, the practice is paged, and the reply names the doctor', async () => {
    modelDown = true;
    const res = await say(w.legacy, 'I have severe chest pain.');
    assert.equal(res.status, 200);
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.legacy.user._id, severity: 'emergency' }), 1, 'no alert without the model');
    const reply = res.body.reply.content;
    assert.ok(reply.includes('call an ambulance now') && reply.includes('Dr. Amit Kumar Dey has been alerted.') && reply.includes('Do not wait for a reply in this chat.'), reply);

    await eventually(() => tokensPushed().includes('tok-dey'), 'the doctor was not paged');
    const paged = tokensPushed();
    assert.ok(paged.includes('tok-desk') && paged.includes('tok-rahman'), `the practice was not paged: ${paged}`);
    assert.ok(!paged.includes('tok-iyer'), 'another practice was paged');
    assert.ok(pushes.some((p) => /EMERGENCY/.test(p.notification?.title ?? '')), 'no emergency push');
  });

  test('the same emergency within 30 minutes reuses the alert and pages nobody again', async () => {
    await say(w.legacy, 'I have severe chest pain.');
    await eventually(() => tokensPushed().includes('tok-dey'), 'the first emergency paged nobody');
    const first = pushes.length;

    await say(w.legacy, 'I have severe chest pain.');
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.legacy.user._id }), 1, 'a second alert was opened');
    assert.equal(pushes.length, first, 'the repeat paged the practice again');
  });

  test('a doctor’s message is pushed to the patient’s phone, and only theirs', async () => {
    const res = await as(w.rahman.token).post(`/chat/patients/${w.fresh.user._id}/clinician-message`, { content: 'Please check your sugar' });
    assert.equal(res.status, 201);
    await eventually(() => tokensPushed().includes('tok-fresh'), 'the patient was not notified');
    assert.deepEqual(tokensPushed(), ['tok-fresh']);
    assert.equal(pushes[0].data.kind, 'clinician_reply');
  });
});
