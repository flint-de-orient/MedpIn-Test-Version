import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Keeping one practice's clinicians out of another's records — without locking
 * the practice that exists today out of its own.
 *
 * `resolvePatientScope` has always said "clinicians may act on any patient in
 * the clinic". With two practices that sentence is a hole: a clinician at one
 * can open records at the other, and every clinical route funnels through it.
 *
 * The obvious fix is the dangerous one. "The caller must belong to the
 * patient's practice" would refuse every request the moment it deployed,
 * because there are no membership rows yet — the backfill has not run. The
 * clinic seeing patients right now would lose its own records on a Monday.
 *
 * So the rule is: deny on a proven mismatch, permit whenever either side is
 * unknown. These pin that rule, because it is the sort of thing a later tidy-up
 * makes "stricter" without realising what it costs.
 */
const scope = readFileSync(
  new URL('../src/middleware/practiceScope.js', import.meta.url),
  'utf8',
);
const auth = readFileSync(new URL('../src/middleware/auth.js', import.meta.url), 'utf8');

describe('missing data permits', () => {
  test('a caller with no practice is not a mismatch', () => {
    // The line this whole file exists to protect. `unplacedStaff` has already
    // refused anybody who should be refused for having no practice; what is
    // left here is a deployment with no memberships at all.
    assert.match(scope, /if \(!mine\) return;/);
  });

  test('and a patient nobody has enrolled is left to the gate', () => {
    /*
     * `enrollmentGate` runs immediately after this and answers "not connected
     * to any practice yet", which tells a clinician what to do. Refusing here
     * would answer with "belongs to a different practice", which is false and
     * sends them looking for a practice that does not exist.
     */
    assert.match(scope, /if \(here \|\| !anywhere\) return;/);
  });

  test('the permits come before the refusal', () => {
    // Order matters as much as presence: a refusal evaluated first would
    // throw on the unknown case before the guard clause could let it through.
    const body = scope.slice(scope.indexOf('export async function assertSamePractice'));
    const permit = body.indexOf('if (here || !anywhere) return;');
    const refuse = body.indexOf('throw forbidden');
    assert.ok(permit > -1 && refuse > permit, 'the refusal is reachable before the permit');
  });

  test('a patient with no assigned doctor has no practice, rather than a guessed one', () => {
    // Patients have no membership — they are not staff. Their practice is
    // inferred from the doctor they are under, and a patient nobody has taken
    // on yet resolves to null, which permits.
    assert.match(scope, /if \(!profile\?\.assignedDoctor\) return null;/);
  });
});

describe('a proven mismatch refuses', () => {
  test('a patient enrolled elsewhere and not here is forbidden', () => {
    /*
     * Asked of the enrolment rather than of `assignedDoctor`, which is one
     * field naming one doctor at one practice: for a patient properly enrolled
     * at two it returned the first and refused the second, telling a clinician
     * at a clinic the patient had consented to that this was somebody else's
     * patient.
     */
    assert.match(scope, /Enrollment\.exists\(\{ patient: patientId, practice: mine \}\)/);
    assert.match(scope, /Enrollment\.exists\(\{ patient: patientId \}\)/);
    assert.match(scope, /That patient belongs to a different practice/);
  });

  test('only current memberships count', () => {
    // A receptionist who left in March still has a row. Both halves of
    // "current" are needed: an ended row is `active` and ended.
    // Asserted through `currentFilter` rather than by matching the inlined
    // condition, which is what this did before — and which failed the moment
    // the three hand-rolled copies were consolidated into one. A test that
    // pins an implementation blocks the tidy-up it should have encouraged.
    /*
     * `find` as well as `findOne`, because resolving the caller's practices
     * reads all of them — one person may work at two.
     *
     * And "current" rather than "currentFilter": `memberIdsOf` looks up a
     * practice's members rather than a person's memberships, so it cannot use
     * a filter keyed on a user, and it spells the same two conditions out.
     * Requiring the helper by name would fail a lookup that is correct, which
     * is how a ratchet teaches people to work around it.
     */
    const lookups = [...scope.matchAll(/Membership\.find(One)?\(/g)];
    assert.ok(lookups.length >= 2, 'the membership lookups have moved');

    for (const m of lookups) {
      const call = scope.slice(m.index, m.index + 300);
      const viaHelper = call.includes('Membership.currentFilter(');
      const spelledOut =
        call.includes('status: MEMBERSHIP_STATUS.ACTIVE') && call.includes('endedOn: null');
      assert.ok(
        viaHelper || spelledOut,
        `a membership lookup here counts rows that are not current:\n${call.slice(0, 120)}`,
      );
    }
  });
});

describe('it is wired into the one place every clinical route passes', () => {
  test('resolvePatientScope calls it', () => {
    assert.match(auth, /await assertSamePractice\(req, patient\._id\);/);
  });

  test('after the patient is found, so an unknown id still reads as unknown', () => {
    // Checked in this order the caller learns "no such patient" rather than
    // "wrong practice", which would otherwise leak that the id exists.
    const found = auth.indexOf("if (!patient) throw forbidden('Unknown patient')");
    const check = auth.indexOf('await assertSamePractice');
    assert.ok(found > -1 && check > found);
  });

  test('the answer is cached on the request', () => {
    // Several guards may ask on one call, and this app polls.
    assert.match(scope, /if \(req\._practiceId !== undefined\) return req\._practiceId;/);
  });
});

describe('a refusal leaves a trace', () => {
  test('both guards record before they throw', () => {
    // `audit()` wraps a handler, and a guard refuses before the handler runs —
    // so without this the most interesting line in an audit trail is the one
    // that never gets written. A clinician reading their own patient is
    // routine; one being refused another practice's patient is either somebody
    // fumbling a link or somebody trying.
    // `auth` here is auth.js, which calls the guards. The guards themselves —
    // and the recording — live in practiceScope.js and authorise.js.
    const authorise = readFileSync(
      new URL('../src/middleware/authorise.js', import.meta.url),
      'utf8',
    );
    for (const [name, src] of [['practiceScope', scope], ['authorise', authorise]]) {
      const at = src.indexOf('recordDenial(req');
      assert.ok(at > -1, `${name} does not record its refusals`);
      const thrown = src.indexOf('throw forbidden(', at);
      assert.ok(thrown > at, `${name} throws before it records`);
    }
  });

  test('the reason is carried, not flattened', () => {
    // Four things can refuse a read, and a log that says only "denied" cannot
    // tell an expired consent from somebody reaching where they should not.
    const authoriseSrc = readFileSync(
      new URL('../src/middleware/authorise.js', import.meta.url),
      'utf8',
    );
    assert.match(authoriseSrc, /reason: verdict\.reason/);
    assert.match(scope, /reason: 'cross_practice'/);
  });

  test('recording can never turn a refusal into an outage', () => {
    // A 403 must stay a 403 if the audit write fails. Fire-and-forget with the
    // failure logged, never awaited into the response path.
    const src = readFileSync(new URL('../src/middleware/recordDenial.js', import.meta.url), 'utf8');
    assert.match(src, /\.catch\(/);
    assert.ok(!/await AuditLog\.create/.test(src), 'the denial write is awaited');
  });
});
