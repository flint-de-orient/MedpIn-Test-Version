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
 * An AI-drafted assistant, from draft to a patient's answer, over real HTTP.
 *
 * ---- What this proves --------------------------------------------------------
 *
 * Nothing drafted reaches a patient until a clinician of that specialty, at the
 * patient's own practice, has approved both the scope and enough of the
 * guidance; approving at one practice changes nothing at another; a general
 * physician cannot sign off what the cardiology assistant says; and the shared
 * drafts themselves are never approved in place.
 *
 * Every outbound request is refused, as in httpChatByPractice.test.js: the
 * model is never called, and a reply that does come back is the scripted
 * fallback, which is enough to tell "answered" from "silent".
 */

const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

const DRAFTS = 11;
let w;

async function world() {
  const cardiology = await Department.create({
    key: 'cardiology',
    names: { en: 'Cardiologist' },
    practice: null,
    isSeed: true,
    assistantScope: {
      role: 'the cardiology assistant',
      covers: ['High blood pressure and its treatment.'],
      refuses: ['Changing any medicine or dose.'],
      redFlags: ['Chest pain that does not go away.'],
      status: 'pending_review',
      origin: 'ai_draft',
      version: 1,
    },
  });
  const generalPhysician = await Department.create({
    key: 'general_physician',
    names: { en: 'General Physician' },
    practice: null,
    isSeed: true,
  });

  const drafts = [];
  for (let i = 0; i < DRAFTS; i += 1) {
    drafts.push(
      await KnowledgeChunk.create({
        docId: `cardio-draft-${i}`,
        title: `Cardiology draft ${i}`,
        content: `Plain-language guidance number ${i} about looking after your heart, drafted for review.`,
        category: i === 0 ? 'emergency' : 'hypertension',
        language: 'en',
        status: 'pending_review',
        origin: 'ai_draft',
        practice: null,
        department: cardiology._id,
        sources: [{ title: 'Heart attack', organisation: 'NHS (England)', year: 2026, url: 'https://www.nhs.uk/conditions/heart-attack/', accessed: '2026-09-16' }],
        sourceCitation: 'NHS (England) — Heart attack (2026)',
        // Present so approving does not try to embed over the network.
        embedding: [0.1, 0.2, 0.3],
        embeddedAt: new Date(),
      }),
    );
  }

  const side = async (name) => {
    const practice = await makePractice(name, {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
      specialty: 'cardiology',
    });
    const cardiologist = await makeMember(practice, { name: `Dr ${name} Heart`, isOwner: true });
    const patient = await makePatient({ name: `${name} Patient`, practices: [practice] });
    await PatientProfile.create({ user: patient.user._id });
    return { practice, cardiologist, patient };
  };

  const a = await side('Salt Lake');
  const b = await side('Behala');
  // A general physician at the cardiology practice: a doctor, not of this specialty.
  a.physician = await makeMember(a.practice, {
    name: 'Dr Salt Lake General',
    role: ROLES.DOCTOR,
    department: generalPhysician._id,
  });

  return { cardiology, generalPhysician, drafts, a, b };
}

const byId = (items) => new Map(items.map((c) => [String(c.id), c]));

async function approveAllDrafts(member) {
  for (const draft of w.drafts) {
    const res = await as(member.token).post(`/doctor/knowledge/${draft._id}/approve`, { version: 1 });
    assert.equal(res.status, 200, `approving ${draft.docId}: ${JSON.stringify(res.body)}`);
  }
}

const cardiologyStatus = async (member) => {
  const res = await as(member.token).get('/doctor/knowledge/assistants');
  assert.equal(res.status, 200);
  return res.body.items.find((s) => s.department.key === 'cardiology');
};

const say = (patient, text) => as(patient.token).post('/chat/message', { text });

describe('an AI-drafted assistant reaches patients only through a clinician of the specialty', () => {
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

  test('the drafts are listed as AI-drafted, with their sources, and approvable only by the specialty', async () => {
    const asCardiologist = await as(w.a.cardiologist.token).get('/doctor/knowledge?origin=ai_draft&limit=50');
    assert.equal(asCardiologist.status, 200);
    assert.equal(asCardiologist.body.items.length, DRAFTS);
    for (const item of asCardiologist.body.items) {
      assert.equal(item.isAiDrafted, true);
      assert.equal(item.isShared, true);
      assert.equal(item.status, 'pending_review');
      assert.equal(item.canApprove, true, `${item.docId} not approvable by the practice’s cardiologist`);
      assert.equal(item.sources[0].url, 'https://www.nhs.uk/conditions/heart-attack/');
    }

    const asPhysician = await as(w.a.physician.token).get('/doctor/knowledge?origin=ai_draft&limit=50');
    assert.ok(asPhysician.body.items.every((c) => c.canApprove === false), 'a general physician was offered cardiology approval');
  });

  test('a doctor of another specialty cannot approve, and the shared draft is never approved in place', async () => {
    const draft = w.drafts[0];
    const refused = await as(w.a.physician.token).post(`/doctor/knowledge/${draft._id}/approve`, { version: 1 });
    assert.equal(refused.status, 403);
    assert.equal(await KnowledgeChunk.countDocuments({ practice: w.a.practice._id }), 0);

    const approved = await as(w.a.cardiologist.token).post(`/doctor/knowledge/${draft._id}/approve`, { version: 1 });
    assert.equal(approved.status, 200);
    assert.equal(approved.body.chunk.isShared, false, 'the approval did not make a practice copy');
    assert.equal(approved.body.chunk.status, 'approved');
    assert.equal(approved.body.chunk.adoptedFrom, String(draft._id));
    assert.equal(approved.body.chunk.isAiDrafted, true, 'the practice copy lost its AI-drafted attribution');

    const shared = await KnowledgeChunk.findById(draft._id).lean();
    assert.equal(shared.status, 'pending_review', 'the shared draft was approved for every practice');
    assert.equal(shared.approvedBy, undefined);

    // Approving again is not a second copy.
    await as(w.a.cardiologist.token).post(`/doctor/knowledge/${draft._id}/approve`, { version: 1 });
    assert.equal(await KnowledgeChunk.countDocuments({ practice: w.a.practice._id, adoptedFrom: draft._id }), 1);
  });

  test('a draft revised since it was opened is not approved', async () => {
    const draft = w.drafts[1];
    await KnowledgeChunk.updateOne({ _id: draft._id }, { $set: { version: 2, content: `${draft.content} Revised.` } });
    const stale = await as(w.a.cardiologist.token).post(`/doctor/knowledge/${draft._id}/approve`, { version: 1 });
    assert.equal(stale.status, 409);
    assert.equal(await KnowledgeChunk.countDocuments({ practice: w.a.practice._id }), 0);
  });

  test('approved knowledge without an approved scope is still no assistant', async () => {
    await approveAllDrafts(w.a.cardiologist);

    const status = await cardiologyStatus(w.a.cardiologist);
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'scope_not_approved');
    assert.equal(status.knowledge.approved.forLanguage, DRAFTS);
    assert.equal(status.knowledge.pending.total, 0, 'drafts approved here are still counted as waiting');

    const sent = await say(w.a.patient, 'what is a normal blood pressure');
    assert.equal(sent.status, 200);
    assert.equal(sent.body.reply, null, 'the assistant answered before its scope was approved');
    assert.deepEqual(sent.body.assistant, { enabled: false, reason: 'scope_not_approved' });
  });

  test('the scope is approved by version, by the specialty, for one practice only', async () => {
    await approveAllDrafts(w.a.cardiologist);
    const path = `/doctor/knowledge/assistants/${w.cardiology._id}/approve`;

    assert.equal((await as(w.a.cardiologist.token).post(path, {})).status, 400, 'approved without naming the version read');
    assert.equal((await as(w.a.cardiologist.token).post(path, { version: 2 })).status, 409);
    assert.equal((await as(w.a.physician.token).post(path, { version: 1 })).status, 403);

    const approved = await as(w.a.cardiologist.token).post(path, { version: 1 });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.status.enabled, true, `${approved.body.status.reasons}`);

    const answered = await say(w.a.patient, 'what is a normal blood pressure');
    assert.equal(answered.status, 200);
    assert.ok(answered.body.reply, 'the approved cardiology assistant did not answer');
    assert.equal(answered.body.assistant.enabled, true);

    // The other cardiology practice approved nothing.
    const elsewhere = await say(w.b.patient, 'what is a normal blood pressure');
    assert.equal(elsewhere.body.reply, null, 'one practice’s approval switched another practice’s assistant on');
    const behala = await cardiologyStatus(w.b.cardiologist);
    assert.equal(behala.enabled, false);
    assert.equal(behala.knowledge.approved.total, 0, 'Behala counts Salt Lake’s approved copies');
    assert.equal(behala.knowledge.pending.total, DRAFTS);

    const scope = (await Department.findById(w.cardiology._id).lean()).assistantScope;
    assert.equal(scope.status, 'pending_review', 'the shared scope was approved for every practice');
  });

  test('withdrawing the scope silences the assistant at once', async () => {
    await approveAllDrafts(w.a.cardiologist);
    await as(w.a.cardiologist.token).post(`/doctor/knowledge/assistants/${w.cardiology._id}/approve`, { version: 1 });
    assert.ok((await say(w.a.patient, 'hello heart clinic')).body.reply);

    const withdrawn = await as(w.a.cardiologist.token).post(`/doctor/knowledge/assistants/${w.cardiology._id}/withdraw`, {});
    assert.equal(withdrawn.status, 200);
    assert.equal(withdrawn.body.status.enabled, false);
    assert.equal((await say(w.a.patient, 'hello again heart clinic')).body.reply, null);
  });

  test('a copy taken to edit is reviewed as the practice’s own, and not overwritten by the draft', async () => {
    const draft = w.drafts[2];
    const adopted = await as(w.b.cardiologist.token).post(`/doctor/knowledge/${draft._id}/adopt`, {});
    assert.equal(adopted.status, 201);
    assert.equal(adopted.body.chunk.status, 'pending_review');

    const edited = await as(w.b.cardiologist.token).patch(`/doctor/knowledge/${adopted.body.chunk.id}`, {
      content: 'Behala’s own corrected wording about looking after your heart.',
    });
    assert.equal(edited.status, 200);

    const overwrite = await as(w.b.cardiologist.token).post(`/doctor/knowledge/${draft._id}/approve`, { version: 1 });
    assert.equal(overwrite.status, 409, 'approving the draft put its words over the practice’s edit');

    const own = await as(w.b.cardiologist.token).post(`/doctor/knowledge/${adopted.body.chunk.id}/approve`, {});
    assert.equal(own.status, 200);
    const saved = await KnowledgeChunk.findById(adopted.body.chunk.id).lean();
    assert.equal(saved.content, 'Behala’s own corrected wording about looking after your heart.');
    assert.equal(saved.status, 'approved');

    // And Salt Lake cannot touch Behala's copy.
    assert.equal((await as(w.a.cardiologist.token).post(`/doctor/knowledge/${saved._id}/approve`, {})).status, 404);
  });

  test('the department list and the patient’s thread list say the same as the assistant', async () => {
    const before = await as(w.a.cardiologist.token).get('/departments');
    assert.equal(before.status, 200);
    const cardiology = before.body.items.find((d) => d.key === 'cardiology');
    assert.equal(cardiology.hasAssistant, false, 'a draft scope was listed as an assistant');
    assert.equal(cardiology.assistant.reason, 'scope_not_approved');

    await approveAllDrafts(w.a.cardiologist);
    await as(w.a.cardiologist.token).post(`/doctor/knowledge/assistants/${w.cardiology._id}/approve`, { version: 1 });

    const afterApproval = await as(w.a.cardiologist.token).get('/departments');
    assert.equal(afterApproval.body.items.find((d) => d.key === 'cardiology').hasAssistant, true);

    await say(w.a.patient, 'first message to start the thread');
    const threads = await as(w.a.patient.token).get('/chat/threads');
    assert.equal(threads.status, 200);
    const thread = threads.body.groups.flatMap((g) => g.threads)[0];
    assert.equal(thread.hasAssistant, true);

    const behalaPatient = await say(w.b.patient, 'first message to Behala');
    assert.equal(behalaPatient.status, 200);
    const behalaThreads = await as(w.b.patient.token).get('/chat/threads');
    const behalaThread = behalaThreads.body.groups.flatMap((g) => g.threads)[0];
    assert.equal(behalaThread.hasAssistant, false);
    assert.deepEqual(behalaThread.assistant, { enabled: false, reason: 'scope_not_approved' });
  });
});
