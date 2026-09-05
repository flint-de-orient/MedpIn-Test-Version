import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Everything exported can be reached by something that runs.
 *
 * ---- Why this test exists ------------------------------------------------
 *
 * `clinicIdentity()` was written with a cache, a fallback chain and a comment
 * saying it was read on every prescription and every AI turn. Nothing called
 * it. For one clinic that was invisible, because the env default happened to be
 * the right name; for a second practice it would have introduced their patients
 * to somebody else's doctor.
 *
 * Then it happened again, several times over: an enrolment flow, a
 * per-department assistant, a consent log and a record lifecycle, each with a
 * model and tests and no caller. Passing tests are not evidence a feature
 * works — only that the code does what it says when something calls it.
 *
 * Services and model methods both, because the first version of this checked
 * only services and `endAs` and `detachTo` hid in the gap. A half-built feature
 * takes exactly that shape: a method on a schema, tested, unreachable.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

/**
 * What legitimately has no caller, and why.
 *
 * Each needs a reason. A list of bare paths is where dead code gets filed when
 * the test is inconvenient, which is worse than not having the test.
 */
const EXEMPT = new Map([
  [
    'models/ShareGrant.js',
    'Sharing between practices and break-glass are fixed as shape and ' +
      'deliberately unbuilt — the decision is open, and the models exist so it ' +
      'can be answered later without unpicking anything around them.',
  ],
]);

/** Methods that render a document rather than doing anything. */
const SERIALISERS = new Set(['toPublic', 'toBrief', 'toJSON', 'nameIn', 'fromJson']);

const serviceFiles = walk(path.join(SRC, 'services'));
const modelFiles = walk(path.join(SRC, 'models'));

// Everything that can execute: routes, middleware, the services and models
// themselves, the entry point — `server.js` starts the crons, and a cron is
// reachable though no route calls it — and the scripts.
const surface = [
  ...walk(path.join(SRC, 'routes')),
  ...walk(path.join(SRC, 'middleware')),
  ...serviceFiles,
  ...modelFiles,
  path.join(SRC, 'server.js'),
  path.join(SRC, 'app.js'),
  ...walk(path.join(SRC, '..', 'scripts')),
]
  .filter(existsSync)
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const count = (hay, re) => (hay.match(re) ?? []).length;

describe('nothing is exported into a void', () => {
  test('every exported service function has a caller', () => {
    const orphans = [];

    for (const file of serviceFiles) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (EXEMPT.has(rel)) continue;

      for (const m of readFileSync(file, 'utf8').matchAll(/export (?:async )?function (\w+)/g)) {
        const name = m[1];

        // Every mention across the surface, less the declaration and the
        // import lines that only name it. What remains is a call — from a
        // route, middleware, a sibling, or inside its own file, which counts as
        // long as that caller is itself reachable.
        const calls =
          count(surface, new RegExp(`\\b${name}\\b`, 'g')) -
          count(surface, new RegExp(`export (?:async )?function ${name}\\b`, 'g')) -
          count(surface, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\}`, 'g'));

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

  test('every model method has a caller', () => {
    const orphans = [];

    for (const file of modelFiles) {
      const rel = path.relative(SRC, file).replace(/\\/g, '/');
      if (EXEMPT.has(rel)) continue;

      const src = readFileSync(file, 'utf8');

      for (const m of src.matchAll(/Schema\.(?:methods|statics)\.(\w+)/gi)) {
        const name = m[1];
        if (SERIALISERS.has(name)) continue;
        // ALL_CAPS on a schema is a constant hung there for convenience, not
        // behaviour. `Prescription.RECORD_STATE` is a lookup table, and a
        // lookup table has no caller to find.
        if (name === name.toUpperCase()) continue;

        // No subtraction here, unlike the service check above. A method is
        // declared as `.name = function`, which never matches `.name(` — so
        // taking the declaration off the count removed a call that was never
        // added, and every method with exactly one caller read as zero.
        const calls = count(surface, new RegExp(`\\.${name}\\(`, 'g'));

        if (calls === 0) orphans.push(`${rel}  .${name}()`);
      }
    }

    assert.deepEqual(
      orphans,
      [],
      `\n\nModel methods nothing calls:\n\n  ${orphans.join(
        '\n  ',
      )}\n\nA method on a schema is the shape a half-built feature takes.\n`,
    );
  });

  test('every exemption states a reason', () => {
    for (const [file, reason] of EXEMPT) {
      assert.ok(reason && reason.length > 40, `${file} is exempt without a real reason`);
    }
  });

  test('the exemption list stays small', () => {
    // A tripwire, not a limit. If it grows, the question is whether wiring has
    // become inconvenient rather than whether more code truly has no caller.
    assert.ok(EXEMPT.size <= 4, `${EXEMPT.size} exempt — is wiring being avoided?`);
  });
});
