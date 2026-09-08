import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The tenant model has to be something that happens, not something described.
 *
 * ---- What this is for ---------------------------------------------------
 *
 * `Membership` existed for weeks and nothing created one. The only two calls in
 * the repository were a migration and a test harness, so every practice-scoped
 * guard sat permanently in its permissive branch and the whole model was a
 * shape rather than a behaviour. It worked because there was one clinic and
 * nothing to be wrong about.
 *
 * That is invisible in review. The model is right, the guards are right, the
 * tests pass, and a second practice would have been created with nobody able to
 * sign into it — a fact nobody discovers until they try.
 *
 * So these check the wiring rather than the shape: that something creates a
 * membership, that a practice cannot be made without a head, and that the
 * lists which used to mean "everyone on the platform" now mean "this practice".
 */
const ROOT = fileURLToPath(new URL('../src/', import.meta.url));

function sourceUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === 'node_modules') continue;
    out += readdirSync(dir, { withFileTypes: true }).find((d) => d.name === name)?.isDirectory()
      ? sourceUnder(full)
      : name.endsWith('.js')
        ? readFileSync(full, 'utf8') + '\n'
        : '';
  }
  return out;
}

const src = sourceUnder(ROOT);
const memberships = readFileSync(new URL('../src/services/memberships.js', import.meta.url), 'utf8');
const admin = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const practices = readFileSync(new URL('../src/routes/practices.js', import.meta.url), 'utf8');
const doctor = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');

describe('somebody actually creates a membership', () => {
  test('the service exists and is the only place that writes one', () => {
    assert.match(memberships, /Membership\.create\(/);

    // Every other caller goes through it. Four handlers each writing their own
    // is four copies of the rules below, and they are the rules that go wrong
    // quietly — a duplicate row shadowing the real one, an owner removed
    // leaving a practice nobody can manage.
    const direct = [...src.matchAll(/Membership\.create\(/g)].length;
    assert.equal(direct, 1, 'a route creates a membership without going through the service');
  });

  test('a person already in a practice is reactivated, not duplicated', () => {
    // Two rows for one pair is the failure that hurts later: `currentFilter`
    // finds one of them, and which one is whichever Mongo returns first.
    assert.match(memberships, /const existing = await Membership\.findOne\(\{ user, practice \}\)/);
  });

  test('the last owner cannot leave', () => {
    // A practice with no active owner cannot add staff, add a location, or be
    // handed over, and the only way back is the operator console or a shell.
    assert.match(memberships, /isOwner: true,\s*\n\s*status: MEMBERSHIP_STATUS\.ACTIVE/);
    assert.match(memberships, /only owner/);
  });
});

describe('a practice cannot be created without somebody in it', () => {
  test('the console requires a head doctor', () => {
    const body = admin.slice(admin.indexOf("router.post(\n  '/practices'"));
    assert.match(body.slice(0, 3000), /headDoctorName: z\.string\(\)/);
    assert.match(body.slice(0, 3000), /headDoctorPhoneToken: z\.string\(\)/);
  });

  test('and the number must have been answered, not typed', () => {
    // A regex tests the shape of a phone number and nothing about who holds it.
    // One mistyped digit here hands an entire practice to a stranger.
    assert.match(admin, /phoneFromToken\(headDoctorPhoneToken\) !== headDoctorPhone/);
  });

  test('a failure removes the practice rather than leaving an orphan', () => {
    // No transaction without a replica set, so the compensation is explicit.
    assert.match(admin, /await Practice\.deleteOne\(\{ _id: practice\._id \}\);/);
  });

  test('a doctor opening their own becomes its owner', () => {
    const block = practices.slice(practices.indexOf("router.post(\n  '/',"));
    assert.match(block.slice(0, 2000), /isOwner: true/);
    assert.match(block.slice(0, 2000), /VERIFICATION\.UNVERIFIED/);
  });
});

describe('the lists mean this practice, not the platform', () => {
  test('staff are scoped by membership', () => {
    // `{ role: STAFF, isActive: true }` was every staff account anywhere — the
    // same set while there was one clinic, and a receptionist appearing in
    // another practice's list the moment there are two.
    // The staff list moved to /team, which reads `membersOf(practiceId)` —
    // the practice taken from the membership, never from the request.
    const team = readFileSync(new URL('../src/routes/team.js', import.meta.url), 'utf8');
    assert.match(team, /membersOf\(practiceId\)/);
    assert.match(team, /const practiceId = await practiceOf\(req\)/);
  });

  test('and creating one writes the membership that makes the scope work', () => {
    // Hiring is one route for all three roles now, so the role is `b.role`
    // rather than a constant per path — which is the point: one path cannot
    // forget what another one remembers.
    const team = readFileSync(new URL('../src/routes/team.js', import.meta.url), 'utf8');
    assert.match(team, /joinPractice\(\{[\s\S]{0,200}role: b\.role/);
  });

  test('a new location belongs to a practice', () => {
    const clinics = readFileSync(new URL('../src/routes/clinics.js', import.meta.url), 'utf8');
    assert.match(clinics, /\.\.\.\(practiceId \? \{ practice: practiceId \} : \{\}\)/);
  });
});

describe('and every one of those still permits when the practice is unknown', () => {
  /**
   * The rule the whole migration rested on. A caller with no membership
   * predates the model rather than being an intruder, and denying them would
   * take the screen away from the clinic seeing patients right now.
   */
  test('staff scoping', () => {
    // The rule moved. It lived in doctor.js when the staff list was the only
    // list of people that was scoped at all; it is now in the shared helper
    // that the dietician list, the clinic list and every push notification
    // ask, so this reads the one place instead of one of five copies.
    const scope = readFileSync(
      new URL('../src/middleware/practiceScope.js', import.meta.url),
      'utf8',
    );
    assert.match(scope, /export async function memberIdsOf/);
    assert.match(scope, /if \(!practiceId\) return null;/);
    assert.match(scope, /if \(!rows\.length && !\(await membershipsExist\(\)\)\) return null;/);
    // practiceStaffFilter went with the routes that used it. The shared
    // helper it delegated to is still what the dietician list asks.
    assert.match(doctor, /practiceMembers\(req, ROLES\.DIETICIAN\)/);
  });

  test('locations', () => {
    const clinics = readFileSync(new URL('../src/routes/clinics.js', import.meta.url), 'utf8');
    assert.match(clinics, /practiceId \? \{ practice: practiceId \} : \{\}/);
  });

  test('and belonging to a practice at all', () => {
    assert.match(practices, /no membership anywhere — the pre-migration state/);
  });
});
