import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { KNOWLEDGE_SEED } from '../src/knowledge/seedContent.js';
import {
  SEED_DOC_IDS,
  planBackfill,
  applyBackfill,
} from '../scripts/backfillKnowledgePractice.js';

/**
 * The deploy step for scoping knowledge to its practice.
 *
 * Every passage written through the app was created shared, and the fix makes
 * shared passages read-only from the app. This backfill hands a practice back
 * what it wrote — and must never adopt the seeded clinical content every
 * practice's assistant depends on, or a second practice onboards with an
 * assistant that has nothing to ground on.
 *
 * Tested against a real database, because the whole risk is in which rows the
 * filter selects, and a source-reading test cannot see that.
 */

const chunk = (overrides) =>
  KnowledgeChunk.create({
    title: 'A passage',
    content: 'Twenty or more characters of clinical wording for the test.',
    category: 'general',
    language: 'en',
    status: 'approved',
    ...overrides,
  });

describe('the knowledge backfill', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('knows the seed', () => {
    // Every assertion below leans on this set. Empty, the filter would adopt
    // the platform's own content.
    assert.ok(SEED_DOC_IDS.length > 0, 'no seed docIds found');
    for (const entry of KNOWLEDGE_SEED) assert.ok(SEED_DOC_IDS.includes(entry.docId));
  });

  test('adopts app-written shared passages and leaves seeded ones shared', async () => {
    const practice = await makePractice('Dr Dey Diabetes Care');
    const other = await makePractice('Behala Clinic');

    const seeded = await chunk({ docId: SEED_DOC_IDS[0], practice: null });
    const written = await chunk({ docId: 'dey-clinic-hours', practice: null, category: 'clinic_info' });
    const theirs = await chunk({ docId: 'behala-hours', practice: other._id });

    const plan = await planBackfill();
    assert.deepEqual(plan.adopt.map((c) => c.docId), ['dey-clinic-hours']);
    assert.equal(plan.stayShared, 1);

    assert.equal(await applyBackfill(practice._id), 1);

    assert.equal(String((await KnowledgeChunk.findById(written._id).lean()).practice), String(practice._id));
    assert.equal((await KnowledgeChunk.findById(seeded._id).lean()).practice, null, 'seeded content was adopted');
    assert.equal(
      String((await KnowledgeChunk.findById(theirs._id).lean()).practice),
      String(other._id),
      'a row that already belonged to a practice was moved',
    );
  });

  test('a second run changes nothing', async () => {
    const practice = await makePractice('Dr Dey Diabetes Care');
    await chunk({ docId: 'dey-clinic-hours', practice: null });

    assert.equal(await applyBackfill(practice._id), 1);
    assert.equal(await applyBackfill(practice._id), 0);
    assert.deepEqual((await planBackfill()).adopt, []);
  });

  test('importing the script does not run it', () => {
    // It connects and exits when run. Had `main` fired on import, this file
    // would have lost its database connection before the first test.
    assert.equal(typeof applyBackfill, 'function');
  });
});
