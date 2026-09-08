import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CAPABILITIES } from '../src/services/capabilities.js';

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
  test('it reads the endpoint', () => {
    assert.match(app, /getJson\('\/me\/capabilities'\)/);
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
    assert.match(app, /capabilitySetProvider\)\.has\(Cap\.department\)/);
    const screen = readFileSync(
      new URL('../../mobile/lib/features/clinician/presentation/practice_screen.dart', import.meta.url),
      'utf8',
    );
    assert.ok(
      !/plan ==|practiceType ==/.test(screen),
      'the practice screen is deciding from the plan or the type directly',
    );
  });
});

describe('the Nutrition tab has two reasons to exist', () => {
  const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');

  test('the server says whether anybody here writes diet plans', () => {
    // Not a capability — a capability is what the product offers, this is who
    // the practice employs. It rides in the capabilities response because the
    // navigation needs it and that is the request the navigation already makes;
    // a second round trip would show the bar rearranging after the first frame.
    const at = auth.indexOf("'/me/capabilities'");
    assert.ok(at > 0, 'the capabilities endpoint moved');
    const body = auth.slice(at, at + 1800);
    assert.match(body, /role: ROLES\.DIETICIAN/);
    assert.match(body, /hasDietician,/);
  });

  test('and it counts memberships, not accounts', () => {
    // A User with role DIETICIAN and no membership belongs to nobody. Counting
    // those would light the tab for every practice on the platform the moment
    // one existed anywhere — the same shape as every other leak in this repo.
    const at = auth.indexOf("'/me/capabilities'");
    const body = auth.slice(at, at + 1800);
    assert.match(body, /Membership\.countDocuments\(\{[\s\S]{0,160}practice: ctx\.practice\._id/);
  });

  test('the app reads it, and either reason is enough', () => {
    assert.match(app, /hasDietician: json\['hasDietician'\] == true/);
    assert.match(app, /caps\.has\(Cap\.aiAssistant\) \|\| caps\.hasDietician/);
  });
});
