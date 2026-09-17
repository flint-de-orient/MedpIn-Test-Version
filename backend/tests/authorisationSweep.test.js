import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Every route that changes something has had its authorisation decided.
 *
 * ---- Why a list and not a rule ------------------------------------------
 *
 * "Add `requirePermission` to every mutating route" is wrong, and expensively
 * so. A patient editing their own name, a Razorpay webhook verified by HMAC,
 * a badge counter, the login endpoint — none of them has a permission to
 * require, and inventing one for each would mean seventy new grants that every
 * preset has to hold, which is a permission system that permits everything.
 *
 * So the answer is not a rule but a decision per route, and the thing that
 * decays is not the decision — it is the *review*. A route added on a Friday
 * inherits whatever its router happens to apply, and nobody is asked again.
 *
 * This is the same shape as auditCoverage.test.js's EXEMPT map, for the same
 * reason: the list is small, every entry carries its reason, and a new
 * mutating route that nobody has classified fails the build.
 *
 * ---- What the sweep found -----------------------------------------------
 *
 * Five cross-practice writes, all one shape — an ownership check written as
 * "unless you are a patient", which was true of a single-clinic product and
 * became "any clinician may act on anybody's data" the moment practices
 * arrived. See httpCrossTenantWrites.test.js. None of them needed a new
 * permission. They needed the scoping the rest of the codebase already had.
 */

const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));

/**
 * How a mutating route is allowed to be authorised, other than by a permission.
 *
 *   public    unauthenticated by design — signup, login, the OTP exchange
 *   self      acts only on the caller's own account or own record
 *   scoped    guarded by something other than a permission: an HMAC signature,
 *             a tenant filter, an ownership test, a one-time code
 *   notice    changes nothing a person would care about — a badge, a heartbeat
 *
 * Anything else must carry `requirePermission`, `requireCapability`,
 * `requireDoctor`, `requireAdmin`, `requireRole` or `resolvePatientScope`, and
 * is not listed here at all.
 */
const CLASSIFIED = new Map([
  // ---- public: no account exists yet, by definition ----------------------
  [
    'auth.js /register',
    'public: creating the account there is nothing to authorise against yet. '
      + 'Rate-limited and OTP-gated, and it can only ever make a patient.',
  ],
  [
    'auth.js /login',
    'public: the thing an account is for. Rate-limited, and the credential is the '
      + 'authorisation.',
  ],
  [
    'auth.js /otp/request',
    'public: pre-identity — there is nobody to authorise yet, which is why auth’s OTP '
      + 'pair is exempt from the audit log too.',
  ],
  [
    'auth.js /otp/verify',
    'public: the other half of that exchange. Spending a code creates nothing; the '
      + 'login or registration that follows is what gets audited, and it names the account.',
  ],
  [
    'auth.js /refresh',
    'public: the refresh token is the credential and authorises itself. Rotated on '
      + 'every use, so a stolen one is single-shot.',
  ],
  [
    'applications.js /verify/send',
    'public: an applicant has no account, which is the point of the surface. Rate-limited.',
  ],
  [
    'applications.js /verify/check',
    'public: spends the code it was sent and returns a signed phone token. Same '
      + 'exchange, same absence of anybody to authorise.',
  ],
  [
    'applications.js /',
    'public: a practice asking to exist. Everything decided on it afterwards is audited, ' +
      'because by then there is an operator to name.',
  ],
  [
    'applications.js /:reference/confirm-email',
    'public: the applicant clicking the link in their own email. The token is the credential.',
  ],
  [
    'applications.js /:reference/resend-email',
    'public: the same, for a chase. Rate-limited, and it writes email_resent to the '
      + 'application’s own history so an operator can see it was tried.',
  ],

  // ---- self: the caller's own account, own record, own device -----------
  [
    'auth.js /logout',
    'self: ends the caller’s own session. revokeAllForUser acts on the token holder, '
      + 'so there is no id to point somewhere else.',
  ],
  ['auth.js /me', 'self: the caller’s own profile. Two verbs, both their own.'],
  [
    'auth.js /me/profile',
    'self: the caller’s own clinical profile — height, conditions, emergency contact. '
      + 'Keyed on the token, never on a body field.',
  ],
  ['auth.js /device-token', 'self: this handset registering itself for push.'],
  // messages.js is retired (V-02): one merged direct-message thread per patient
  // with no practice on it. Every route there now answers 410 Gone, so it has
  // no mutating route left to classify.
  ['feedback.js /', 'self: a patient’s own feedback. The handler refuses non-patients.'],
  ['chat.js /message', 'self: the patient’s own thread. patientId comes from the token.'],
  [
    'chat.js /message/stream',
    'self: the same thread, delivered as Server-Sent Events. Same patientId source, '
      + 'same triage-first order.',
  ],
  [
    'chat.js /nutrition',
    'self: the same patient’s own thread, in the nutrition conversation rather than '
      + 'the care one.',
  ],
  [
    'chat.js /messages/:id/flag',
    'self: a patient reporting a bad answer. Filtered on `patient: req.user._id` ' +
      'unconditionally, so it refuses clinicians too — it is not moderation.',
  ],

  // ---- scoped: guarded, but not by a permission -------------------------
  [
    'billing.js /webhook',
    'scoped: HMAC over the raw request bytes with the webhook secret. There is no ' +
      'caller to authorise — the signature is the authorisation.',
  ],
  [
    'chat.js /sessions/:id/archive',
    'scoped: findVisibleMessage’s sibling — the session is filtered to the caller’s ' +
      'own for a patient and to the practice’s patients for a clinician.',
  ],
  [
    'chat.js /messages/:id/pin',
    'scoped: findVisibleMessage filters to the practice’s patients. Was not, and a ' +
      'clinician could moderate any thread on the platform.',
  ],
  [
    'chat.js /messages/:id/hide',
    'scoped: the same practice filter. Hiding is per-reader and writes to hiddenFor, '
      + 'so it changes nothing for anybody else.',
  ],
  [
    'chat.js /messages/:id/unhide',
    'scoped: the same practice filter, undoing the same per-reader flag.',
  ],
  [
    'chat.js /messages/:id/delete',
    'scoped: the same filter, plus isOwnMessage for delete-for-everyone.',
  ],
  [
    'uploads.js /',
    'scoped: a clinician naming a patientId must name one of their own practice’s. ' +
      'Was not, and a file could be filed into any patient’s record on the platform.',
  ],
  [
    'feedback.js /:id/reviewed',
    'scoped: filtered to the practice’s own patients. The GET beside it already was; ' +
      'this one was not.',
  ],
  [
    'enrolments.js /:id/confirm',
    'scoped: the patient’s own one-time code is the authorisation. A clinic that could ' +
      'confirm without it could enrol somebody who never agreed.',
  ],
  [
    'enrolments.js /:id/revoke',
    'scoped: only the patient, checked against patientIdsFor. A clinic that could revoke ' +
      'on somebody’s behalf could also decline to, and neither is theirs to decide.',
  ],
  [
    'appointments.js /',
    'scoped: the handler resolves the practice and the patient from the caller. Booking ' +
      'is what a front desk does and every preset can do it.',
  ],
  [
    'appointments.js /request',
    'scoped: a patient asking for a time at a practice they are enrolled at. The '
      + 'enrolment is what makes it their practice.',
  ],
  [
    'appointments.js /waitlist',
    'scoped: the handler refuses anybody who is not a patient, and a patient joins '
      + 'only their own queue.',
  ],
  [
    'appointments.js /waitlist/:id',
    'scoped: the caller’s own waitlist entry — leaving a queue they joined.',
  ],

  [
    'appointments.js /:id/reschedule',
    'scoped: the handler resolves the appointment through scopeFilter, so another ' +
      'practice’s diary is not reachable by id.',
  ],
  [
    'appointments.js /:id/cancel',
    'scoped: the same practice filter as reschedule, so another practice’s diary is '
      + 'not reachable by id.',
  ],
  [
    'appointments.js /:id/status',
    'scoped: the same filter, with a comment saying why — findByIdAndUpdate takes no ' +
      'filter beyond the id and could have moved another practice’s appointment.',
  ],
  [
    'appointments.js /:id/check-in',
    'scoped: the same practice filter. Marking somebody arrived is desk work and '
      + 'every preset can do it.',
  ],
  [
    'chat.js /messages/:id/edit',
    'scoped: findVisibleMessage’s practice filter, plus isOwnMessage — you may only ' +
      'edit what you wrote.',
  ],
  [
    'doctor.js /patients',
    'scoped: registration creates the patient inside the caller’s own practice; there is ' +
      'no id to reach across with.',
  ],
  [
    'records.js /patients/:id/detach',
    'scoped: filtered to the practice’s own patients. Was not, and detaching decides ' +
      'which number signs in as that person.',
  ],
  [
    'uploads.js /:id',
    'scoped: the asset must be the caller’s own or belong to one of their practice’s ' +
      'patients. Was ownership-checked for patients only.',
  ],

  // ---- notice: changes nothing anybody is protecting --------------------
  [
    'auth.js /reminder-health',
    'notice: the handset reporting whether its alarms are armed. Telemetry about itself.',
  ],
  [
    'doctor.js /notifications/seen',
    'notice: clearing a badge. Written on every screen open.',
  ],
]);

/** Every mutating route, with whatever authorises it. */
function mutations() {
  const out = [];
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
    const src = readFileSync(path.join(ROUTES, file), 'utf8');
    const routerLevel = (src.match(/router\.use\(([^)]*)\)/g) ?? []).join(' ');
    const found = [...src.matchAll(/router\.(get|post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g)];

    for (let i = 0; i < found.length; i += 1) {
      if (found[i][1] === 'get') continue;
      const body = src.slice(found[i].index, i + 1 < found.length ? found[i + 1].index : undefined);
      out.push({ file, path: found[i][2], body, routerLevel });
    }
  }
  return out;
}

/**
 * The admin surface, by file.
 *
 * `requireAdmin` is applied once in admin.js and these are nested under it, so
 * their own source names no guard at all. The same list and the same reasoning
 * as auditCoverage.test.js, which additionally asserts that each really is
 * mounted after the guard — without that assertion this would be a way to
 * exempt a file by adding its name here.
 */
const PLATFORM = new Set(['admin.js', 'adminBilling.js', 'adminApplications.js']);

/** Whether something other than the classification list authorises this route. */
function guarded({ file, body, routerLevel }) {
  if (PLATFORM.has(file)) return true;
  const both = `${body} ${routerLevel}`;
  return /requireAdmin|requireDoctor|requireDietician|requireRole\(|requirePermission\(|requireCapability\(|resolvePatientScope/.test(
    both,
  );
}

describe('every mutating route has had its authorisation decided', () => {
  const routes = mutations();

  test('the routes were actually found', () => {
    // Every assertion below iterates this. On an empty list they all pass.
    assert.ok(routes.length > 100, `only ${routes.length} mutating routes found`);
  });

  test('nothing changes data without a guard or a stated reason', () => {
    const unclassified = [];

    for (const route of routes) {
      if (guarded(route)) continue;
      const key = `${route.file} ${route.path}`;
      if (CLASSIFIED.has(key)) continue;
      unclassified.push(key);
    }

    assert.deepEqual(
      unclassified,
      [],
      `\n\nThese change data and carry no guard this test recognises:\n\n  ${unclassified.join(
        '\n  ',
      )}\n\nEither add the guard, or classify it in CLASSIFIED in this file with a\nreason — public, self, scoped or notice. Do not add a permission to a route\nthat has nothing to require: seventy grants every preset must hold is a\npermission system that permits everything.\n`,
    );
  });

  test('every classification states which kind it is, and why', () => {
    /*
     * The rule that keeps the list from becoming a dumping ground — the same
     * one auditCoverage.test.js applies to its exemptions. An entry reading
     * "fine" is how a list of decisions turns into a list of things somebody
     * did not want to think about.
     */
    for (const [route, reason] of CLASSIFIED) {
      assert.match(
        reason,
        /^(public|self|scoped|notice):/,
        `${route} does not say which kind of route it is`,
      );
      assert.ok(reason.length > 40, `${route} is classified without a real reason`);
    }
  });

  test('and every classified route still exists', () => {
    // A stale entry is a route that was renamed — the new name is unclassified
    // while the list claims otherwise.
    for (const key of CLASSIFIED.keys()) {
      const [file, routePath] = [key.slice(0, key.indexOf(' ')), key.slice(key.indexOf(' ') + 1)];
      const src = readFileSync(path.join(ROUTES, file), 'utf8');
      assert.ok(src.includes(`'${routePath}'`), `${key} is classified but no longer exists`);
    }
  });

  test('the list is small enough to have been read', () => {
    /*
     * A tripwire rather than a limit. Thirty-odd routes that genuinely have no
     * permission to require is a believable number for a product with a public
     * signup, a patient app and a webhook. Sixty would mean the list had become
     * the place routes go when adding a guard is inconvenient.
     */
    assert.ok(
      CLASSIFIED.size <= 45,
      `${CLASSIFIED.size} routes classified as needing no permission — is the list being used to avoid guards?`,
    );
  });
});
