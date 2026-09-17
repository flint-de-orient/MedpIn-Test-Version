import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { Department } from '../src/models/Department.js';
import { KnowledgeChunk, KNOWLEDGE_CATEGORIES } from '../src/models/KnowledgeChunk.js';
import { KNOWLEDGE_SEED } from '../src/knowledge/seedContent.js';
import { AI_DRAFT_SEED, AI_DRAFT_SCOPES } from '../src/knowledge/aiDrafts.js';
import { SOURCES } from '../src/knowledge/guidanceSources.js';
import { planKnowledgeSeed, applyKnowledgeSeed } from '../scripts/seedKnowledge.js';
import { SEED_DOC_IDS } from '../scripts/backfillKnowledgePractice.js';
import { assistantStatusForPractice, RED_FLAG_CATEGORY } from '../src/services/ai/assistantAvailability.js';

/**
 * The AI-drafted cardiology and general-medicine guidance, and the seed that
 * writes it.
 *
 * Two halves. The drafts as written: every one pending review, attributed to an
 * AI, cited to a page with its organisation, year, address and access date, and
 * free of the things patient guidance must never contain. Then the seed, run
 * against a real database: drafts and scopes land in review, the platform corpus
 * lands approved and filed under diabetology as it always was seeded, a second
 * run writes nothing, a dry run writes nothing, and no assistant is switched on.
 */

const PLATFORM = KNOWLEDGE_SEED.filter((e) => e.origin !== 'ai_draft');

describe('the drafts as written', () => {
  test('every draft is pending review and AI-drafted, and so is every scope', () => {
    assert.ok(AI_DRAFT_SEED.length >= 50, `only ${AI_DRAFT_SEED.length} drafts`);
    for (const d of AI_DRAFT_SEED) {
      assert.equal(d.status, 'pending_review', `${d.docId} is not pending review`);
      assert.equal(d.origin, 'ai_draft', `${d.docId} is not attributed as AI-drafted`);
    }
    for (const s of AI_DRAFT_SCOPES) {
      assert.equal(s.status, 'pending_review');
      assert.equal(s.origin, 'ai_draft');
    }
  });

  test('each specialty has a sized set, its red-flag guidance, and a complete scope', () => {
    for (const key of ['cardiology', 'general_physician']) {
      const drafts = AI_DRAFT_SEED.filter((d) => d.departmentKey === key);
      assert.ok(drafts.length >= 25 && drafts.length <= 40, `${key} has ${drafts.length} drafts`);
      assert.ok(drafts.some((d) => d.category === RED_FLAG_CATEGORY), `${key} has no red-flag guidance to approve`);

      const scope = AI_DRAFT_SCOPES.find((s) => s.departmentKey === key);
      assert.ok(scope?.role, `${key} has no scope`);
      for (const field of ['covers', 'refuses', 'redFlags', 'sources']) {
        assert.ok(scope[field].length > 0, `${key} scope has no ${field}`);
      }
    }
  });

  test('every draft cites complete, verifiable sources', () => {
    const known = new Set(Object.values(SOURCES));
    for (const d of AI_DRAFT_SEED) {
      assert.ok(d.sources.length > 0, `${d.docId} cites nothing`);
      for (const s of d.sources) {
        assert.ok(known.has(s), `${d.docId} cites a source not in guidanceSources.js`);
        assert.ok(s.title && s.organisation && s.url && s.accessed, `${d.docId} has an incomplete source`);
        assert.match(s.url, /^https:\/\//, `${d.docId} cites a non-https address`);
        assert.ok(s.year === null || (s.year >= 2020 && s.year <= 2026), `${d.docId} cites year ${s.year}`);
      }
      assert.ok(d.sourceCitation && d.sourceCitation.length <= 500, `${d.docId} has no usable citation line`);
    }
  });

  test('drafts use real categories, are complete enough to review, and never collide with the platform corpus', () => {
    for (const d of AI_DRAFT_SEED) {
      assert.ok(KNOWLEDGE_CATEGORIES.includes(d.category), `${d.docId}: unknown category ${d.category}`);
      assert.equal(d.language, 'en');
      assert.ok(d.title && d.content.length > 200, `${d.docId} is too thin`);
    }
    const ids = KNOWLEDGE_SEED.map((e) => e.docId);
    assert.equal(new Set(ids).size, ids.length, 'a draft docId collides');
  });

  test('no brand names, no doses, and no phone number but the national quit line', () => {
    // Brand names commonly sold in India for the medicines these passages
    // discuss. A passage that names one is a passage recommending a product.
    const brands = /\b(crocin|dolo|calpol|combiflam|brufen|disprin|ecosprin|clopilet|plavix|eliquis|xarelto|pradaxa|lipitor|atorva|rosuvas|concor|cardace|telma|amlong|lasix|sorbitrate|epipen|augmentin|electral)\b/i;
    // An amount of a medicine is a dose.
    const dose = /\b\d+(\.\d+)?\s?(mg|mcg|µg|g|ml|units?)\b(?![^.]*\b(salt|sodium|sugar|fruit|vegetables)\b)/i;
    for (const d of AI_DRAFT_SEED) {
      assert.ok(!brands.test(d.content), `${d.docId} names a brand`);
      assert.ok(!dose.test(d.content), `${d.docId} states an amount that reads as a dose: ${d.content.match(dose)?.[0]}`);
      const phones = d.content.match(/\b\d[\d -]{7,}\d\b/g) ?? [];
      for (const p of phones) {
        assert.equal(p.replace(/\D/g, ''), '1800112356', `${d.docId} contains a phone number: ${p}`);
      }
    }
  });

  test('the platform corpus and the drafts are both in the seed export, so the practice backfill leaves both shared', () => {
    for (const d of AI_DRAFT_SEED) assert.ok(SEED_DOC_IDS.includes(d.docId), `${d.docId} would be adopted by a practice`);
    assert.ok(PLATFORM.length > 0);
  });
});

describe('the knowledge seed', () => {
  let mongod;

  before(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('medpin_knowledge_seed'));
    await Promise.all([KnowledgeChunk.init(), Department.init()]);
  });

  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  beforeEach(async () => {
    await Promise.all([KnowledgeChunk.deleteMany({}), Department.deleteMany({})]);
    await Department.create([
      {
        key: 'diabetology',
        names: { en: 'Diabetes & Endocrinology' },
        isSeed: true,
        assistantScope: { role: 'the AI health assistant', covers: ['Diabetes.'], refuses: ['Dose changes.'] },
      },
      { key: 'cardiology', names: { en: 'Cardiologist' }, isSeed: true },
      { key: 'general_physician', names: { en: 'General Physician' }, isSeed: true },
    ]);
  });

  const seedOnce = async () => applyKnowledgeSeed(await planKnowledgeSeed(), { embedder: null });

  test('a dry run writes nothing', async () => {
    const plan = await planKnowledgeSeed();
    assert.equal(plan.errors.length, 0, plan.errors.join('\n'));
    assert.equal(plan.chunks.filter((c) => c.action === 'create').length, KNOWLEDGE_SEED.length);
    assert.equal(await KnowledgeChunk.countDocuments({}), 0);
    const cardiology = await Department.findOne({ key: 'cardiology' }).lean();
    assert.equal(cardiology.assistantScope?.role ?? null, null);
  });

  test('drafts and scopes land in review; the platform corpus lands approved under diabetology', async () => {
    const counts = await seedOnce();
    assert.equal(counts.created, KNOWLEDGE_SEED.length);
    assert.equal(counts.scopesCreated, 2);

    const drafts = await KnowledgeChunk.find({ origin: 'ai_draft' }).lean();
    assert.equal(drafts.length, AI_DRAFT_SEED.length);
    assert.ok(drafts.every((d) => d.status === 'pending_review' && d.practice == null && d.department), 'a draft was written approved, owned or unfiled');
    assert.ok(drafts.every((d) => !d.approvedBy && !d.approvedAt));

    const platform = await KnowledgeChunk.find({ origin: 'platform_seed' }).lean();
    const diabetology = await Department.findOne({ key: 'diabetology' }).lean();
    assert.equal(platform.length, PLATFORM.length);
    assert.ok(platform.every((p) => p.status === 'approved' && String(p.department) === String(diabetology._id)));

    for (const key of ['cardiology', 'general_physician']) {
      const scope = (await Department.findOne({ key }).lean()).assistantScope;
      assert.equal(scope.status, 'pending_review');
      assert.equal(scope.origin, 'ai_draft');
      assert.equal(scope.version, 1);
      assert.deepEqual(scope.approvals, []);
    }
    // The live diabetology scope was not touched.
    assert.equal(diabetology.assistantScope.status, undefined);
  });

  test('a second run writes nothing', async () => {
    await seedOnce();
    const before = await KnowledgeChunk.find({}).select('updatedAt').lean();
    const plan = await planKnowledgeSeed();
    assert.ok(plan.chunks.every((c) => c.action === 'unchanged'), 'a second run found something to change');
    assert.ok(plan.scopes.every((s) => s.action === 'unchanged'));
    const counts = await applyKnowledgeSeed(plan, { embedder: null });
    assert.equal(counts.created + counts.updated + counts.scopesCreated + counts.scopesUpdated, 0);
    const afterRun = await KnowledgeChunk.find({}).select('updatedAt').lean();
    assert.deepEqual(afterRun.map((r) => String(r.updatedAt)), before.map((r) => String(r.updatedAt)));
  });

  test('on a fresh seed no new assistant is on; diabetology still is', async () => {
    await seedOnce();
    const statuses = await assistantStatusForPractice({ practiceId: null, language: 'en' });
    const byKey = Object.fromEntries(statuses.map((s) => [s.department.key, s]));

    assert.equal(byKey.diabetology.enabled, true, `${byKey.diabetology.reasons}`);
    for (const key of ['cardiology', 'general_physician']) {
      assert.equal(byKey[key].enabled, false, `${key} switched on by seeding`);
      assert.deepEqual(byKey[key].reasons, ['scope_not_approved', 'too_little_approved_knowledge', 'no_approved_red_flag_guidance']);
      assert.equal(byKey[key].knowledge.approved.total, 0);
      assert.equal(byKey[key].knowledge.pending.aiDrafts, AI_DRAFT_SEED.filter((d) => d.departmentKey === key).length);
    }
  });

  test('the corpus seeded before departments existed is filed under diabetology without being re-approved', async () => {
    const entry = PLATFORM[0];
    const approvedAt = new Date('2026-01-01T00:00:00Z');
    await KnowledgeChunk.create({
      docId: entry.docId,
      title: entry.title,
      section: entry.section,
      content: entry.content,
      category: entry.category,
      language: entry.language,
      tags: entry.tags,
      sourceCitation: entry.sourceCitation,
      status: 'approved',
      approvedAt,
      practice: null,
      department: null,
    });

    await seedOnce();
    const row = await KnowledgeChunk.findOne({ docId: entry.docId, practice: null }).lean();
    const diabetology = await Department.findOne({ key: 'diabetology' }).lean();
    assert.equal(String(row.department), String(diabetology._id));
    assert.equal(row.status, 'approved');
    assert.equal(row.approvedAt.toISOString(), approvedAt.toISOString(), 'unchanged wording was re-approved');
  });

  test('a revised draft goes back to review with a new version, and a practice’s copy is not touched', async () => {
    await seedOnce();
    const draft = AI_DRAFT_SEED[0];
    const shared = await KnowledgeChunk.findOne({ docId: draft.docId, practice: null }).lean();
    const practice = new mongoose.Types.ObjectId();
    await KnowledgeChunk.create({
      docId: draft.docId, title: draft.title, content: draft.content, category: draft.category,
      language: 'en', status: 'approved', origin: 'ai_draft', practice,
      department: shared.department, adoptedFrom: shared._id, adoptedVersion: 1,
    });

    const revised = { ...draft, content: `${draft.content}\n\nA sentence added in revision.` };
    const plan = await planKnowledgeSeed({ entries: [revised], scopes: [] });
    await applyKnowledgeSeed(plan, { embedder: null });

    const after = await KnowledgeChunk.findById(shared._id).lean();
    assert.equal(after.version, 2);
    assert.equal(after.status, 'pending_review');
    const copy = await KnowledgeChunk.findOne({ practice, adoptedFrom: shared._id }).lean();
    assert.equal(copy.content, draft.content, 'the seed rewrote a practice’s approved copy');
    assert.equal(copy.status, 'approved');
  });

  test('a draft approved in place is put back to review, and a retired one is left alone', async () => {
    await seedOnce();
    const [first, second] = AI_DRAFT_SEED;
    await KnowledgeChunk.updateOne({ docId: first.docId, practice: null }, { $set: { status: 'approved', approvedAt: new Date() } });
    await KnowledgeChunk.updateOne({ docId: second.docId, practice: null }, { $set: { status: 'retired' } });

    const plan = await planKnowledgeSeed({ entries: [first, second], scopes: [] });
    assert.ok(plan.warnings.some((w) => w.includes(first.docId)));
    await applyKnowledgeSeed(plan, { embedder: null });

    assert.equal((await KnowledgeChunk.findOne({ docId: first.docId, practice: null }).lean()).status, 'pending_review');
    assert.equal((await KnowledgeChunk.findOne({ docId: second.docId, practice: null }).lean()).status, 'retired');
  });

  test('a revised scope lapses approvals of the old wording; a live scope is never overwritten', async () => {
    await seedOnce();
    const practice = new mongoose.Types.ObjectId();
    await Department.updateOne(
      { key: 'cardiology' },
      { $push: { 'assistantScope.approvals': { practice, version: 1, approvedBy: new mongoose.Types.ObjectId(), approvedAt: new Date() } } },
    );

    const cardiologyScope = AI_DRAFT_SCOPES.find((s) => s.departmentKey === 'cardiology');
    const revised = { ...cardiologyScope, covers: [...cardiologyScope.covers, 'A line added in revision.'] };
    const diabetologyAttempt = { ...cardiologyScope, departmentKey: 'diabetology' };
    const plan = await planKnowledgeSeed({ entries: [], scopes: [revised, diabetologyAttempt] });
    assert.equal(plan.scopes.find((s) => s.departmentKey === 'cardiology').approvalsLapsing, 1);
    assert.equal(plan.scopes.find((s) => s.departmentKey === 'diabetology').action, 'left_live_scope');
    await applyKnowledgeSeed(plan, { embedder: null });

    const cardiology = (await Department.findOne({ key: 'cardiology' }).lean()).assistantScope;
    assert.equal(cardiology.version, 2);
    assert.equal(cardiology.approvals.length, 1, 'approvals were deleted rather than left to lapse');
    const diabetology = (await Department.findOne({ key: 'diabetology' }).lean()).assistantScope;
    assert.equal(diabetology.role, 'the AI health assistant', 'the live diabetology scope was overwritten');
  });

  test('without the department, its drafts are not written at all — never filed under no department', async () => {
    await Department.deleteOne({ key: 'general_physician' });
    const plan = await planKnowledgeSeed();
    assert.ok(plan.errors.some((e) => e.includes('general_physician')));
    await applyKnowledgeSeed(plan, { embedder: null });
    assert.equal(await KnowledgeChunk.countDocuments({ origin: 'ai_draft', department: null }), 0);
    assert.equal(
      await KnowledgeChunk.countDocuments({ docId: { $in: AI_DRAFT_SEED.filter((d) => d.departmentKey === 'general_physician').map((d) => d.docId) } }),
      0,
    );
  });

  test('importing the script does not run it', () => {
    assert.equal(typeof planKnowledgeSeed, 'function');
  });
});
