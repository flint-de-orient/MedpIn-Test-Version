import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { requireCapability, requestCan } from '../src/middleware/requireCapability.js';
import { CAPABILITIES } from '../src/services/capabilities.js';
import { PRACTICE_TYPE, PLAN } from '../src/models/Practice.js';
import { PRESETS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';

/**
 * The gate on the clinic's daily work, actually run.
 *
 * ---- Why this file exists separately from the others -------------------
 *
 * Every other test of the capability layer reads source. They check that
 * `requireCapability(CAPABILITIES.PRESCRIPTION)` appears in prescriptions.js,
 * which proves the guard is mounted and nothing whatever about what it does
 * when a doctor presses Save.
 *
 * That distinction is the whole history of this codebase. A guard that is
 * present and wrong looks exactly like a guard that is present and right, and
 * the difference shows up in a consultation.
 *
 * So this one calls the middleware. No route, no server, no database — the
 * context is cached on the request and presetting that cache is the seam.
 *
 * ---- The case that matters is the boring one ---------------------------
 *
 * Dr. Dey's practice has no `practiceType` and no `plan` anybody chose. If the
 * resolver reads either absence as "no capabilities", the gate refuses, and the
 * first person to find out is a doctor with a patient in front of him.
 */

/** A request with its capability context already resolved. */
function reqWith({ practice, membership = null, role = ROLES.DOCTOR }) {
  return {
    _capabilityContext: { practice, membership, role },
    user: { _id: 'u1', role },
    ip: '127.0.0.1',
    get: () => 'test',
  };
}

/** Run a guard and report what it did, without a server. */
async function run(guard, req) {
  return new Promise((resolve) => {
    guard(req, {}, (err) => resolve(err ?? null));
  });
}

const prescribe = requireCapability(CAPABILITIES.PRESCRIPTION);
const doctor = { role: ROLES.DOCTOR, permissions: [...PRESETS.clinician] };

describe('the practice running today can prescribe', () => {
  test('an unclassified practice is let through', async () => {
    // No type, no plan. Every practice in the database on the day the
    // capability layer shipped, and the one the clinic actually uses.
    const err = await run(prescribe, reqWith({ practice: {}, membership: doctor }));
    assert.equal(err, null, 'the gate refused a practice nobody has classified');
  });

  test('and so is one with a plan but no type', async () => {
    const err = await run(
      prescribe,
      reqWith({ practice: { plan: PLAN.TRIAL }, membership: doctor }),
    );
    assert.equal(err, null);
  });

  test('a caller the backfill has not reached is let through', async () => {
    // No practice at all. Refusing here would lock out every account created
    // before memberships existed — which is the outage the whole permissive
    // rule is written to avoid.
    //
    // Permitted twice over, which mutation testing turned up: the guard's
    // `if (!ctx.practice) return next()` and the resolver reading a null
    // practice as two null ceilings both let it through, so removing either
    // alone changes nothing. That is worth knowing rather than mistaking the
    // early return for the thing doing the work — and worth keeping, because
    // the guard should not depend on the resolver being generous.
    const err = await run(prescribe, reqWith({ practice: null }));
    assert.equal(err, null, 'the gate refused a caller with no practice');
  });

  test('a member with no membership row is let through', async () => {
    const err = await run(prescribe, reqWith({ practice: {}, membership: null }));
    assert.equal(err, null);
  });

  test('an ordinary clinic on any plan is let through', async () => {
    for (const plan of Object.values(PLAN)) {
      const err = await run(
        prescribe,
        reqWith({
          practice: { practiceType: PRACTICE_TYPE.CLINIC, plan },
          membership: doctor,
        }),
      );
      assert.equal(err, null, `a clinic on ${plan} could not prescribe`);
    }
  });
});

describe('and the gate still refuses what it is for', () => {
  test('a diagnostic centre cannot prescribe, on any plan', async () => {
    for (const plan of Object.values(PLAN)) {
      const err = await run(
        prescribe,
        reqWith({
          practice: { _id: 'p1', practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE, plan },
          membership: doctor,
        }),
      );
      assert.ok(err, `a diagnostic centre prescribed on ${plan}`);
      assert.equal(err.status ?? err.statusCode, 403);
    }
  });

  test('the receptionist at a hospital cannot either', async () => {
    const err = await run(
      prescribe,
      reqWith({
        practice: { _id: 'p1', practiceType: PRACTICE_TYPE.HOSPITAL, plan: PLAN.HOSPITAL },
        membership: { role: ROLES.STAFF, permissions: [...PRESETS.desk] },
        role: ROLES.STAFF,
      }),
    );
    assert.ok(err, 'the front desk prescribed');
  });

  test('and the two refusals say different things', async () => {
    // One is a sale and one is not. Telling a pathologist their plan does not
    // include prescribing sends them to buy something that will not help.
    const byType = await run(
      prescribe,
      reqWith({
        practice: { _id: 'p1', practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE },
        membership: doctor,
      }),
    );
    const byRole = await run(
      prescribe,
      reqWith({
        practice: { _id: 'p1', practiceType: PRACTICE_TYPE.HOSPITAL },
        membership: { role: ROLES.STAFF, permissions: [...PRESETS.desk] },
        role: ROLES.STAFF,
      }),
    );

    assert.match(byType.message, /practice does not have that feature/);
    assert.match(byRole.message, /account does not have access/);
  });
});

describe('requestCan answers without throwing', () => {
  test('true for the clinic running today', async () => {
    assert.equal(
      await requestCan(reqWith({ practice: {}, membership: doctor }), CAPABILITIES.PRESCRIPTION),
      true,
    );
  });

  test('and true when there is no practice to ask about', async () => {
    assert.equal(
      await requestCan(reqWith({ practice: null }), CAPABILITIES.PRESCRIPTION),
      true,
    );
  });

  test('false only on a real mismatch', async () => {
    assert.equal(
      await requestCan(
        reqWith({
          practice: { practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE },
          membership: doctor,
        }),
        CAPABILITIES.PRESCRIPTION,
      ),
      false,
    );
  });
});
