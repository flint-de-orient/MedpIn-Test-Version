import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * What an invite code is allowed to make.
 *
 * A staff account can see every patient in the clinic. A dietician's cannot,
 * and a patient's certainly cannot. The one thing that must never happen is a
 * caller choosing which of those it becomes: the app posts an inviteCode and a
 * form, and an edited APK can put anything in that form.
 *
 * So the code decides the role, server-side, and these read the source to say
 * so. Read rather than exercised because the failure would be a *missing*
 * check — a line someone deletes while making something else work — and a
 * request that never happens cannot be tested by making requests.
 */
const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
const doctor = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');

describe('an invite code decides its own role', () => {
  test('registration never reads a role off the request body', () => {
    // The register schema must not accept one. If it ever does, an APK can
    // ask to be staff.
    const schema = auth.slice(
      auth.indexOf('const registerSchema'),
      auth.indexOf('router.post'),
    );
    assert.ok(!/\brole\s*:/.test(schema), 'registerSchema accepts a role field');
  });

  test('the role comes from roleForInvite, not from the caller', () => {
    assert.match(auth, /const invitedRole = await roleForInvite\(inviteCode\)/);
    assert.match(auth, /const role = invitedRole \?\? ROLES\.PATIENT/);
  });

  test('an unrecognised code is refused rather than ignored', () => {
    // Silently falling back to patient would be worse than an error: someone
    // handed a stale code would get an account, and never know it was the
    // wrong kind until they could not do their job.
    assert.match(auth, /if \(inviteCode && !invitedRole\)/);
  });

  test('the staff code has no source-code default', () => {
    // The dietician code falls back to an env var so existing deployments keep
    // working. Staff must not: a default that ships in the repository is not a
    // credential, and this one opens every patient record in the clinic.
    const fn = auth.slice(
      auth.indexOf('async function roleForInvite'),
      auth.indexOf('const otpLimiter'),
    );
    assert.match(fn, /settings\.staffInviteCode/);
    assert.ok(
      !/STAFF_INVITE_CODE/.test(fn),
      'the staff code falls back to an env default',
    );
  });

  test('the two codes are separate', () => {
    // One code for both roles would mean rotating it for a departing
    // receptionist also locked out every dietician mid-registration.
    const fn = auth.slice(
      auth.indexOf('async function roleForInvite'),
      auth.indexOf('const otpLimiter'),
    );
    assert.match(fn, /dieticianInviteCode/);
    assert.match(fn, /staffInviteCode/);
  });

  test('only a doctor may create or rotate staff access', () => {
    // requireClinician admits STAFF. A desk that can mint another desk account,
    // or reissue the code, is a desk that can let anyone in.
    for (const route of [
      "'/staff'",
      "'/staff-invite'",
      "'/staff-invite/generate'",
    ]) {
      const at = doctor.indexOf(`  ${route},`);
      assert.notEqual(at, -1, `no route registered at ${route}`);
      const guards = doctor.slice(at, at + 200);
      assert.match(guards, /requireDoctor/, `${route} is not doctor-only`);
    }
  });
});
