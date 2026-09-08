import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Registration makes patients. There is no other kind.
 *
 * This file used to guard an invite code: a shared secret that, typed into the
 * registration form, turned the new account into a dietician or a front desk.
 * The tests were about making the *code* decide the role rather than the
 * caller, which was the right guard for the wrong feature.
 *
 * The feature is gone. A shared code is a credential that cannot be un-shared —
 * read out over a counter, forwarded, photographed — and it does not record who
 * used it. One of them was used by an account nobody at the clinic recognised,
 * which is the failure that shape guarantees eventually, and a dietician
 * account with no explicit assignments can read every patient record in the
 * clinic. Clinical accounts are created by the doctor, one at a time, in the
 * panel: he knows who he is hiring, and a code does not.
 *
 * So what is guarded now is the absence. Read from the source, because what
 * matters is that no line reappears — and a route that does not exist cannot be
 * tested by calling it.
 */
const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
const doctor = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');
const settings = readFileSync(
  new URL('../src/models/ClinicSettings.js', import.meta.url),
  'utf8',
);

describe('registration cannot make anything but a patient', () => {
  test('the role is a constant, not a lookup', () => {
    assert.match(auth, /const role = ROLES\.PATIENT;/);
  });

  test('no role is read off the request body', () => {
    // The schema must not accept one. If it ever does, an edited APK can ask
    // to be staff — which is what the invite code was protecting against, and
    // the protection has to outlive the feature.
    const schema = auth.slice(
      auth.indexOf('const registerSchema'),
      auth.indexOf('router.post'),
    );
    assert.ok(!/\brole\s*:/.test(schema), 'registerSchema accepts a role field');
    assert.ok(!/inviteCode/.test(schema), 'registerSchema still takes an invite code');
  });

  test('nothing anywhere resolves a role from a code', () => {
    assert.ok(!/roleForInvite/.test(auth), 'roleForInvite is back');
    assert.ok(!/invite/i.test(auth.replace(/\/\*[\s\S]*?\*\//g, '')), 'an invite path is back in auth');
  });
});

describe('there is no invite code to steal', () => {
  test('the endpoints are gone', () => {
    for (const route of ["'/invite/validate'", "'/dietician-invite'", "'/staff-invite'"]) {
      assert.ok(!auth.includes(route), `${route} is back in auth.js`);
      assert.ok(!doctor.includes(route), `${route} is back in doctor.js`);
    }
  });

  test('and no code is stored', () => {
    // Left in the schema, the field would be a live credential that nothing
    // reads, nobody can rotate, and no screen displays.
    assert.ok(!/dieticianInviteCode/.test(settings));
    assert.ok(!/staffInviteCode/.test(settings));
  });

  test('creating a clinical account is still doctor-only', () => {
    // The invite code is gone; the door it bypassed is not. This is the only
    // way in now, so it has to stay shut to everyone but the doctor.
    // Hiring is one route now, in team.js — the role is a field rather than
    // three URLs. The door this checks is the same door; it has one handle.
    const team = readFileSync(new URL('../src/routes/team.js', import.meta.url), 'utf8');
    const at = team.indexOf("router.post(\n  '/',");
    assert.notEqual(at, -1, 'the hiring route moved');
    assert.match(team.slice(at, at + 220), /requireDoctor/, 'hiring is not doctor-only');

    // And the read that stayed behind.
    const listed = doctor.indexOf("  '/dieticians',");
    assert.notEqual(listed, -1, 'the dietician list is gone');
    assert.match(doctor.slice(listed, listed + 200), /requireDoctor/);
  });
});
