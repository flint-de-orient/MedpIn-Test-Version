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
 *
 * The rule is one answer now: the dietician assigned at the practice this
 * conversation is with, while they still work there. "Whoever has been
 * replying" is gone — with the caseload being the assignments, that person is
 * either the assigned dietician or somebody who no longer holds the patient.
 * The database-backed half, a suspended dietician over HTTP, is in
 * c7DieticianInactive.test.js.
 */

/** A stub User model that answers one findOne with [value] and records what it was asked. */
function userModel(value) {
  const calls = [];
  const chain = {
    select: () => chain,
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

function throwingUserModel(message = 'connection lost') {
  return {
    findOne: () => {
      throw new Error(message);
    },
  };
}

/** A stub for the assignment lookup, recording what it was asked. */
function holder(value) {
  const calls = [];
  const fn = async (args) => {
    calls.push(args);
    return value;
  };
  fn.calls = calls;
  return fn;
}

const ASSIGNED = { _id: 'dietA', name: 'Priya Nair', avatarAssetId: 'img1' };

describe('the dietician a patient is shown', () => {
  test('the dietician this practice assigned, while they work here', async () => {
    const activeDieticianOf = holder('dietA');
    const User = userModel(ASSIGNED);
    const out = await dieticianFacingPatient('p1', { practiceId: 'saltLake' }, { activeDieticianOf, User });

    assert.equal(out.name, 'Priya Nair');
    assert.equal(out.assigned, true);
    assert.equal(out.avatarUrl, '/api/v1/uploads/img1/raw');
    // Asked about this patient at this practice, and nobody else's.
    assert.deepEqual(activeDieticianOf.calls, [{ practiceId: 'saltLake', patientId: 'p1' }]);
    assert.deepEqual(User.calls, [{ _id: 'dietA', isActive: true }]);
  });

  test('no avatar is null, not a broken URL', async () => {
    const out = await dieticianFacingPatient(
      'p1',
      { practiceId: 'saltLake' },
      { activeDieticianOf: holder('dietA'), User: userModel({ ...ASSIGNED, avatarAssetId: null }) },
    );
    assert.equal(out.avatarUrl, null);
  });

  test('without a practice there is no relationship to read, and nothing is guessed', async () => {
    // A patient with two practices and no conversation yet. Naming either
    // practice's dietician would be choosing between them.
    const activeDieticianOf = holder('dietA');
    const out = await dieticianFacingPatient('p1', {}, { activeDieticianOf, User: userModel(ASSIGNED) });
    assert.equal(out, null);
    assert.equal(activeDieticianOf.calls.length, 0);
  });

  test('a brand-new patient gets null, not a nameless face', async () => {
    // Nobody assigned at this practice: null is the true answer and the
    // header says so, rather than drawing an avatar with no name in it.
    const out = await dieticianFacingPatient(
      'p1',
      { practiceId: 'saltLake' },
      { activeDieticianOf: holder(null), User: userModel(ASSIGNED) },
    );
    assert.equal(out, null);
  });

  test('an assignment to a switched-off account is nobody', async () => {
    // The assignment lookup already refuses a dietician whose membership
    // ended; an account switched off since is the second half.
    const out = await dieticianFacingPatient(
      'p1',
      { practiceId: 'saltLake' },
      { activeDieticianOf: holder('gone'), User: userModel(null) },
    );
    assert.equal(out, null);
  });

  describe('cannot take the conversation down with it', () => {
    // The whole point. Every one of these used to be a 500, and a 500 here is a
    // patient staring at "Could not load the conversation" with their messages
    // sitting fine in the database behind it.
    test('the assignment lookup failing yields null, not a throw', async () => {
      const broken = async () => {
        throw new Error('connection lost');
      };
      assert.equal(
        await dieticianFacingPatient('p1', { practiceId: 'saltLake' }, { activeDieticianOf: broken, User: userModel(ASSIGNED) }),
        null,
      );
    });

    test('the dietician lookup failing yields null, not a throw', async () => {
      // Reached only through a successful assignment lookup, so it is paired
      // with one — a broken model behind an early return proves nothing.
      assert.equal(
        await dieticianFacingPatient(
          'p1',
          { practiceId: 'saltLake' },
          { activeDieticianOf: holder('dietA'), User: throwingUserModel() },
        ),
        null,
      );
    });

    test('a missing dependency behaves like any other failure', async () => {
      // Which is what the original bug was: a model was not imported, so the
      // reference was undefined at call time.
      assert.equal(await dieticianFacingPatient('p1', { practiceId: 'saltLake' }, {}), null);
    });
  });
});
