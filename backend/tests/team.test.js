import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PRESETS, PERMISSIONS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';

/**
 * Who works here, in one place — and the three things that were missing.
 *
 * ---- One: there was no way to add a doctor -----------------------------
 *
 * Four routes in this codebase create a user. Two make patients, one makes a
 * desk account, one makes a dietician. A practice that hired a second doctor
 * had to ask the platform operator to add them from the console, which means a
 * polyclinic could not be staffed by the people running it.
 *
 * ---- Two: the role was baked into the route ----------------------------
 *
 * Front desk, Clinic care and Practice were three screens over three routes,
 * each knowing about one role. That is why `/doctor/dieticians` was the one
 * that forgot to create a membership: the paths drifted because nothing held
 * them together. Role is a column, not a URL.
 *
 * ---- Three: the caps were decoration -----------------------------------
 *
 * `Practice.overLimit` has existed since plans did and was called for patients
 * only, so the staff and location numbers on every plan bit nothing. A plan
 * whose limits are not enforced is a price list.
 */
const src = readFileSync(new URL('../src/routes/team.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/models/Membership.js', import.meta.url), 'utf8');
const service = readFileSync(new URL('../src/services/memberships.js', import.meta.url), 'utf8');
const index = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');

function route(marker) {
  const at = src.indexOf(marker);
  assert.ok(at > 0, `${marker} moved`);
  const next = src.indexOf('\nrouter.', at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

describe('a membership says which part of the practice, and which building', () => {
  test('both fields exist and both are nullable', () => {
    // A solo clinic has no departments and one location. Requiring either
    // would make the commonest customer fill in a field whose only value is
    // "the only one there is".
    assert.match(model, /department: \{[\s\S]{0,160}ref: 'Department',[\s\S]{0,80}default: null/);
    assert.match(model, /location: \{[\s\S]{0,160}ref: 'Clinic',[\s\S]{0,80}default: null/);
  });

  test('they live on the membership, not on the account', () => {
    // One person, two practices: a cardiologist consulting at a polyclinic on
    // Tuesdays and running their own evening clinic. Putting either on the User
    // would make changing a job at one change it at the other.
    const user = readFileSync(new URL('../src/models/User.js', import.meta.url), 'utf8');
    assert.ok(!/^\s+department:/m.test(user), 'department is on the User account');
    assert.ok(!/^\s+location:/m.test(user), 'location is on the User account');
  });

  test('and joining carries them without clearing them', () => {
    // Rejoining without naming a department should not silently drop the one
    // they had.
    assert.match(service, /if \(department !== null\) existing\.department = department;/);
    assert.match(service, /if \(location !== null\) existing\.location = location;/);
  });
});

describe('one route hires everybody', () => {
  test('it is mounted', () => {
    assert.match(index, /router\.use\('\/team', teamRoutes\)/);
  });

  test('all three roles, and never a patient', () => {
    assert.match(src, /const HIREABLE = \[ROLES\.DOCTOR, ROLES\.STAFF, ROLES\.DIETICIAN\]/);
    assert.match(src, /role: z\.enum\(HIREABLE\)/);
    assert.ok(!src.includes('ROLES.PATIENT'), 'the hiring route can create a patient');
  });

  test('a doctor can finally be added by the practice', () => {
    // The gap this closes. Every other creation path is role-specific and none
    // of them is for a doctor.
    assert.ok(ROLES.DOCTOR === 'doctor');
    assert.match(route("router.post(\n  '/',"), /role: b\.role/);
  });

  test('the number has to have been answered', () => {
    // For a doctor that account can prescribe, so a mistyped digit is worse
    // here than anywhere else it is checked.
    assert.match(src, /phoneToken: z\.string\(\)\.min\(20\)/);
    assert.match(src, /phoneFromToken\(b\.phoneToken\)/);
  });

  test('and the account is removed if the membership fails', () => {
    // An account with no membership belongs to nobody, shows in no list, and
    // holds a phone number that cannot be reused — which is the bug this route
    // exists to stop repeating.
    const body = route("router.post(\n  '/',");
    assert.match(body, /await User\.deleteOne\(\{ _id: user\._id \}\)/);
  });
});

describe('the caps finally bite', () => {
  const body = route("router.post(\n  '/',");

  test('the staff limit is checked before anything is written', () => {
    assert.match(body, /practice\?\.overLimit\('staff', current\)/);
    assert.ok(
      body.indexOf('overLimit') < body.indexOf('new User('),
      'the account is created before the cap is checked',
    );
  });

  test('and no cap means no limit, which is every practice today', () => {
    // overLimit returns null when nothing is set, so this does nothing at all
    // for the clinic running now and bites only where a number was agreed.
    const practice = readFileSync(new URL('../src/models/Practice.js', import.meta.url), 'utf8');
    assert.match(practice, /if \(cap === null \|\| cap === undefined\) return null;/);
  });
});

describe('a department or a location has to be this practice’s', () => {
  test('on hiring', () => {
    const body = route("router.post(\n  '/',");
    assert.match(body, /\$or: \[\{ practice: null \}, \{ practice: practiceId \}\]/);
    assert.match(body, /Clinic\.findOne\(\{ _id: b\.locationId, practice: practiceId \}\)/);
  });

  test('and on changing somebody’s job', () => {
    const body = route("router.patch(\n  '/:id',");
    assert.match(body, /String\(membership\.practice\) !== String\(practiceId\)/);
    assert.match(body, /throw notFound\('Not found'\)/);
  });
});

describe('the practice cannot be left with nobody in charge', () => {
  test('the owner is not demoted or suspended from here', () => {
    // A manager suspending the owner leaves a clinic nobody can add anybody
    // to, and the recovery is a phone call to us.
    const body = route("router.patch(\n  '/:id',");
    assert.match(body, /if \(membership\.isOwner && \(req\.body\.role \|\| req\.body\.status\)\)/);
  });

  test('and a changed role brings its own grant', () => {
    // A dietician promoted to doctor keeping the desk preset would be a doctor
    // who cannot prescribe, and nothing on screen would say why.
    const body = route("router.patch(\n  '/:id',");
    assert.match(body, /presetFor\(\{ role: req\.body\.role, isOwner: membership\.isOwner \}\)/);
    // Only when they are on the preset. Somebody's customised grant is a
    // decision a person made and a role change must not silently undo it.
    assert.match(body, /if \(!membership\.permissions\?\.length\)/);
  });
});

describe('managing is a permission, reading is not', () => {
  test('hiring and changing need MANAGE_STAFF', () => {
    for (const marker of ["router.post(\n  '/',", "router.patch(\n  '/:id',"]) {
      assert.match(route(marker), /requirePermission\(PERMISSIONS\.MANAGE_STAFF\)/);
    }
  });

  test('an ordinary doctor does not hold it', () => {
    // "Restrict default staff-management access for Doctors" — already true,
    // and worth pinning so a widened preset is a failing test rather than a
    // silent promotion for every doctor on the platform.
    assert.ok(!PRESETS.clinician.includes(PERMISSIONS.MANAGE_STAFF));
    assert.ok(!PRESETS.desk.includes(PERMISSIONS.MANAGE_STAFF));
    assert.ok(PRESETS.head.includes(PERMISSIONS.MANAGE_STAFF));
  });

  test('reading the list is open to any clinician', () => {
    // The desk needs to know which doctor is in. What a reader may change is
    // answered by `canManage` in the payload rather than by hiding the list.
    const body = route("router.get(\n  '/',");
    assert.ok(!/requirePermission/.test(body), 'reading the team now needs a permission');
    assert.match(body, /canManage: membership \? membership\.can\(PERMISSIONS\.MANAGE_STAFF\) : false/);
  });
});

describe('the payload says what the screen needs', () => {
  const body = route("router.get(\n  '/',");

  test('the resolved grant, not the stored one', () => {
    // An empty array on the row means "the preset applies". Sending it raw
    // makes every screen re-derive that, and one of them will get it wrong.
    assert.match(body, /permissions: r\.permissions\?\.length[\s\S]{0,120}presetFor/);
    assert.match(body, /usingPreset: !r\.permissions\?\.length/);
  });

  test('and two ways of being gone are told apart', () => {
    // A membership that ended is somebody who left. An inactive account is
    // somebody switched off. Collapsing them loses which lever to pull.
    assert.match(body, /'disabled'/);
    assert.match(body, /'left'/);
  });

  test('a dangling membership is not rendered as a blank person', () => {
    assert.match(body, /\.filter\(\(r\) => r\.user\)/);
  });

  test('an account with no practice gets an honest empty answer', () => {
    // Not an empty list, which would say the clinic has nobody in it.
    assert.match(body, /if \(!practiceId\) \{[\s\S]{0,140}canManage: false/);
  });
});
