import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { retrieve } from '../src/services/ai/rag.js';

/**
 * The lexical fallback searches the same corpus the vector search does.
 *
 * ---- What was wrong ------------------------------------------------------
 *
 * Both vector backends narrow by practice and department before ranking. The
 * text search they fall back to when embedding fails — an outage, a rate limit,
 * a key that has run out — searched every approved passage on the platform.
 * So for as long as the embedding call was failing, one practice's patients
 * were grounded on, and shown the titles of, another practice's private
 * guidance.
 *
 * `departmentAssistant.test.js` pins the two vector paths. Nothing pinned this
 * one, because it only runs when something else has already gone wrong.
 *
 * ---- How the fallback is reached here ----------------------------------
 *
 * Every outbound request is refused, so the embedding call fails exactly as it
 * does when the provider is unreachable, and retrieval takes the text path.
 */

const realFetch = globalThis.fetch;
const refuseOutbound = () => Promise.reject(new Error('outbound request refused by this suite'));

let mongod;
const A = new mongoose.Types.ObjectId();
const B = new mongoose.Types.ObjectId();
const CARDIOLOGY = new mongoose.Types.ObjectId();

let n = 0;
function passage(title, { practice = null, department = null } = {}) {
  n += 1;
  return KnowledgeChunk.create({
    docId: `retinopathy-${n}`,
    title,
    content: 'Retinopathy screening every year protects your eyesight when you live with diabetes.',
    category: 'eye_care',
    language: 'en',
    status: 'approved',
    practice,
    department,
  });
}

const titles = (chunks) => chunks.map((c) => c.title);

describe('the retrieval fallback stays inside the practice', () => {
  before(async () => {
    globalThis.fetch = refuseOutbound;
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('medpin_rag_fallback'));
    // The text index the fallback depends on. Built explicitly: a query that
    // failed for want of an index would be a different test.
    await KnowledgeChunk.init();
  });

  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    globalThis.fetch = realFetch;
  });

  beforeEach(async () => {
    await KnowledgeChunk.deleteMany({});
    await passage('Shared retinopathy guide');
    await passage('Salt Lake retinopathy clinic hours', { practice: A });
    await passage('Behala retinopathy clinic hours', { practice: B });
  });

  test('a practice’s patient is grounded on shared guidance and their own practice’s, never another’s', async () => {
    const found = titles(await retrieve('retinopathy screening', { language: 'en', practice: A }));

    assert.ok(found.includes('Shared retinopathy guide'), 'the shared passage was not found at all');
    assert.ok(found.includes('Salt Lake retinopathy clinic hours'));
    assert.ok(!found.includes('Behala retinopathy clinic hours'), 'another practice’s passage was retrieved');
  });

  test('asked with no practice, only shared guidance answers', async () => {
    const found = titles(await retrieve('retinopathy screening', { language: 'en' }));

    assert.deepEqual(found, ['Shared retinopathy guide']);
  });

  test('and a department’s passages stay in that department', async () => {
    await passage('Cardiology retinopathy note', { practice: A, department: CARDIOLOGY });

    const elsewhere = titles(
      await retrieve('retinopathy screening', { language: 'en', practice: A, department: new mongoose.Types.ObjectId() }),
    );
    assert.ok(!elsewhere.includes('Cardiology retinopathy note'), 'another department’s passage was retrieved');

    const there = titles(await retrieve('retinopathy screening', { language: 'en', practice: A, department: CARDIOLOGY }));
    assert.ok(there.includes('Cardiology retinopathy note'));
  });
});
