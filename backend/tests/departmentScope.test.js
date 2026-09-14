import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The router that shipped unreachable, and what that cost.
 *
 * ---- Six routes, no callers, no review ----------------------------------
 *
 * `/api/v1/departments` was mounted, complete, and called by nothing — not the
 * app, not the console. Nobody exercised it, so nobody noticed that every route
 * in it decided which practice it was operating on by reading the request:
 *
 *   GET   /                  `req.query.practice`
 *   POST  /                  `req.body.practice`
 *   PATCH /:id               nothing at all
 *   POST  /doctors/:id       `req.body.practice`
 *   DELETE /doctors/:id/...  nothing at all
 *
 * The worst was POST's fallback: `req.body.practice ?? req.user.practice ??
 * null`. `User` has no `practice` field — it lives on the membership — so a
 * department created without one in the body got `null`, and `null` in this
 * collection means *shared with every practice on the platform*.
 *
 * That is a write into every other tenant, from a route any doctor could call,
 * with no screen anywhere that would have shown who did it.
 *
 * ---- Which is the lesson worth keeping ----------------------------------
 *
 * `noDeadServices` checks that services have route callers. `adminPanel`
 * checks that admin routes have console callers. Neither looks at the mobile
 * app, and this is what fell through: code that is finished, mounted and
 * unreviewed, because nothing that runs touches it.
 */
const src = readFileSync(new URL('../src/routes/departments.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/models/Department.js', import.meta.url), 'utf8');

/** The handler for a route, from its declaration to the next one. */
function route(marker) {
  const at = src.indexOf(marker);
  assert.ok(at > 0, `${marker} moved`);
  const next = src.indexOf('\nrouter.', at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

describe('the caller does not choose the tenant', () => {
  test('not from the query string', () => {
    assert.ok(
      !/req\.query\.practice/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      'a route reads the practice from the query string again',
    );
  });

  test('not from the body', () => {
    assert.ok(
      !/req\.body\.practice/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      'a route reads the practice from the body again',
    );
  });

  test('and not from a field that does not exist', () => {
    // `req.user.practice` is undefined — the practice lives on the membership.
    // Reading it was what made every created department platform-shared.
    assert.ok(
      !/req\.user\.practice/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
      'User.practice is being read again; it has never existed',
    );
  });

  test('every route that needs one asks the membership', () => {
    for (const marker of [
      "router.get(\n  '/',",
      "router.post(\n  '/',",
      "router.patch(\n  '/:id',",
      "router.post(\n  '/doctors/:id',",
    ]) {
      assert.match(
        route(marker),
        /practiceOf\(req\)|assertColleague\(/,
        `${marker.replace(/\n\s*/g, ' ')} does not establish whose practice this is`,
      );
    }
  });
});

describe('a new department belongs to somebody', () => {
  const body = route("router.post(\n  '/',");

  test('an unknown practice is refused, not defaulted to null', () => {
    // The one place in this codebase where unknown refuses. `null` here does
    // not mean unknown, it means shared with everybody — so defaulting is a
    // write into every other tenant rather than a permissive read.
    assert.match(body, /const practice = await practiceOf\(req\);/);
    assert.match(body, /if \(!practice\) \{[\s\S]{0,200}badRequest\(/);
  });

  test('and the schema no longer accepts a practice it would ignore', () => {
    assert.ok(
      !/practice: z\.string\(\)/.test(body),
      'the body schema takes a practice the handler does not read',
    );
  });
});

describe('one practice cannot edit another’s', () => {
  const body = route("router.patch(\n  '/:id',");

  test('shared rows stay uneditable', () => {
    assert.match(body, /This is a shared specialty and cannot be edited here/);
  });

  test('and so does somebody else’s own', () => {
    // The shared check stopped one practice renaming a specialty for everybody.
    // It did nothing about one practice renaming another practice's.
    assert.match(body, /String\(dept\.practice\) !== String\(mine\)/);
    // notFound rather than forbidden: confirming the id exists is an answer.
    assert.match(body, /throw notFound\('Department not found'\)/);
  });
});

describe('a doctor is only moved by somebody entitled to move them', () => {
  test('your own record is yours', () => {
    // A blanket MANAGE_DEPARTMENT would be the obvious fix and the wrong one:
    // a doctor setting their own primary specialty is not an administrative
    // act, and needing the head for it is how a letterhead stays wrong.
    assert.match(src, /async function mayChangeDepartmentsOf\(req, userId\)/);
    assert.match(src, /if \(String\(req\.user\._id\) === String\(userId\)\) return true;/);
  });

  test('somebody else’s needs the permission', () => {
    assert.match(src, /membership\.can\(PERMISSIONS\.MANAGE_DEPARTMENT\)/);
    for (const marker of ["router.post(\n  '/doctors/:id',", "router.delete("]) {
      assert.match(route(marker), /mayChangeDepartmentsOf\(req, req\.params\.id\)/);
    }
  });

  test('and it permits when there is no membership to read', () => {
    assert.match(src, /if \(!membership\) return true;/);
  });

  test('the department has to be one this practice can use', () => {
    // Assigning into somebody else's department wrote their practice id onto
    // the row.
    const body = route("router.post(\n  '/doctors/:id',");
    assert.match(body, /\$or: \[\{ practice: null \}/);
  });
});

describe('managing departments needs the capability, not only the permission', () => {
  test('both gates, on both write routes', () => {
    // They answer different questions. The permission says this person
    // administers departments; the capability says the practice has them at
    // all. A solo clinic's owner holds the first and has nothing to manage.
    for (const marker of ["router.post(\n  '/',", "router.patch(\n  '/:id',"]) {
      const body = route(marker);
      assert.match(body, /requirePermission\(PERMISSIONS\.MANAGE_DEPARTMENT\)/);
      assert.match(body, /requireCapability\(CAPABILITIES\.DEPARTMENT\)/);
    }
  });

  test('reading stays open to any clinician', () => {
    // The desk needs the list to say which doctor a patient is booked with,
    // and a practice with no DEPARTMENT capability still sees the shared
    // specialties. Gating the read would empty a screen for no gain.
    const body = route("router.get(\n  '/',");
    assert.ok(!/requireCapability/.test(body), 'reading the list now needs a capability');
  });
});

describe('the model points at the right collection', () => {
  test('Department.practice refs Practice, not Clinic', () => {
    // Inert — a ref only matters to populate() and nothing populated this one.
    // But admin.js queries it with a Practice id, so the declaration and every
    // caller already disagreed, and the day somebody adds a populate it
    // returns null for every row: "this practice has no departments".
    assert.match(model, /practice: \{ type: mongoose\.Schema\.Types\.ObjectId, ref: 'Practice'/);
    // As a declaration, not anywhere in the file. The comment above the field
    // names the old ref to say why it changed, and a test that cannot tell a
    // declaration from an explanation forbids explaining anything.
    assert.ok(
      !/type: mongoose\.Schema\.Types\.ObjectId, ref: 'Clinic'/.test(model),
      'Department.practice points at Clinic again',
    );
  });
});

describe('a clinician answers their own department’s threads', () => {
  const scope = readFileSync(new URL('../src/middleware/practiceScope.js', import.meta.url), 'utf8');
  const doctor = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');

  test('the unassigned ones stay everybody’s', () => {
    // A thread names a department and anybody in it may answer — that is why
    // the schema names a department rather than a doctor. But most threads
    // carry null: a solo practice has none to choose from, and every message
    // sent before departments existed has none. Narrowing to `department: mine`
    // alone would empty the inbox of the clinic running today.
    assert.match(scope, /export async function departmentThreads\(req, field = 'department'\)/);
    assert.match(scope, /\{ \$or: \[\{ \[field\]: mine \}, \{ \[field\]: null \}\] \}/);
  });

  test('and no department on the caller narrows nothing', () => {
    // Every membership the backfill created.
    assert.match(scope, /if \(!mine\) return \{\};/);
  });

  test('the badge counts what the list shows', () => {
    // Two reads of the same threads with different filters is a dashboard
    // saying eleven over a screen showing four. Inside `$and` beside the
    // practice's conversations, because both filters can be an `$or` and a
    // spread keeps only the second — see services/conversationPractice.js.
    const bell = doctor.slice(doctor.indexOf("'/notifications',"), doctor.indexOf("'/notifications/seen'"));
    const inBell = [...bell.matchAll(/\$and: \[\s*await practiceSessions\(req\),[\s\S]{0,200}?await departmentThreads\(req\),?\s*\]/g)];
    assert.equal(inBell.length, 2, 'the flagged count and the flagged list disagree');

    const worklist = doctor.slice(doctor.indexOf("'/worklist',"));
    assert.match(worklist.slice(0, 2500), /\$and: \[await practiceSessions\(req\), await departmentThreads\(req\)\]/);
  });
});
