import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { Department } from '../src/models/Department.js';
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
    await Promise.all([Department.deleteMany({}), KnowledgeChunk.deleteMany({}), Practice.deleteMany({})]);
  });

  test('the floor is ten', () => {
    // Stated here as well as in the code, so changing it is a decision with a
    // test diff rather than an edit nobody reviews.
    assert.equal(MIN_APPROVED_DOCUMENTS, 10);
  });

  test('a scope awaiting review is no assistant, however much knowledge is approved', async () => {
    const cardiology = await department('cardiology', draftScope());
    await approvedCorpus(cardiology, 12);

    const status = await assistantStatus({ department: cardiology.toObject(), practiceId: A });
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'scope_not_approved');
    assert.equal(status.knowledge.approved.forLanguage, 12);
  });

  test('approved for one practice switches it on there and nowhere else', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope({ approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
    );
    await approvedCorpus(cardiology, 10);

    const atA = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(atA.enabled, true, `off at the approving practice: ${atA.reasons}`);
    assert.equal(atA.scope.state, 'approved');

    const atB = await assistantStatus({ departmentId: cardiology._id, practiceId: B });
    assert.equal(atB.enabled, false, 'one practice’s approval switched another practice’s assistant on');
    assert.equal(atB.reason, 'scope_not_approved');

    const platform = await assistantStatus({ departmentId: cardiology._id });
    assert.equal(platform.enabled, false, 'an approval by one practice switched the platform view on');
    assert.equal(platform.scope.practicesApproved, 1);
  });

  test('an approval of earlier wording goes quiet when the scope is revised', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope({ version: 2, approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
    );
    await approvedCorpus(cardiology, 10);

    const status = await assistantStatus({ departmentId: cardiology._id, practiceId: A });
    assert.equal(status.enabled, false);
    assert.equal(status.reason, 'scope_approval_outdated');
  });

  test('nine approved passages is not enough, ten is', async () => {
    const cardiology = await department(
      'cardiology',
      draftScope({ approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
    );
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
      draftScope({ approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
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
      draftScope({ approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
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
      draftScope({
        approvals: [
          { practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() },
          { practice: B, version: 1, approvedBy: DOCTOR, approvedAt: new Date() },
        ],
      }),
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
      draftScope({ approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
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

  test('the diabetology scope is off until this practice approves it, and counts the corpus seeded with no department', async () => {
    // Role, no review status: the remit lifted from the original prompt. It
    // was on for every practice, approved by nobody. It is now reviewed at
    // version 1 like any scope. Its passages were seeded without a department
    // and are still that way until the knowledge seed files them.
    const diabetology = await department('diabetology', { role: 'the AI health assistant', covers: ['Diabetes.'] });
    for (let i = 0; i < 11; i += 1) {
      await passage({ department: null, category: i === 0 ? 'emergency' : 'hypoglycaemia', origin: 'platform_seed' });
    }

    const before = await assistantStatus({ departmentId: diabetology._id, practiceId: A });
    assert.equal(before.enabled, false, 'the diabetes assistant was on with no doctor’s approval');
    assert.equal(before.reason, 'scope_not_approved');
    assert.equal(before.scope.state, 'pending_review');
    assert.equal(before.scope.version, 1);
    assert.equal(before.knowledge.includesCrossSpecialty, true);
    assert.equal(before.knowledge.approved.total, 11, 'the corpus seeded with no department was not counted');

    await Department.updateOne(
      { _id: diabetology._id },
      { $push: { 'assistantScope.approvals': { practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() } } },
    );
    assert.equal((await assistantStatus({ departmentId: diabetology._id, practiceId: A })).enabled, true);
    assert.equal(
      (await assistantStatus({ departmentId: diabetology._id, practiceId: B })).enabled,
      false,
      'one practice’s approval switched the assistant on at another',
    );
  });

  test('a practice’s own department answers only that practice', async () => {
    const own = await department(
      'foot_clinic',
      draftScope({ role: 'the foot clinic assistant', approvals: [{ practice: A, version: 1, approvedBy: DOCTOR, approvedAt: new Date() }] }),
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
    await Promise.all([Department.deleteMany({}), KnowledgeChunk.deleteMany({}), Practice.deleteMany({})]);
  });

  const practiceWith = (specialty) => Practice.create({ name: `Practice ${(n += 1)}`, ...(specialty ? { specialty } : {}) });

  test('a general thread at a practice with no specialty is the diabetology assistant, off until that practice approves', async () => {
    const diabetology = await department('diabetology', { role: 'the AI health assistant' });
    for (let i = 0; i < 10; i += 1) {
      await passage({ department: diabetology._id, category: i === 0 ? 'emergency' : 'insulin', origin: 'platform_seed' });
    }
    const practice = await practiceWith(null);

    const before = await conversationAssistant({ session: { department: null }, practiceId: practice._id });
    assert.equal(before.enabled, false, 'the founding scope answered with no doctor’s approval');
    assert.equal(before.via, 'legacy_default');
    assert.equal(before.reason, 'scope_not_approved');

    await Department.updateOne(
      { _id: diabetology._id },
      { $push: { 'assistantScope.approvals': { practice: practice._id, version: 1, approvedBy: DOCTOR, approvedAt: new Date() } } },
    );
    const answer = await conversationAssistant({ session: { department: null }, practiceId: practice._id });
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

  test('a cardiology practice’s general thread is the cardiology assistant, off until approved', async () => {
    const cardiology = await department('cardiology', draftScope());
    await approvedCorpus(cardiology, 10);
    const practice = await practiceWith('cardiology');

    const before = await conversationAssistant({ session: {}, practiceId: practice._id });
    assert.equal(before.enabled, false, 'a cardiology practice was answered before its scope was approved');
    assert.equal(before.via, 'practice_specialty');
    assert.equal(before.reason, 'scope_not_approved');

    await Department.updateOne(
      { _id: cardiology._id },
      { $push: { 'assistantScope.approvals': { practice: practice._id, version: 1, approvedBy: DOCTOR, approvedAt: new Date() } } },
    );
    const afterApproval = await conversationAssistant({ session: {}, practiceId: practice._id });
    assert.equal(afterApproval.enabled, true, `${afterApproval.reason}`);
    assert.equal(afterApproval.useDepartmentBlock, true);
    assert.equal(String(afterApproval.retrievalDepartment), String(cardiology._id));
  });

  test('a specialty that names no department gets no assistant, not a borrowed one', async () => {
    await department('diabetology', { role: 'the AI health assistant' });
    const practice = await practiceWith('Sports medicine');
    const answer = await conversationAssistant({ session: {}, practiceId: practice._id });
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
    assert.equal(
      (await conversationAssistant({ session: {}, practiceId: practice._id })).enabled,
      false,
      'an endocrine practice was answered before its diabetologist approved',
    );
    await Department.updateOne(
      { _id: diabetology._id },
      { $push: { 'assistantScope.approvals': { practice: practice._id, version: 1, approvedBy: DOCTOR, approvedAt: new Date() } } },
    );
    const answer = await conversationAssistant({ session: {}, practiceId: practice._id });
    assert.equal(answer.enabled, true, `${answer.reason}`);
    assert.equal(answer.useDepartmentBlock, false, 'a diabetology practice lost the prompt it has always had');
  });

  test('a thread that names a department is that department', async () => {
    const cardiology = await department('cardiology', draftScope());
    const answer = await conversationAssistant({ session: { department: cardiology._id }, practiceId: A });
    assert.equal(answer.via, 'thread');
    assert.equal(answer.enabled, false);
    assert.equal(answer.useDepartmentBlock, true);
  });
});
