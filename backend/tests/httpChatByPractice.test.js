import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Enrollment, ENROLLMENT_STATUS, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Prescription } from '../src/models/Prescription.js';
import { LabResult } from '../src/models/LabResult.js';
import { AiUsage } from '../src/models/AiUsage.js';
import { ROLES } from '../src/models/User.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { buildPatientContext } from '../src/services/patientContext.js';

/**
 * One conversation per practice, for a patient two practices care for.
 *
 * ---- What was wrong ------------------------------------------------------
 *
 * A session never recorded which practice it was with. So for a patient
 * enrolled at Salt Lake and at Behala:
 *
 *   - each practice's clinician thread, chat review and dietician thread read
 *     every conversation the patient had, whoever it was with;
 *   - a reply landed in whichever session was newest, so Salt Lake's doctor
 *     could write into the conversation Behala was holding;
 *   - opening a thread marked the other practice's messages as seen;
 *   - the patient's messages went to the newest conversation, not to the
 *     practice they chose;
 *   - the assistant was given every practice's record and every clinician's
 *     words, and told they were this practice's doctor's instructions;
 *   - and it answered — and was counted — as whichever practice the assigned
 *     doctor belonged to, which a desk-enrolled patient does not have.
 *
 * ---- The rule -------------------------------------------------------------
 *
 * A conversation belongs to one enrolment. A conversation written before
 * sessions carried one belongs to the patient's first practice — the only one
 * they had when it was written — which is the rule the thread list and the
 * backfill already follow.
 */

const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

const MAY = new Date('2026-05-01T09:00:00Z');
const JUNE = new Date('2026-06-01T09:00:00Z');

let w;

async function say(session, patient, seq, role, sender, content, at = null) {
  const m = await ChatMessage.create({ session: session._id, patient, seq, role, sender: sender ?? undefined, content });
  // Kept in step the way every route keeps it: the patient's next turn is
  // numbered from this, and a stale count collides with a message already here.
  await ChatSession.updateOne({ _id: session._id }, { $inc: { messageCount: 1 } });
  // Written through the driver: the timestamps plugin treats createdAt as
  // immutable, and these messages have to predate the second enrolment.
  if (at) await ChatMessage.collection.updateOne({ _id: m._id }, { $set: { createdAt: at, updatedAt: at } });
  return m;
}

/** Resolves once `check` returns something truthy, for the writes nobody awaits. */
async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function world() {
  const side = async (name) => {
    const practice = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    return {
      practice,
      doctor: await makeMember(practice, { name: `Dr ${name}`, isOwner: true }),
      desk: await makeMember(practice, { name: `${name} Desk`, role: ROLES.STAFF }),
      dietician: await makeMember(practice, { name: `${name} Dietician`, role: ROLES.DIETICIAN }),
    };
  };
  const a = await side('Salt Lake');
  const b = await side('Behala');

  // Enrolled at both by their desks, so no assigned doctor decides for them.
  const patient = await makePatient({ name: 'Shared Patient' });
  const pid = patient.user._id;
  await PatientProfile.create({ user: pid });
  a.enrollment = await Enrollment.create({
    patient: pid,
    practice: a.practice._id,
    status: ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: MAY,
  });
  b.enrollment = await Enrollment.create({
    patient: pid,
    practice: b.practice._id,
    status: ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: new Date(Date.now() - 60 * 60 * 1000),
  });

  // What the patient and Salt Lake said before sessions carried an enrolment.
  const legacy = await ChatSession.create({ patient: pid, kind: 'care', lastMessageAt: JUNE });
  await say(legacy, pid, 1, 'user', null, 'Salt Lake question about sugar', JUNE);
  await say(legacy, pid, 2, 'clinician', a.doctor.user._id, 'Salt Lake doctor: take metformin after food', JUNE);
  const legacyNutrition = await ChatSession.create({ patient: pid, kind: 'nutrition', lastMessageAt: JUNE });
  await say(legacyNutrition, pid, 1, 'dietician', a.dietician.user._id, 'Salt Lake dietician: two rotis at lunch', JUNE);

  // Behala's own conversations, since Behala enrolled the patient.
  const behala = await ChatSession.create({ patient: pid, kind: 'care', enrollment: b.enrollment._id });
  await say(behala, pid, 1, 'user', null, 'Behala question about chest tightness');
  await say(behala, pid, 2, 'clinician', b.doctor.user._id, 'Behala cardiologist: stop aspirin for now');
  const behalaNutrition = await ChatSession.create({ patient: pid, kind: 'nutrition', enrollment: b.enrollment._id });
  await say(behalaNutrition, pid, 1, 'dietician', b.dietician.user._id, 'Behala dietician: no rice at night');

  // Each practice's own record: Salt Lake's in June, Behala's today.
  await Prescription.create({
    patient: pid,
    doctor: a.doctor.user._id,
    referenceNo: `SL-${Date.now()}`,
    issuedOn: JUNE,
    diagnosis: ['Salt Lake diagnosis: type 2 diabetes'],
    generalAdvice: 'Salt Lake advice: walk daily',
  });
  await Prescription.create({
    patient: pid,
    doctor: b.doctor.user._id,
    referenceNo: `BH-${Date.now()}`,
    issuedOn: new Date(),
    diagnosis: ['Behala diagnosis: hypertension'],
  });
  const lab = await LabResult.create({ patient: pid, testName: 'Salt Lake lipid profile', note: 'Salt Lake lab note' });
  await LabResult.collection.updateOne({ _id: lab._id }, { $set: { createdAt: JUNE, updatedAt: JUNE } });

  return { a, b, patient, pid, legacy, legacyNutrition, behala, behalaNutrition };
}

function lifecycle() {
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
}

describe('a clinician reads the conversation their own practice has with a shared patient', () => {
  lifecycle();

  test('each practice’s thread holds its own conversation and none of the other’s', async () => {
    const saltLake = await as(w.a.doctor.token).get(`/chat/patients/${w.pid}/thread`);
    assert.equal(saltLake.status, 200);
    const aText = allText(saltLake.body);
    assert.ok(aText.includes('Salt Lake doctor'), 'Salt Lake lost its own conversation');
    assert.ok(!aText.includes('Behala cardiologist'), 'Salt Lake read Behala’s conversation');
    assert.ok(!aText.includes('Behala question'), 'Salt Lake read the patient’s messages to Behala');

    const behala = await as(w.b.doctor.token).get(`/chat/patients/${w.pid}/thread`);
    assert.equal(behala.status, 200);
    const bText = allText(behala.body);
    assert.ok(bText.includes('Behala cardiologist'), 'Behala lost its own conversation');
    assert.ok(!bText.includes('Salt Lake doctor'), 'Behala read Salt Lake’s conversation');
    assert.ok(!bText.includes('Salt Lake question'), 'Behala read the patient’s messages to Salt Lake');
  });

  test('a reply lands in the conversation of the practice that wrote it', async () => {
    const fromBehala = await as(w.b.doctor.token).post(`/chat/patients/${w.pid}/clinician-message`, {
      content: 'Behala follow-up',
    });
    assert.equal(fromBehala.status, 201);
    assert.equal(String(fromBehala.body.sessionId), String(w.behala._id));

    const fromSaltLake = await as(w.a.doctor.token).post(`/chat/patients/${w.pid}/clinician-message`, {
      content: 'Salt Lake follow-up',
    });
    assert.equal(fromSaltLake.status, 201);
    assert.equal(
      String(fromSaltLake.body.sessionId),
      String(w.legacy._id),
      'Salt Lake’s reply went into the conversation Behala is holding',
    );

    const legacy = await ChatSession.findById(w.legacy._id).lean();
    assert.equal(
      String(legacy.enrollment),
      String(w.a.enrollment._id),
      'the conversation was not recorded as Salt Lake’s once Salt Lake wrote in it',
    );
  });

  test('opening the thread marks only that practice’s messages as seen', async () => {
    await as(w.b.doctor.token).get(`/chat/patients/${w.pid}/thread`);

    const toBehala = await ChatMessage.findOne({ content: /Behala question/ }).lean();
    const toSaltLake = await ChatMessage.findOne({ content: 'Salt Lake question about sugar' }).lean();
    assert.ok(toBehala.seenByClinicAt, 'Behala’s own unread message was not marked');
    assert.ok(!toSaltLake.seenByClinicAt, 'Behala marked a message to Salt Lake as seen by the clinic');
  });
});

describe('chat review stays inside the practice', () => {
  lifecycle();

  test('each practice’s review list holds only its own conversations', async () => {
    const saltLake = await as(w.a.doctor.token).get('/doctor/chat-review?flagged=false');
    assert.equal(saltLake.status, 200);
    const aIds = saltLake.body.items.map((s) => String(s.id));
    assert.ok(aIds.includes(String(w.legacy._id)), 'Salt Lake’s own conversation is missing');
    assert.ok(!aIds.includes(String(w.behala._id)), 'Salt Lake’s review list holds Behala’s conversation');
    assert.ok(!aIds.includes(String(w.behalaNutrition._id)));

    const behala = await as(w.b.doctor.token).get('/doctor/chat-review?flagged=false');
    assert.equal(behala.status, 200);
    const bIds = behala.body.items.map((s) => String(s.id));
    assert.ok(bIds.includes(String(w.behala._id)), 'Behala’s own conversation is missing');
    assert.ok(!bIds.includes(String(w.legacy._id)), 'Behala’s review list holds Salt Lake’s conversation');
    assert.ok(!bIds.includes(String(w.legacyNutrition._id)));
  });

  test('another practice’s conversation cannot be opened, marked or written into by id', async () => {
    const peek = await as(w.a.doctor.token).get(`/doctor/chat-review/${w.behala._id}`);
    assert.equal(peek.status, 404, 'Salt Lake opened Behala’s conversation by id');

    const own = await as(w.a.doctor.token).get(`/doctor/chat-review/${w.legacy._id}`);
    assert.equal(own.status, 200);

    const marked = await as(w.b.doctor.token).post(`/doctor/chat-review/${w.legacy._id}/reviewed`, {});
    assert.equal(marked.status, 404, 'Behala marked Salt Lake’s conversation reviewed');

    const written = await as(w.b.doctor.token).post(`/doctor/chat-review/${w.legacy._id}/message`, {
      content: 'into the wrong conversation',
    });
    assert.equal(written.status, 404, 'Behala wrote into Salt Lake’s conversation');
    assert.equal(await ChatMessage.countDocuments({ content: 'into the wrong conversation' }), 0);
  });
});

describe('a dietician reads and writes their own practice’s nutrition conversation', () => {
  lifecycle();

  /**
   * Hand the patient to one practice's dietician, at that practice.
   *
   * A dietician sees the patients assigned to them and nobody else. The
   * assignment was a single field on the profile, so each half of this test
   * had to take the patient off the other practice's dietician first; it is on
   * the enrolment now, and both practices' dieticians hold the patient at once.
   */
  const handTo = (side) =>
    Enrollment.updateOne(
      { _id: side.enrollment._id },
      { $set: { dietician: side.dietician.user._id, dieticianSource: DIETICIAN_SOURCE.DOCTOR } },
    );

  test('each dietician’s thread holds only their practice’s conversation', async () => {
    await handTo(w.a);
    await handTo(w.b);
    const saltLake = await as(w.a.dietician.token).get(`/dietician/patients/${w.pid}/thread`);
    assert.equal(saltLake.status, 200);
    assert.ok(allText(saltLake.body).includes('Salt Lake dietician'), 'Salt Lake’s nutrition conversation is missing');
    assert.ok(!allText(saltLake.body).includes('Behala dietician'), 'Salt Lake’s dietician read Behala’s');

    const behala = await as(w.b.dietician.token).get(`/dietician/patients/${w.pid}/thread`);
    assert.equal(behala.status, 200);
    assert.ok(allText(behala.body).includes('Behala dietician'));
    assert.ok(!allText(behala.body).includes('Salt Lake dietician'), 'Behala’s dietician read Salt Lake’s');
  });

  test('and a dietician’s message goes into their practice’s conversation', async () => {
    await handTo(w.a);
    const sent = await as(w.a.dietician.token).post(`/dietician/patients/${w.pid}/message`, {
      content: 'Salt Lake dietician again',
    });
    assert.equal(sent.status, 201);
    const message = await ChatMessage.findOne({ content: 'Salt Lake dietician again' }).lean();
    assert.equal(
      String(message.session),
      String(w.legacyNutrition._id),
      'Salt Lake’s dietician wrote into Behala’s nutrition conversation',
    );
  });
});

describe('the patient reads and writes each practice’s conversation on its own', () => {
  lifecycle();

  test('the thread they open is that practice’s conversation alone', async () => {
    const opened = await as(w.patient.token).get(`/chat/thread?sessionId=${w.behala._id}`);
    assert.equal(opened.status, 200);
    const text = allText(opened.body);
    assert.ok(text.includes('Behala cardiologist'));
    assert.ok(!text.includes('Salt Lake doctor'), 'Behala’s conversation opened with Salt Lake’s messages in it');
  });

  test('the thread list offers each practice with its own conversation', async () => {
    const list = await as(w.patient.token).get('/chat/threads');
    assert.equal(list.status, 200);
    const byName = new Map(list.body.groups.map((g) => [g.practice?.name, g]));
    assert.deepEqual(
      byName.get('Behala').threads.map((t) => t.id),
      [String(w.behala._id)],
    );
    assert.ok(byName.get('Salt Lake').threads.map((t) => t.id).includes(String(w.legacy._id)));
    assert.ok(byName.get('Behala').practice.id, 'a practice with no conversation yet could not be written to');
  });

  test('a message sent into a conversation stays in it', async () => {
    const sent = await as(w.patient.token).post('/chat/message', {
      sessionId: String(w.behala._id),
      text: 'Behala: thank you',
    });
    assert.equal(sent.status, 200);
    assert.equal(String(sent.body.sessionId), String(w.behala._id));
  });

  test('a message to a chosen practice goes to that practice', async () => {
    const sent = await as(w.patient.token).post('/chat/message', {
      practiceId: String(w.a.practice._id),
      text: 'Salt Lake: a new question',
    });
    assert.equal(sent.status, 200);
    assert.equal(
      String(sent.body.sessionId),
      String(w.legacy._id),
      'the message went to a practice the patient did not choose',
    );
  });

  test('with two practices and no choice made, the patient is asked which rather than guessed for', async () => {
    const sent = await as(w.patient.token).post('/chat/message', { text: 'which clinic gets this?' });
    assert.equal(sent.status, 409);
    const streamed = await as(w.patient.token).post('/chat/message/stream', { text: 'which clinic gets this?' });
    assert.equal(streamed.status, 409);
    assert.equal(await ChatMessage.countDocuments({ content: 'which clinic gets this?' }), 0);
  });

  test('a practice the patient is not enrolled at cannot be chosen', async () => {
    const elsewhere = await makePractice('Elsewhere');
    const sent = await as(w.patient.token).post('/chat/message', {
      practiceId: String(elsewhere._id),
      text: 'to a stranger',
    });
    assert.equal(sent.status, 404);
    assert.equal(await ChatMessage.countDocuments({ content: 'to a stranger' }), 0);
  });

  test('a patient with one practice keeps their one conversation', async () => {
    // The whole test of whether this is right rather than merely finished.
    const solo = await makePatient({ name: 'Solo Patient', practices: [w.a.practice] });
    await PatientProfile.create({ user: solo.user._id });
    const old = await ChatSession.create({ patient: solo.user._id, kind: 'care' });
    await say(old, solo.user._id, 1, 'user', null, 'Solo earlier words');

    const sent = await as(solo.token).post('/chat/message', { text: 'Solo new words' });
    assert.equal(sent.status, 200);
    assert.equal(String(sent.body.sessionId), String(old._id), 'a one-practice patient’s history was split in two');

    const thread = await as(w.a.doctor.token).get(`/chat/patients/${solo.user._id}/thread`);
    assert.ok(allText(thread.body).includes('Solo earlier words'));
    assert.ok(allText(thread.body).includes('Solo new words'));
  });
});

describe('the assistant speaks for the practice the conversation is with', () => {
  lifecycle();

  test('it is given that practice’s record, from when that practice was given access', async () => {
    const saltLake = await buildPatientContext(w.pid, {
      practiceId: w.a.practice._id,
      enrolledOn: w.a.enrollment.enrolledOn,
    });
    assert.ok(saltLake.text.includes('Salt Lake diagnosis'), 'Salt Lake’s own record is missing');
    assert.ok(!saltLake.text.includes('Behala diagnosis'), 'Salt Lake’s assistant was given Behala’s diagnosis');

    const behala = await buildPatientContext(w.pid, {
      practiceId: w.b.practice._id,
      enrolledOn: w.b.enrollment.enrolledOn,
    });
    assert.ok(behala.text.includes('Behala diagnosis'), 'Behala’s own record is missing');
    assert.ok(!behala.text.includes('Salt Lake'), 'Behala’s assistant was given Salt Lake’s record');
  });

  test('it quotes only that practice’s clinicians, from that conversation', async () => {
    const { careTeamNotesFor } = await import('../src/services/careTeamNotes.js');

    const forBehala = await careTeamNotesFor({ patientId: w.pid, enrollment: w.b.enrollment });
    assert.ok(forBehala.includes('Behala cardiologist'));
    assert.ok(!forBehala.includes('Salt Lake'), 'Behala’s assistant would quote Salt Lake’s doctor as Behala’s');

    const forSaltLake = await careTeamNotesFor({ patientId: w.pid, enrollment: w.a.enrollment });
    assert.ok(forSaltLake.includes('Salt Lake doctor'));
    assert.ok(!forSaltLake.includes('Behala'), 'Salt Lake’s assistant would quote Behala’s cardiologist as Salt Lake’s');
  });

  test('it answers, and is counted, as the practice the conversation is with', async () => {
    // A diagnostic centre's type carries no assistant.
    const centre = await makePractice('Gariahat Diagnostics', {
      practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
      plan: PLAN.PROFESSIONAL,
    });
    const enrolment = await Enrollment.create({
      patient: w.pid,
      practice: centre._id,
      status: ENROLLMENT_STATUS.ACTIVE,
      enrolledOn: new Date(Date.now() - 60 * 1000),
    });
    const atCentre = await ChatSession.create({ patient: w.pid, kind: 'care', enrollment: enrolment._id });

    const quiet = await as(w.patient.token).post('/chat/message', {
      sessionId: String(atCentre._id),
      text: 'is my report normal',
    });
    assert.equal(quiet.status, 200);
    assert.equal(quiet.body.reply, null, 'the assistant answered for a practice whose type has none');
    const refused = await AiUsage.findOne({ practice: centre._id }).lean();
    assert.equal(refused?.refused, 1, 'the refusal was not recorded against the practice the conversation is with');

    const answered = await as(w.patient.token).post('/chat/message', {
      sessionId: String(w.legacy._id),
      text: 'hello salt lake',
    });
    assert.equal(answered.status, 200);
    assert.ok(answered.body.reply, 'Salt Lake’s assistant went quiet');
    const counted = await eventually(() => AiUsage.findOne({ practice: w.a.practice._id, replies: 1 }).lean());
    assert.ok(counted, 'the reply was not counted to the practice the conversation is with');
  });

  test('only a patient’s own account talks to the patient assistant', async () => {
    const desk = as(w.a.desk.token);
    assert.equal((await desk.post('/chat/message', { text: 'testing the assistant' })).status, 403);
    assert.equal((await desk.post('/chat/message/stream', { text: 'testing the assistant' })).status, 403);
    assert.equal((await desk.post('/chat/nutrition', { content: 'testing the assistant' })).status, 403);
    assert.equal(
      await ChatSession.countDocuments({ patient: w.a.desk.user._id }),
      0,
      'a staff account opened a conversation with itself as the patient',
    );
  });
});

describe('a conversation from before this change is not handed to another practice', () => {
  lifecycle();

  test('a practice that has never written starts its own conversation, never taking over another’s', async () => {
    const third = await makePractice('Park Street Clinic', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    const doctor = await makeMember(third, { name: 'Dr Park Street', isOwner: true });
    await Enrollment.create({
      patient: w.pid,
      practice: third._id,
      status: ENROLLMENT_STATUS.ACTIVE,
      enrolledOn: new Date(Date.now() - 60 * 1000),
    });

    const sent = await as(doctor.token).post(`/chat/patients/${w.pid}/clinician-message`, {
      content: 'Park Street introduces itself',
    });
    assert.equal(sent.status, 201);
    assert.notEqual(String(sent.body.sessionId), String(w.legacy._id), 'a third practice took over Salt Lake’s conversation');
    assert.notEqual(String(sent.body.sessionId), String(w.behala._id), 'a third practice wrote into Behala’s conversation');
    const legacy = await ChatSession.findById(w.legacy._id).lean();
    assert.equal(legacy.enrollment ?? null, null, 'Salt Lake’s old conversation was stamped as another practice’s');
  });

  test('a doctor who works at both practices is quoted only in the conversation they wrote in', async () => {
    // Membership of the practice is not enough: the same person can hold it at
    // both. What they told the patient at Behala is Behala's instruction, and
    // Salt Lake's assistant must not repeat it as Salt Lake's.
    const both = await makeMember(w.b.practice, { name: 'Dr Both Practices' });
    await Membership.create({
      user: both.user._id,
      practice: w.a.practice._id,
      role: ROLES.DOCTOR,
      permissions: presetFor({ role: ROLES.DOCTOR, isOwner: false }),
      status: MEMBERSHIP_STATUS.ACTIVE,
    });
    await say(w.behala, w.pid, 3, 'clinician', both.user._id, 'Dr Both at Behala: hold the statin this week');

    const { careTeamNotesFor } = await import('../src/services/careTeamNotes.js');
    const forSaltLake = await careTeamNotesFor({ patientId: w.pid, enrollment: w.a.enrollment });
    assert.ok(!forSaltLake.includes('hold the statin'), 'Salt Lake’s assistant would quote what was said at Behala');
    const forBehala = await careTeamNotesFor({ patientId: w.pid, enrollment: w.b.enrollment });
    assert.ok(forBehala.includes('hold the statin'), 'Behala lost its own doctor’s instruction');
  });

  test('a message another practice left in the old conversation is not quoted as this practice’s instruction', async () => {
    // Written before this was fixed, when a reply landed in whichever session
    // happened to be newest.
    await say(
      w.legacy,
      w.pid,
      3,
      'clinician',
      w.b.doctor.user._id,
      'Behala doctor wrote here by mistake: double the dose',
      new Date('2026-06-02T09:00:00Z'),
    );
    const { careTeamNotesFor } = await import('../src/services/careTeamNotes.js');
    const notes = await careTeamNotesFor({ patientId: w.pid, enrollment: w.a.enrollment });
    assert.ok(notes.includes('Salt Lake doctor'));
    assert.ok(!notes.includes('double the dose'), 'Salt Lake’s assistant would quote another practice’s doctor as its own');
  });

  test('each practice’s dietician writes into that practice’s own nutrition conversation', async () => {
    // Held by Behala's dietician, on Behala's enrolment.
    await Enrollment.updateOne(
      { _id: w.b.enrollment._id },
      { $set: { dietician: w.b.dietician.user._id, dieticianSource: DIETICIAN_SOURCE.DOCTOR } },
    );
    const sent = await as(w.b.dietician.token).post(`/dietician/patients/${w.pid}/message`, {
      content: 'Behala dietician again',
    });
    assert.equal(sent.status, 201);
    const message = await ChatMessage.findOne({ content: 'Behala dietician again' }).lean();
    assert.equal(
      String(message.session),
      String(w.behalaNutrition._id),
      'Behala’s dietician wrote into another practice’s nutrition conversation',
    );
  });
});

describe('the bell, the counts and the inbox read the practice’s own conversations', () => {
  lifecycle();

  test('the doctor’s bell previews and counts only this practice’s unread messages', async () => {
    const bell = await as(w.a.doctor.token).get('/doctor/notifications');
    assert.equal(bell.status, 200);
    assert.ok(!allText(bell.body).includes('Behala question'), 'Salt Lake’s bell previewed a message written to Behala');
    assert.ok(allText(bell.body).includes('Salt Lake question'), 'Salt Lake’s own unread message is missing');
    assert.equal(bell.body.counts.messages, 1, 'Salt Lake’s bell counted a message written to Behala');
  });

  test('the patients inbox previews this practice’s last message, not the other practice’s', async () => {
    const inbox = await as(w.a.doctor.token).get('/doctor/patients?limit=50');
    assert.equal(inbox.status, 200);
    assert.ok(!allText(inbox.body).includes('Behala cardiologist'), 'Salt Lake’s inbox previewed Behala’s conversation');
  });

  test('a dietician’s bell and badge clearing stay in the practice', async () => {
    await say(w.behalaNutrition, w.pid, 2, 'user', null, 'Behala nutrition question');
    // Both practices' dieticians hold the patient — each on their own
    // practice's enrolment — so the absence below is about the conversation,
    // not about an empty caseload.
    for (const side of [w.a, w.b]) {
      await Enrollment.updateOne(
        { _id: side.enrollment._id },
        { $set: { dietician: side.dietician.user._id, dieticianSource: DIETICIAN_SOURCE.DOCTOR } },
      );
    }

    const theirs = await as(w.b.dietician.token).get('/dietician/notifications');
    assert.ok(allText(theirs.body).includes('Behala nutrition question'), 'Behala’s own dietician was not shown it');

    const bell = await as(w.a.dietician.token).get('/dietician/notifications');
    assert.equal(bell.status, 200);
    assert.ok(
      !allText(bell.body).includes('Behala nutrition question'),
      'Salt Lake’s dietician was shown a message written to Behala’s dietician',
    );

    await as(w.a.dietician.token).post('/dietician/notifications/seen', {});
    const question = await ChatMessage.findOne({ content: 'Behala nutrition question' }).lean();
    assert.ok(!question.seenByClinicAt, 'Salt Lake’s dietician cleared Behala’s unread message');
  });
});
