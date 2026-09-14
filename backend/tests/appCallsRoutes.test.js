import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CAPABILITIES } from '../src/services/capabilities.js';
import { PERMISSIONS } from '../src/models/Membership.js';
import { WIDGETS, QUICK_ACTIONS } from '../src/services/uiConfig.js';

/**
 * The gap that let six finished routes sit unreachable for weeks.
 *
 * ---- Two tests looked, and neither looked here --------------------------
 *
 * `noDeadServices` checks that services have route callers — one layer down.
 * `adminPanel` checks that admin routes have console callers, and reads
 * `web/src`. Neither has ever opened `mobile/lib`.
 *
 * So `/api/v1/departments` shipped mounted, complete and called by nothing.
 * Nothing exercised it, nothing reviewed it, and every route in it let the
 * caller choose which practice it operated on — including one that wrote a
 * department into every practice on the platform at once.
 *
 * Unreachable code is not harmless code. It is code that has not been read.
 *
 * ---- And a second kind of silence ---------------------------------------
 *
 * The capability names exist twice: `CAPABILITIES` in JavaScript and `Cap` in
 * Dart. A name that drifts does not throw. It resolves to a string the server
 * has never heard of, `has()` returns false, and the feature is quietly off
 * everywhere — which looks exactly like a decision somebody made on purpose.
 */
/**
 * One route handler, whole — from its path string to the next route.
 *
 * These assertions used to slice a fixed number of bytes: `auth.slice(at, at +
 * 1800)`. That is a window that stops covering what it checks the moment the
 * handler grows, and the failure is the quiet kind — the assertion is still
 * there, still running, and now reading the wrong part of the file. Two of
 * them went out of range at once when `/me/capabilities` gained a paragraph.
 *
 * A handler ends where the next one begins, which the file itself knows.
 */
function handlerFor(src, quotedPath) {
  const at = src.indexOf(quotedPath);
  assert.ok(at > 0, `${quotedPath} moved or was renamed`);
  const rest = src.slice(at);
  const end = rest.search(/\nrouter\.(get|post|patch|put|delete|use)\(/);
  return end === -1 ? rest : rest.slice(0, end);
}

const MOBILE = fileURLToPath(new URL('../../mobile/lib/', import.meta.url));

function dartUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += dartUnder(full);
    else if (name.endsWith('.dart')) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

const app = dartUnder(MOBILE);

describe('the app calls the departments it was given', () => {
  test('the list is fetched', () => {
    assert.match(app, /getJson\('\/departments'\)/);
  });

  test('one can be created and one can be edited', () => {
    assert.match(app, /postJson\(\s*'\/departments'/);
    assert.match(app, /patchJson\(\s*'\/departments\/\$id'/);
  });

  test('and there is a screen behind it', () => {
    assert.match(app, /class DepartmentsScreen/);
    assert.match(app, /path: '\/clinician\/departments'/);
  });

  test('the practice is never sent', () => {
    // The router took it from the query string and the body. The app must not
    // start supplying it again now that the server ignores it — a client that
    // sends a field the server drops is a client somebody will later "fix" by
    // making the server read it.
    //
    // Checked against what is actually sent rather than a window of text: the
    // doc comment above the call says the word "practice" four times, in the
    // course of explaining why it is not sent.
    assert.ok(
      !/'\/departments\?[^']*practice/.test(app),
      'a department request carries the practice in its query string',
    );
    assert.ok(
      !/'\/departments'[\s\S]{0,300}?'practice':/.test(app),
      'a department request carries the practice in its body',
    );
  });
});

describe('the capability names mean the same thing on both sides', () => {
  /** Every `static const x = 'NAME';` inside `abstract final class Cap`. */
  const at = app.indexOf('abstract final class Cap {');
  const block = app.slice(at, app.indexOf('}', at));
  const inDart = [...block.matchAll(/static const \w+ = '([A-Z_]+)';/g)].map((m) => m[1]);

  test('the Dart list was found at all', () => {
    // Every assertion below passes on an empty list.
    assert.ok(at > 0, 'the Cap class is gone or renamed');
    assert.ok(inDart.length >= 10, `only ${inDart.length} capabilities found in Dart`);
  });

  test('every name the app knows is one the server defines', () => {
    const server = Object.values(CAPABILITIES);
    const strays = inDart.filter((c) => !server.includes(c));
    assert.deepEqual(
      strays,
      [],
      `the app checks capabilities the server has never heard of: ${strays.join(', ')}. ` +
        'has() returns false for those, so the feature is off everywhere and looks deliberate.',
    );
  });

  test('and every name the server defines is one the app knows', () => {
    // The other direction matters less — a capability with no client check is
    // simply not surfaced yet — but a missing one is how a shipped feature
    // stays invisible after the server starts sending it.
    const missing = Object.values(CAPABILITIES).filter((c) => !inDart.includes(c));
    assert.deepEqual(missing, [], `the app has no constant for: ${missing.join(', ')}`);
  });
});

describe('the app is told what it may do, and does not work it out', () => {
  test('it reads the endpoint, at the path the server actually mounts', () => {
    // This asserted the string '/me/capabilities' — the path the app called —
    // and the server has only ever served '/auth/me/capabilities'. So the call
    // 404'd in every build, every capability and permission check in the app
    // fell back to "allowed", and this test passed throughout, because it
    // checked the app against itself. It checks the app against the mount now.
    //
    // Split across lines by the formatter, so matched on a collapsed copy.
    assert.match(app.replace(/\s+/g, ''), /\.getJson\('\/auth\/me\/capabilities'\)/);
    const index = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');
    const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');
    assert.match(index, /router\.use\('\/auth', authRoutes\)/);
    assert.match(auth, /'\/me\/capabilities'/);
  });

  test('unknown permits, on this side too', () => {
    // The server treats an unclassified practice as unrestricted. If the client
    // treated "not loaded yet" as "nothing available", every screen would flash
    // its stripped-down version on each cold start — and the two ends would
    // disagree about what absence means, which is how a hidden button outlives
    // the reason it was hidden.
    assert.match(app, /bool has\(String capability\) => !resolved \|\| effective\.contains\(capability\);/);
    assert.match(app, /resolved: false,/);
  });

  test('and a failed fetch does not empty the app', () => {
    // The routes still refuse what they should. A doctor whose network blipped
    // should see their practice, not a version of it with the features removed.
    assert.match(app, /valueOrNull \?\? Capabilities\.unknown/);
  });

  test('the practice screen asks rather than checking the plan', () => {
    // `if (plan == 'hospital')` in a client is the product's shape shipping on
    // an app-store review cycle.
    const screen = readFileSync(
      new URL('../../mobile/lib/features/clinician/presentation/practice_screen.dart', import.meta.url),
      'utf8',
    );

    /*
     * The claim is that the screen asks the capability set, not that it asks
     * in one particular expression.
     *
     * This pinned `capabilitySetProvider).has(Cap.department)` as a literal and
     * failed the day the widget read the provider into a local so it could ask
     * a second question of it — a refactor that made the screen better and
     * changed nothing this test exists to protect. A test that fails on shape
     * and passes on substance is one somebody eventually edits to make green.
     */
    assert.match(screen, /capabilitySetProvider/);
    assert.match(screen, /\bCap\.department\b/);
    assert.ok(
      !/plan ==|practiceType ==/.test(screen),
      'the practice screen is deciding from the plan or the type directly',
    );
  });

  test('and it tells apart "cannot" from "may not"', () => {
    /*
     * `has()` is false whether the practice cannot have departments at all or
     * this person simply may not manage them, and the section vanished for
     * both. Right for a solo clinic, wrong for a doctor whose colleagues can
     * see a thing their own screen shows no trace of — which reads as broken.
     *
     * `withheld()` was written for exactly this and nothing used it.
     */
    const screen = readFileSync(
      new URL('../../mobile/lib/features/clinician/presentation/practice_screen.dart', import.meta.url),
      'utf8',
    );
    assert.match(screen, /withheld\(Cap\.department\)/);
  });
});

describe('the Nutrition tab has two reasons to exist', () => {
  const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');

  test('the server says whether anybody here writes diet plans', () => {
    // Not a capability — a capability is what the product offers, this is who
    // the practice employs. It rides in the capabilities response because the
    // navigation needs it and that is the request the navigation already makes;
    // a second round trip would show the bar rearranging after the first frame.
    const body = handlerFor(auth, "'/me/capabilities'");
    assert.match(body, /role: ROLES\.DIETICIAN/);
    assert.match(body, /hasDietician,/);
  });

  test('and it counts memberships, not accounts', () => {
    // A User with role DIETICIAN and no membership belongs to nobody. Counting
    // those would light the tab for every practice on the platform the moment
    // one existed anywhere — the same shape as every other leak in this repo.
    const body = handlerFor(auth, "'/me/capabilities'");
    assert.match(body, /Membership\.countDocuments\(\{[\s\S]{0,160}practice: ctx\.practice\._id/);
  });

  test('the app reads it, and either reason is enough', () => {
    assert.match(app, /hasDietician: json\['hasDietician'\] == true/);
    assert.match(app, /caps\.has\(Cap\.aiAssistant\) \|\| caps\.hasDietician/);
  });
});

describe('the app can tell what this person may do', () => {
  const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');

  test('the grant it is sent is resolved, not stored', () => {
    // An empty array on the row means "the role's preset applies". The model
    // resolves that on read and requirePermission asks the document, so the
    // server has always behaved correctly — this field did not. It sent the
    // raw `[]`, and a client checking a permission against it would find that
    // nobody holds any, because almost nobody has a customised grant.
    const body = handlerFor(auth, "'/me/capabilities'");
    assert.match(body, /ctx\.membership\.permissions\?\.length[\s\S]{0,200}presetFor\(/);
    assert.match(body, /usingPreset: !ctx\.membership\.permissions\?\.length/);
  });

  test('the app reads it and the names match the server', () => {
    assert.match(app, /permissions: \(\(membership\?\['permissions'\] as List\?\)/);

    const at = app.indexOf('abstract final class Perm {');
    assert.ok(at > 0, 'the Perm class is gone or renamed');
    const block = app.slice(at, app.indexOf('}', at));
    const inDart = [...block.matchAll(/static const \w+ = '([A-Z_]+)';/g)].map((m) => m[1]);

    const server = Object.values(PERMISSIONS);
    assert.deepEqual(
      inDart.filter((p) => !server.includes(p)),
      [],
      'the app checks a permission the server has never heard of',
    );
    assert.deepEqual(
      server.filter((p) => !inDart.includes(p)),
      [],
      'the app has no constant for a permission the server defines',
    );
  });

  test('and can() permits before the answer arrives', () => {
    // The same rule as has(), for the same reason: a button appearing a moment
    // late beats one vanishing under somebody's thumb, and the server refuses
    // what it should either way.
    assert.match(app, /bool can\(String permission\) => !resolved \|\| permissions\.contains\(permission\);/);
  });

  test('managing departments is gated on the permission, not the role', () => {
    // A practice manager who is not a doctor may hold MANAGE_DEPARTMENT, and a
    // doctor normally does not. The routes have required it since they were
    // scoped, so the screen was offering a button it knew would be refused.
    assert.match(app, /can\(Perm\.manageDepartment\)/);
  });
});

/**
 * The dashboard registry exists twice, and the two have to be one list.
 *
 * ---- Why this is the most fragile contract in the codebase ---------------
 *
 * A component name lives in `services/uiConfig.js` and again in
 * `dashboard_registry.dart`, and both ends are written to drop what they do
 * not recognise — deliberately, so an operator's typo and an app a release
 * behind both fail quietly in one panel rather than loudly on the whole
 * screen.
 *
 * That tolerance is what makes drift invisible. A name added to the server and
 * not to the app is a component an operator can select, sees accepted, sees
 * saved — and which never appears on anybody's phone. From the console it
 * looks exactly like a configuration that took effect.
 *
 * The same shape as the `Cap` and `Perm` mirrors above, and the same shape as
 * the notification-id contract: two languages, one vocabulary, no compiler
 * between them.
 */
describe('the app can draw every component the server may send', () => {
  const registry = readFileSync(
    fileURLToPath(
      new URL(
        '../../mobile/lib/features/clinician/presentation/widgets/dashboard_registry.dart',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  /** The keys of one Dart map literal, by the name it is declared under. */
  function keysOf(declaration) {
    const at = registry.indexOf(declaration);
    assert.ok(at > 0, `${declaration} is gone or renamed`);
    const block = registry.slice(at, registry.indexOf('\n};', at));
    return [...block.matchAll(/^ {2}'([A-Z][A-Z0-9_]*)':/gm)].map((m) => m[1]);
  }

  test('every widget the server can send has a builder', () => {
    const inDart = new Set(keysOf('final Map<String, WidgetBuilderFn> dashboardWidgets = {'));
    const missing = Object.keys(WIDGETS).filter((id) => !inDart.has(id));

    assert.deepEqual(
      missing,
      [],
      `\n\nThe server may send these and the app would drop them:\n\n  ${missing.join(
        '\n  ',
      )}\n\nAdd them to dashboard_registry.dart, or remove them from WIDGETS in\nuiConfig.js. A component in one and not the other is one an operator can\nselect and nobody ever sees.\n`,
    );
  });

  test('and the app has no builder for a component the server cannot send', () => {
    // The other direction, which is the less dangerous half and still worth
    // catching: dead code that looks like a feature, and a name somebody will
    // eventually try to configure.
    const inDart = keysOf('final Map<String, WidgetBuilderFn> dashboardWidgets = {');
    const orphans = inDart.filter((id) => !WIDGETS[id]);
    assert.deepEqual(orphans, [], `the app builds ${orphans.join(', ')}, which the server never sends`);
  });

  test('every action the server can send has somewhere to go', () => {
    const inDart = new Set(keysOf('final Map<String, ActionSpec> dashboardActions = {'));
    const missing = Object.keys(QUICK_ACTIONS).filter((id) => !inDart.has(id));
    assert.deepEqual(missing, [], `the app has no destination for ${missing.join(', ')}`);
  });

  test('and no action goes nowhere', () => {
    /*
     * A button with no route is worse than an absent one, because somebody
     * presses it in front of a patient. Checked against the router rather than
     * against a list here — a route that is registered is one the app can
     * actually open.
     */
    const router = readFileSync(
      fileURLToPath(new URL('../../mobile/lib/core/router/app_router.dart', import.meta.url)),
      'utf8',
    );
    const at = registry.indexOf('final Map<String, ActionSpec> dashboardActions = {');
    const block = registry.slice(at, registry.indexOf('\n};', at));

    for (const [, id, route] of block.matchAll(
      /'([A-Z][A-Z0-9_]*)': \(\s*label:[^)]*?route: '([^']+)'/gs,
    )) {
      /*
       * The whole path, declared as `path: '/clinician/…'`.
       *
       * This first accepted the last segment as a fallback, on the theory that
       * the router might nest paths — it does not, every route is declared
       * whole. Which made the fallback a hole rather than a convenience:
       * `/clinician/patients/add` would have passed on the word `patients`
       * appearing somewhere in the file, and that route does not exist. The
       * real one is `/clinician/patients/new`.
       */
      assert.ok(
        router.includes(`path: '${route}'`),
        `${id} opens ${route}, which the router does not declare`,
      );
    }
  });

  test('the app reads the arrangement the server sent', () => {
    // The wiring itself. Everything above could be in step while the screen
    // still draws a list written in Dart.
    assert.match(app, /caps\.ui\?\.widgets/);
    assert.match(app, /dashboardWidgets\[id\]\?\.call\(data\)/);
  });
});

describe('a department says what its dashboard is', () => {
  /*
   * The pattern this codebase keeps finding: a field recorded and never shown.
   *
   * `widgets` on a department is a thing a practice can now change, and until
   * it appears somewhere a practice that changed one six months ago has no way
   * to tell. `practice` on an audit entry, `ip` and `userAgent` beside it,
   * `consentRequired` from registration, `hasSecondFactor` — all the same
   * shape, all found the same way.
   */
  const domain = readFileSync(
    fileURLToPath(
      new URL('../../mobile/lib/features/clinician/domain/department.dart', import.meta.url),
    ),
    'utf8',
  );
  const screen = readFileSync(
    fileURLToPath(
      new URL(
        '../../mobile/lib/features/clinician/presentation/departments_screen.dart',
        import.meta.url,
      ),
    ),
    'utf8',
  );

  test('the app parses what the server sends about it', () => {
    assert.match(domain, /widgets: \(\(json\['widgets'\] as List\?\)/);
    assert.match(domain, /usingDefault: json\['usingDefault'\] != false/);
  });

  test('and a reader can see it without opening a database', () => {
    // Parsed and unused is the same as not parsed, and looks like it works.
    assert.match(screen, /d\.usingDefault/);
    assert.match(screen, /d\.widgets\.length/);
  });

  test('the two readings of empty are kept apart', () => {
    /*
     * `[]` on the row means "the platform's default applies", not "show
     * nothing" — so the server sends the resolved list and a flag, and the app
     * must not re-derive the flag from the list being empty. It never is: the
     * resolved list always has something in it.
     */
    assert.ok(
      !/usingDefault:\s*\w+\.widgets\.isEmpty/.test(domain),
      'the app infers usingDefault from an empty list, which it never sees',
    );
  });
});
