import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { Department } from '../src/models/Department.js';
import { DoctorDepartment } from '../src/models/DoctorDepartment.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';
import { Practice } from '../src/models/Practice.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import {
  MIN_APPROVED_DOCUMENTS,
  assistantStatus,
  assistantStatusForPractice,
  conversationAssistant,
  departmentForSpecialty,
  statusFrom,
} from '../src/services/ai/assistantAvailability.js';

/**
 * Is the assistant on for this department, here, in this language — run
 * against a real database, because every way this goes wrong is a filter that
 * selects the wrong rows, and a test that reads the source cannot see a row.
 *
 * The rule under test: an approved scope for this practice, at least
 * MIN_APPROVED_DOCUMENTS approved passages for the department retrievable here
 * in the conversation's grounding languages, and among them the department's
 * approved red-flag guidance. Anything less is no assistant.
 */

let mongod;
let n = 0;

const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();
const DOCTOR = new mongoose.Types.ObjectId();

function draftScope(extra = {}) {
  return {
    role: 'the cardiology assistant',
    covers: ['High blood pressure.'],
    refuses: ['Dose changes.'],
    redFlags: ['Chest pain that does not go away.'],
    status: 'pending_review',
    origin: 'ai_draft',
    version: 1,
    approvals: [],
    ...extra,
  };
}

async function department(key, assistantScope = null, extra = {}) {
  return Department.create({
    key,
    names: { en: key },
    ...(assistantScope ? { assistantScope } : {}),
    ...extra,
  });
}

function passage({ department: dept = null, practice = null, status = 'approved', language = 'en', category = 'hypertension', origin = 'ai_draft', ...extra } = {}) {
  n += 1;
  return KnowledgeChunk.create({
    docId: `passage-${n}`,
    title: `Passage ${n}`,
    content: 'Twenty or more characters of approved patient guidance for the test.',
    category,
    language,
    status,
    origin,
    practice,
    department: dept,
    ...extra,
  });
}

/** `count` approved passages for a department, one of them its red-flag guidance. */
async function approvedCorpus(dept, count, { practice = null, language = 'en', redFlag = true } = {}) {
  for (let i = 0; i < count; i += 1) {
    await passage({
      department: dept._id,
      practice,
      language,
      category: redFlag && i === 0 ? 'emergency' : 'hypertension',
    });
  }
}

/**
 * A general conversation whose patient has an assigned doctor at this practice,
 * placed in `department` or in none. A patient with no assigned doctor has no
 * doctor's chat and no assistant, so every conversation that expects one needs
 * this.
 */
async function assignedConversation(practice, { department: dept = null } = {}) {
  const doctor = new mongoose.Types.ObjectId();
  await Membership.create({
    user: doctor,
    practice: practice._id,
    role: ROLES.DOCTOR,
    status: MEMBERSHIP_STATUS.ACTIVE,
    ...(dept ? { department: dept._id } : {}),
  });
  const enrollment = await Enrollment.create({
    patient: new mongoose.Types.ObjectId(),
    practice: practice._id,
    status: ENROLLMENT_STATUS.ACTIVE,
    primaryDoctor: doctor,
  });
  return { department: null, enrollment: enrollment._id, patient: enrollment.patient };
}

describe('whether a department’s assistant is on', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('medpin_assistant_availability'));
    await Promise.all([Department.init(), KnowledgeChunk.init(), Practice.init()]);
  });

  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([Department.deleteMany({}), KnowledgeChunk.deleteMany({}), Practice.deleteMany({}), Enrollment.deleteMany({}), Membership.deleteMany({}), DoctorDepartment.deleteMany({})]);
  });

  test('the floor is ten', () => {
    // Stated here as well as in the code, so changing it is a decision with a
    // test diff rather than an edit nobody reviews.
    assert.equal(MIN_APPROVED_DOCUMENTS, 10);
  });

  test('a written scope with its knowledge is an assistant — there is no approval step', async () => {
    // Whether it answers one conversation is the clinicians' toggle on that
    // conversation; see httpAssistantToggle.test.js.
    const cardiology = await department('cardiology', draftScope());
    await approvedCorpus(cardiology, 12);

    for (const practiceId of [A, B, null]) {
      const status = await assistantStatus({ department: cardiology.toObject(), practiceId });
      assert.equal(status.enabled, true, `${practiceId}: ${status.reasons}`);
      assert.equal(status.scope.state, 'live');
    }
  });

  test('a practice’s own approved passages count for it and nowhere else', async () => {
    const cardiology = await department('cardiology', draftScope());
    await approvedCorpus(cardiology, 10, { practice: A });

    assert.equal((await assistantStatus({ departmentId: cardiology._id, practiceId: A })).enabled, true);
    const atB = await assistantStatus({ departmentId: cardiology._id, practiceId: B });
    assert.equal(atB.enabled, false, 'one practice’s own guidance switched another practice’s assistant on');
    assert.equal(atB.reason, 'too_little_approved_knowledge');
  });

  test('a retired scope is no assistant anywhere', async () => {
    const cardiology = await department('cardiology', draftScope({ status: 'retired' }));
    await approvedCorpus(cardiology, 10);

    const status = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'scope_retired');
  });

  test('nine approved passages is not enough, ten is', async () => {
    const cardiology = await department('cardiology', draftScope());
    await approvedCorpus(cardiology, MIN_APPROVED_DOCUMENTS - 1);

    const nine = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(nine.enabled, false);
    assert.deepEqual(nine.reasons, ['too_little_approved_knowledge']);

    await passage({ department: cardiology._id });
    const ten = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(ten.enabled, true, `${ten.reasons}`);
  });

  test('without its approved red-flag guidance a department stays off', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope(),
    );
    await approvedCorpus(cardiology, 15, { redFlag: false });
    // Written, but not approved: it does not count.
    await passage({ department: cardiology._id, category: 'emergency', status: 'pending_review' });

    const status = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(status.enabled, false);
    assert.deepEqual(status.reasons, ['no_approved_red_flag_guidance']);
  });

  test('pending, draft and retired passages, other departments and cross-specialty passages do not count', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope(),
    );
    const other = await department('general_physician', draftScope({ role: 'the general medicine assistant' }));
    await passage({ department: cardiology._id, category: 'emergency' });
    for (let i = 0; i < 4; i += 1) {
      await passage({ department: cardiology._id, status: 'pending_review' });
      await passage({ department: cardiology._id, status: 'draft' });
      await passage({ department: cardiology._id, status: 'retired' });
      await passage({ department: other._id });
      // A clinic's opening hours must not help switch a cardiology assistant on.
      await passage({ department: null, practice: A, category: 'clinic_info', origin: 'clinician' });
    }

    const status = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(status.knowledge.approved.forLanguage, 1);
    assert.equal(status.knowledge.pending.total, 8);
    assert.equal(status.knowledge.retired, 4);
    assert.equal(status.enabled, false);
  });

  test('another practice’s approved copies are never counted here', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope(),
    );
    await approvedCorpus(cardiology, 12, { practice: B });

    const atA = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(atA.knowledge.approved.total, 0, 'practice B’s approved passages counted at practice A');
    assert.equal(atA.enabled, false);

    const atB = await assistantStatus({ departmentId: cardiology._id, practiceId: B });
    assert.equal(atB.enabled, true, `${atB.reasons}`);
  });

  test('a Bengali conversation is grounded on Bengali and English; Hindi alone does not switch English on', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope(),
    );
    await approvedCorpus(cardiology, 10, { language: 'hi' });

    const english = await assistantStatus({ departmentId: cardiology._id, practiceId: A, language: 'en' });
    assert.equal(english.enabled, false, 'Hindi-only guidance switched an English conversation on');
    assert.deepEqual(english.knowledge.groundingLanguages, ['en']);

    const hindi = await assistantStatus({ departmentId: cardiology._id, practiceId: A, language: 'hi' });
    assert.equal(hindi.enabled, true);
    assert.deepEqual(hindi.knowledge.groundingLanguages, ['hi', 'en']);

    const bengali = await assistantStatus({ departmentId: cardiology._id, practiceId: A, language: 'bn' });
    assert.equal(bengali.enabled, false, 'Hindi guidance switched a Bengali conversation on');
    assert.deepEqual(bengali.knowledge.approved.byLanguage, { en: 0, bn: 0, hi: 10 });
  });

  test('the diabetology scope answers with no approval step, counting the corpus seeded with no department', async () => {
    // Role, no review status: the remit lifted from the original prompt. Its
    // passages were seeded without a department and are still that way until
    // the knowledge seed files them under diabetology.
    const diabetology = await department('diabetology', { role: 'the AI health assistant', covers: ['Diabetes.'] });
    for (let i = 0; i < 11; i += 1) {
      await passage({ department: null, category: i === 0 ? 'emergency' : 'hypoglycaemia', origin: 'platform_seed' });
    }

    const status = await assistantStatus({ departmentId: diabetology._id, practiceId: A });
    assert.equal(status.enabled, true, `${status.reasons}`);
    assert.equal(status.scope.state, 'live');
    assert.equal(status.knowledge.includesCrossSpecialty, true);
    assert.equal(status.knowledge.approved.total, 11, 'the corpus seeded with no department was not counted');
  });

  test('a practice’s own department answers only that practice', async () => {
    const own = await department(
      'foot_clinic',
      draftScope({ role: 'the foot clinic assistant' }),
      { practice: A },
    );
    await approvedCorpus(own, 10, { practice: A });

    assert.equal((await assistantStatus({ departmentId: own._id, practiceId: A })).enabled, true);
    const elsewhere = await assistantStatus({ departmentId: own._id, practiceId: B });
    assert.equal(elsewhere.enabled, false);
    assert.equal(elsewhere.reason, 'no_department');
    assert.equal(elsewhere.department, null, 'another practice’s department was described');
  });

  test('a shared draft this practice has copied is counted once, as the copy', async () => {
    const cardiology = await department('cardiology', draftScope());
    const shared = await passage({ department: cardiology._id, status: 'pending_review' });
    await passage({ department: cardiology._id, status: 'pending_review' });
    await passage({ department: cardiology._id, practice: A, adoptedFrom: shared._id, adoptedVersion: 1 });

    const [status] = await assistantStatusForPractice({ practiceId: A });
    assert.equal(status.knowledge.approved.total, 1);
    assert.equal(status.knowledge.pending.total, 1, 'the copied draft was still counted as waiting');
  });

  test('statusFrom is the rule, with nothing to query', () => {
    const dept = { _id: new mongoose.Types.ObjectId(), key: 'x', names: { en: 'X' }, assistantScope: {} };
    const status = statusFrom(dept, [], { practiceId: null, language: 'en' });
    assert.equal(status.enabled, false);
    assert.deepEqual(status.reasons, ['no_scope', 'too_little_approved_knowledge', 'no_approved_red_flag_guidance']);
  });
});

describe('which department a conversation is', () => {
  before(async () => {
    if (mongoose.connection.readyState === 0) {
      mongod = await MongoMemoryServer.create();
      await mongoose.connect(mongod.getUri('medpin_assistant_conversation'));
    }
  });

  after(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
      await mongod.stop();
    }
  });

  beforeEach(async () => {
    await Promise.all([Department.deleteMany({}), KnowledgeChunk.deleteMany({}), Practice.deleteMany({}), Enrollment.deleteMany({}), Membership.deleteMany({}), DoctorDepartment.deleteMany({})]);
  });

  const practiceWith = (specialty) => Practice.create({ name: `Practice ${(n += 1)}`, ...(specialty ? { specialty } : {}) });

  test('a doctor in no department at a practice with no specialty is the diabetology assistant, with its prompt', async () => {
    const diabetology = await department('diabetology', { role: 'the AI health assistant' });
    for (let i = 0; i < 10; i += 1) {
      await passage({ department: diabetology._id, category: i === 0 ? 'emergency' : 'insulin', origin: 'platform_seed' });
    }
    const practice = await practiceWith(null);

    const session = await assignedConversation(practice);
    const answer = await conversationAssistant({ session, practiceId: practice._id });
    assert.equal(answer.enabled, true, `${answer.reason}`);
    assert.equal(answer.via, 'legacy_default');
    assert.equal(answer.useDepartmentBlock, false, 'the founding clinic’s prompt would change');
    assert.equal(String(answer.retrievalDepartment), String(diabetology._id));
  });

  test('and with no department rows at all, it does not answer', async () => {
    const answer = await conversationAssistant({ session: {}, practiceId: null });
    assert.equal(answer.enabled, false, 'an assistant answered with nothing approved anywhere');
    assert.equal(answer.retrievalDepartment, null);
  });

  test('a doctor in no department at a cardiology practice is a cardiologist, once the guidance is there', async () => {
    const cardiology = await department('cardiology', draftScope());
    const practice = await practiceWith('cardiology');
    const session = await assignedConversation(practice);

    const before = await conversationAssistant({ session, practiceId: practice._id });
    assert.equal(before.enabled, false, 'a cardiology practice was answered with no cardiology guidance');
    assert.equal(before.via, 'practice_specialty');
    assert.equal(before.reason, 'too_little_approved_knowledge');

    await approvedCorpus(cardiology, 10);
    const answer = await conversationAssistant({ session, practiceId: practice._id });
    assert.equal(answer.enabled, true, `${answer.reason}`);
    assert.equal(answer.useDepartmentBlock, true);
    assert.equal(String(answer.retrievalDepartment), String(cardiology._id));
  });

  test('a specialty that names no department gets no assistant, not a borrowed one', async () => {
    await department('diabetology', { role: 'the AI health assistant' });
    const practice = await practiceWith('Sports medicine');
    const answer = await conversationAssistant({ session: await assignedConversation(practice), practiceId: practice._id });
    assert.equal(answer.enabled, false);
    assert.equal(answer.reason, 'specialty_has_no_department');
  });

  test('every endocrine spelling resolves to diabetology and keeps its prompt', async () => {
    const diabetology = await department('diabetology', { role: 'the AI health assistant' }, { names: { en: 'Diabetes & Endocrinology' } });
    for (const spelling of ['diabetology', 'Diabetes & Endocrinology', 'endocrinology', 'metabolic medicine']) {
      const found = await departmentForSpecialty(spelling);
      assert.equal(String(found?._id), String(diabetology._id), `"${spelling}" did not resolve`);
    }

    for (let i = 0; i < 10; i += 1) {
      await passage({ department: diabetology._id, category: i === 0 ? 'emergency' : 'insulin', origin: 'platform_seed' });
    }
    const practice = await practiceWith('Diabetes & Endocrinology');
    const answer = await conversationAssistant({ session: await assignedConversation(practice), practiceId: practice._id });
    assert.equal(answer.enabled, true, `${answer.reason}`);
    assert.equal(answer.useDepartmentBlock, false, 'a diabetology practice lost the prompt it has always had');
  });

  describe('the patient’s own doctor decides the specialty', () => {
    const PATIENT = () => new mongoose.Types.ObjectId();

    async function clinic({ specialty = null } = {}) {
      const practice = await practiceWith(specialty);
      const cardiology = await department('cardiology', draftScope());
      const gp = await department('general_physician', draftScope({ role: 'the general medicine assistant' }));
      const derm = await department('dermatology');
      const diabetology = await department('diabetology', { role: 'the AI health assistant' });
      for (const d of [cardiology, gp, diabetology]) await approvedCorpus(d, 10);
      return { practice, cardiology, gp, derm, diabetology };
    }

    async function doctorIn(practice, { department: dept = null, rows = [], left = false } = {}) {
      const doctor = new mongoose.Types.ObjectId();
      await Membership.create({
        user: doctor,
        practice: practice._id,
        role: ROLES.DOCTOR,
        status: MEMBERSHIP_STATUS.ACTIVE,
        ...(left ? { endedOn: new Date() } : {}),
        ...(dept ? { department: dept._id } : {}),
      });
      for (const r of rows) {
        await DoctorDepartment.create({ doctor, practice: practice._id, department: r.department._id, isPrimary: Boolean(r.isPrimary) });
      }
      return doctor;
    }

    const enrol = (practice, primaryDoctor = null) =>
      Enrollment.create({
        patient: PATIENT(),
        practice: practice._id,
        status: ENROLLMENT_STATUS.ACTIVE,
        ...(primaryDoctor ? { primaryDoctor } : {}),
      });

    const answerFor = (enrollment, practice) =>
      conversationAssistant({
        session: { department: null, enrollment: enrollment._id, patient: enrollment.patient },
        practiceId: practice._id,
      });

    beforeEach(async () => {
      await Promise.all([Enrollment.deleteMany({}), Membership.deleteMany({}), DoctorDepartment.deleteMany({})]);
    });

    test('at one practice, a cardiologist’s patient gets cardiology and a GP’s patient gets general medicine', async () => {
      const w = await clinic();
      const cardiologist = await doctorIn(w.practice, { department: w.cardiology });
      const physician = await doctorIn(w.practice, { rows: [{ department: w.gp, isPrimary: true }] });

      const heart = await answerFor(await enrol(w.practice, cardiologist), w.practice);
      assert.equal(heart.via, 'doctor');
      assert.equal(heart.department.key, 'cardiology');
      assert.equal(heart.enabled, true, `${heart.reason}`);
      assert.equal(heart.useDepartmentBlock, true);

      const general = await answerFor(await enrol(w.practice, physician), w.practice);
      assert.equal(general.department.key, 'general_physician');
      assert.equal(general.enabled, true, `${general.reason}`);
    });

    test('a patient with no assigned doctor has no doctor’s chat, and no assistant', async () => {
      for (const specialty of ['cardiology', null]) {
        await Promise.all([Department.deleteMany({}), KnowledgeChunk.deleteMany({})]);
        const w = await clinic({ specialty });
        const answer = await answerFor(await enrol(w.practice), w.practice);
        assert.equal(answer.enabled, false, `an unassigned patient was answered (${specialty ?? 'no specialty'})`);
        assert.equal(answer.via, 'no_doctor');
        assert.equal(answer.reason, 'no_assigned_doctor');
        assert.equal(answer.retrievalDepartment, null);
      }
    });

    test('a doctor placed in a specialty with no assistant gets none, not the diabetes one', async () => {
      const w = await clinic();
      const dermatologist = await doctorIn(w.practice, { department: w.derm });
      const answer = await answerFor(await enrol(w.practice, dermatologist), w.practice);
      assert.equal(answer.via, 'doctor');
      assert.equal(answer.enabled, false, 'a skin patient was answered by another specialty’s assistant');
      assert.equal(answer.reason, 'no_scope');
      assert.equal(answer.retrievalDepartment, null);
    });

    test('a patient whose doctor has left the practice has no doctor here, and no assistant', async () => {
      const w = await clinic({ specialty: 'general_physician' });
      const gone = await doctorIn(w.practice, { department: w.cardiology, left: true });
      const answer = await answerFor(await enrol(w.practice, gone), w.practice);
      assert.equal(answer.enabled, false);
      assert.equal(answer.reason, 'no_assigned_doctor');
    });

    test('a practice not yet written to asks the same question, from the enrolment', async () => {
      const w = await clinic();
      const cardiologist = await doctorIn(w.practice, { department: w.cardiology });
      const enrollment = await enrol(w.practice, cardiologist);
      const answer = await conversationAssistant({ session: null, enrollmentId: enrollment._id, practiceId: w.practice._id });
      assert.equal(answer.department.key, 'cardiology');
    });
  });

  test('a thread that names a department is that department', async () => {
    const cardiology = await department('cardiology', draftScope());
    const answer = await conversationAssistant({ session: { department: cardiology._id }, practiceId: A });
    assert.equal(answer.via, 'thread');
    assert.equal(answer.enabled, false);
    assert.equal(answer.useDepartmentBlock, true);
  });
});
