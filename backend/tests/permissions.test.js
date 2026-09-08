import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { Membership, PERMISSIONS, PRESETS, presetFor } from '../src/models/Membership.js';
import { authorisationIsComplete } from '../src/middleware/authorise.js';
import { ROLES } from '../src/models/User.js';

const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));

/**
 * What a membership may do, and the two ways this could have taken the clinic
 * down.
 *
 * The first is the empty grant. The backfill ran before `permissions` was a
 * field, so every row on the live deployment has none. Read literally, that
 * denies every action to every member of the practice seeing patients this
 * morning. The second is the temptation to call four questions five.
 */
describe('an empty grant cannot lock anybody out', () => {
  const current = (over = {}) =>
    new Membership({
      user: '000000000000000000000001',
      practice: '000000000000000000000002',
      role: ROLES.DOCTOR,
      ...over,
    });

  test('a row written before permissions existed falls back to its preset', () => {
    // Exactly the rows on the VPS right now. `permissions` is set on the way in
    // by a hook, so this forces the pre-migration shape directly.
    const m = current({ isOwner: true });
    m.permissions = [];
    assert.equal(m.can(PERMISSIONS.PRESCRIBE), true);
    assert.equal(m.can(PERMISSIONS.MANAGE_STAFF), true);
  });

  test('the fallback respects the role — it is not a blanket yes', () => {
    // The desk falling back must not fall back into prescribing.
    const desk = current({ role: ROLES.STAFF });
    desk.permissions = [];
    assert.equal(desk.can(PERMISSIONS.VIEW_PATIENT), true);
    assert.equal(desk.can(PERMISSIONS.PRESCRIBE), false);
    assert.equal(desk.can(PERMISSIONS.MANAGE_STAFF), false);
  });

  test('a stored grant wins over the preset', () => {
    // Once the migration writes real sets, they are the answer — including a
    // set narrower than the role's preset.
    const m = current({ isOwner: true });
    m.permissions = [PERMISSIONS.VIEW_PATIENT];
    assert.equal(m.can(PERMISSIONS.VIEW_PATIENT), true);
    assert.equal(m.can(PERMISSIONS.PRESCRIBE), false);
  });

  test('a suspended or ended member is refused whatever they hold', () => {
    for (const over of [{ status: 'suspended' }, { endedOn: new Date() }]) {
      const m = current({ isOwner: true, ...over });
      assert.equal(m.can(PERMISSIONS.PRESCRIBE), false, JSON.stringify(over));
    }
  });

  test('a new row is seeded with its preset', async () => {
    const m = current({ role: ROLES.DOCTOR });
    await m.validate();
    assert.deepEqual(m.permissions, PRESETS.clinician);
  });
});

describe('the presets', () => {
  test('the desk cannot prescribe or manage staff', () => {
    assert.ok(!PRESETS.desk.includes(PERMISSIONS.PRESCRIBE));
    assert.ok(!PRESETS.desk.includes(PERMISSIONS.MANAGE_STAFF));
    assert.ok(!PRESETS.desk.includes(PERMISSIONS.VIEW_AUDIT));
  });

  test('a clinician prescribes but does not administer', () => {
    assert.ok(PRESETS.clinician.includes(PERMISSIONS.PRESCRIBE));
    assert.ok(!PRESETS.clinician.includes(PERMISSIONS.MANAGE_STAFF));
  });

  test('the head holds everything', () => {
    assert.deepEqual([...PRESETS.head].sort(), Object.values(PERMISSIONS).sort());
  });

  test('an owner gets the head preset whatever their role says', () => {
    assert.deepEqual(presetFor({ role: ROLES.STAFF, isOwner: true }), PRESETS.head);
  });
});

describe('the guard is wired where it matters', () => {
  const routeSrc = (f) => readFileSync(path.join(ROUTES, f), 'utf8');

  test('prescribing requires PRESCRIBE', () => {
    assert.match(routeSrc('prescriptions.js'), /requirePermission\(PERMISSIONS\.PRESCRIBE\)/);
  });

  test('hiring requires MANAGE_STAFF', () => {
    // One route hires and one changes a job, both in team.js. It was two
    // creation routes in doctor.js — the count is the same and the reason is
    // different, which is why this names the file it means.
    const src = routeSrc('team.js');
    assert.equal((src.match(/requirePermission\(PERMISSIONS\.MANAGE_STAFF\)/g) ?? []).length, 2);
  });

  test('creating and editing departments requires MANAGE_DEPARTMENT', () => {
    const src = routeSrc('departments.js');
    assert.equal(
      (src.match(/requirePermission\(PERMISSIONS\.MANAGE_DEPARTMENT\)/g) ?? []).length,
      2,
    );
  });

  test('every wiring sits beside a role guard, never instead of one', () => {
    // The permission is the practice's grant; the role guard is the platform's.
    // A route that dropped requireDoctor and kept only the permission would
    // admit anyone whose membership row happened to carry it.
    for (const f of readdirSync(ROUTES).filter((n) => n.endsWith('.js'))) {
      const src = routeSrc(f);
      for (const m of src.matchAll(/requirePermission\(PERMISSIONS\.(\w+)\)/g)) {
        const before = src.slice(Math.max(0, m.index - 400), m.index);
        assert.ok(
          /require(Doctor|Clinician|Role)/.test(before),
          `${f}: requirePermission(${m[1]}) has no role guard above it`,
        );
      }
    }
  });
});

describe('all five questions are answered', () => {
  test('the middleware says so out loud', () => {
    // This was pinned false while Enrollment did not exist, so that the gap
    // could not be forgotten. Enrollment exists; the flag moves with it.
    assert.equal(authorisationIsComplete, true);
  });

  test('question 4 asks the real question', () => {
    const src = readFileSync(new URL('../src/middleware/authorise.js', import.meta.url), 'utf8');
    assert.match(src, /export async function enrollmentGate/);
    // Not a stub any more: it consults the enrollment and refuses.
    assert.match(src, /practiceMaySee\(practiceId, patientId/);
    assert.match(src, /throw forbidden\(/);

    // The stub returned true and nothing else. The real one has a conditional
    // return and a refusal, so counting them distinguishes the two without a
    // brittle whole-body match.
    const body = src.slice(src.indexOf('export async function enrollmentGate'));
    const gate = body.slice(0, body.indexOf('\n}\n') + 2);
    // Matched on the condition, not the whole line — the permit gained a body
    // when it started keeping the enrolment for the reads that follow, and a
    // test pinned to the one-liner failed on an addition it should not care
    // about.
    assert.ok(gate.includes('if (verdict.allowed)'), 'no conditional permit');
    assert.ok(gate.includes('return true;'), 'the permit never returns');
    assert.ok(gate.includes('throw forbidden('), 'the gate cannot refuse');
  });

  test('it is wired into the one place every clinical route passes', () => {
    const auth = readFileSync(new URL('../src/middleware/auth.js', import.meta.url), 'utf8');
    assert.match(auth, /await enrollmentGate\(req, patient\._id\);/);
  });
});

describe('the permissions backfill', () => {
  const src = readFileSync(
    new URL('../scripts/backfillPermissions.js', import.meta.url),
    'utf8',
  );

  test('only fills an empty set', () => {
    // A row that already lists permissions may have been chosen rather than
    // derived, and a migration that overwrites a choice is a migration that
    // teaches people not to make choices.
    assert.match(src, /permissions: \{ \$size: 0 \}/);
    assert.match(src, /permissions: \{ \$exists: false \}/);
  });

  test('does not write unless asked', () => {
    assert.match(src, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(src, /if \(!apply\)/);
  });
});
