import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Every exported service can be reached by something that runs.
 *
 * ---- Why this test exists ------------------------------------------------
 *
 * `clinicIdentity()` was written with a cache, a fallback chain and a comment
 * saying it was read on every prescription and every AI turn. Nothing called
 * it. For one clinic that was invisible, because the env default happened to be
 * the right name; for a second practice it would have introduced their patients
 * to somebody else's doctor.
 *
 * Then the same thing happened again, several times over, in one session: an
 * enrolment flow, a per-department assistant, a consent log and a record
 * lifecycle, each with a model and tests and no caller. Passing tests are not
 * evidence a feature works — only that the code does what it says when
 * something calls it.
 *
 * So this walks the service layer and fails on anything nothing can reach.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * Services that legitimately have no caller, and why.
 *
 * Each needs a reason. A list of bare paths is where dead code gets filed when
 * the test is inconvenient, which is worse than not having the test at all.
 */
const EXEMPT = new Map([
  [
    'models/ShareGrant.js',
    'Sharing between practices and break-glass access are fixed as shape and ' +
      'deliberately unbuilt — the decision is open, and the models exist so it ' +
      'can be answered later without unpicking anything.',
  ],
]);

describe('no service is unreachable', () => {
  const serviceFiles = walk(path.join(SRC, 'services'));

  // Everything that can execute: routes, middleware, the services themselves,
  // and the process entry point — `server.js` starts the crons, and a cron is
  // reachable though no route calls it.
  const surface = [
    ...walk(path.join(SRC, 'routes')),
    ...walk(path.join(SRC, 'middleware')),
    ...serviceFiles,
    path.join(SRC, 'server.js'),
    path.join(SRC, 'app.js'),
    // Scripts execute too. A seed or a migration is a caller, even though no
    // request reaches it.
    ...walk(path.join(SRC, '..', 'scripts')),
  ]
    .filter(existsSync)
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');

  test('every exported function has a caller', () => {
    const orphans = [];

    for (const file of serviceFiles) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (EXEMPT.has(rel)) continue;

      for (const m of readFileSync(file, 'utf8').matchAll(/export (?:async )?function (\w+)/g)) {
        const name = m[1];

        // Every mention across that surface, minus the declaration itself and
        // the import lines that only name it. What is left is a call — from a
        // route, from middleware, from a sibling, or from inside its own file,
        // which counts as long as the caller is itself reachable.
        const decl = new RegExp(`export (?:async )?function ${name}\\b`, 'g');
        const imported = new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\}`, 'g');
        const mention = new RegExp(`\\b${name}\\b`, 'g');

        const calls =
          (surface.match(mention) ?? []).length -
          (surface.match(decl) ?? []).length -
          (surface.match(imported) ?? []).length;

        if (calls <= 0) orphans.push(`${rel}  ${name}()`);
      }
    }

    assert.deepEqual(
      orphans,
      [],
      `\n\nExported, and nothing can reach them:\n\n  ${orphans.join(
        '\n  ',
      )}\n\nWire each to a route, or add it to EXEMPT with a reason.\nCode with no caller is not a feature — it is a plan that passes tests.\n`,
    );
  });

  test('every exemption states a reason', () => {
    for (const [file, reason] of EXEMPT) {
      assert.ok(reason && reason.length > 40, `${file} is exempt without a real reason`);
    }
  });

  test('the exemption list stays small', () => {
    // A tripwire, not a limit. If it grows, the question is whether wiring has
    // become inconvenient rather than whether more services truly have no
    // caller.
    assert.ok(EXEMPT.size <= 4, `${EXEMPT.size} exempt — is wiring being avoided?`);
  });
});
