import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * An account that belongs to nobody.
 *
 * ---- Reported as "I added the dietician and it did not appear" ----------
 *
 * The request succeeded. The account existed. The list stayed empty.
 *
 * `POST /doctor/dieticians` created a User and never created a Membership.
 * Staff creation had done it since the tenant model landed; this route was
 * written before it and never caught up. Nothing failed, because until the day
 * before there was nothing to fail: the dietician list was unscoped, so an
 * account belonging to no practice showed up in every practice — including,
 * by accident, the right one.
 *
 * Scoping that list turned the leak into a disappearance. Same missing line,
 * opposite symptom, and the second symptom is the one somebody notices.
 *
 * ---- Which is the more interesting half --------------------------------
 *
 * A missing membership does not read as a bug while the guards are permissive.
 * It reads as working software, right up until a guard starts working — and
 * then it reads as data loss. So this is not a test about dieticians. It is a
 * test that every path creating somebody who works at a practice says which
 * practice, at the moment it creates them.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function filesUnder(rel) {
  const dir = path.join(SRC, rel);
  return readdirSync(dir)
    .filter((n) => n.endsWith('.js'))
    .map((n) => ({ name: `${rel}/${n}`, src: readFileSync(path.join(dir, n), 'utf8') }));
}

/** The handler a `new User(` sits in, from `router.` to the end of the route. */
function handlerAround(src, index) {
  const from = src.lastIndexOf('router.', index);
  // The next route declaration, or the end of the file.
  const next = src.indexOf('\nrouter.', index);
  return src.slice(from === -1 ? 0 : from, next === -1 ? src.length : next);
}

/** Roles that are staff of a practice. A patient is enrolled, not employed. */
const CLINICAL = ['DOCTOR', 'STAFF', 'DIETICIAN'];

describe('creating somebody who works here says where they work', () => {
  for (const dir of ['routes', 'services']) {
    for (const { name, src } of filesUnder(dir)) {
      for (const m of src.matchAll(/new User\(\{/g)) {
        const handler = handlerAround(src, m.index);
        const created = src.slice(m.index, m.index + 400);

        // Only the ones making a colleague. Patients get an Enrollment, which
        // is a different relationship with a different backfill.
        const role = CLINICAL.find((r) => created.includes(`ROLES.${r}`));
        if (!role) continue;

        const line = src.slice(0, m.index).split('\n').length;
        test(`${name}:${line} — creates a ${role.toLowerCase()}`, () => {
          assert.ok(
            /joinPractice\(|joinByPhone\(/.test(handler),
            [
              '',
              `${name}:${line} creates a ${role.toLowerCase()} and never adds them to a practice.`,
              '',
              'The account will exist and belong to nobody. Every practice-scoped',
              'list will leave them out, and every guard will permit them',
              'everywhere, because a caller with no practice is the permissive',
              'case. Call joinPractice({ user, practice, role, addedBy }) in the',
              'same handler, as POST /team does.',
            ].join('\n'),
          );
        });
      }
    }
  }
});

describe('the one that was reported, and where the rule lives now', () => {

  const team = readFileSync(path.join(SRC, 'routes', 'team.js'), 'utf8');

  test('hiring anybody creates the membership', () => {
    // Three routes became one, which is the structural fix for the bug this
    // file is named after: the dietician path forgot because nothing held it
    // to what the staff path did. One path cannot disagree with itself.
    assert.match(team, /joinPractice\(\{/);
    assert.match(team, /role: b\.role/);
  });

  test('and the account is removed if that fails', () => {
    // The compensating half. An account with no membership belongs to nobody,
    // appears in no list, and holds a phone number that cannot be reused.
    assert.match(team, /await User\.deleteOne\(\{ _id: user\._id \}\)/);
  });

  test('an unknown practice refuses rather than orphaning an account', () => {
    // A deliberate change from what the old routes did. They created the
    // account without a membership — which is exactly the state that made a
    // dietician invisible, so knowingly repeating it would be permissiveness
    // about the wrong thing. Read guards still permit; this is a write with
    // nowhere to go.
    assert.match(team, /if \(!practiceId\) \{[\s\S]{0,140}badRequest\(/);
  });
});

describe('and nobody sets a colleague’s password', () => {
  const team = readFileSync(path.join(SRC, 'routes', 'team.js'), 'utf8');
  const form = readFileSync(
    new URL('../../mobile/lib/features/clinician/presentation/team_screen.dart', import.meta.url),
    'utf8',
  );

  test('the server refuses one, by name, for every role', () => {
    // It was required on the dietician path, then optional for everybody —
    // "for a handset that lives on a counter". Optional still meant somebody
    // choosing a credential for somebody else. The number is the credential:
    // the person has just answered a code on it. See
    // c7StaffAuthentication.test.js for the same thing over HTTP.
    assert.match(team, /PASSWORD_NOT_ALLOWED/);
    assert.ok(!/setPassword\(/.test(team), 'the hire route still writes a password');
  });

  test('and the form no longer offers one', () => {
    assert.ok(!/_setPassword|_password\b/.test(form), 'the hire sheet still has a password switch');
    assert.ok(!/labelText: 'Password'/.test(form), 'the hire sheet still has a password field');
    assert.ok(
      !form.includes("'They can sign in with this number and password.'"),
      'the sheet still promises a password',
    );
  });
});
