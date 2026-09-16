import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { nextMessageSeq } from '../src/services/chatSequence.js';

/**
 * Two people writing into one conversation at the same moment.
 *
 * Every writer used to work out its message's position as "the highest so far,
 * plus one", against a unique `(session, seq)` index. The second of two
 * simultaneous writers was refused with a duplicate key — a 409 the sender saw
 * as a failure to send — and the message was not written. The assistant, which
 * claimed the patient's message plus one after a model call lasting seconds,
 * lost its reply whenever a clinician answered first.
 */

let practice;
let doctor;
let desk;
let patient;
let session;

describe('a conversation written to by several people at once', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    /*
     * Both unique indexes are part of what is being tested: the message position
     * and the one-conversation-per-enrolment rule, because eight replies to a
     * conversation that is not yet bound to the enrolment race to bind or create
     * it. Mongoose builds indexes in the background once per process, and on a
     * loaded machine that build was still running when the replies arrived —
     * which reproduces a database that never had the index, not this release.
     */
    await ChatSession.createIndexes();
    await ChatMessage.createIndexes();

    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });

    session = await ChatSession.create({ patient: patient.user._id, kind: 'care', language: 'en' });
    await ChatMessage.create({
      session: session._id,
      patient: patient.user._id,
      seq: 0,
      role: 'user',
      content: 'Is it safe to take my tablet before the blood test?',
    });
  });

  test('every reply sent at the same moment is written', async () => {
    const replies = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        as((n % 2 ? desk : doctor).token).post(
          `/chat/patients/${patient.user._id}/clinician-message`,
          { content: `Reply ${n}` },
        ),
      ),
    );

    const statuses = replies.map((r) => r.status);
    assert.deepEqual(statuses, Array(8).fill(201), `a reply was refused: ${statuses.join(', ')}`);

    const written = await ChatMessage.find({ session: session._id }).select('seq').lean();
    assert.equal(written.length, 9, 'a reply that was answered as sent is not in the conversation');
    assert.equal(new Set(written.map((m) => m.seq)).size, 9, 'two messages share a position');
  });

  test('the allocator carries on from the messages already there', async () => {
    // Existing conversations have messages numbered by the old code. The first
    // number drawn must follow the last one, not restart at zero on top of it.
    await ChatMessage.create({
      session: session._id,
      patient: patient.user._id,
      seq: 41,
      role: 'clinician',
      sender: doctor.user._id,
      content: 'Yes, but drink water.',
    });

    assert.equal(await nextMessageSeq(session._id), 42);
    assert.equal(await nextMessageSeq(session._id), 43);
  });

  test('and a brand-new conversation starts at zero', async () => {
    const fresh = await ChatSession.create({ patient: patient.user._id, kind: 'nutrition', language: 'en' });
    assert.equal(await nextMessageSeq(fresh._id), 0);
  });
});

describe('the first replies to a patient nobody has written to yet', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    // Both indexes are part of what is being tested, and Mongoose builds them
    // once per process against whichever database connected first.
    await ChatSession.createIndexes();
    await ChatMessage.createIndexes();

    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  });

  test('all land in one conversation, not several', async () => {
    /*
     * Every request looks for the enrolment's conversation, finds none, and
     * creates one. With nothing refusing the second — the unique index meant
     * to was never built — eight at once made up to eight conversations, each
     * holding one reply, and the patient's thread with the practice split into
     * pieces with 201 on every request.
     */
    const { sessionForEnrolment } = await import('../src/services/conversationPractice.js');
    const enrollment = patient.enrollments[0];

    const sessions = await Promise.all(
      Array.from({ length: 8 }, () =>
        sessionForEnrolment({ patientId: patient.user._id, enrollment, kind: 'care' }),
      ),
    );

    const ids = new Set(sessions.map((s) => String(s._id)));
    assert.equal(ids.size, 1, `one enrolment was given ${ids.size} conversations`);
    assert.equal(
      await ChatSession.countDocuments({ patient: patient.user._id, enrollment: enrollment._id }),
      1,
    );
  });
});
