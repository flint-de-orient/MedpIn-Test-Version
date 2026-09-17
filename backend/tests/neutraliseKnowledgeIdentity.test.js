import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { KNOWLEDGE_SEED } from '../src/knowledge/seedContent.js';
import {
  REWORDINGS,
  CITATION_REWORDINGS,
  reword,
  planNeutralise,
  applyNeutralise,
} from '../scripts/neutraliseKnowledgeIdentity.js';

/**
 * The founding doctor's name, out of the passages every practice's assistant
 * grounds on.
 *
 * Seeded passages are shared: the assistant of any practice may quote "Only
 * Dr. Dey can tell you to change an insulin dose" to that practice's patient.
 * The seed in the repository was rewritten; this deploy step brings the rows
 * already in a database into line — and must leave a practice's own passages,
 * which may rightly name its own doctor, exactly as they are.
 */

const FOUNDING = /Dr\.? (Amit Kumar )?Dey|A\. K\. Dey|ডাঃ দে|डॉ\. दे/;

/** A seed entry as it read before the rewording, rebuilt from the pairs. */
function asItWas(entry) {
  let content = entry.content;
  let sourceCitation = entry.sourceCitation;
  for (const [from, to] of REWORDINGS) content = content.split(to).join(from);
  for (const [from, to] of CITATION_REWORDINGS) {
    if (sourceCitation === to && entry.docId === 'insulin-missed-dose') sourceCitation = from;
  }
  return { ...entry, content, sourceCitation };
}

const insert = (entry, over = {}) =>
  KnowledgeChunk.create({
    docId: entry.docId,
    title: entry.title,
    section: entry.section,
    category: entry.category,
    language: entry.language,
    tags: entry.tags,
    content: entry.content,
    sourceCitation: entry.sourceCitation,
    status: 'approved',
    practice: null,
    ...over,
  });

describe('the seed itself names nobody', () => {
  test('no seeded passage or citation names the founding doctor', () => {
    const named = KNOWLEDGE_SEED.filter(
      (e) => FOUNDING.test(e.content) || FOUNDING.test(e.title ?? '') || FOUNDING.test(e.sourceCitation ?? ''),
    ).map((e) => e.docId);
    assert.deepEqual(named, []);
  });

  test('and every rewording is one the seed actually uses', () => {
    // The pairs are the migration. One whose new wording is not in the seed is
    // a migration that writes text the repository does not contain.
    const all = KNOWLEDGE_SEED.map((e) => `${e.content}\n${e.sourceCitation ?? ''}`).join('\n');
    for (const [from, to] of [...REWORDINGS, ...CITATION_REWORDINGS]) {
      assert.ok(all.includes(to), `the seed does not contain "${to}"`);
      assert.ok(!all.includes(from), `the seed still contains "${from}"`);
    }
  });
});

describe('the rows already in a database', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  const named = () => KNOWLEDGE_SEED.filter((e) => asItWas(e).content !== e.content);

  test('shared seeded passages are reworded to the seed’s words, and nothing else changes', async () => {
    const entries = named();
    assert.ok(entries.length >= 10, `only ${entries.length} seeded passages named the doctor`);

    for (const entry of entries) await insert(asItWas(entry));
    const missed = asItWas(KNOWLEDGE_SEED.find((e) => e.docId === 'insulin-missed-dose'));
    assert.match(missed.sourceCitation, /A\. K\. Dey/, 'the old citation could not be rebuilt');

    const plan = await planNeutralise();
    assert.equal(plan.length, entries.length);
    const written = await applyNeutralise(plan);
    assert.equal(written, entries.length);

    for (const entry of entries) {
      const row = await KnowledgeChunk.findOne({ docId: entry.docId }).lean();
      assert.equal(row.content, entry.content, `${entry.docId} does not read as the seed now does`);
      assert.ok(!FOUNDING.test(row.content));
      assert.ok(!FOUNDING.test(row.sourceCitation ?? ''));
      assert.equal(row.status, 'approved', 'the approval was dropped');
      assert.equal(row.version, 2, 'the change is not visible on the row');
    }
  });

  test('a second run changes nothing', async () => {
    for (const entry of named()) await insert(asItWas(entry));
    await applyNeutralise(await planNeutralise());

    assert.deepEqual(await planNeutralise(), []);
    assert.equal(await applyNeutralise(await planNeutralise()), 0);
  });

  test('a practice’s own passage may name its own doctor and is never touched', async () => {
    const founding = await makePractice('Dey Diabetes Care', { isFounding: true });
    const entry = named()[0];
    const theirs = await insert(asItWas(entry), { docId: 'dey-own-insulin-note', practice: founding._id });

    assert.deepEqual(await planNeutralise(), []);
    await applyNeutralise(await planNeutralise());
    assert.equal((await KnowledgeChunk.findById(theirs._id).lean()).content, asItWas(entry).content);
  });

  test('a passage somebody corrected keeps the correction', async () => {
    const entry = named()[0];
    const old = asItWas(entry);
    const corrected = `${old.content}\n\nA sentence the clinic added later.`;
    await insert({ ...old, content: corrected });

    await applyNeutralise(await planNeutralise());
    const row = await KnowledgeChunk.findOne({ docId: entry.docId }).lean();
    assert.equal(row.content, reword(corrected));
    assert.match(row.content, /A sentence the clinic added later\./);
  });

  test('the dry run writes nothing', async () => {
    const entry = named()[0];
    const before = await insert(asItWas(entry));
    await planNeutralise();
    assert.equal((await KnowledgeChunk.findById(before._id).lean()).content, asItWas(entry).content);
  });
});
