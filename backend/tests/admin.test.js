import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import jwt from 'jsonwebtoken';

import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { verifyAdminToken } from '../src/services/adminTokens.js';

/**
 * The platform's own surface, and the wall between it and the clinic.
 *
 * "A bug in the clinic app must not reach every practice you have." That is
 * the whole requirement, and it is why almost everything below is about what
 * this namespace *cannot* do rather than what it can.
 */
const route = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../src/services/adminTokens.js', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../src/middleware/requireAdmin.js', import.meta.url), 'utf8');

describe('a clinic token cannot open the admin panel', () => {
  test('the two are signed with different secrets', () => {
    // Not a role claim on a shared key. A clinic token put in front of the
    // admin verifier fails on the signature, so there is no check to forget.
    assert.match(tokens, /env\.ADMIN_JWT_SECRET/);
    assert.ok(
      !/JWT_ACCESS_SECRET/.test(tokens.replace(/secretsAreSeparate[\s\S]*$/, '')),
      'the admin signer touches the clinic key',
    );
  });

  test('and different issuers', () => {
    // Catches the one case a shared secret would still admit: an operator who
    // pastes the same string into both env vars.
    assert.match(tokens, /const ISSUER = 'medpin-admin'/);
  });

  test('a token signed with the clinic key is refused', () => {
    // The property, exercised rather than asserted about.
    const clinicish = jwt.sign({ sub: 'x', role: 'doctor' }, 'a-clinic-key-that-is-long-enough', {
      issuer: 'akd-care',
    });
    assert.throws(() => verifyAdminToken(clinicish), /Admin session expired|jwt/i);
  });

  test('an admin token carries no role to branch on', () => {
    // A role here would be a field somebody later branches on, and the branch
    // nobody tests is the one that grants too much.
    const signer = tokens.slice(tokens.indexOf('export function signAdminToken'));
    assert.ok(!/role:/.test(signer.slice(0, signer.indexOf('}'))));
  });

  test('the session is short', () => {
    // This account can suspend a whole practice.
    assert.match(tokens, /const TTL = '2h'/);
  });
});

describe('off unless deliberately switched on', () => {
  test('an unset secret makes the namespace 404, not 401', () => {
    // A 401 confirms the namespace exists. Every deployment today is in this
    // state and should stay in it unless the panel is actually being run.
    assert.match(guard, /if \(!process\.env\.ADMIN_JWT_SECRET\)/);
    assert.match(guard, /status\(404\)/);
    assert.match(route, /status\(404\)/);
  });

  test('matching secrets are refused loudly', () => {
    // A misconfiguration that silently grants platform access is worse than one
    // that stops the panel working.
    assert.match(guard, /secretsAreSeparate\(\)/);
    assert.match(guard, /must differ from the clinic key/);
  });

  test('an empty secret is valid config, not a boot failure', () => {
    // A required secret here would stop the clinic's own API starting.
    const envSrc = readFileSync(new URL('../src/config/env.js', import.meta.url), 'utf8');
    assert.match(envSrc, /v === '' \|\| v\.length >= 32/);
  });
});

describe('the namespace holds no clinical data', () => {
  test('no clinical model is imported', () => {
    // Verifying a registration number is a statement that a doctor is who they
    // say they are. It is not, and must never become, a key to their patients.
    for (const forbidden of [
      'Prescription',
      'ChatSession',
      'PatientProfile',
      'Enrollment',
      'GlucoseReading',
      'MedicationLog',
      'Patient.js',
    ]) {
      assert.ok(
        !route.includes(forbidden),
        `admin.js reaches for ${forbidden}, which is clinical`,
      );
    }
  });

  test('it reports counts, never contents', () => {
    /*
     * How many people a practice has is a number the platform needs. Who they
     * are is not.
     *
     * This used to assert the exact aggregation stage — `$group: { _id:
     * '$practice', count: { $sum: 1 } }` — and broke the day that became a
     * `$lookup` with `$size`, which is the same guarantee written differently.
     * A test that pins an implementation fails on refactors and passes on
     * regressions, which is the wrong way round.
     *
     * So it asserts the property instead: whatever joins members or clinics
     * pulls back ids and nothing else, so no name can reach this route to be
     * leaked from it. `httpPracticeList.test.js` proves the outcome over real
     * HTTP — that no member's name appears in the response — and this is the
     * cheap structural half of the same rule.
     */
    assert.match(route, /Counts, never contents/);

    for (const collection of ['memberships', 'clinics']) {
      const at = route.indexOf(`from: '${collection}'`);
      assert.ok(at > -1, `admin.js no longer joins ${collection}`);
      const stage = route.slice(at, at + 400);
      assert.match(
        stage,
        /\$project: \{ _id: 1 \}/,
        `the ${collection} join pulls back more than ids`,
      );
    }
  });

  test('the admin audit log is its own collection', () => {
    // Sharing AuditLog would mean a practice-scoped viewer has to remember to
    // exclude platform actions — a filter that works until somebody writes a
    // query without it.
    assert.equal(AdminAuditLog.collection.collectionName, 'adminauditlogs');
    assert.ok(!Object.keys(AdminAuditLog.schema.paths).includes('subjectPatient'));
  });
});

describe('destructive actions must say why', () => {
  test('a suspension needs a reason', () => {
    // It stops people working. Six months later, the reason is what a review
    // reads.
    assert.match(route, /A suspension needs a reason/);
  });

  test('a rejection needs a reason', () => {
    // "Rejected" with no reason is a decision nobody can review and the
    // applicant cannot answer.
    assert.match(route, /A rejection needs a reason/);
  });

  test('verification and status are separate routes', () => {
    // The day they collapse into one flag is the day checking papers starts
    // granting access to patients.
    assert.match(route, /'\/practices\/:id\/verification'/);
    assert.match(route, /'\/practices\/:id\/status'/);
  });

  test('a new practice arrives unverified', () => {
    // Creating a practice is not vouching for it.
    assert.match(route, /verification: VERIFICATION\.UNVERIFIED/);
    assert.match(route, /status: PRACTICE_STATUS\.ONBOARDING/);
  });

  test('reads are logged too', () => {
    assert.match(route, /action: 'admin\.practices\.list'/);
  });
});

describe('the model', () => {
  test('the password hash is never selected by default', () => {
    assert.equal(PlatformAdmin.schema.path('passwordHash').options.select, false);
  });

  test('an admin is not a User', () => {
    // Different collection, so a role check inverted in the clinic app cannot
    // reach it.
    assert.equal(PlatformAdmin.collection.collectionName, 'platformadmins');
  });

  test('the login gives one message for both failures', () => {
    // Saying "no such account" tells whoever is guessing which half of the
    // pair to keep trying.
    assert.match(route, /Those details do not match an account/);
    assert.equal((route.match(/Those details do not match an account/g) ?? []).length, 1);
  });

  test('the first admin is made by a script, not an open route', () => {
    // A "create the first admin" endpoint has to be open until it is used and
    // closed afterwards, and the closing is a thing somebody has to remember.
    //
    // The rule is about the *first* one. An existing administrator adding a
    // colleague is a different act: it is authenticated, attributable and
    // logged, and refusing it only means the second operator is created by
    // whoever has a shell — which is worse, not safer.
    //
    // So the test is position, not existence. Anything above `requireAdmin` is
    // reachable by a stranger.
    const routes = readdirSync(new URL('../src/routes/', import.meta.url));
    assert.ok(routes.includes('admin.js'));

    const guard = route.indexOf('router.use(requireAdmin)');
    assert.ok(guard > -1, 'the admin guard is no longer applied at the router');

    const open = route.slice(0, guard);
    assert.ok(
      !/router\.post\(\s*'\/admins?'/.test(open),
      'an unauthenticated route creates administrators',
    );
    assert.match(
      route.slice(guard),
      /router\.post\(\s*\n?\s*'\/admins'/,
      'adding a colleague should be possible while signed in',
    );
  });

  test('and nobody can deactivate themselves', () => {
    // The last door locked from the inside. The way back would be a shell on
    // the server, which is the situation the reset flow exists to avoid.
    assert.match(route, /You cannot deactivate your own account/);
  });
});

describe('an audit entry says what changed, not just that something did', () => {
  test('the model can hold a before and an after', () => {
    // "Changed permission" with no values records that something happened and
    // not what. The question asked six months later is always what it used to
    // be, and a log that cannot answer it is a list of timestamps.
    const paths = Object.keys(AdminAuditLog.schema.paths);
    assert.ok(paths.includes('before'), 'no before');
    assert.ok(paths.includes('after'), 'no after');
  });

  test('every mutating route captures the old value before writing', () => {
    // Read after the write, "changed to verified" is all the log can say.
    const mutations = route.match(/const before = \{ \w+: practice\.\w+ \};/g) ?? [];
    assert.equal(mutations.length, 2, 'a mutation does not capture its before');

    for (const [, field] of route.matchAll(/const before = \{ (\w+): practice\.\w+ \};/g)) {
      const after = new RegExp(`after: \{ ${field}: practice\.${field} \}`);
      assert.match(route, after, `${field} records a before but no after`);
    }
  });

  test('creation records no before, rather than an empty one', () => {
    // So a reader can tell "created" from "changed, but the diff was not
    // recorded".
    assert.match(route, /before: null,/);
  });

  test('the audit endpoint returns both', () => {
    assert.match(route, /before: r\.before \?\? null,/);
    assert.match(route, /after: r\.after \?\? null,/);
  });
});
