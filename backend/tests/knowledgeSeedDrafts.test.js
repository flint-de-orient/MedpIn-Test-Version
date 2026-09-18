import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { Department } from '../src/models/Department.js';
import { KnowledgeChunk, KNOWLEDGE_CATEGORIES } from '../src/models/KnowledgeChunk.js';
import { KNOWLEDGE_SEED } from '../src/knowledge/seedContent.js';
import { AI_DRAFT_SEED, AI_DRAFT_SCOPES, DRAFT_STATUS } from '../src/knowledge/aiDrafts.js';
import { SOURCES, SPECIALIST_ACCESSED } from '../src/knowledge/guidanceSources.js';
import { SPECIALIST_EVIDENCE } from '../src/knowledge/specialistEvidence.js';
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
  test('every draft is live and still attributed as AI-drafted, and so is every scope', () => {
    // No approval step: the specialty assistants answer from these. The origin
    // stays, so the knowledge screen shows which passages a machine wrote.
    assert.equal(DRAFT_STATUS, 'approved');
    assert.ok(AI_DRAFT_SEED.length >= 50, `only ${AI_DRAFT_SEED.length} drafts`);
    for (const d of AI_DRAFT_SEED) {
      assert.equal(d.status, 'approved', `${d.docId} is not live`);
      assert.equal(d.origin, 'ai_draft', `${d.docId} is not attributed as AI-drafted`);
    }
    for (const s of AI_DRAFT_SCOPES) {
      assert.equal(s.status, 'approved');
      assert.equal(s.origin, 'ai_draft');
    }
  });

  test('each specialty has a sized set, its red-flag guidance, and a complete scope', () => {
    for (const key of ['cardiology', 'general_physician']) {
      // The English originals. Their translations are counted below.
      const drafts = AI_DRAFT_SEED.filter((d) => d.departmentKey === key && d.language === 'en');
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
      // English, or a translation that names its English original.
      assert.equal(d.language === 'en', !d.translationOf, `${d.docId}: language ${d.language}`);
      assert.ok(d.title && d.content.length > 200, `${d.docId} is too thin`);
    }
    const ids = KNOWLEDGE_SEED.map((e) => e.docId);
    assert.equal(new Set(ids).size, ids.length, 'a draft docId collides');
  });

  test('every English draft has a Bengali and a Hindi version, saying it with the same sources', () => {
    const english = AI_DRAFT_SEED.filter((d) => d.language === 'en');
    for (const d of english) {
      for (const language of ['bn', 'hi']) {
        const t = AI_DRAFT_SEED.find((x) => x.docId === `${d.docId}-${language}`);
        assert.ok(t, `${d.docId} has no ${language} version`);
        assert.equal(t.language, language);
        assert.equal(t.translationOf, d.docId);
        assert.equal(t.departmentKey, d.departmentKey);
        assert.equal(t.category, d.category, `${t.docId} is filed differently from its English`);
        assert.deepEqual(t.sources, d.sources, `${t.docId} cites differently from its English`);
        assert.equal(t.status, d.status);
        assert.equal(t.origin, 'ai_draft');
        // Western digits, so the dose and phone checks below read them.
        assert.ok(!/[০-৯०-९]/.test(t.content), `${t.docId} writes a number in native digits`);
      }
    }
    for (const t of AI_DRAFT_SEED.filter((d) => d.translationOf)) {
      assert.ok(english.some((d) => d.docId === t.translationOf), `${t.docId} translates nothing`);
    }
  });

  test('every heart-specialist citation is backed by the guideline’s own words', () => {
    // Which sources are the specialist guidelines, by the date they were opened.
    const specialist = new Map(
      Object.entries(SOURCES).filter(([, s]) => s.accessed === SPECIALIST_ACCESSED).map(([key, s]) => [s, key]),
    );
    assert.ok(specialist.size >= 5, 'the specialist guidelines are missing');
    let cited = 0;
    for (const d of AI_DRAFT_SEED.filter((x) => x.language === 'en')) {
      for (const s of d.sources) {
        const key = specialist.get(s);
        if (!key) continue;
        cited += 1;
        const evidence = (SPECIALIST_EVIDENCE[d.docId] ?? []).filter((e) => e.source === key);
        assert.ok(evidence.length > 0, `${d.docId} cites ${key} with no quote from it`);
        for (const e of evidence) {
          assert.ok(e.quote.split(/\s+/).length <= 40 && e.location, `${d.docId}: ${key} evidence incomplete`);
        }
      }
    }
    assert.ok(cited >= 25, `only ${cited} specialist citations`);
    // And no evidence is kept for a citation that was not made.
    for (const [docId, entries] of Object.entries(SPECIALIST_EVIDENCE)) {
      const d = AI_DRAFT_SEED.find((x) => x.docId === docId);
      assert.ok(d, `evidence for a passage that does not exist: ${docId}`);
      for (const e of entries) assert.ok(d.sources.includes(SOURCES[e.source]), `${docId} does not cite ${e.source}`);
    }
  });

  test('worsening angina and chest pain that comes and goes go to emergency care, in all three languages', () => {
    // These two told patients to contact the clinic the same day, where ESC
    // guidance treats the same symptoms as possible unstable angina. They were
    // changed before the drafts went live, and must not drift back.
    const text = (docId) => AI_DRAFT_SEED.find((d) => d.docId === docId).content;
    for (const docId of ['cardio-angina', 'cardio-bp-emergency']) {
      assert.match(text(docId), /call an ambulance or go to the nearest hospital emergency department/i);
      assert.doesNotMatch(text(docId), /same day[^.]*chest pain that comes and goes/i, `${docId} sends chest pain to a same-day contact`);
      assert.match(text(`${docId}-bn`), /অ্যাম্বুলেন্স ডাকুন অথবা নিকটতম হাসপাতালের জরুরি বিভাগে/);
      assert.match(text(`${docId}-hi`), /एम्बुलेंस बुलाएं या सबसे नज़दीकी अस्पताल के इमरजेंसी विभाग/);
    }
    assert.doesNotMatch(text('cardio-angina'), /Contact your clinic the same day if your angina/);
    assert.doesNotMatch(text('cardio-angina-bn'), /সেই দিনই আপনার ক্লিনিকে/);
    assert.doesNotMatch(text('cardio-angina-hi'), /उसी दिन अपने क्लिनिक/);
  });

  test('no brand names, no doses, and no phone number but the national quit line', () => {
    // Brand names commonly sold in India for the medicines these passages
    // discuss. A passage that names one is a passage recommending a product.
    const brands = /\b(crocin|dolo|calpol|combiflam|brufen|disprin|ecosprin|clopilet|plavix|eliquis|xarelto|pradaxa|lipitor|atorva|rosuvas|concor|cardace|telma|amlong|lasix|sorbitrate|epipen|augmentin|electral)\b/i;
    // An amount of a medicine is a dose. An amount of salt, sugar or food is
    // not — in the translations' words for them as well as in English, and to
    // the end of the sentence, which Bengali and Hindi close with "।".
    const food = String.raw`\b(salt|sodium|sugar|fruit|vegetables)\b|নুন|লবণ|সোডিয়াম|চিনি|ফল|সবজি|नमक|सोडियम|चीनी|फल|सब्ज़ी|सब्जी`;
    const dose = new RegExp(String.raw`\b\d+(\.\d+)?\s?(mg|mcg|µg|g|ml|units?)\b(?![^.।]*(${food}))`, 'i');
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

  test('drafts and scopes land live; the platform corpus lands approved under diabetology', async () => {
    const counts = await seedOnce();
    assert.equal(counts.created, KNOWLEDGE_SEED.length);
    assert.equal(counts.scopesCreated, 2);

    const drafts = await KnowledgeChunk.find({ origin: 'ai_draft' }).lean();
    assert.equal(drafts.length, AI_DRAFT_SEED.length);
    assert.ok(drafts.every((d) => d.status === 'approved' && d.practice == null && d.department), 'a draft was written not live, owned or unfiled');
    assert.ok(drafts.every((d) => !d.approvedBy), 'a draft was attributed to a person who never approved it');

    const platform = await KnowledgeChunk.find({ origin: 'platform_seed' }).lean();
    const diabetology = await Department.findOne({ key: 'diabetology' }).lean();
    assert.equal(platform.length, PLATFORM.length);
    assert.ok(platform.every((p) => p.status === 'approved' && String(p.department) === String(diabetology._id)));

    for (const key of ['cardiology', 'general_physician']) {
      const scope = (await Department.findOne({ key }).lean()).assistantScope;
      assert.equal(scope.status, 'approved');
      assert.equal(scope.origin, 'ai_draft');
      assert.equal(scope.version, 1);
    }
    // The hand-written diabetology scope was not touched.
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

  test('on a fresh seed the diabetes, cardiology and general-medicine assistants are all on', async () => {
    await seedOnce();
    const statuses = await assistantStatusForPractice({ practiceId: null, language: 'en' });
    const byKey = Object.fromEntries(statuses.map((s) => [s.department.key, s]));

    for (const key of ['diabetology', 'cardiology', 'general_physician']) {
      assert.equal(byKey[key].enabled, true, `${key}: ${byKey[key].reasons}`);
    }
    for (const key of ['cardiology', 'general_physician']) {
      // English, Bengali and Hindi, each specialty's own and nobody else's.
      assert.equal(byKey[key].knowledge.approved.total, AI_DRAFT_SEED.filter((d) => d.departmentKey === key).length);
      assert.equal(byKey[key].knowledge.pending.total, 0);
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

  test('a revised draft gets the new wording and version, and a practice’s copy is not touched', async () => {
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
    assert.equal(after.status, 'approved');
    const copy = await KnowledgeChunk.findOne({ practice, adoptedFrom: shared._id }).lean();
    assert.equal(copy.content, draft.content, 'the seed rewrote a practice’s approved copy');
    assert.equal(copy.status, 'approved');
  });

  test('a draft left waiting from before is made live, and a retired one is left alone', async () => {
    await seedOnce();
    const [first, second] = AI_DRAFT_SEED;
    await KnowledgeChunk.updateOne({ docId: first.docId, practice: null }, { $set: { status: 'pending_review' } });
    await KnowledgeChunk.updateOne({ docId: second.docId, practice: null }, { $set: { status: 'retired' } });

    const plan = await planKnowledgeSeed({ entries: [first, second], scopes: [] });
    await applyKnowledgeSeed(plan, { embedder: null });

    assert.equal((await KnowledgeChunk.findOne({ docId: first.docId, practice: null }).lean()).status, 'approved');
    assert.equal((await KnowledgeChunk.findOne({ docId: second.docId, practice: null }).lean()).status, 'retired');
  });

  test('a revised AI-drafted scope takes the new wording; a scope the seed did not write is never overwritten', async () => {
    await seedOnce();
    const cardiologyScope = AI_DRAFT_SCOPES.find((s) => s.departmentKey === 'cardiology');
    const revised = { ...cardiologyScope, covers: [...cardiologyScope.covers, 'A line added in revision.'] };
    const diabetologyAttempt = { ...cardiologyScope, departmentKey: 'diabetology' };
    const plan = await planKnowledgeSeed({ entries: [], scopes: [revised, diabetologyAttempt] });
    assert.equal(plan.scopes.find((s) => s.departmentKey === 'diabetology').action, 'left_own_scope');
    await applyKnowledgeSeed(plan, { embedder: null });

    const cardiology = (await Department.findOne({ key: 'cardiology' }).lean()).assistantScope;
    assert.equal(cardiology.version, 2);
    assert.ok(cardiology.covers.includes('A line added in revision.'));
    const diabetology = (await Department.findOne({ key: 'diabetology' }).lean()).assistantScope;
    assert.equal(diabetology.role, 'the AI health assistant', 'the hand-written diabetology scope was overwritten');
  });

  test('a scope written before, still waiting, is made live without a new version', async () => {
    await seedOnce();
    await Department.updateOne({ key: 'cardiology' }, { $set: { 'assistantScope.status': 'pending_review' } });
    const plan = await planKnowledgeSeed({ entries: [], scopes: AI_DRAFT_SCOPES });
    await applyKnowledgeSeed(plan, { embedder: null });
    const cardiology = (await Department.findOne({ key: 'cardiology' }).lean()).assistantScope;
    assert.equal(cardiology.status, 'approved');
    assert.equal(cardiology.version, 1);
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
