import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { findSplitConversations } from '../scripts/checkDuplicateConversations.js';

/**
 * Conversations that were split before the index that forbids it existed.
 *
 * The rows are written straight to the collection with the unique index
 * dropped, because that is the only way they can exist now — and precisely how
 * they came to exist in any database that has been running: the index was
 * never built there either.
 */

const patient = () => new mongoose.Types.ObjectId();

async function withoutTheIndex() {
  try {
    await ChatSession.collection.dropIndex('enrollment_1_department_1_kind_1');
  } catch {
    // Not built on this database — which is the state being reproduced.
  }
}

describe('finding a conversation split in two', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await withoutTheIndex();
  });

  test('two sessions for one enrolment are reported, with what each holds', async () => {
    const enrollment = new mongoose.Types.ObjectId();
    const who = patient();

    const [first] = await ChatSession.collection.insertMany([
      { patient: who, enrollment, kind: 'care', createdAt: new Date('2026-08-01') },
      { patient: who, enrollment, kind: 'care', createdAt: new Date('2026-08-02') },
    ]).then((r) => Object.values(r.insertedIds));

    await ChatMessage.collection.insertMany([
      { session: first, patient: who, seq: 0, role: 'user', content: 'one' },
      { session: first, patient: who, seq: 1, role: 'clinician', content: 'two' },
    ]);

    const split = await findSplitConversations();

    assert.equal(split.length, 1);
    assert.equal(split[0].sessions.length, 2);
    assert.deepEqual(
      split[0].sessions.map((s) => s.messages),
      [2, 0],
      'the report does not say which half holds the messages',
    );
  });

  test('one session per enrolment, or none with an enrolment, is not reported', async () => {
    const who = patient();
    await ChatSession.collection.insertMany([
      { patient: who, enrollment: new mongoose.Types.ObjectId(), kind: 'care' },
      { patient: who, enrollment: new mongoose.Types.ObjectId(), kind: 'care' },
      // The older rows have no enrolment and are not the rule's business.
      { patient: who, kind: 'care' },
      { patient: who, kind: 'care' },
    ]);

    assert.deepEqual(await findSplitConversations(), []);
  });

  test('the care and nutrition conversations are separate by design', async () => {
    const enrollment = new mongoose.Types.ObjectId();
    const who = patient();
    await ChatSession.collection.insertMany([
      { patient: who, enrollment, kind: 'care' },
      { patient: who, enrollment, kind: 'nutrition' },
    ]);

    assert.deepEqual(await findSplitConversations(), []);
  });
});
