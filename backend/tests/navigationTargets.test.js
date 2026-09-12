import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Every button goes somewhere that exists.
 *
 * ---- The failure, which has already happened here -----------------------
 *
 * The Book button on the patient's appointments screen pushed
 * `/care/appointments/book`. There is no `/care` branch and no `errorBuilder`,
 * so a patient tapping it got go_router's "page not found" — the one button in
 * the app whose entire job is getting somebody seen.
 *
 * Nothing catches that. `flutter analyze` sees a string; the route is resolved
 * at runtime, on a real tap, by whoever tapped it. A dead destination is not a
 * compile error and not a test failure: it is a person standing in a clinic
 * looking at an error page.
 *
 * ---- Why this lives in the backend suite --------------------------------
 *
 * Beside appCallsRoutes.test.js, which reads `mobile/lib` for the same reason:
 * this is the suite that runs, and a check nobody runs is a check that does
 * not exist. Both read Dart as text — no Flutter toolchain, no emulator.
 */

const MOBILE = fileURLToPath(new URL('../../mobile/lib/', import.meta.url));
const ROUTER = path.join(MOBILE, 'core/router/app_router.dart');

function dartUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += dartUnder(full);
    else if (name.endsWith('.dart')) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

/**
 * Every route the router declares, as a full path.
 *
 * go_router nests: a child declares `path: 'edit'` and lives at
 * `/profile/edit`. A first version of this compared pushed paths against the
 * literals and reported nine dead buttons, every one of them a nested child —
 * a checker that cries wolf gets deleted, and then the real one is not caught
 * either.
 *
 * The nesting is literal in the source, so bracket depth resolves it: a
 * relative path belongs to the nearest preceding declaration at a lower depth.
 */
function declaredRoutes() {
  const src = readFileSync(ROUTER, 'utf8');
  const marks = [];
  let depth = 0;

  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;

    if (src.startsWith("path: '", i)) {
      const end = src.indexOf("'", i + 7);
      marks.push({ path: src.slice(i + 7, end), depth });
    }
  }

  const out = [];
  const stack = [];
  for (const m of marks) {
    while (stack.length && stack[stack.length - 1].depth >= m.depth) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].full : '';
    const full = m.path.startsWith('/')
      ? m.path
      : `${parent.replace(/\/$/, '')}/${m.path}`;
    out.push(full);
    stack.push({ depth: m.depth, full });
  }
  return out;
}

/** Every Dart file under `lib/`, with its path. */
function dartFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...dartFiles(full));
    else if (name.endsWith('.dart')) out.push({ file: full, source: readFileSync(full, 'utf8') });
  }
  return out;
}

/** The routed files, resolved once: which area prefixes each widget class is built under. */
const ROUTED = (() => {
  const src = readFileSync(ROUTER, 'utf8');
  const routes = declaredRoutes();

  // `builder:` lines name the widget. Paired with the route declared just
  // before them, which is how go_router reads: path, then what it builds.
  const marks = [];
  for (const m of src.matchAll(/path: '([^']+)'|\b([A-Z][A-Za-z0-9_]*)\s*\(/g)) {
    marks.push({ at: m.index, path: m[1], widget: m[2] });
  }

  /** widget class → the set of area prefixes it is routed under. */
  const byWidget = new Map();
  let i = 0;
  let current = null;
  for (const m of marks) {
    if (m.path !== undefined) {
      current = routes[i];
      i += 1;
      continue;
    }
    if (!current) continue;
    const prefix = `/${current.split('/').filter(Boolean)[0] ?? ''}`;
    if (!byWidget.has(m.widget)) byWidget.set(m.widget, new Set());
    byWidget.get(m.widget).add(prefix);
  }
  return byWidget;
})();

/**
 * Which area prefixes this file's screens are reachable from.
 *
 * Direct first: a class the router builds. Then one level of imports, which
 * covers a sheet or dialog shown from a screen — `appointment_manage_sheet`
 * pushes by area prefix and is not itself a route.
 */
function areasHosting(file, source) {
  const classes = [...source.matchAll(/^class ([A-Z][A-Za-z0-9_]*)/gm)].map((m) => m[1]);
  const found = new Set();
  for (const c of classes) for (const p of ROUTED.get(c) ?? []) found.add(p);
  if (found.size) return found;

  // Nothing here is routed, so ask who imports it.
  const base = path.basename(file);
  for (const { file: other, source: src } of dartFiles(MOBILE)) {
    if (other === file) continue;
    if (!src.includes(`/${base}'`) && !src.includes(`'${base}'`)) continue;
    for (const p of areasHosting(other, src)) found.add(p);
  }
  return found;
}

/** Every literal destination the app navigates to. */
function pushedTargets(app) {
  return [
    ...new Set(
      [...app.matchAll(/context\.(?:push|go|pushReplacement)\(\s*'([^']+)'/g)].map(
        (m) => m[1],
      ),
    ),
  ];
}

describe('no button goes nowhere', () => {
  const app = dartUnder(MOBILE);
  const declared = declaredRoutes();
  const patterns = declared.map(
    (p) => new RegExp(`^${p.replace(/:[A-Za-z]+/g, '[^/]+')}$`),
  );

  test('the router was actually parsed', () => {
    // Every assertion below passes on an empty list. This one does not.
    assert.ok(declared.length > 50, `only ${declared.length} routes found — did the parser break?`);
    assert.ok(declared.every((p) => p.startsWith('/')), 'a route resolved to a relative path');
    assert.ok(declared.includes('/profile/edit'), 'nested children are not being resolved');
  });

  test('every destination in the app is a route that exists', () => {
    const dead = [];

    for (const raw of pushedTargets(app)) {
      /*
       * Dart interpolation is a path segment, whatever it evaluates to —
       * `/clinician/patients/$id` is a route with one variable in it, and the
       * router's own `:id` is the same shape.
       *
       * A target that *starts* with interpolation is built from `areaPrefix`
       * and is checked in the test below instead: which prefix it resolves to
       * is a question about who is signed in, not about the string.
       */
      const resolved = raw
        .replace(/\$\{[^}]+\}/g, 'X')
        .replace(/\$[A-Za-z_]+/g, 'X');
      if (resolved.startsWith('X')) continue;
      if (patterns.some((re) => re.test(resolved))) continue;
      dead.push(raw);
    }

    assert.deepEqual(
      dead,
      [],
      `\n\nThese are pushed and the router declares no such route:\n\n  ${dead.join(
        '\n  ',
      )}\n\nA dead destination is not a compile error. It is somebody tapping a\nbutton in a clinic and getting "page not found".\n`,
    );
  });

  test('and a shared screen can reach its own destinations from every area it appears in', () => {
    /*
     * `'${areaPrefix(ref)}/patients/new'` resolves differently per role, and
     * the whole reason areaPrefix exists is that pushing `/clinician/...`
     * outright was a dead end for the front desk: tapping a patient, or the
     * register button, redirected straight back to Today with nothing saying
     * why. The screen looked broken because half its destinations were in an
     * area its own user is not allowed into.
     *
     * ---- Only the areas that actually host the screen -------------------
     *
     * Not every prefix `areaPrefix` can return. This asked that first and
     * reported `/dietician/patients/X/thread` as dead — which it is, and it
     * does not matter, because a dietician never opens the screen that pushes
     * it. They have their own patients screen. A check that reports three
     * findings nobody can act on is one somebody switches off, and then the
     * real one goes with it.
     *
     * So the question is per-screen: which routes build this file's widgets,
     * what area are those routes in, and does the destination exist there.
     */
    const missing = [];

    for (const { file, source } of dartFiles(MOBILE)) {
      const tails = [
        ...new Set(
          [...source.matchAll(/context\.(?:push|go|pushReplacement)\(\s*'\$\{areaPrefix\([^)]*\)\}([^']+)'/g)].map(
            (m) => m[1],
          ),
        ),
      ];
      if (!tails.length) continue;

      const areas = areasHosting(file, source);
      /*
       * A file nothing hosts is a widget shown from another screen — a sheet
       * or a dialog. Reported rather than skipped: if nothing in the app
       * reaches it even indirectly, its buttons are unreachable too, and that
       * is worth knowing on its own.
       */
      assert.ok(
        areas.size > 0,
        `${path.basename(file)} navigates by area prefix and nothing in the router reaches it`,
      );

      for (const tail of tails) {
        const suffix = tail.replace(/\$\{[^}]+\}/g, 'X').replace(/\$[A-Za-z_]+/g, 'X');
        for (const prefix of areas) {
          if (!patterns.some((re) => re.test(prefix + suffix))) {
            missing.push(`${path.basename(file)}  →  ${prefix}${suffix}`);
          }
        }
      }
    }

    assert.deepEqual(
      missing,
      [],
      `\n\nA screen reachable from one area pushes a destination that does not\nexist there:\n\n  ${missing.join(
        '\n  ',
      )}\n\nEither declare the route in that area, or stop offering the control to\nthe role that lands there.\n`,
    );
  });

  test('a static route is declared before the parameter that would swallow it', () => {
    /*
     * The limitation the two tests above cannot cover, made into its own.
     *
     * `/staff/patients/new` and `/staff/patients/:id` are the same shape. If
     * the static one is deleted or moved below the parameter, every check here
     * still passes — the path matches, because `new` is a perfectly good
     * patient id as far as a pattern is concerned. What actually happens is
     * that the registration form is replaced by a patient profile for a
     * patient called "new", which loads nothing and explains nothing.
     *
     * The router already knows this. It says so, above that very route:
     * "Declared BEFORE the `:id` route so the static `new` segment is matched
     * as the form, not as a patient id." Nothing enforced it.
     *
     * go_router matches in declaration order, so the invariant is an ordering
     * one, and that is exactly what this reads.
     */
    const routes = declaredRoutes();
    const wrong = [];

    routes.forEach((route, i) => {
      const segments = route.split('/');
      const paramAt = segments.findIndex((s) => s.startsWith(':'));
      if (paramAt === -1) return;

      // Every static route this parameter would also match.
      const shape = new RegExp(
        `^${route.replace(/:[A-Za-z]+/g, '[^/]+').replace(/\//g, '\\/')}$`,
      );
      routes.forEach((other, j) => {
        if (j <= i) return;
        if (other.includes(':')) return;
        if (shape.test(other)) {
          wrong.push(`${other} is declared after ${route}, which matches it first`);
        }
      });
    });

    assert.deepEqual(
      wrong,
      [],
      `\n\n${wrong.join(
        '\n  ',
      )}\n\ngo_router matches in declaration order, so the static route never runs.\nMove it above the parameterised one.\n`,
    );
  });
});
