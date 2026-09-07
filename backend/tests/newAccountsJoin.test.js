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
              'same handler, as POST /doctor/staff does.',
            ].join('\n'),
          );
        });
      }
    }
  }
});

describe('the two that were reported', () => {
  const doctor = readFileSync(path.join(SRC, 'routes', 'doctor.js'), 'utf8');

  function routeBody(marker) {
    const at = doctor.indexOf(marker);
    assert.ok(at > 0, `${marker} moved`);
    const next = doctor.indexOf('\nrouter.', at);
    return doctor.slice(at, next === -1 ? doctor.length : next);
  }

  test('a new dietician joins the practice', () => {
    const body = routeBody("router.post(\n  '/dieticians'");
    assert.match(body, /joinPractice\(\{/);
    assert.match(body, /role: ROLES\.DIETICIAN/);
  });

  test('and a new desk account still does', () => {
    const body = routeBody("router.post(\n  '/staff'");
    assert.match(body, /joinPractice\(\{/);
    assert.match(body, /role: ROLES\.STAFF/);
  });

  test('both permit when the practice is unknown', () => {
    // A doctor whose own membership predates the backfill can still hire. The
    // account is created without one rather than the request being refused —
    // which is the same rule the read guards follow.
    for (const marker of ["router.post(\n  '/dieticians'", "router.post(\n  '/staff'"]) {
      assert.match(routeBody(marker), /if \(practiceId\) \{/);
    }
  });
});

describe('and nobody has to invent a colleague’s password', () => {
  const doctor = readFileSync(path.join(SRC, 'routes', 'doctor.js'), 'utf8');
  const form = readFileSync(
    new URL('../../mobile/lib/features/clinician/presentation/dieticians_screen.dart', import.meta.url),
    'utf8',
  );

  test('the server takes it as optional, both for staff and for a dietician', () => {
    // It was required on exactly one of the two, which is the inconsistency
    // that was reported. A dietician has their own phone and has just answered
    // a code on it; the number is the credential.
    const optional = [
      ...doctor.matchAll(/password: z\.string\(\)\.min\(8[^\n]*\.optional\(\)/g),
    ];
    assert.equal(optional.length, 2, 'a password is mandatory on one of the two again');
  });

  test('and the form offers it rather than demanding it', () => {
    assert.match(form, /bool _setPassword = false;/);
    assert.match(form, /password: _setPassword \? _password\.text : null/);
    assert.ok(
      !form.includes("'They can sign in with this number and password.'"),
      'the sheet still promises a password it no longer requires',
    );
  });
});
