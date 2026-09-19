import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { Counter } from '../src/models/Counter.js';
import { AiUsage } from '../src/models/AiUsage.js';
import { Department } from '../src/models/Department.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { PatientProfile } from '../src/models/PatientProfile.js';

/**
 * Every message in a patient's conversation is kept, whoever writes it.
 *
 * The patient's own message took `messageCount + 1` while the assistant's
 * reply and the doctor's messages drew from the per-conversation counter, and
 * after each reply `messageCount` became the reply's number plus one. The two
 * drifted until the counter handed out a number a patient message already
 * had. About three messages in, the assistant's reply was refused as a
 * duplicate (409, "Something went wrong" on the phone). From then on every
 * patient message asked for a taken number and was refused before it was
 * saved, so it vanished from the screen, and an emergency among them raised
 * no alert. The doctor's messages still went through.
 *
 * The (session, seq) index is built before anything runs, because a unique
 * index that is not built yet accepts duplicates, and a test that runs
 * against one cannot see this at all.
 */

const realFetch = globalThis.fetch;

/** A Google that answers, so a reply is generated and has to be saved. */
function answeringGoogle(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  if (url.includes(':embedContent')) {
    return Promise.resolve(new Response(JSON.stringify({ embedding: { values: [0.1, 0.2, 0.3] } })));
  }
  if (url.includes(':streamGenerateContent')) {
    const chunk = { candidates: [{ content: { role: 'model', parts: [{ text: 'Streamed answer.' }] }, finishReason: 'STOP' }] };
    return Promise.resolve(
      new Response(`data: ${JSON.stringify(chunk)}\r\n\r\n`, { headers: { 'content-type': 'text/event-stream' } }),
    );
  }
  if (url.includes(':generateContent')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{ content: { role: 'model', parts: [{ text: 'An answer.' }] }, finishReason: 'STOP' }],
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      ),
    );
  }
  return Promise.reject(new Error(`unexpected request to ${url}`));
}

let w;

async function world() {
  const diabetology = await Department.create({
    key: 'diabetology',
    names: { en: 'Diabetes & Endocrinology' },
    practice: null,
    assistantScope: { role: 'the AI health assistant' },
  });
  for (let i = 0; i < 10; i += 1) {
    await KnowledgeChunk.create({
      docId: `diab-${i}`,
      title: `Diabetes passage ${i}`,
      content: `Plain-language diabetes guidance number ${i}, long enough to be a real passage.`,
      category: i === 0 ? 'emergency' : 'preventive_care',
      language: 'en',
      status: 'approved',
      practice: null,
      department: null,
      embedding: [0.1, 0.2, 0.3],
      embeddedAt: new Date(),
    });
  }
  const practice = await makePractice('Test Diabetes Clinic');
  const doctor = await makeMember(practice, { name: 'Dr. Test', isOwner: true, department: diabetology._id });
  const patient = await makePatient({ name: 'Test Patient', practices: [practice], primaryDoctor: doctor.user });
  await PatientProfile.create({ user: patient.user._id });
  return { practice, doctor, patient };
}

const sessionOf = () => ChatSession.findOne({ patient: w.patient.user._id }).lean();

async function say(text) {
  const session = await sessionOf();
  return as(w.patient.token).post('/chat/message', {
    ...(session ? { sessionId: String(session._id) } : {}),
    text,
    language: 'en',
  });
}

async function sayStreamed(text) {
  const session = await sessionOf();
  return as(w.patient.token).post('/chat/message/stream', {
    ...(session ? { sessionId: String(session._id) } : {}),
    text,
    language: 'en',
  });
}

const doctorSays = (content) =>
  as(w.doctor.token).post(`/chat/patients/${w.patient.user._id}/clinician-message`, { content });

const messages = async () => ChatMessage.find({ patient: w.patient.user._id }).sort({ createdAt: 1, _id: 1 }).lean();

/** Makes the next ChatMessage.create for [role] fail, once. */
function refuseNext(role) {
  const create = ChatMessage.create;
  ChatMessage.create = async function (doc, ...rest) {
    if (doc?.role === role) {
      ChatMessage.create = create;
      throw new Error(`refused a ${role} message for this test`);
    }
    return create.call(this, doc, ...rest);
  };
  return () => {
    ChatMessage.create = create;
  };
}

async function eventually(check, label) {
  for (let i = 0; i < 50; i += 1) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail(label);
}

describe('every message in a patient’s conversation is kept, and numbered in order', () => {
  before(async () => {
    globalThis.fetch = answeringGoogle;
    await boot();
    await ChatMessage.init();
  });
  after(async () => {
    await shutdown();
    globalThis.fetch = realFetch;
  });
  beforeEach(async () => {
    await wipe();
    w = await world();
  });

  test('patient, assistant and doctor take turns, and nobody is refused', async () => {
    // Before the fix the third patient message was a 409, the next doctor
    // message another, and every patient message after that.
    const steps = [
      ['patient', () => say('Hi')],
      ['patient', () => say('what is a normal sugar')],
      ['patient', () => say('I have a chest pain')],
      ['doctor', () => doctorSays('Please rest, I am calling you.')],
      ['patient', () => sayStreamed('ok')],
      ['patient', () => say('hello?')],
      ['doctor', () => doctorSays('On my way.')],
      ['patient', () => say('thank you')],
    ];
    for (const [who, step] of steps) {
      const res = await step();
      assert.ok(res.status === 200 || res.status === 201, `${who} step refused: ${res.status} ${JSON.stringify(res.body)}`);
    }

    const all = await messages();
    assert.equal(all.filter((m) => m.role === 'user').length, 6, 'a patient message was lost');
    assert.equal(all.filter((m) => m.role === 'assistant').length, 6, 'an assistant reply was lost');
    assert.equal(all.filter((m) => m.role === 'clinician').length, 2, 'a doctor message was lost');

    const numbers = all.map((m) => m.seq);
    assert.deepEqual(numbers, [...numbers].sort((a, b) => a - b), `numbered out of the order written: ${numbers}`);
    assert.equal(new Set(numbers).size, numbers.length, 'two messages share a number');

    const session = await sessionOf();
    assert.equal(session.messageCount, all.length, 'messageCount is not the number of messages');
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.patient.user._id }), 1, 'the chest pain was not escalated');
  });

  test('a conversation the old numbering left stuck works again on its next message', async () => {
    // What the old code left behind: a patient message holding the number the
    // counter will draw next, and a messageCount behind both.
    assert.equal((await say('Hi')).status, 200);
    const session = await sessionOf();
    const top = (await ChatMessage.findOne({ session: session._id }).sort({ seq: -1 }).lean()).seq;
    await ChatMessage.create({ session: session._id, patient: w.patient.user._id, seq: top + 1, role: 'user', content: 'what is a normal sugar', language: 'en' });
    await Counter.updateOne({ _id: `chat:${session._id}` }, { $set: { seq: top } });
    await ChatSession.updateOne({ _id: session._id }, { $set: { messageCount: top } });

    const res = await say('I have a chest pain');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.reply, 'the stuck conversation was not answered');
    assert.equal(await ClinicalAlert.countDocuments({ patient: w.patient.user._id }), 1, 'the chest pain was not escalated');
    assert.equal((await doctorSays('Calling you now.')).status, 201);

    const numbers = (await messages()).map((m) => m.seq);
    assert.equal(new Set(numbers).size, numbers.length, 'two messages share a number');
  });

  test('an emergency that cannot be saved still reaches the clinic', async () => {
    assert.equal((await say('Hi')).status, 200);
    const restore = refuseNext('user');
    try {
      const res = await say('I have a chest pain');
      assert.ok(res.status >= 500, `a message that was not saved was reported as sent: ${res.status}`);
    } finally {
      restore();
    }
    const alert = await ClinicalAlert.findOne({ patient: w.patient.user._id }).lean();
    assert.ok(alert, 'an unsaved chest-pain message reached nobody');
    assert.equal(alert.severity, 'emergency');
    assert.equal(alert.source.kind, 'chat');
    assert.match(alert.detail, /chest pain/);
  });

  test('a reply the database refuses is not charged to the practice', async () => {
    const replies = async () => (await AiUsage.findOne({ practice: w.practice._id }).lean())?.replies ?? 0;
    assert.equal((await say('Hi')).status, 200);
    await eventually(async () => (await replies()) === 1, 'a saved reply was not counted');

    const restore = refuseNext('assistant');
    try {
      const res = await say('what is a normal sugar');
      assert.ok(res.status >= 500, `a lost reply was reported as sent: ${res.status}`);
    } finally {
      restore();
    }
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(await replies(), 1, 'a reply nobody saw was charged');
  });
});
