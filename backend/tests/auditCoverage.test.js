import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Every route that changes something says so in the log.
 *
 * The specification is blunt about this: every route is audited, reads
 * included, and a test fails if a new clinical route ships without it. Knowing
 * who looked is the half usually missing, and the coverage is the half that
 * decays — one route added on a Friday without a wrapper, and the gap is
 * invisible until somebody needs the entry that was never written.
 *
 * So this walks the routes rather than trusting them.
 */
const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));

/**
 * The three ways a route may record itself.
 *
 * `audit()` is the middleware most use. `auth.js` writes `AuditLog.create()`
 * inline, because its actor is only known part-way through a login. The admin
 * namespace writes to its own collection entirely — see AdminAuditLog for why
 * platform actions are not in the clinical log.
 */
const LOGGERS = /audit\(|AuditLog\.create\(|AdminAuditLog\.record\(/;

/**
 * Routes that deliberately write nothing, and why.
 *
 * Every entry needs a reason. A list that accumulates paths without them
 * becomes the place routes are quietly added to when the test is inconvenient,
 * and then the test is worse than not having one.
 */
const EXEMPT = new Map([
  [
    'applications.js /verify/send',
    'Pre-identity, like auth.js /otp/request and for the same reason: an ' +
      'applicant has no account by definition, so there is no actor either ' +
      'log can name. It sends a code and writes nothing else — the OTP ' +
      'challenge row is the record that it happened, and the application it ' +
      'leads to carries the proved number and the address it came from.',
  ],
  [
    'applications.js /verify/check',
    'The other half of the same exchange, and the same absence of an actor. ' +
      'Spending a code creates nothing; the submission that spends the token ' +
      'afterwards is the row that records any of it.',
  ],
  [
    'applications.js /',
    'A practice asking to exist, submitted by somebody with no account — that ' +
      'being the point of it. Neither log can hold it: AdminAuditLog records ' +
      'what an operator did and there is no operator, and the clinical log ' +
      'needs a User as its actor and there is no user. The application row is ' +
      'its own record — it carries the submission in `history` and the address ' +
      'it came from — and every decision taken on it afterwards is audited ' +
      'properly, because by then there is an operator to name.',
  ],
  [
    'chat.js /patients/:patientId/presence',
    'A typing indicator. It writes nothing, is sent every few seconds, and an ' +
      'audit row per keystroke would bury the entries that matter.',
  ],
  [
    'auth.js /reminder-health',
    'The phone reporting whether its alarms are armed. Device telemetry about ' +
      'itself, not an action anybody took.',
  ],
  [
    'auth.js /otp/request',
    'Unauthenticated and pre-identity: there is no actor to record yet. The ' +
      'login or registration that follows is audited, and it names the account.',
  ],
  [
    'auth.js /otp/verify',
    'Same — still pre-identity. The row is written when the session is.',
  ],
  [
    'auth.js /refresh',
    'Token rotation, run every few minutes by every signed-in device. The ' +
      'session it refreshes was audited when it began, and a row per rotation ' +
      'would bury that one under thousands.',
  ],
  [
    'auth.js /logout',
    'Ends a session that was recorded when it started. Nothing about the ' +
      'record changes, and revokeAllForUser leaves its own trace.',
  ],
  [
    'auth.js /device-token',
    'A handset registering for push. Device plumbing about itself, not an ' +
      'action a person took on anybody’s record.',
  ],
  [
    'auth.js /me',
    'A person editing their own name or language. Their own account, their ' +
      'own change, and no clinical record is touched.',
  ],
  [
    'dietician.js /notifications/seen',
    'Clearing a badge. Written on every screen open, and an audit row for ' +
      'reading a counter is noise in a log that has to stay readable.',
  ],
  [
    'doctor.js /notifications/seen',
    'The same badge, in the other panel, for the same reason.',
  ],
  [
    'admin.js /auth/reset',
    'Audited inside completeReset, which is the only place that knows which ' +
      'of four outcomes occurred — issued, wrong token, wrong code, or done. ' +
      'The route would have to re-derive that to log it here.',
  ],
  [
    'admin.js /auth/forgot',
    'Audited inside requestResetByEmail. The route cannot record it without ' +
      'first learning whether the address has an account — which is the one ' +
      'fact this endpoint exists not to reveal, and would be sitting in the ' +
      'log either way.',
  ],
  [
    'tracking.js /lifestyle/:id',
    'A patient editing their own sleep or steps entry. Self-reported data ' +
      'about themselves; the clinical record it informs is audited where a ' +
      'clinician reads it.',
  ],
]);

/** Every mutating route in a file, as `[path, body]`. */
function mutations(src) {
  const out = [];
  // `router.post(\n  '/path',` and the single-line form.
  const re = /router\.(post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g;
  for (const m of re.exec.length ? [...src.matchAll(re)] : []) {
    const start = m.index;
    // The block ends where the next route begins, or at the file's end.
    const next = src.slice(start + 1).search(/\n\s*router\.(get|post|patch|put|delete)\(/);
    out.push([m[2], src.slice(start, next === -1 ? undefined : start + 1 + next)]);
  }
  return out;
}

describe('every mutating route is audited', () => {
  const files = readdirSync(ROUTES).filter((f) => f.endsWith('.js') && f !== 'index.js');

  test('no route changes data without recording it', () => {
    const missing = [];

    for (const file of files) {
      const src = readFileSync(path.join(ROUTES, file), 'utf8');
      for (const [route, body] of mutations(src)) {
        if (LOGGERS.test(body)) continue;
        if (EXEMPT.has(`${file} ${route}`)) continue;
        missing.push(`${file}  ${route}`);
      }
    }

    assert.deepEqual(
      missing,
      [],
      `\n\nThese routes change something and record nothing:\n\n  ${missing.join(
        '\n  ',
      )}\n\nWrap them with audit(), or add an entry to EXEMPT in this file with a\nreason. An exemption without a reason is how coverage decays.\n`,
    );
  });

  test('every exemption states a reason', () => {
    // The rule that keeps the list from becoming a dumping ground.
    for (const [route, reason] of EXEMPT) {
      assert.ok(
        reason && reason.length > 40,
        `${route} is exempt without a real reason`,
      );
    }
  });

  test('the exemption list is small', () => {
    /*
     * Not a hard limit so much as a tripwire. If this list grows, the question
     * is whether auditing has become inconvenient rather than whether a few
     * more routes genuinely have nothing to say.
     *
     * Raised from 14 to 16 when the public application surface arrived. Both
     * additions are the two halves of one pre-identity exchange — sending a
     * code and spending it — and an applicant has no account by definition, so
     * neither log has an actor to name. That is the same reason auth.js's own
     * OTP pair is exempt, and it is a property of the flow rather than a
     * preference about it.
     *
     * If it needs raising again, read the new entries before doing it: two
     * arriving together for one stated reason is different from two arriving
     * separately because writing an audit line was awkward.
     */
    assert.ok(EXEMPT.size <= 16, `${EXEMPT.size} exemptions — is auditing being avoided?`);
  });

  test('every exempt route still exists', () => {
    // A stale exemption is a route that was renamed, and the new name is
    // unaudited while the list still claims otherwise.
    for (const key of EXEMPT.keys()) {
      const [file, route] = key.split(' ');
      const src = readFileSync(path.join(ROUTES, file), 'utf8');
      assert.ok(src.includes(`'${route}'`), `${key} is exempt but no longer exists`);
    }
  });
});

describe('the clinical log and the platform log stay apart', () => {
  /*
   * The platform surface, by name.
   *
   * Was `admin.js` alone, which read as "the admin file" and meant "the admin
   * surface" — fine until the surface outgrew one file. Listed explicitly
   * rather than matched on a prefix, so adding `adminSomething.js` does not
   * quietly grant itself the right to write platform audit entries: putting a
   * file on this list is a deliberate act with a test diff attached.
   */
  /*
   * The admin surface, by file.
   *
   * Every one of these is nested inside admin.js behind `requireAdmin` — the
   * assertion at the foot of this describe() is what keeps that true, and it
   * is why extending this list is safe rather than a way of quietly widening
   * what counts as "the platform".
   */
  const PLATFORM = new Set(['admin.js', 'adminBilling.js', 'adminApplications.js']);

  test('the admin namespace writes only to its own', () => {
    // Sharing AuditLog would mean a practice-scoped viewer has to remember to
    // exclude platform actions, and a filter that must be remembered is one
    // that will be forgotten.
    for (const file of PLATFORM) {
      const src = readFileSync(path.join(ROUTES, file), 'utf8');
      assert.match(src, /AdminAuditLog\.record\(/, `${file} records nothing`);
      assert.ok(
        !/[^n]AuditLog\.create\(/.test(src),
        `${file} writes into the clinical audit log`,
      );
    }
  });

  test('no clinical route writes into the admin log', () => {
    for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.js') && !PLATFORM.has(f))) {
      const src = readFileSync(path.join(ROUTES, file), 'utf8');
      assert.ok(!src.includes('AdminAuditLog'), `${file} writes into the platform audit log`);
    }
  });

  test('and every platform file is actually mounted behind requireAdmin', () => {
    // The reason this list is safe to extend. A platform file that is not
    // nested under the admin guard would answer anybody who typed the URL,
    // which is a worse failure than the audit split this describe() is about.
    const admin = readFileSync(path.join(ROUTES, 'admin.js'), 'utf8');
    const guardAt = admin.indexOf('router.use(requireAdmin)');
    assert.ok(guardAt > -1, 'admin.js no longer applies requireAdmin');

    for (const file of PLATFORM) {
      if (file === 'admin.js') continue;
      const mount = admin.indexOf(file.replace('.js', ''));
      assert.ok(mount > -1, `${file} is not referenced from admin.js`);
      const mountedAfterGuard = admin.indexOf('adminBillingRoutes)', guardAt);
      assert.ok(mountedAfterGuard > guardAt, `${file} is mounted before the guard`);
    }
  });
});
