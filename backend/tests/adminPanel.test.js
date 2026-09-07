import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The console is a caller, and these are the tests that say so.
 *
 * Three `/me/totp/*` routes once shipped with no button anywhere, which was
 * worse than merely unused: the login had no field for a code either, so an
 * operator who followed DEPLOY.md and enrolled a second factor was locked out
 * of the panel that told them to. Every piece worked. Nothing was wired.
 *
 * So this is `noDeadServices` pointed at the browser. A route with no caller is
 * a feature nobody has.
 *
 * ---- It reads `web/`, not `admin/` --------------------------------------
 *
 * The hand-written panel still exists and is still what production serves, but
 * every route added since is called from the Next console. Pointing this at the
 * old file measured a panel nobody is developing — and it did, for one commit,
 * which is how `/attention` and `/analytics` came to look unreachable while
 * being called from two screens each.
 */
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');

/** Every .ts/.tsx under web/src, concatenated. */
function sourceUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += sourceUnder(full);
    else if (/\.tsx?$/.test(name)) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

const app = sourceUnder(WEB);

/**
 * The same source with every run of whitespace collapsed.
 *
 * Prose in JSX is wrapped by the formatter, so a sentence on screen is two or
 * three lines in the file with indentation between them. Matching a phrase
 * against the raw source therefore tests where prettier chose to break, which
 * is not a behaviour anybody wants pinned — it broke the moment a paragraph was
 * reworded and rewrapped.
 */
const prose = app.replace(/\s+/g, ' ');

/** Every path the admin API answers on, taken from the router itself. */
function declaredRoutes() {
  return [
    ...routes.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g),
  ].map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
}

/**
 * Does the console call this path?
 *
 * `:id` becomes a wildcard, because the caller writes it as a template hole.
 * No `/` inside that wildcard: a greedy match that crossed a separator let
 * `/admin/practices/${id}/verification` count as a caller for `/practices/:id`,
 * so a route with no screen looked wired because a longer one was.
 *
 * The end is anchored on a quote, a query string or the start of an
 * interpolation — without that, `/admin/me` matches `/admin/me/totp/setup`.
 */
function isCalled(routePath) {
  const body = routePath
    .split('/')
    .filter(Boolean)
    .map((seg) =>
      seg.startsWith(':') ? '[^\'"`/]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');
  return new RegExp('/admin/' + body + '([\'"`?]|\\$\\{)').test(app);
}

describe('every admin route is reachable from the console', () => {
  /**
   * Built, not yet wired. Empty, and it stays empty.
   *
   * It held nine routes for one commit while the screens that call them were
   * written. A name appearing here again is somebody shipping an endpoint with
   * no way to reach it, and the only allowed edit is a deletion.
   */
  const AWAITING_UI = new Set([]);

  for (const { method, path: p } of declaredRoutes()) {
    if (AWAITING_UI.has(`${method} ${p}`)) continue;
    test(`${method} ${p}`, () => {
      assert.ok(
        isCalled(p),
        `Nothing under web/src calls ${method} /admin${p}.\n` +
          'Either wire it to a control or delete the route. A route documented\n' +
          'as a curl command is a feature the operator does not have.',
      );
    });
  }

  test('nothing is exempt', () => {
    assert.equal(AWAITING_UI.size, 0, `a route ships with no caller: ${[...AWAITING_UI]}`);
  });

  test('and there are enough routes that the matcher is doing work', () => {
    // A regex that silently matched nothing would make every test above pass.
    assert.ok(declaredRoutes().length >= 15, 'the route list came back suspiciously short');
  });
});

describe('the second factor can be turned on and survived', () => {
  test('the login asks for a code when the server says to', () => {
    // TOTP_REQUIRED arrives as a 401, which everywhere else means "your session
    // is gone, start again". Told apart by the code and not the sentence,
    // because the next person to reword the message should not break the login.
    assert.match(app, /err\.code === "TOTP_REQUIRED"/);
    assert.match(routes, /code: 'TOTP_REQUIRED'/, 'the server no longer sends the code');
    assert.match(app, /setNeedsCode\(true\)/);
  });

  test('enrolling shows the key, and a code is needed before it counts', () => {
    assert.match(app, /\/admin\/me\/totp\/setup/);
    assert.match(app, /\/admin\/me\/totp\/enable/);
    assert.match(app, /secret\.match/, 'the setup key is never shown');
    assert.match(prose, /a mistyped key cannot lock you out/);
  });

  test('turning it off asks for a code too', () => {
    // The route requires one. A screen that did not ask would send an empty
    // body and fail with a validation error nobody can act on.
    assert.match(app, /\/admin\/me\/totp\/disable[\s\S]{0,200}totp: code/);
  });

  test('an account without one is told, on every screen', () => {
    // Driven by `hasSecondFactor`, not by TOTP alone — an operator who
    // registered a passkey and never touched the app is protected, and a banner
    // telling them otherwise would be nagging about a thing they have done.
    assert.match(app, /!hasFactor/);
    assert.match(prose, /no second factor/i);
  });

  test('and a passkey counts as one', () => {
    const model = readFileSync(
      new URL('../src/models/PlatformAdmin.js', import.meta.url),
      'utf8',
    );
    assert.match(model, /hasSecondFactor: Boolean\(this\.totpEnabled\) \|\| \(this\.passkeys \?\? \[\]\)\.length > 0/);
  });
});

describe('the reset can be finished in the browser', () => {
  test('there is a form, not only a shell command', () => {
    assert.match(app, /\/admin\/auth\/reset/);
    assert.match(prose, /Reset token/);
  });

  test('and it does not pretend to sign you in', () => {
    // The route returns no session on purpose, and the screen says so rather
    // than jumping to a page it has no session to load.
    assert.match(prose, /Choosing a password is not signing in/);
  });
});

describe('what needs a person is shown, not buried', () => {
  test('the landing screen asks the server what is waiting', () => {
    assert.match(app, /\/admin\/attention/);
  });

  test('and every item links somewhere that can act on it', () => {
    // An alert that cannot be acted on from where it appears is a worry rather
    // than a task.
    assert.match(routes, /href: '\/practices\/\?verification=pending'/);
    assert.match(routes, /href: '\/admins\/'/);
  });
});

describe('filters live in the URL', () => {
  test('the register reads its filters from the query string', () => {
    // `/practices/?status=active` is a link somebody can send, a tab that
    // survives a reload, and the address the attention items point at. State
    // held in a component would make "3 awaiting verification → Review" land on
    // an unfiltered list.
    assert.match(app, /params\.get\("status"\)/);
    assert.match(app, /params\.get\("verification"\)/);
    assert.match(app, /router\.replace\(`\/practices\//);
  });
});
