import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { allowanceFor, currentPeriod, AI_MONTHLY_ALLOWANCE } from '../src/services/ai/allowance.js';
import { PLAN, PRACTICE_TYPE, LEGACY_PLANS } from '../src/models/Practice.js';

/**
 * What the assistant is allowed to do, and the record of when it was not.
 *
 * ---- Three things were missing -----------------------------------------
 *
 * `AI_ASSISTANT` was defined, resolved, sent to the app, and enforced by
 * nothing. No route asked for it, so a practice whose type or plan excluded the
 * assistant had one anyway — the capability described a product decision that
 * the product did not make.
 *
 * There was no usage accounting at all, so "AI usage limits by plan" had
 * nothing to limit.
 *
 * And nothing recorded a refusal. A clinic whose patients quietly stopped
 * getting answers would have had nothing to look at and no reason to suspect a
 * limit.
 *
 * ---- Where the check lives, and why ------------------------------------
 *
 * In `assistantShouldReply`, not at the route. That function is where the
 * assistant already knows how to be silent: a department nobody has written a
 * scope for gets no reply and the thread says so. A practice without the
 * capability, or one that has spent the month, lands in the same place — which
 * is right, because a patient does not need telling which of their clinic's
 * commercial arrangements applies to their question.
 */
const allowance = readFileSync(new URL('../src/services/ai/allowance.js', import.meta.url), 'utf8');
const assistant = readFileSync(new URL('../src/services/ai/assistant.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/models/AiUsage.js', import.meta.url), 'utf8');

describe('unknown means unlimited', () => {
  test('a practice with no plan has no cap', () => {
    // Every practice today. A cap invented for somebody who never agreed to
    // one would silence an assistant a clinic is relying on — the same rule
    // the rest of this codebase runs on, applied to a commercial limit.
    assert.equal(allowanceFor({}), null);
    assert.equal(allowanceFor({ plan: null }), null);
    assert.equal(allowanceFor(null), null);
  });

  test('and a plan nobody has written an allowance for does not invent one', () => {
    assert.equal(allowanceFor({ plan: 'something_new' }), null);
  });

  test('the check itself fails open', () => {
    // An allowance check that cannot run is a reason to answer, not a reason
    // to go quiet. The failure mode of this file has to be a working clinic.
    assert.match(allowance, /catch \(err\) \{[\s\S]{0,220}return \{ allowed: true \}/);
  });
});

describe('the plans that do have one', () => {
  test('every plan is either a number or deliberately unlimited', () => {
    for (const plan of Object.values(PLAN)) {
      const v = AI_MONTHLY_ALLOWANCE[plan];
      assert.ok(
        v === null || typeof v === 'number',
        `${plan} has no allowance decision either way`,
      );
    }
  });

  test('the trial is not a taste', () => {
    // Somebody deciding whether to buy needs to see it work under a real
    // week's load. A trial that runs out on Wednesday demonstrates the
    // opposite of what it is for.
    assert.ok(AI_MONTHLY_ALLOWANCE[PLAN.TRIAL] >= AI_MONTHLY_ALLOWANCE[PLAN.ESSENTIAL]);
  });

  test('and they increase with the plan', () => {
    assert.ok(AI_MONTHLY_ALLOWANCE[PLAN.PROFESSIONAL] > AI_MONTHLY_ALLOWANCE[PLAN.ESSENTIAL]);
    assert.equal(AI_MONTHLY_ALLOWANCE[PLAN.ENTERPRISE], null);
  });
});

describe('the month is the clinic’s month', () => {
  test('the period is in the clinic timezone, not the server’s', () => {
    // A plan's month is a month where the clinic is. A server in UTC rolls
    // over five and a half hours early, which spends a January reply on
    // December for every clinic in India.
    assert.match(allowance, /inClinicTz\(at\)\.format\('YYYY-MM'\)/);
    assert.match(currentPeriod(new Date('2026-09-08T12:00:00Z')), /^\d{4}-\d{2}$/);
  });
});

describe('the gate is where silence already lives', () => {
  test('assistantShouldReply asks, about the practice the conversation is with', () => {
    // Not the assigned doctor's practice, which a desk-enrolled patient does
    // not have. See services/conversationPractice.js.
    assert.match(
      assistant,
      /const may = await mayAssistantReply\(session\.patient, \{ practiceId: relationship\?\.practiceId \?\? null \}\)/,
    );
    assert.match(assistant, /if \(!may\.allowed\) return false;/);
  });

  test('and both refusals look the same to the patient', () => {
    // One `return false`, the same as a department with no scope. Two
    // different messages would tell a patient about a billing arrangement
    // they are not party to.
    const at = assistant.indexOf('async function assistantShouldReply');
    const body = assistant.slice(at, assistant.indexOf('\n}', at));
    assert.equal([...body.matchAll(/may\.allowed/g)].length, 1);
  });
});

describe('a reply is counted only once it exists', () => {
  test('after the reply is saved, not before', () => {
    // A request that fails on the provider's side has cost the practice
    // nothing, and charging them for it spends a limit on an outage. Nor has a
    // reply the database refused: counted just before the save, it was
    // charged and never shown. chatMessageNumbering.test.js checks that over
    // HTTP; this checks both paths keep the order.
    const uses = [...assistant.matchAll(/countReply\(/g)];
    assert.equal(uses.length, 2, 'the two reply paths do not both count');

    for (const m of uses) {
      const saved = assistant.lastIndexOf('const assistantMessage = await ChatMessage.create({', m.index);
      assert.ok(
        saved > -1 && m.index - saved < 2500,
        'a reply is counted somewhere other than right after it is saved',
      );
    }
  });

  test('and a failed counter does not lose the reply', () => {
    /*
     * The claim is that the counter swallows its own failure, not that it has
     * one parameter.
     *
     * This pinned `export function countReply(practiceId)` as a literal and
     * broke when the function gained the token figures — which is the change
     * that made the meter measure what Google actually bills for. A signature
     * is not the behaviour; the `.catch` is.
     */
    assert.match(allowance, /export function countReply\(/);
    assert.match(allowance, /\.catch\(\(err\) => logger\.warn/);
  });

  test('and it counts what the call cost, not only that there was one', () => {
    /*
     * The allowance compares `replies` against a plan limit, and a reply is
     * not a unit of anything: a conversation carrying a clinical record and
     * several knowledge chunks can cost several thousand prompt tokens where a
     * one-line answer costs a few hundred. Both decremented the allowance by
     * one, so a practice could spend its thousand replies at 4,400 tokens each
     * or at 800 and nothing could tell the two apart.
     *
     * See aiTokenMetering.test.js for the behaviour; this is the wiring.
     */
    assert.match(allowance, /promptTokens/);
    assert.match(allowance, /responseTokens/);
  });
});

describe('a refusal leaves a trace', () => {
  test('both reasons are recorded, and told apart', () => {
    // "We hit the limit twice" and "we hit it four hundred times" are
    // different answers: the first is a busy week, the second is the wrong
    // plan.
    //
    // Asserted on the calls, not the strings. Both reasons appear in the
    // returned `reason` as well, so matching the literal passes with the
    // recording deleted — which is what mutation testing showed.
    assert.match(allowance, /await record\(practiceId, patientId, 'no_capability'\)/);
    assert.match(
      allowance,
      /await record\(practiceId, patientId, 'allowance_spent', period\)/,
    );
    assert.match(allowance, /action: `assistant\.declined\.\$\{reason\}`/);
  });

  test('and every refusal path records before it returns', () => {
    // One `return { allowed: false }` with no `record` above it is a refusal
    // nobody can find afterwards, which is the whole failure this exists to
    // prevent.
    const refusals = [...allowance.matchAll(/return \{ allowed: false/g)];
    assert.ok(refusals.length >= 2, 'the refusal paths moved');

    for (const m of refusals) {
      assert.match(
        allowance.slice(Math.max(0, m.index - 300), m.index),
        /await record\(/,
        'a refusal returns without being recorded',
      );
    }
  });

  test('the counter separates replies from refusals', () => {
    assert.match(model, /replies: \{ type: Number, default: 0 \}/);
    assert.match(model, /refused: \{ type: Number, default: 0 \}/);
  });

  test('one row per practice per month, enforced', () => {
    assert.match(model, /aiUsageSchema\.index\(\{ practice: 1, period: 1 \}, \{ unique: true \}\)/);
  });
});

describe('the plans are named after the product', () => {
  const practiceModel = readFileSync(new URL('../src/models/Practice.js', import.meta.url), 'utf8');

  test('not after the customer', () => {
    // `solo`, `clinic` and `hospital` described who was buying rather than what
    // they got — and two collided with a practice *type*. "A hospital on the
    // hospital plan" is a tautology; "a clinic not on the clinic plan" reads as
    // a bug report.
    assert.deepEqual(Object.values(PLAN), ['trial', 'essential', 'professional', 'enterprise']);
  });

  test('and no tier shares a name with a practice type', () => {
    // The collision this rename exists to end. A tier and a kind of
    // organisation sharing a word makes every sentence about either ambiguous.
    const types = Object.values(PRACTICE_TYPE);
    for (const plan of Object.values(PLAN)) {
      assert.ok(!types.includes(plan), `"${plan}" is both a plan and a practice type`);
    }
  });

  test('a stored old name still saves', () => {
    // Mongoose validates an enum on save and not on read, so a practice left on
    // `clinic` loads fine and throws the next time anything touches it — days
    // later, on an unrelated edit, for whoever pressed save.
    assert.match(practiceModel, /export const LEGACY_PLANS = Object\.freeze\(\{/);
    assert.match(practiceModel, /practiceSchema\.pre\('validate', function normaliseLegacyPlan/);
    assert.match(practiceModel, /const mapped = LEGACY_PLANS\[this\.plan\];/);
  });

  test('every legacy name maps to a real one', () => {
    for (const [from, to] of Object.entries(LEGACY_PLANS)) {
      assert.ok(
        Object.values(PLAN).includes(to),
        `${from} maps to "${to}", which is not a plan`,
      );
      assert.ok(!Object.values(PLAN).includes(from), `"${from}" is still a current plan`);
    }
  });

  test('and every current plan has an allowance decision', () => {
    // The rename must not leave a tier with no entry, which reads as unlimited.
    for (const plan of Object.values(PLAN)) {
      assert.ok(
        plan in AI_MONTHLY_ALLOWANCE,
        `${plan} has no allowance decision after the rename`,
      );
    }
  });
});
