import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { retrieve } from '../src/services/ai/rag.js';

/**
 * What retrieval may ground a patient's answer on, once drafts exist.
 *
 * Approved passages for the conversation's department, approved passages filed
 * under no department, the platform's shared passages and the practice's own —
 * in the patient's language and English. Never a draft, a pending or retired
 * passage, another department's, another practice's, or a third language.
 *
 * Run through the lexical fallback, which shares the filter with both vector
 * paths (departmentAssistant.test.js pins that they all call it): every
 * outbound request is refused, so the embedding call fails the way it does
 * when the provider is unreachable. Ids are passed as strings, the way the
 * conversation resolver hands them over.
 */

const realFetch = globalThis.fetch;
const refuseOutbound = () => Promise.reject(new Error('outbound request refused by this suite'));

let mongod;
const PRACTICE = new mongoose.Types.ObjectId();
const OTHER_PRACTICE = new mongoose.Types.ObjectId();
const CARDIOLOGY = new mongoose.Types.ObjectId();
const DIABETOLOGY = new mongoose.Types.ObjectId();

let n = 0;
function passage(title, overrides = {}) {
  n += 1;
  return KnowledgeChunk.create({
    docId: `scope-${n}`,
    title,
    content: 'Palpitations are when your heartbeat feels like it is racing, pounding or fluttering.',
    category: 'cardiac_symptoms',
    language: 'en',
    status: 'approved',
    practice: null,
    department: null,
    ...overrides,
  });
}

const titles = (chunks) => chunks.map((c) => c.title).sort();

describe('retrieval with drafts in the corpus', () => {
  before(async () => {
    globalThis.fetch = refuseOutbound;
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri('medpin_rag_review_scope'));
    await KnowledgeChunk.init();
  });

  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
    globalThis.fetch = realFetch;
  });

  beforeEach(async () => {
    await KnowledgeChunk.deleteMany({});
    await passage('cardiology approved, shared', { department: CARDIOLOGY });
    await passage('cardiology approved, this practice', { department: CARDIOLOGY, practice: PRACTICE, origin: 'ai_draft' });
    await passage('cross-specialty approved, this practice', { practice: PRACTICE, category: 'clinic_info' });
    await passage('cardiology approved, other practice', { department: CARDIOLOGY, practice: OTHER_PRACTICE });
    await passage('diabetology approved, shared', { department: DIABETOLOGY, category: 'hypertension' });
    await passage('cardiology AI draft, shared', { department: CARDIOLOGY, status: 'pending_review', origin: 'ai_draft' });
    await passage('cardiology draft, this practice', { department: CARDIOLOGY, practice: PRACTICE, status: 'draft' });
    await passage('cardiology retired, this practice', { department: CARDIOLOGY, practice: PRACTICE, status: 'retired' });
    await passage('cardiology approved, Bengali', { department: CARDIOLOGY, language: 'bn' });
    await passage('cardiology approved, Hindi', { department: CARDIOLOGY, language: 'hi' });
  });

  test('a cardiology conversation is grounded on cardiology and cross-specialty guidance, approved, here', async () => {
    const found = titles(
      await retrieve('palpitations heartbeat racing', {
        language: 'en',
        practice: String(PRACTICE),
        department: String(CARDIOLOGY),
        limit: 20,
      }),
    );
    assert.deepEqual(found, [
      'cardiology approved, shared',
      'cardiology approved, this practice',
      'cross-specialty approved, this practice',
    ]);
  });

  test('a Bengali conversation adds Bengali, never Hindi', async () => {
    const found = titles(
      await retrieve('palpitations heartbeat racing', {
        language: 'bn',
        practice: String(PRACTICE),
        department: String(CARDIOLOGY),
        limit: 20,
      }),
    );
    assert.ok(found.includes('cardiology approved, Bengali'));
    assert.ok(found.includes('cardiology approved, shared'), 'English grounding was dropped for Bengali');
    assert.ok(!found.includes('cardiology approved, Hindi'), 'a third language was retrieved');
  });

  test('no draft, pending or retired passage is ever retrieved, whoever asks', async () => {
    for (const opts of [
      { language: 'en' },
      { language: 'en', practice: String(PRACTICE) },
      { language: 'en', practice: String(PRACTICE), department: String(CARDIOLOGY) },
    ]) {
      const found = titles(await retrieve('palpitations heartbeat racing', { ...opts, limit: 50 }));
      for (const title of found) {
        assert.ok(
          !/draft|retired/.test(title),
          `retrieved "${title}" for ${JSON.stringify(opts)}`,
        );
      }
    }
  });

  test('another practice’s approved copy is never retrieved here', async () => {
    const found = titles(
      await retrieve('palpitations heartbeat racing', {
        language: 'en',
        practice: String(PRACTICE),
        department: String(CARDIOLOGY),
        limit: 20,
      }),
    );
    assert.ok(!found.includes('cardiology approved, other practice'));
  });
});
