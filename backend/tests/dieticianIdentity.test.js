import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dieticianFacingPatient } from '../src/services/dieticianIdentity.js';

/**
 * Who the patient sees at the top of their nutrition thread.
 *
 * These exist because this function shipped inside a route where nothing could
 * reach it, using a model it had not imported. The result was a ReferenceError
 * on every call, so every newly registered patient opened their dietician tab
 * to "Could not load the conversation" — their whole thread lost to a lookup
 * that only decides whose name to print at the top of it.
 *
 * So two things are pinned here: the rule, and the promise that getting the
 * rule wrong can never again cost a patient their messages.
 */

/** A stub that answers one findOne with [value] and records what it was asked. */
function model(value) {
  const calls = [];
  const chain = {
    select: () => chain,
    sort: () => chain,
    lean: async () => value,
  };
  return {
    calls,
    findOne: (q) => {
      calls.push(q);
      return chain;
    },
  };
}

function throwingModel(message = 'connection lost') {
  return {
    findOne: () => {
      throw new Error(message);
    },
  };
}

const ASSIGNED = { _id: 'dietA', name: 'Priya Nair', avatarAssetId: 'img1' };
const REPLIER = { _id: 'dietB', name: 'Anita Bose', avatarAssetId: null };

describe('the dietician a patient is shown', () => {
  test('an explicit assignment wins', async () => {
    const out = await dieticianFacingPatient('p1', {
      PatientProfile: model({ assignedDietician: 'dietA' }),
      User: model(ASSIGNED),
      ChatSession: model(null),
      ChatMessage: model(null),
    });

    assert.equal(out.name, 'Priya Nair');
    assert.equal(out.assigned, true);
    assert.equal(out.avatarUrl, '/api/v1/uploads/img1/raw');
  });

  test('with nobody assigned, whoever has been replying', async () => {
    // Not a lesser answer. With no assignment, the person who has been writing
    // back IS this patient's dietician in every sense they experience.
    const out = await dieticianFacingPatient('p1', {
      PatientProfile: model(null),
      User: model(REPLIER),
      ChatSession: model({ _id: 's1' }),
      ChatMessage: model({ sender: 'dietB' }),
    });

    assert.equal(out.name, 'Anita Bose');
    assert.equal(out.assigned, false, 'nobody chose them, they just answered');
    assert.equal(out.avatarUrl, null, 'no avatar is null, not a broken URL');
  });

  test('a brand-new patient gets null, not a nameless face', async () => {
    // The case that started all of this: no assignment, no thread, nobody has
    // written. Null is the true answer and the header says so, rather than
    // drawing an avatar with no name in it.
    const out = await dieticianFacingPatient('p1', {
      PatientProfile: model(null),
      User: model(null),
      ChatSession: model(null),
      ChatMessage: model(null),
    });

    assert.equal(out, null);
  });

  test('a thread with no dietician reply yet is still null', async () => {
    const out = await dieticianFacingPatient('p1', {
      PatientProfile: model(null),
      User: model(REPLIER),
      ChatSession: model({ _id: 's1' }),
      ChatMessage: model(null),
    });

    assert.equal(out, null);
  });

  test('an assignment pointing at a deactivated account falls through', async () => {
    // A dietician who has left. The assignment is stale, so the answer is
    // whoever is actually answering — not a name that can no longer reply.
    const out = await dieticianFacingPatient('p1', {
      PatientProfile: model({ assignedDietician: 'gone' }),
      // The active-only query finds nothing for the assignment and nothing for
      // the replier either.
      User: model(null),
      ChatSession: model({ _id: 's1' }),
      ChatMessage: model({ sender: 'dietB' }),
    });

    assert.equal(out, null);
  });

  describe('cannot take the conversation down with it', () => {
    // The whole point. Every one of these used to be a 500, and a 500 here is a
    // patient staring at "Could not load the conversation" with their messages
    // sitting fine in the database behind it.
    // Each case has to be reached to be broken. An assignment that resolves
    // returns before the session is ever queried, so pairing a broken
    // ChatSession with a working assignment proves nothing — the first draft of
    // this test did exactly that and passed for the wrong reason.
    const withAssignment = {
      PatientProfile: model({ assignedDietician: 'dietA' }),
      User: model(ASSIGNED),
      ChatSession: model({ _id: 's1' }),
      ChatMessage: model({ sender: 'dietB' }),
    };
    const noAssignment = { ...withAssignment, PatientProfile: model(null) };

    const cases = [
      ['the profile lookup', withAssignment, { PatientProfile: throwingModel() }],
      ['the assigned-dietician lookup', withAssignment, { User: throwingModel() }],
      ['the session lookup', noAssignment, { ChatSession: throwingModel() }],
      ['the last-reply lookup', noAssignment, { ChatMessage: throwingModel() }],
    ];

    for (const [name, base, broken] of cases) {
      test(`${name} failing yields null, not a throw`, async () => {
        assert.equal(
          await dieticianFacingPatient('p1', { ...base, ...broken }),
          null,
        );
      });
    }

    test('a missing dependency behaves like any other failure', async () => {
      // Which is what the original bug was: PatientProfile was not imported, so
      // the reference was undefined at call time.
      assert.equal(await dieticianFacingPatient('p1', {}), null);
    });
  });
});
