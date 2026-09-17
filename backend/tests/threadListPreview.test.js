import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { Membership } from '../src/models/Membership.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * The patient's list of conversations, read the way any messaging app is: who
 * it is with, what was said last and when, and how many messages they have not
 * seen.
 */

const minutesAgo = (n) => new Date(Date.now() - n * 60_000);

describe('a patient’s conversation list', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  let seq = 0;
  const say = (session, role, content, extra = {}) =>
    ChatMessage.create({
      session: session._id,
      patient: session.patient,
      seq: ++seq,
      role,
      content,
      ...extra,
    });

  async function setUp({ named = true } = {}) {
    const practice = await makePractice('Salt Lake Clinic', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const doctor = await makeMember(practice, { name: 'Dr Meera Sen' });
    const patient = await makePatient({ name: 'Arshad', practices: [practice], primaryDoctor: named ? doctor.user : null });
    const session = await ChatSession.create({
      patient: patient.user._id,
      kind: 'care',
      language: 'en',
      enrollment: patient.enrollments[0]._id,
    });
    return { practice, doctor, patient, session };
  }

  const rowOf = async (patient) => {
    const res = await as(patient.token).get('/chat/threads');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const group = res.body.groups[0];
    return { group, thread: group.threads[0] };
  };

  test('shows the doctor, the last message and when it was sent', async () => {
    const { doctor, patient, session } = await setUp();
    await say(session, 'user', 'hi', { createdAt: minutesAgo(10) });
    const reply = await say(session, 'clinician', '  Take the evening dose\n after food. ', {
      sender: doctor.user._id,
      createdAt: minutesAgo(5),
    });

    const { group, thread } = await rowOf(patient);
    assert.equal(group.doctor.name, 'Dr Meera Sen');
    assert.equal(group.doctor.avatarUrl, null);
    assert.equal(group.practice.name, 'Salt Lake Clinic');
    assert.deepEqual(
      { ...thread.lastMessage, at: new Date(thread.lastMessage.at).getTime() },
      {
        role: 'clinician',
        senderName: 'Dr Meera Sen',
        deleted: false,
        text: 'Take the evening dose after food.',
        attachment: null,
        at: reply.createdAt.getTime(),
      },
    );
  });

  test('a practice not written to yet says whether its assistant would answer', async () => {
    // A general physician's practice whose assistant nobody has approved: the
    // first message there gets no reply, and the empty conversation must not
    // say otherwise.
    const gp = await makePractice('Behala GP', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
      specialty: 'general_physician',
    });
    const patient = await makePatient({ name: 'Rina', practices: [gp] });
    const res = await as(patient.token).get('/chat/threads');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.groups[0].threads, []);
    assert.equal(res.body.groups[0].newConversationHasAssistant, false);

    // A practice with a conversation leaves it to the thread.
    await wipe();
    const { patient: withThread } = await setUp();
    assert.equal((await rowOf(withThread)).group.newConversationHasAssistant, null);
  });

  test('a practice without a named doctor, or whose doctor has left, is shown as the practice', async () => {
    const unnamed = await setUp({ named: false });
    assert.equal((await rowOf(unnamed.patient)).group.doctor, null);

    await wipe();
    const { doctor, patient } = await setUp();
    await Membership.updateOne({ _id: doctor.membership._id }, { $set: { endedOn: new Date() } });
    assert.equal((await rowOf(patient)).group.doctor, null, 'a doctor who left is still shown');
  });

  test('reading clears the count, and what arrives afterwards counts again', async () => {
    const { doctor, patient, session } = await setUp();
    await say(session, 'user', 'hi', { createdAt: minutesAgo(30) });
    await say(session, 'assistant', 'Hello, how can I help?', { createdAt: minutesAgo(29) });
    const reply = await say(session, 'clinician', 'Please come in on Monday.', {
      sender: doctor.user._id,
      createdAt: minutesAgo(20),
    });

    // Never read here before: the doctor's reply since the patient last wrote.
    assert.equal((await rowOf(patient)).thread.unreadCount, 1);

    const read = await as(patient.token).post(`/chat/threads/${session._id}/read`, { upTo: reply.createdAt.toISOString() });
    assert.equal(read.status, 204, JSON.stringify(read.body));
    assert.equal((await rowOf(patient)).thread.unreadCount, 0);

    // Once reads are recorded the assistant's messages count too.
    await say(session, 'assistant', 'A reminder about your appointment.', { createdAt: minutesAgo(2) });
    await say(session, 'clinician', 'See you then.', { sender: doctor.user._id, createdAt: minutesAgo(1) });
    assert.equal((await rowOf(patient)).thread.unreadCount, 2);
  });

  test('a message deleted for everyone is not counted and its words are not previewed', async () => {
    const { doctor, patient, session } = await setUp();
    await say(session, 'user', 'hi', { createdAt: minutesAgo(10) });
    await say(session, 'clinician', 'Wrong patient — ignore', {
      sender: doctor.user._id,
      createdAt: minutesAgo(5),
      deletedForEveryoneAt: minutesAgo(4),
    });

    const { thread } = await rowOf(patient);
    assert.equal(thread.unreadCount, 0);
    assert.equal(thread.lastMessage.deleted, true);
    assert.equal(thread.lastMessage.text, '');
  });

  test('a message the patient hid is neither previewed nor counted', async () => {
    const { doctor, patient, session } = await setUp();
    await say(session, 'user', 'hi', { createdAt: minutesAgo(10) });
    await say(session, 'clinician', 'Hidden by the patient', {
      sender: doctor.user._id,
      createdAt: minutesAgo(5),
      hiddenFor: [patient.user._id],
    });

    const { thread } = await rowOf(patient);
    assert.equal(thread.unreadCount, 0);
    assert.equal(thread.lastMessage.text, 'hi');
    assert.equal(thread.lastMessage.role, 'user');
  });

  test('a photo with no caption is named by what it is', async () => {
    const { patient, session } = await setUp();
    const photo = await MediaAsset.create({
      owner: patient.user._id,
      uploadedBy: patient.user._id,
      kind: 'meal_photo',
      storageKey: 'test/plate.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    });
    await say(session, 'user', '', { attachments: [photo._id], createdAt: minutesAgo(1) });

    const { thread } = await rowOf(patient);
    assert.equal(thread.lastMessage.attachment, 'photo');
    assert.equal(thread.lastMessage.text, '');
  });

  test('the read marker only moves forward, never past now, and only on the patient’s own conversation', async () => {
    const { patient, session } = await setUp();
    const stored = async () => (await ChatSession.findById(session._id).lean()).patientReadAt;

    const future = new Date(Date.now() + 24 * 3_600_000);
    assert.equal((await as(patient.token).post(`/chat/threads/${session._id}/read`, { upTo: future.toISOString() })).status, 204);
    const first = await stored();
    assert.ok(first <= new Date(), 'the marker was set in the future');

    await as(patient.token).post(`/chat/threads/${session._id}/read`, { upTo: minutesAgo(60).toISOString() });
    assert.equal((await stored()).getTime(), first.getTime(), 'the marker moved backwards');

    const other = await makePatient({ name: 'Somebody else' });
    assert.equal((await as(other.token).post(`/chat/threads/${session._id}/read`, {})).status, 404);
  });
});
