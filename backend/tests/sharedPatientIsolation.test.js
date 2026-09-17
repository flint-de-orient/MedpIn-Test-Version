import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { DirectMessage } from '../src/models/DirectMessage.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * A patient cared for by two practices is the normal case, not the edge case
 * (verification V-02, V-04, V-05, V-51).
 *
 * Each practice has its own conversation with the patient. Scoping by patient
 * alone — "is this one of my patients?" — answers yes for both practices, and
 * that is exactly the check these routes used: one practice's bell marked the
 * other's thread as read, one practice's doctor could pin the other's messages,
 * and the old direct-message thread was one merged conversation for everybody.
 */

let a;
let b;
let patient;
let sessionA;
let sessionB;

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return { practice: p, doctor: await makeMember(p, { name: `Dr ${name}`, isOwner: true }) };
}

async function sharedPatient() {
  a = await practice('Salt Lake');
  b = await practice('Behala');
  patient = await makePatient({ name: 'Seen By Both', practices: [a.practice, b.practice] });
  const [enrolA, enrolB] = patient.enrollments;
  sessionA = await ChatSession.create({ patient: patient.user._id, kind: 'care', language: 'en', enrollment: enrolA._id });
  sessionB = await ChatSession.create({ patient: patient.user._id, kind: 'care', language: 'en', enrollment: enrolB._id });
}

const turn = (session, content, seq = 1) =>
  ChatMessage.create({ session: session._id, patient: patient.user._id, seq, role: 'user', content });

describe('V-05: one practice’s bell clears its own conversation', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await sharedPatient();
  });

  test('marking seen at Salt Lake leaves the patient’s unread message to Behala unread', async () => {
    const toSalt = await turn(sessionA, 'For Salt Lake: my sugar is 300');
    const toBehala = await turn(sessionB, 'For Behala: my knee hurts');

    const res = await as(a.doctor.token).post('/doctor/notifications/seen', {});
    assert.equal(res.status, 200);

    assert.ok((await ChatMessage.findById(toSalt._id).lean()).seenByClinicAt, 'Salt Lake’s own message was not marked');
    assert.equal(
      (await ChatMessage.findById(toBehala._id).lean()).seenByClinicAt ?? null,
      null,
      'Behala’s thread was marked "seen by the clinic" by another practice',
    );
  });
});

describe('V-04: moderation stays inside this practice’s conversation', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await sharedPatient();
  });

  test('a doctor cannot pin, hide or unhide a message in the other practice’s conversation with their patient', async () => {
    const theirs = await turn(sessionB, 'Behala: private question');
    const url = `/chat/messages/${theirs._id}`;

    assert.equal((await as(a.doctor.token).post(`${url}/pin`, { pinned: true })).status, 404, 'pinned another practice’s message');
    assert.equal((await as(a.doctor.token).post(`${url}/hide`, {})).status, 404, 'hid another practice’s message');
    assert.equal((await as(a.doctor.token).post(`${url}/unhide`, {})).status, 404, 'unhid another practice’s message');

    const after = await ChatMessage.findById(theirs._id).lean();
    assert.equal(after.pinnedAt ?? null, null);
    assert.deepEqual(after.hiddenFor ?? [], []);
  });

  test('and still moderates its own', async () => {
    const mine = await turn(sessionA, 'Salt Lake: question');
    const res = await as(a.doctor.token).post(`/chat/messages/${mine._id}/pin`, { pinned: true });
    assert.equal(res.status, 200);
    assert.ok((await ChatMessage.findById(mine._id).lean()).pinnedAt);
  });
});

describe('V-02: the merged direct-message thread is retired', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await sharedPatient();
  });

  test('every route answers 410, and the stored messages are left as they were', async () => {
    const stored = await DirectMessage.create({
      patient: patient.user._id,
      sender: patient.user._id,
      senderRole: 'patient',
      content: 'An old message to the clinic',
    });

    for (const [token, call] of [
      [a.doctor.token, (c) => c.get('/messages/threads')],
      [patient.token, (c) => c.get('/messages')],
      [patient.token, (c) => c.post('/messages', { content: 'hello?' })],
      [b.doctor.token, (c) => c.get(`/messages/patient/${patient.user._id}`)],
      [b.doctor.token, (c) => c.post(`/messages/patient/${patient.user._id}`, { content: 'answering the merged thread' })],
    ]) {
      const res = await call(as(token));
      assert.equal(res.status, 410, 'a retired direct-message route still answered');
      assert.ok(!JSON.stringify(res.body).includes('An old message'), 'a retired route returned message content');
    }

    assert.equal(await DirectMessage.countDocuments({}), 1, 'retiring the routes lost or added messages');
    assert.equal((await DirectMessage.findById(stored._id).lean()).content, 'An old message to the clinic');
  });
});

describe('V-51: the patient list reads only the listed patients’ profiles', () => {
  test('the profile query is bounded by the practice’s patients', () => {
    // A query-shape check: the list's behaviour was already scoped, and this
    // finding was the read behind it — every patient profile on the platform,
    // on every inbox refresh. Nothing HTTP-visible distinguishes the two.
    const src = readFileSync(fileURLToPath(new URL('../src/routes/doctor.js', import.meta.url)), 'utf8');
    const at = src.indexOf('const matchingProfiles = await PatientProfile.find(');
    assert.ok(at > 0, 'the patient list no longer reads profiles where expected — re-check this test');
    const call = src.slice(at, src.indexOf('.lean()', at));
    assert.match(call, /user:\s*scope\._id/, 'the patient list reads every patient profile on the platform');
  });
});
