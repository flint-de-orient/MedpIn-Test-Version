import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { routeToDieticians } from '../src/services/notifications.js';

/**
 * Who gets woken up when a patient writes to the nutrition thread.
 *
 * The clinic ran with one dietician for months, where "tell the dieticians"
 * and "tell the dietician" were the same sentence. A second one arrived and
 * both were pushed every message — two people reading the same question, and
 * neither sure whether the other was answering it.
 *
 * These cover the rule itself. The queries that feed it are in
 * `dieticiansFor`; what is worth pinning down is the decision.
 */
const A = { _id: 'aaa' };
const B = { _id: 'bbb' };
const C = { _id: 'ccc' };

describe('routing a patient message to dieticians', () => {
  test('one dietician covering gets everything', () => {
    // The setup the app launched with. It was never wrong and must not change.
    assert.deepEqual(
      routeToDieticians({ pool: [A], lastReplierId: null, urgency: 'routine' }),
      [A],
    );
  });

  test('one dietician still gets everything when they are already in it', () => {
    assert.deepEqual(
      routeToDieticians({ pool: [A], lastReplierId: 'aaa', urgency: 'routine' }),
      [A],
    );
  });

  test('no dieticians at all is nobody, not an error', () => {
    assert.deepEqual(
      routeToDieticians({ pool: [], lastReplierId: null, urgency: 'routine' }),
      [],
    );
  });

  test('two dieticians and nobody has answered yet: both hear about it', () => {
    // Nobody owns this patient, so the message cannot be routed. Everyone
    // covering hears it and the first to reply takes it.
    assert.deepEqual(
      routeToDieticians({ pool: [A, B], lastReplierId: null, urgency: 'routine' }),
      [A, B],
    );
  });

  test('two dieticians and one is already in the conversation: only them', () => {
    // The bug this was written for.
    assert.deepEqual(
      routeToDieticians({ pool: [A, B], lastReplierId: 'bbb', urgency: 'routine' }),
      [B],
    );
  });

  test('three dieticians route to the one holding the conversation', () => {
    assert.deepEqual(
      routeToDieticians({ pool: [A, B, C], lastReplierId: 'ccc', urgency: 'advice' }),
      [C],
    );
  });

  test('an urgent message reaches everyone covering', () => {
    // Ownership is a courtesy. It must never be the reason nobody hears about
    // chest pain because the dietician who usually answers is off today.
    assert.deepEqual(
      routeToDieticians({ pool: [A, B], lastReplierId: 'aaa', urgency: 'urgent' }),
      [A, B],
    );
  });

  test('an emergency reaches everyone covering', () => {
    assert.deepEqual(
      routeToDieticians({ pool: [A, B, C], lastReplierId: 'bbb', urgency: 'emergency' }),
      [A, B, C],
    );
  });

  test('an owner who has left the covering pool does not swallow the message', () => {
    // The dietician who used to answer this patient has since been given their
    // own restricted list, so they are no longer covering the clinic. Routing
    // to them alone would send it nowhere.
    assert.deepEqual(
      routeToDieticians({ pool: [A, B], lastReplierId: 'zzz', urgency: 'routine' }),
      [A, B],
    );
  });

  test('an id that arrives as an object still matches', () => {
    // Mongo hands back ObjectIds, not strings, and === between two of them is
    // false however equal they are.
    const objectish = { toString: () => 'bbb' };
    assert.deepEqual(
      routeToDieticians({
        pool: [A, { _id: objectish }],
        lastReplierId: 'bbb',
        urgency: 'routine',
      }).length,
      1,
    );
  });

  test('a missing urgency is treated as routine, not as urgent', () => {
    // The caller may not have triaged. Defaulting the other way would put the
    // fan-out back for every untriaged message.
    assert.deepEqual(
      routeToDieticians({ pool: [A, B], lastReplierId: 'aaa', urgency: null }),
      [A],
    );
  });
});
