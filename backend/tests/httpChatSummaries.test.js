import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES, User } from '../src/models/User.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../src/models/Membership.js';
import { useMessagingForTests } from '../src/config/firebase.js';
import { sendChatDigests } from '../src/services/chatDigest.js';
import { Department } from '../src/models/Department.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { mergeModelSummary, rulesSummary, clinicDay, conversationDay } from '../src/services/ai/chatSummary.js';

/**
 * The day's conversations, summarised for the clinicians they did not interrupt.
 *
 * A doctor is pushed emergencies and high-risk alerts about their own patients
 * and nothing else. What that leaves unread is a day of routine conversation —
 * the question the assistant declined, the request to be seen, the patient
 * nobody has taken on. These are the promises the summary makes about it:
 *
 *   - a doctor's list is the patients they answer for, and the patients nobody
 *     answers for, never a colleague's; the practice view is everyone who wrote
 *     to this practice and nothing said to another;
 *   - what needs a clinician is said without a model, and a model cannot talk
 *     it down;
 *   - every point cites a message from that patient's conversation with this
 *     practice;
 *   - a review is one person's, and a message written after it undoes it;
 *   - somebody who may not see patients is refused, and another practice gets
 *     not found;
 *   - the evening push tells the people who decide how many wrote and how many
 *     are waiting on them, and never a name or a word of what was written.
 *
 * Model calls are refused in this file, so every summary here is the rules one.
 * What the model may add is tested on its own, below.
 */

const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

let w;

async function say(session, patient, role, content, { sender = null, urgency = 'routine', redFlags = [], action = null } = {}) {
  const seq = (await ChatMessage.countDocuments({ session: session._id })) + 1;
  const m = await ChatMessage.create({
    session: session._id,
    patient,
    seq,
    role,
    sender: sender ?? undefined,
    content,
    triage: { urgency, redFlags },
    ...(action ? { action } : {}),
  });
  await ChatSession.updateOne({ _id: session._id }, { $inc: { messageCount: 1 }, $set: { lastMessageAt: new Date() } });
  return m;
}

async function world() {
  const practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  const mine = await makeMember(practice, { name: 'Dr Mine', isOwner: true });
  const colleague = await makeMember(practice, { name: 'Dr Colleague' });
  const manager = await makeMember(practice, { name: 'Salt Lake Manager', role: ROLES.PRACTICE_MANAGER });

  const other = await makePractice('Behala', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  const otherDoctor = await makeMember(other, { name: 'Dr Behala', isOwner: true });

  const patient = async (name, { primaryDoctor = null, practices = [practice] } = {}) => {
    const p = await makePatient({ name, practices, primaryDoctor });
    await PatientProfile.create({ user: p.user._id });
    return p;
  };
  const conversation = async (p, at) => {
    const enrollment = await Enrollment.findOne({ patient: p.user._id, practice: at._id });
    return ChatSession.create({ patient: p.user._id, kind: 'care', enrollment: enrollment._id });
  };

  // Answered for by this doctor.
  const dizzy = await patient('Dizzy Patient', { primaryDoctor: mine.user });
  const dizzyChat = await conversation(dizzy, practice);
  await say(dizzyChat, dizzy.user._id, 'user', 'My sugar was 280 this morning and I feel dizzy', {
    urgency: 'urgent',
    redFlags: ['Very high sugar with symptoms'],
  });
  await say(dizzyChat, dizzy.user._id, 'assistant', 'Please contact the clinic today.');

  // Answered for by a colleague.
  const booking = await patient('Booking Patient', { primaryDoctor: colleague.user });
  const bookingChat = await conversation(booking, practice);
  await say(bookingChat, booking.user._id, 'user', 'Can I get an appointment tomorrow?');
  await say(bookingChat, booking.user._id, 'assistant', 'The desk will give you a time.', {
    action: { kind: 'appointment_request' },
  });

  // Answered for by nobody at the practice.
  const unassigned = await patient('Unassigned Patient');
  const unassignedChat = await conversation(unassigned, practice);
  await say(unassignedChat, unassigned.user._id, 'user', 'Thank you for the diet chart');
  await say(unassignedChat, unassigned.user._id, 'assistant', 'You are welcome.');

  // Cared for by both practices, and wrote only to Behala today.
  const shared = await patient('Shared Patient', { practices: [practice, other] });
  const sharedChat = await conversation(shared, other);
  await say(sharedChat, shared.user._id, 'user', 'Behala only words about my knee');

  // Cared for by both practices, and wrote to each of them today. Nobody at
  // either practice answers for them.
  const both = await patient('Both Patient', { practices: [practice, other] });
  const bothChat = await conversation(both, practice);
  await say(bothChat, both.user._id, 'user', 'Salt Lake words about my feet');
  await say(await conversation(both, other), both.user._id, 'user', 'Behala words about my eyes');

  return {
    practice,
    mine,
    colleague,
    manager,
    other,
    otherDoctor,
    dizzy,
    dizzyChat,
    booking,
    unassigned,
    unassignedChat,
    shared,
    both,
    bothChat,
  };
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

const named = (body, name) => body.items.find((i) => i.patient?.name === name);

describe('a clinician’s day of conversations', () => {
  lifecycle();

  test('a doctor’s list is the patients they answer for and those nobody does, worst first', async () => {
    const res = await as(w.mine.token).get('/chat-summaries');
    assert.equal(res.status, 200);
    const names = res.body.items.map((i) => i.patient.name);

    assert.equal(names[0], 'Dizzy Patient', 'the patient triage marked urgent is not first');
    assert.ok(names.includes('Unassigned Patient'), 'a patient nobody answers for reached nobody');
    assert.ok(!names.includes('Booking Patient'), 'a colleague’s patient was listed as this doctor’s');

    const dizzy = res.body.items[0];
    assert.equal(dizzy.needsDoctor, true);
    assert.ok(dizzy.reasons.some((r) => r.startsWith('Urgent by triage')), 'the triage verdict is missing from the reasons');
    assert.equal(res.body.counts.patients, names.length);
    assert.equal(res.body.counts.needsDoctor, res.body.items.filter((i) => i.needsDoctor).length);
  });

  test('the practice view is everyone who wrote to this practice, and nothing said to another', async () => {
    const res = await as(w.mine.token).get('/chat-summaries?scope=practice');
    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.items.map((i) => i.patient.name).sort(),
      ['Booking Patient', 'Both Patient', 'Dizzy Patient', 'Unassigned Patient'],
    );
    assert.ok(!allText(res.body).includes('Behala'), 'a message to another practice was summarised here');
    assert.ok(allText(res.body).includes('Salt Lake words'), 'what a shared patient said to this practice is missing');
  });

  test('a request to be seen needs the doctor, with no model to write it up', async () => {
    const res = await as(w.colleague.token).get('/chat-summaries');
    const booking = named(res.body, 'Booking Patient');
    assert.ok(booking, 'the colleague’s own patient is missing');
    assert.equal(booking.needsDoctor, true);
    assert.ok(booking.reasons.includes('Asked to be seen'));
    assert.equal(booking.source, 'rules', 'with the model unreachable the summary claimed a model wrote it');
  });

  test('every point cites a message from that patient’s conversation', async () => {
    const res = await as(w.mine.token).get('/chat-summaries?scope=practice');
    for (const item of res.body.items) {
      const ids = item.points.flatMap((p) => p.messageIds);
      assert.ok(ids.length > 0, `${item.patient.name}’s summary cites nothing`);
      const cited = await ChatMessage.find({ _id: { $in: ids } }).lean();
      assert.equal(cited.length, new Set(ids).size, 'a point cites a message that does not exist');
      assert.ok(
        cited.every((m) => String(m.patient) === item.patient.id),
        'a point cites another patient’s message',
      );
      assert.ok(
        cited.every((m) => !m.content.includes('Behala')),
        'a point cites what the patient said to another practice',
      );
    }
  });

  test('one patient’s summary sits at the top of their conversation', async () => {
    const res = await as(w.mine.token).get(`/chat-summaries/patients/${w.dizzy.user._id}?days=2`);
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 1, 'a day with nothing said was summarised');
    assert.equal(res.body.items[0].day, clinicDay());
  });
});

describe('who may read a summary, and who has read it', () => {
  lifecycle();

  test('another practice gets its own conversations and cannot reach this practice’s', async () => {
    const theirs = await as(w.otherDoctor.token).get('/chat-summaries?scope=practice');
    assert.equal(theirs.status, 200);
    assert.deepEqual(theirs.body.items.map((i) => i.patient.name).sort(), ['Both Patient', 'Shared Patient']);
    assert.ok(!allText(theirs.body).includes('Dizzy'), 'another practice read this practice’s patients');
    assert.ok(!allText(theirs.body).includes('Salt Lake words'), 'another practice read what a shared patient said here');

    const list = await as(w.mine.token).get('/chat-summaries?scope=practice');
    const dizzy = named(list.body, 'Dizzy Patient');

    const peek = await as(w.otherDoctor.token).get(`/chat-summaries/patients/${w.dizzy.user._id}`);
    assert.notEqual(peek.status, 200, 'another practice opened a patient’s summary');
    assert.ok(!allText(peek.body).includes('dizzy'));

    const mark = await as(w.otherDoctor.token).post(`/chat-summaries/${dizzy.id}/reviewed`, {});
    assert.equal(mark.status, 404, 'another practice marked this practice’s summary reviewed');
  });

  test('a patient no longer enrolled here is not summarised here, whatever they said elsewhere', async () => {
    await Enrollment.updateOne(
      { patient: w.both.user._id, practice: w.practice._id },
      { $set: { status: ENROLLMENT_STATUS.REVOKED, revokedAt: new Date() } },
    );
    const res = await as(w.mine.token).get('/chat-summaries?scope=practice');
    assert.equal(res.status, 200);
    assert.ok(!res.body.items.some((i) => i.patient.name === 'Both Patient'), 'a patient who withdrew was still summarised');
    assert.ok(!allText(res.body).includes('Behala'), 'what they said to another practice was read here');
  });

  test('a day is never read without the enrolment it belongs to', async () => {
    // With no enrolment the relationship filter answers with every conversation
    // the patient has, at every practice.
    const messages = await conversationDay({ patientId: w.both.user._id, enrollment: null, day: clinicDay() });
    assert.deepEqual(messages, [], 'with no enrolment the day was read from every practice');
  });

  test('somebody who may not see patients is refused', async () => {
    const res = await as(w.manager.token).get('/chat-summaries');
    assert.equal(res.status, 403);

    // The permission, not the role: a doctor whose grant was narrowed is refused too.
    const narrowed = presetFor({ role: ROLES.DOCTOR, isOwner: false }).filter((p) => p !== PERMISSIONS.VIEW_PATIENT);
    await Membership.updateOne({ _id: w.colleague.membership._id }, { $set: { permissions: narrowed } });
    const doctor = await as(w.colleague.token).get('/chat-summaries');
    assert.equal(doctor.status, 403, 'a doctor whose grant does not include seeing patients read the day');
  });

  test('a review is one person’s, and a message written after it undoes it', async () => {
    let list = await as(w.mine.token).get('/chat-summaries?scope=practice');
    const item = named(list.body, 'Unassigned Patient');
    assert.equal((await as(w.mine.token).post(`/chat-summaries/${item.id}/reviewed`, {})).status, 204);

    list = await as(w.mine.token).get('/chat-summaries?scope=practice');
    assert.equal(named(list.body, 'Unassigned Patient').reviewed, true);
    assert.equal(list.body.counts.reviewed, 1);

    const colleague = await as(w.colleague.token).get('/chat-summaries?scope=practice');
    assert.equal(named(colleague.body, 'Unassigned Patient').reviewed, false, 'one doctor’s review was counted as another’s');

    await say(w.unassignedChat, w.unassigned.user._id, 'user', 'One more question about lunch?');
    list = await as(w.mine.token).get('/chat-summaries?scope=practice');
    const after = named(list.body, 'Unassigned Patient');
    assert.equal(after.reviewed, false, 'a review still stood after the patient wrote again');
    assert.ok(allText(after).includes('One more question'), 'the summary did not take in the new message');
  });
});

describe('the evening push', () => {
  lifecycle();

  // One device each, so every push can be traced to the person it reached.
  const devices = {
    mine: 'device-mine',
    colleague: 'device-colleague',
    manager: 'device-manager',
    otherDoctor: 'device-behala',
  };
  let pushes;

  beforeEach(async () => {
    pushes = [];
    useMessagingForTests({
      async sendEachForMulticast(message) {
        pushes.push(message);
        return {
          responses: message.tokens.map(() => ({ success: true })),
          successCount: message.tokens.length,
          failureCount: 0,
        };
      },
    });
    for (const [who, token] of Object.entries(devices)) {
      await User.updateOne({ _id: w[who].user._id }, { $set: { deviceTokens: [token] } });
    }
  });
  after(() => useMessagingForTests(null));

  const bodiesTo = (who) => pushes.filter((p) => p.tokens.includes(devices[who])).map((p) => p.notification.body);

  test('each doctor hears how many of their patients wrote and how many need them, and nothing else', async () => {
    const day = clinicDay();
    const { sent } = await sendChatDigests(day);

    assert.deepEqual(bodiesTo('mine'), ['3 patients wrote today. 2 need you.']);
    assert.deepEqual(bodiesTo('colleague'), ['3 patients wrote today. 2 need you.']);
    assert.deepEqual(
      bodiesTo('otherDoctor'),
      ['2 patients wrote today. 2 need you.'],
      'a practice was told about conversations with another',
    );
    assert.deepEqual(bodiesTo('manager'), [], 'somebody who may not see patients was told about them');
    assert.equal(sent, 3);

    // It reaches a lock screen: a count, never a name or a word of what was said.
    for (const push of pushes) {
      assert.equal(push.data.kind, 'chat_digest');
      assert.equal(push.data.day, day);
      const said = JSON.stringify(push);
      for (const word of ['Dizzy', 'Booking', 'Unassigned', 'Shared', 'Both', '280', 'knee', 'feet', 'eyes']) {
        assert.ok(!said.includes(word), `a push said “${word}”`);
      }
    }
  });

  test('a day one doctor has read is no longer waiting on them, until the patient writes again', async () => {
    const list = await as(w.mine.token).get('/chat-summaries');
    const both = named(list.body, 'Both Patient');
    assert.equal((await as(w.mine.token).post(`/chat-summaries/${both.id}/reviewed`, {})).status, 204);

    await sendChatDigests(clinicDay());
    assert.deepEqual(
      bodiesTo('mine'),
      ['3 patients wrote today. 1 needs you.'],
      'a day the doctor had read was still waiting on them',
    );
    assert.deepEqual(
      bodiesTo('colleague'),
      ['3 patients wrote today. 2 need you.'],
      'one doctor’s reading was counted as another’s',
    );

    await say(w.bothChat, w.both.user._id, 'user', 'And now my ankles are swollen');
    pushes.length = 0;
    await sendChatDigests(clinicDay());
    assert.deepEqual(
      bodiesTo('mine'),
      ['3 patients wrote today. 2 need you.'],
      'a reading still stood after the patient wrote again',
    );
  });

  test('a clinician whose grant does not let them decide hears nothing', async () => {
    const narrowed = presetFor({ role: ROLES.DOCTOR, isOwner: false }).filter((p) => p !== PERMISSIONS.PRESCRIBE);
    await Membership.updateOne({ _id: w.colleague.membership._id }, { $set: { permissions: narrowed } });

    await sendChatDigests(clinicDay());
    assert.deepEqual(bodiesTo('colleague'), [], 'a doctor who may not prescribe was sent what needs a decision');
    assert.equal(bodiesTo('mine').length, 1);
  });

  test('a doctor no longer active at the practice answers for nobody, and hears nothing', async () => {
    await Membership.updateOne({ _id: w.colleague.membership._id }, { $set: { status: MEMBERSHIP_STATUS.SUSPENDED } });

    await sendChatDigests(clinicDay());
    assert.deepEqual(bodiesTo('colleague'), [], 'a suspended doctor was sent the practice’s day');
    assert.deepEqual(
      bodiesTo('mine'),
      ['4 patients wrote today. 3 need you.'],
      'the patients of a doctor who is no longer active reached nobody',
    );
  });
});

describe('a clinician in a department', () => {
  lifecycle();

  // A thread carries the department a patient wrote to. Chat review narrows a
  // clinician in a department to that department's threads and the ones no
  // department has taken; the day's summaries and the evening push narrow the
  // same way, or the push counts patients the list will not show.
  async function departments() {
    const [cardiology, diabetology] = await Department.create([
      { practice: w.practice._id, key: 'cardiology', names: { en: 'Cardiology' } },
      { practice: w.practice._id, key: 'diabetology', names: { en: 'Diabetology' } },
    ]);
    const cardio = await makeMember(w.practice, { name: 'Dr Cardio', department: cardiology._id });

    const writeTo = async (name, department, words) => {
      const p = await makePatient({ name, practices: [w.practice] });
      await PatientProfile.create({ user: p.user._id });
      const enrollment = await Enrollment.findOne({ patient: p.user._id, practice: w.practice._id });
      const chat = await ChatSession.create({
        patient: p.user._id,
        kind: 'care',
        enrollment: enrollment._id,
        department: department._id,
      });
      await say(chat, p.user._id, 'user', words);
    };
    await writeTo('Heart Patient', cardiology, 'My heart flutters at night');
    await writeTo('Sugar Patient', diabetology, 'My sugar drops every evening');
    return { cardio };
  }

  test('reads the threads their department answers and the ones no department has taken', async () => {
    const { cardio } = await departments();

    const theirs = (await as(cardio.token).get('/chat-summaries?scope=practice')).body.items.map((i) => i.patient.name);
    assert.ok(theirs.includes('Heart Patient'), 'the department’s own conversation is missing');
    assert.ok(theirs.includes('Dizzy Patient'), 'a conversation no department has taken was hidden from a department');
    assert.ok(!theirs.includes('Sugar Patient'), 'another department’s conversation was listed');

    const everyone = (await as(w.mine.token).get('/chat-summaries?scope=practice')).body.items.map((i) => i.patient.name);
    assert.ok(
      everyone.includes('Sugar Patient') && everyone.includes('Heart Patient'),
      'a clinician in no department lost a department’s conversation',
    );
  });

  test('is pushed about the threads their department answers and the ones no department has taken', async () => {
    const { cardio } = await departments();
    const pushes = [];
    useMessagingForTests({
      async sendEachForMulticast(message) {
        pushes.push(message);
        return {
          responses: message.tokens.map(() => ({ success: true })),
          successCount: message.tokens.length,
          failureCount: 0,
        };
      },
    });
    try {
      await User.updateOne({ _id: cardio.user._id }, { $set: { deviceTokens: ['device-cardio'] } });
      await User.updateOne({ _id: w.mine.user._id }, { $set: { deviceTokens: ['device-mine'] } });

      await sendChatDigests(clinicDay());
      const bodiesTo = (token) => pushes.filter((p) => p.tokens.includes(token)).map((p) => p.notification.body);

      // Nobody answers for Unassigned, Both, Heart or Sugar; cardiology reaches
      // the first three. Of those, Both and Heart were not answered.
      assert.deepEqual(
        bodiesTo('device-cardio'),
        ['3 patients wrote today. 2 need you.'],
        'the push counted another department’s conversation',
      );
      assert.deepEqual(bodiesTo('device-mine'), ['5 patients wrote today. 4 need you.']);
    } finally {
      useMessagingForTests(null);
    }
  });
});

describe('what the model may and may not change', () => {
  const ids = ['a1', 'a2', 'a3'];
  const rules = {
    overview: '2 messages from the patient; no reply from the clinic yet.',
    reasons: ['Urgent by triage: chest tightness'],
    needsDoctor: true,
    points: [{ kind: 'symptom', text: 'My chest feels tight', messageIds: ['a1'] }],
  };

  test('a point that cites nothing in this conversation is dropped', () => {
    const merged = mergeModelSummary({
      json: {
        overview: 'Chest tightness this morning.',
        needsDoctor: true,
        points: [
          { kind: 'symptom', text: 'Chest tightness', messageIds: ['a1'] },
          { kind: 'medication', text: 'Stopped aspirin', messageIds: ['someone-else'] },
          { kind: 'concern', text: 'Worried', messageIds: [] },
        ],
      },
      rules,
      messageIds: ids,
    });
    assert.deepEqual(merged.points.map((p) => p.text), ['Chest tightness']);
  });

  test('the model cannot clear what the rules found', () => {
    const merged = mergeModelSummary({
      json: { overview: 'Nothing to worry about.', needsDoctor: false, reasons: [], points: [] },
      rules,
      messageIds: ids,
    });
    assert.equal(merged.needsDoctor, true, 'the model talked down a day triage flagged');
    assert.ok(merged.reasons.includes('Urgent by triage: chest tightness'));
    assert.deepEqual(merged.points, rules.points, 'with nothing cited, the rules’ points should stand');
  });

  test('but it can add a reason the rules could not see', () => {
    const merged = mergeModelSummary({
      json: {
        overview: 'Stopped a tablet because of stomach upset.',
        needsDoctor: true,
        reasons: ['Stopped metformin'],
        points: [{ kind: 'medication', text: 'Stopped metformin for stomach upset', messageIds: ['a2'] }],
      },
      rules: { ...rules, reasons: [], needsDoctor: false },
      messageIds: ids,
    });
    assert.equal(merged.needsDoctor, true);
    assert.deepEqual(merged.reasons, ['Stopped metformin']);
  });

  test('an unusable answer leaves the rules summary alone', () => {
    assert.equal(mergeModelSummary({ json: null, rules, messageIds: ids }), null);
    assert.equal(mergeModelSummary({ json: { points: [] }, rules, messageIds: ids }), null);
  });
});

describe('what can be said without a model', () => {
  const at = new Date();
  const message = (id, role, content, extra = {}) => ({ _id: id, role, content, createdAt: at, triage: { urgency: 'routine' }, ...extra });

  test('nobody replying at all is a reason, an assistant reply is not', () => {
    const answered = rulesSummary([message('m1', 'user', 'thanks'), message('m2', 'assistant', 'welcome')]);
    assert.equal(answered.needsDoctor, false);

    const unheard = rulesSummary([message('m1', 'user', 'is anyone there?')]);
    assert.equal(unheard.needsDoctor, true);
    assert.ok(unheard.reasons.some((r) => r.includes('no reply')));
  });

  test('a clinician’s reply closes what came before it', () => {
    const summary = rulesSummary([
      message('m1', 'user', 'my feet hurt'),
      message('m2', 'clinician', 'Come in on Monday'),
    ]);
    assert.equal(summary.unansweredCount, 0);
  });

  test('the patient flagging an answer and the assistant failing both need a clinician', () => {
    const flagged = rulesSummary([message('m1', 'user', 'what dose?'), message('m2', 'assistant', 'Take two', { flaggedByPatient: true })]);
    assert.ok(flagged.reasons.includes('The patient flagged an answer as wrong'));

    const failed = rulesSummary([message('m1', 'user', 'what dose?'), message('m2', 'assistant', 'unavailable', { isFallback: true })]);
    assert.ok(failed.reasons.includes('The assistant could not answer'));
  });
});
