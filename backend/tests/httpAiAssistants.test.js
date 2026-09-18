import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Department } from '../src/models/Department.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { conversationAssistant } from '../src/services/ai/assistantAvailability.js';

/**
 * The doctor-controlled specialty assistants, end to end over real HTTP.
 *
 *   Specialty assistant → its own knowledge base → a doctor of that specialty
 *   at that practice approves → ON for that practice, and nowhere else.
 *
 * Cardiology, diabetology and general medicine, each with its own scope and its
 * own passages. The diabetology scope is the one that used to be on for every
 * practice with nobody's approval; here it is approved like the others.
 *
 * The model is never called — every outbound request is refused — so a reply
 * that comes back is the scripted fallback. That is enough to tell an assistant
 * that answered from one that stayed silent.
 */

const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

const PASSAGES = 11;
let w;

async function passagesFor(department, { origin, status, prefix }) {
  const rows = [];
  for (let i = 0; i < PASSAGES; i += 1) {
    rows.push(
      await KnowledgeChunk.create({
        docId: `${prefix}-${i}`,
        title: `${prefix} passage ${i}`,
        content: `Plain-language ${prefix} guidance number ${i}, long enough to be a real passage for review.`,
        category: i === 0 ? 'emergency' : 'preventive_care',
        language: 'en',
        status,
        origin,
        practice: null,
        department: department._id,
        sources: [{ title: 'Guidance', organisation: 'NHS (England)', year: 2026, url: 'https://www.nhs.uk/', accessed: '2026-09-16' }],
        sourceCitation: 'NHS (England) — Guidance (2026)',
        embedding: [0.1, 0.2, 0.3],
        embeddedAt: new Date(),
      }),
    );
  }
  return rows;
}

async function world() {
  const scope = (role, extra = {}) => ({
    role,
    covers: [`What ${role} helps with.`],
    refuses: ['Changing any medicine or dose.'],
    redFlags: ['Chest pain that does not go away.'],
    status: 'pending_review',
    origin: 'ai_draft',
    version: 1,
    ...extra,
  });
  const cardiology = await Department.create({
    key: 'cardiology', names: { en: 'Cardiologist' }, practice: null, isSeed: true, sortIndex: 30,
    assistantScope: scope('the cardiology assistant'),
  });
  const gp = await Department.create({
    key: 'general_physician', names: { en: 'General Physician' }, practice: null, isSeed: true, sortIndex: 10,
    assistantScope: scope('the general medicine assistant'),
  });
  // The founding scope: a role, and no review status or version at all.
  const diabetology = await Department.create({
    key: 'diabetology', names: { en: 'Diabetes & Endocrinology' }, practice: null, isSeed: true, sortIndex: 20,
    assistantScope: { role: 'the AI health assistant', covers: ['Diabetes.'], refuses: ['Dose changes.'] },
  });
  await passagesFor(cardiology, { origin: 'ai_draft', status: 'pending_review', prefix: 'cardio' });
  await passagesFor(gp, { origin: 'ai_draft', status: 'pending_review', prefix: 'gp' });
  await passagesFor(diabetology, { origin: 'platform_seed', status: 'approved', prefix: 'diab' });

  const practice = (name, specialty) =>
    makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL, ...(specialty ? { specialty } : {}) });
  const patientOf = async (p, name) => {
    const patient = await makePatient({ name, practices: [p] });
    await PatientProfile.create({ user: patient.user._id });
    return patient;
  };

  // One polyclinic with a doctor of each specialty, and one with none.
  const poly = await practice('Salt Lake Polyclinic', null);
  const doctors = {
    cardio: await makeMember(poly, { name: 'Dr Sen (Cardiology)', department: cardiology._id }),
    diab: await makeMember(poly, { name: 'Dr Dey (Diabetes)', department: diabetology._id }),
    gp: await makeMember(poly, { name: 'Dr Roy (General)', department: gp._id }),
    unplaced: await makeMember(poly, { name: 'Dr Unplaced', isOwner: true }),
    desk: await makeMember(poly, { name: 'Front Desk', role: ROLES.STAFF }),
  };

  // Single-specialty practices, for what patients get.
  const cardioA = await practice('Heart Clinic A', 'cardiology');
  const cardioB = await practice('Heart Clinic B', 'cardiology');
  const diabClinic = await practice('Sugar Clinic', 'Diabetes & Endocrinology');
  const gpClinic = await practice('Family Clinic', 'general_physician');
  const clinics = {
    cardioA: { practice: cardioA, doctor: await makeMember(cardioA, { name: 'Dr A Heart', isOwner: true }), patient: await patientOf(cardioA, 'Patient A') },
    cardioB: { practice: cardioB, doctor: await makeMember(cardioB, { name: 'Dr B Heart', isOwner: true }), patient: await patientOf(cardioB, 'Patient B') },
    diab: { practice: diabClinic, doctor: await makeMember(diabClinic, { name: 'Dr Sugar', isOwner: true }), patient: await patientOf(diabClinic, 'Patient D') },
    gp: { practice: gpClinic, doctor: await makeMember(gpClinic, { name: 'Dr Family', isOwner: true }), patient: await patientOf(gpClinic, 'Patient G') },
  };
  return { cardiology, gp, diabetology, poly, doctors, clinics };
}

const list = async (member) => {
  const res = await as(member.token).get('/doctor/knowledge/assistants');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.items;
};
const itemFor = async (member, key) => (await list(member)).find((i) => i.department.key === key);

async function approve(member, key) {
  const item = await itemFor(member, key);
  assert.ok(item, `${key} is not on this doctor's list`);
  return as(member.token).post(`/doctor/knowledge/assistants/${item.department.id}/approve`, {
    version: item.scopeText.version,
    knowledgeVersion: item.knowledgeVersion,
  });
}
const withdraw = (member, department) =>
  as(member.token).post(`/doctor/knowledge/assistants/${department._id}/withdraw`, {});
const say = (patient, text) => as(patient.token).post('/chat/message', { text });

describe('specialty assistants are switched on by a doctor of that specialty, for that practice only', () => {
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

  test('each doctor sees only their own specialty’s assistant, OFF until approved', async () => {
    for (const [who, key] of [['cardio', 'cardiology'], ['diab', 'diabetology'], ['gp', 'general_physician']]) {
      const items = await list(w.doctors[who]);
      assert.deepEqual(items.map((i) => i.department.key), [key], `${who} sees ${items.map((i) => i.department.key)}`);
      const [item] = items;
      assert.equal(item.state, 'off');
      assert.equal(item.enabled, false);
      assert.equal(item.reason, 'scope_not_approved');
      assert.equal(item.canApprove, true);
      assert.equal(item.canWithdraw, false);
      assert.ok(item.scopeText.covers.length && item.scopeText.refuses.length, 'the doctor cannot see what it covers and refuses');
      assert.match(item.knowledgeVersion, /^[0-9a-f]{12}$/);
    }
    assert.deepEqual(await list(w.doctors.unplaced), [], 'a doctor in no specialty was offered somebody else’s assistant');
  });

  test('cardiologist, diabetologist and general physician each turn their own assistant ON', async () => {
    for (const [who, key, dept] of [
      ['cardio', 'cardiology', w.cardiology],
      ['diab', 'diabetology', w.diabetology],
      ['gp', 'general_physician', w.gp],
    ]) {
      const res = await approve(w.doctors[who], key);
      assert.equal(res.status, 200, `${key}: ${JSON.stringify(res.body)}`);
      assert.equal(res.body.item.state, 'on', `${key}: ${res.body.item.reasons}`);
      assert.equal(res.body.item.approval.approvedBy.name, w.doctors[who].name, 'the approval does not name the doctor');

      const status = (await Department.findById(dept._id).lean()).assistantScope.approvals;
      assert.equal(status.length, 1);
      assert.equal(String(status[0].practice), String(w.poly._id));
      assert.equal(String(status[0].approvedBy), String(w.doctors[who].user._id));
    }
  });

  test('one approval covers the scope and the knowledge base: the drafts become this practice’s approved copies', async () => {
    const res = await approve(w.clinics.cardioA.doctor, 'cardiology');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.knowledge, { adopted: PASSAGES, alreadyApproved: 0, keptPracticeEdits: 0 });

    const copies = await KnowledgeChunk.find({ practice: w.clinics.cardioA.practice._id }).lean();
    assert.equal(copies.length, PASSAGES);
    assert.ok(copies.every((c) => c.status === 'approved' && String(c.department) === String(w.cardiology._id)));
    assert.ok(copies.every((c) => String(c.approvedBy) === String(w.clinics.cardioA.doctor.user._id)));
    // The shared drafts are untouched for every other practice.
    assert.equal(await KnowledgeChunk.countDocuments({ practice: null, department: w.cardiology._id, status: 'pending_review' }), PASSAGES);
  });

  test('Practice A’s approval is not Practice B’s', async () => {
    assert.equal((await approve(w.clinics.cardioA.doctor, 'cardiology')).status, 200);

    assert.equal((await itemFor(w.clinics.cardioA.doctor, 'cardiology')).state, 'on');
    const b = await itemFor(w.clinics.cardioB.doctor, 'cardiology');
    assert.equal(b.state, 'off', 'one practice’s approval switched the assistant on at another');
    assert.equal(b.knowledge.approved.total, 0, 'Practice B counts Practice A’s approved copies');

    assert.ok((await say(w.clinics.cardioA.patient, 'what is a normal blood pressure')).body.reply);
    const other = await say(w.clinics.cardioB.patient, 'what is a normal blood pressure');
    assert.equal(other.body.reply, null);
    assert.deepEqual(other.body.assistant, { enabled: false, reason: 'scope_not_approved' });
  });

  test('a doctor of another specialty cannot approve, and neither can the front desk', async () => {
    const cardio = await itemFor(w.doctors.cardio, 'cardiology');
    const body = { version: cardio.scopeText.version, knowledgeVersion: cardio.knowledgeVersion };
    const path = `/doctor/knowledge/assistants/${w.cardiology._id}/approve`;

    assert.equal((await as(w.doctors.gp.token).post(path, body)).status, 403, 'a general physician approved cardiology');
    assert.equal((await as(w.doctors.diab.token).post(path, body)).status, 403, 'a diabetologist approved cardiology');
    assert.equal((await as(w.doctors.unplaced.token).post(path, body)).status, 403, 'a doctor in no specialty approved cardiology');
    assert.equal((await as(w.doctors.desk.token).post(path, body)).status, 403, 'the front desk approved an assistant');
    assert.equal(
      (await as(w.clinics.cardioA.patient.token).post(path, body)).status,
      403,
      'a patient approved an assistant',
    );
    assert.equal((await itemFor(w.doctors.cardio, 'cardiology')).state, 'off');
  });

  test('a doctor outside the practice cannot change it: their approval is their own practice’s', async () => {
    assert.equal((await approve(w.clinics.cardioB.doctor, 'cardiology')).status, 200);
    assert.equal((await itemFor(w.clinics.cardioA.doctor, 'cardiology')).state, 'off');
    assert.equal((await say(w.clinics.cardioA.patient, 'hello')).body.reply, null);

    // And a withdrawal from B does nothing to an approval at A.
    assert.equal((await approve(w.clinics.cardioA.doctor, 'cardiology')).status, 200);
    await withdraw(w.clinics.cardioB.doctor, w.cardiology);
    assert.equal((await itemFor(w.clinics.cardioA.doctor, 'cardiology')).state, 'on');
  });

  test('withdrawn approval turns the assistant OFF at once, and says who withdrew it', async () => {
    assert.equal((await approve(w.clinics.cardioA.doctor, 'cardiology')).status, 200);
    assert.ok((await say(w.clinics.cardioA.patient, 'hello heart clinic')).body.reply);

    const res = await withdraw(w.clinics.cardioA.doctor, w.cardiology);
    assert.equal(res.status, 200);
    assert.equal(res.body.withdrawn, true);
    assert.equal(res.body.item.state, 'withdrawn');
    assert.equal(res.body.item.approval.withdrawnBy.name, w.clinics.cardioA.doctor.name);
    assert.equal(res.body.item.canApprove, true, 'a withdrawn assistant cannot be approved again');

    // No cache to outlive the write: the very next message is not answered.
    const next = await say(w.clinics.cardioA.patient, 'hello again heart clinic');
    assert.equal(next.body.reply, null, 'a withdrawn assistant still answered');
    assert.equal((await itemFor(w.clinics.cardioA.doctor, 'cardiology')).state, 'withdrawn');
  });

  test('a patient is never answered by an assistant nobody approved — the diabetes one included', async () => {
    for (const key of ['cardioA', 'diab', 'gp']) {
      const sent = await say(w.clinics[key].patient, 'I have a question about my health');
      assert.equal(sent.status, 200);
      assert.equal(sent.body.reply, null, `${key}'s assistant answered with no approval`);
      assert.deepEqual(sent.body.assistant, { enabled: false, reason: 'scope_not_approved' });
    }
    assert.equal((await approve(w.clinics.diab.doctor, 'diabetology')).status, 200);
    assert.ok((await say(w.clinics.diab.patient, 'what is a normal sugar')).body.reply, 'the approved diabetes assistant did not answer');
  });

  test('each practice’s conversation is answered by its own specialty, from its own knowledge', async () => {
    for (const [key, dept] of [['cardioA', w.cardiology], ['diab', w.diabetology], ['gp', w.gp]]) {
      const answer = await conversationAssistant({ session: {}, practiceId: w.clinics[key].practice._id });
      assert.equal(String(answer.department?._id), String(dept._id), `${key} is routed to ${answer.department?.key}`);
      assert.equal(String(answer.retrievalDepartment), String(dept._id), `${key} retrieves from the wrong knowledge base`);
    }
    // The endocrine practice keeps its original prompt; the others use their scope.
    const diab = await conversationAssistant({ session: {}, practiceId: w.clinics.diab.practice._id });
    assert.equal(diab.useDepartmentBlock, false);
    const cardio = await conversationAssistant({ session: {}, practiceId: w.clinics.cardioA.practice._id });
    assert.equal(cardio.useDepartmentBlock, true);
  });

  test('approval and withdrawal are audited with who, where, which specialty and which versions', async () => {
    const approved = await approve(w.doctors.cardio, 'cardiology');
    const item = approved.body.item;
    await withdraw(w.doctors.cardio, w.cardiology);

    const rows = await AuditLog.find({ resource: 'AiAssistant' }).sort({ at: 1 }).lean();
    assert.deepEqual(rows.map((r) => r.action), ['AI_ASSISTANT_APPROVED', 'AI_ASSISTANT_APPROVAL_WITHDRAWN']);
    const [a] = rows;
    assert.equal(String(a.actor), String(w.doctors.cardio.user._id));
    assert.equal(a.meta.doctorName, w.doctors.cardio.name);
    assert.equal(a.meta.practiceId, String(w.poly._id));
    assert.equal(a.meta.specialty, 'cardiology');
    assert.equal(a.meta.configurationVersion, 1);
    assert.equal(a.meta.knowledgeVersion, item.knowledgeVersion);
    assert.ok(a.meta.at);
    assert.equal(a.subjectPatient, undefined, 'a doctor’s decision was filed against a patient');
  });

  test('approving twice is one approval, one audit row and one set of copies', async () => {
    assert.equal((await approve(w.doctors.cardio, 'cardiology')).status, 200);
    const again = await approve(w.doctors.cardio, 'cardiology');
    assert.equal(again.status, 200);
    assert.equal(again.body.unchanged, true);

    assert.equal(await AuditLog.countDocuments({ action: 'AI_ASSISTANT_APPROVED' }), 1);
    assert.equal((await Department.findById(w.cardiology._id).lean()).assistantScope.approvals.length, 1);
    assert.equal(await KnowledgeChunk.countDocuments({ practice: w.poly._id }), PASSAGES);
  });

  test('concurrent approvals, and an approval racing a withdrawal, leave one consistent record', async () => {
    const item = await itemFor(w.doctors.cardio, 'cardiology');
    const body = { version: item.scopeText.version, knowledgeVersion: item.knowledgeVersion };
    const path = `/doctor/knowledge/assistants/${w.cardiology._id}/approve`;

    const both = await Promise.all([as(w.doctors.cardio.token).post(path, body), as(w.doctors.cardio.token).post(path, body)]);
    assert.ok(both.every((r) => r.status === 200), JSON.stringify(both.map((r) => r.body)));
    assert.equal((await Department.findById(w.cardiology._id).lean()).assistantScope.approvals.length, 1);
    assert.equal(await KnowledgeChunk.countDocuments({ practice: w.poly._id }), PASSAGES, 'copies were duplicated');

    const race = await Promise.all([as(w.doctors.cardio.token).post(path, body), withdraw(w.doctors.cardio, w.cardiology)]);
    assert.ok(race.every((r) => r.status === 200), JSON.stringify(race.map((r) => r.body)));
    const approvals = (await Department.findById(w.cardiology._id).lean()).assistantScope.approvals;
    assert.equal(approvals.length, 1);
    const state = (await itemFor(w.doctors.cardio, 'cardiology')).state;
    assert.ok(['on', 'withdrawn'].includes(state), state);
    assert.equal(state === 'on', !approvals[0].withdrawnAt, 'the list and the record disagree');
  });

  test('knowledge or wording changed since the doctor read it is not approved on their behalf', async () => {
    const item = await itemFor(w.doctors.cardio, 'cardiology');
    const path = `/doctor/knowledge/assistants/${w.cardiology._id}/approve`;

    // A passage added after the screen was opened.
    await KnowledgeChunk.create({
      docId: 'cardio-late', title: 'Late passage', content: 'A passage drafted after the doctor opened the screen, for review.',
      category: 'preventive_care', language: 'en', status: 'pending_review', origin: 'ai_draft',
      practice: null, department: w.cardiology._id,
    });
    const stale = await as(w.doctors.cardio.token).post(path, { version: item.scopeText.version, knowledgeVersion: item.knowledgeVersion });
    assert.equal(stale.status, 409, 'knowledge the doctor never saw was approved');
    assert.equal((await itemFor(w.doctors.cardio, 'cardiology')).state, 'off');

    const wrongScope = await as(w.doctors.cardio.token).post(path, { version: 2, knowledgeVersion: (await itemFor(w.doctors.cardio, 'cardiology')).knowledgeVersion });
    assert.equal(wrongScope.status, 409);
  });

  test('the state survives a restart: it is read from the record, not remembered', async () => {
    assert.equal((await approve(w.clinics.cardioA.doctor, 'cardiology')).status, 200);
    // What the app reads on a cold start is the same list, from the database.
    const fresh = await itemFor(w.clinics.cardioA.doctor, 'cardiology');
    assert.equal(fresh.state, 'on');
    assert.equal(fresh.approval.approvedBy.name, w.clinics.cardioA.doctor.name);
  });
});
