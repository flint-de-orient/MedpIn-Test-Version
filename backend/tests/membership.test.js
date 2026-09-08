import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';

/**
 * A person's place in a practice.
 *
 * `User.role` says what someone is once, everywhere, which was true while there
 * was one practice. These pin the rules that make the two-practice case work,
 * and — just as importantly — the rule that nothing has switched over yet.
 */
describe('the model', () => {
  test('a membership is active and not an owner by default', () => {
    const m = new Membership({
      user: '000000000000000000000001',
      practice: '000000000000000000000002',
      role: ROLES.STAFF,
    });
    assert.equal(m.status, MEMBERSHIP_STATUS.ACTIVE);
    assert.equal(m.isOwner, false);
    assert.equal(m.endedOn, null);
    assert.ok(m.isCurrent());
  });

  test('an invited person has no access yet', () => {
    // Added but not accepted. Checking only `endedOn` would let them in.
    const m = new Membership({
      user: '000000000000000000000001',
      practice: '000000000000000000000002',
      role: ROLES.DOCTOR,
      status: MEMBERSHIP_STATUS.INVITED,
    });
    assert.equal(m.isCurrent(), false);
  });

  test('someone who has left has no access either', () => {
    // The other half. A row can be `active` and ended — that is precisely the
    // receptionist who worked here until March, and checking only `status`
    // misses them.
    const m = new Membership({
      user: '000000000000000000000001',
      practice: '000000000000000000000002',
      role: ROLES.STAFF,
      endedOn: new Date('2026-03-31'),
    });
    assert.equal(m.status, MEMBERSHIP_STATUS.ACTIVE);
    assert.equal(m.isCurrent(), false);
  });

  test('owner is a flag, not a fifth role', () => {
    // A head doctor is a doctor who also administers. As a role it would force
    // every clinical check to ask "doctor OR owner", and the day someone
    // forgets the second half is the day an owner cannot prescribe.
    assert.ok(!Object.values(ROLES).includes('owner'));
    const path = Membership.schema.path('role');
    assert.deepEqual([...path.enumValues].sort(), [...Object.values(ROLES)].sort());
    assert.ok(Membership.schema.path('isOwner'));
  });

  test('one row per person per practice', () => {
    // Changing someone's role edits the row. A second row is a duplicate, not
    // a promotion, and two rows means two answers to "what are they here".
    const idx = Membership.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find((i) => i.f.user === 1 && i.f.practice === 1);
    assert.ok(unique, 'no user+practice index');
    assert.equal(unique.o.unique, true);
  });

  test('"who works here" is indexed', () => {
    const idx = Membership.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.practice === 1 && f.status === 1 && f.role === 1));
  });

  test('currentFilter excludes both the invited and the departed', () => {
    // The definition of "currently" lives once. It had been written out three
    // times — here, in the practice resolver and in the membership lookup —
    // and three copies is two chances for them to drift, with the one that
    // drifts being the one that stops excluding somebody who left.
    const q = Membership.currentFilter('000000000000000000000001');
    assert.equal(q.status, MEMBERSHIP_STATUS.ACTIVE);
    assert.equal(q.endedOn, null);
    assert.ok(!('practice' in q), 'no practice given should not scope the filter');
  });

  test('and scopes to a practice when given one', () => {
    const q = Membership.currentFilter('000000000000000000000001', '000000000000000000000002');
    assert.equal(String(q.practice), '000000000000000000000002');
  });

  test('both middleware paths use it rather than their own copy', () => {
    for (const f of ['authorise.js', 'practiceScope.js']) {
      const src = readFileSync(new URL(`../src/middleware/${f}`, import.meta.url), 'utf8');
      assert.match(src, /Membership\.currentFilter\(/, `${f} hand-rolls the filter`);
    }
  });
});

describe('nothing has switched over yet', () => {
  const backfill = readFileSync(
    new URL('../scripts/backfillPractices.js', import.meta.url),
    'utf8',
  );

  test('the backfill copies User.role, it does not move it', () => {
    // Flipping authorisation to memberships in the same commit that creates
    // the rows is how a clinic finds itself logged out on a Monday morning.
    assert.ok(!/\$unset[\s\S]{0,80}role/.test(backfill), 'the backfill clears User.role');
    assert.ok(
      !/User\.updateMany[\s\S]{0,120}role/.test(backfill),
      'the backfill rewrites User.role',
    );
    assert.match(backfill, /role: person\.role/);
  });

  test('enrolling is idempotent', () => {
    // The script is re-runnable by design; a second run must not reset
    // somebody whose role was corrected by hand afterwards.
    assert.match(backfill, /\$setOnInsert/);
    assert.match(backfill, /upsert: true/);
  });

  test('the head doctor is the owner and nobody else is', () => {
    assert.match(backfill, /isOwner: String\(person\._id\) === String\(headDoctor/);
  });
});

describe('the practice screen survives a missing backfill', () => {
  const route = readFileSync(new URL('../src/routes/practices.js', import.meta.url), 'utf8');

  test('membership is preferred but never required', () => {
    // There is a window between this deploying and the migration running, and
    // an account that predates memberships entirely. Neither should lose the
    // screen.
    assert.match(route, /Membership\.findOne\(/);
    assert.match(route, /if \(!practice\) \{[\s\S]{0,200}Clinic\.findOne/);
  });

  test('a working clinic never reports having nobody in it', () => {
    // Counting only memberships would show "0 doctors" on a working clinic for
    // as long as the migration had not been run, so the platform-wide count is
    // still the answer in that window.
    assert.match(route, /countsFromRoles\(\)/);
    assert.match(route, /async function membershipsExist\(\)/);
  });

  test('but a practice that genuinely has nobody says zero', () => {
    // The fallback used to fire whenever *this* practice had no membership
    // rows, which was right for exactly as long as no practice had any. After
    // the backfill it meant a newly created practice reported the founding
    // clinic's headcount as its own, on the first screen its owner opens.
    //
    // The collection being empty is what tells "not migrated" from "genuinely
    // nobody" — the same distinction practiceScope.js draws, for the same
    // reason.
    assert.match(route, /membershipsExist\(\)\) \? EMPTY_COUNTS : await countsFromRoles\(\)/);
  });
});
