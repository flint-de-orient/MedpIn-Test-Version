import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The admin panel is a caller, and these are the tests that say so.
 *
 * Three `/me/totp/*` routes shipped with no button anywhere, which was worse
 * than merely unused: the login had no field for a code either, so an operator
 * who followed DEPLOY.md and enrolled a second factor was locked out of the
 * panel that told them to. Every piece worked. Nothing was wired.
 *
 * So this is `noDeadServices` pointed at the browser. A route with no caller is
 * a feature nobody has, and the panel is small enough that "every route is
 * reachable from the page" is a rule that can simply hold.
 */
const app = readFileSync(new URL('../../admin/app.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../../admin/index.html', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');

/** Every path the admin API answers on, taken from the router itself. */
function declaredRoutes() {
  return [
    ...routes.matchAll(/router\.(get|post|patch|put|delete)\(\s*'([^']+)'/g),
  ].map((m) => ({ method: m[1].toUpperCase(), path: m[2] }));
}

/**
 * Does the page call this path?
 *
 * `:id` becomes a wildcard, because the caller writes it as a template hole.
 * The end of the path is anchored on a quote, a query string or the start of an
 * interpolation — without that, `/admin/me` matches `/admin/me/totp/setup` and
 * a route with no caller passes because a longer one has one.
 */
function isCalled(path) {
  const body = path
    .split('/')
    .filter(Boolean)
    .map((seg) => (seg.startsWith(':') ? '[^\'"`]+' : seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp('/admin/' + body + '([\'"`?]|\\$\\{)').test(app);
}

describe('every admin route is reachable from the panel', () => {
  for (const { method, path } of declaredRoutes()) {
    test(`${method} ${path}`, () => {
      assert.ok(
        isCalled(path),
        `Nothing in admin/app.js calls ${method} /admin${path}.\n` +
          'Either wire it to a control or delete the route. A route documented\n' +
          'as a curl command is a feature the operator does not have.',
      );
    });
  }

  test('and there is more than a handful, so the matcher is doing work', () => {
    // A regex that silently matched nothing would make every test above pass.
    assert.ok(declaredRoutes().length >= 10, 'the route list came back suspiciously short');
  });
});

describe('the second factor can be turned on and survived', () => {
  test('the login has a field for the code', () => {
    assert.match(html, /id="loginTotp"/);
  });

  test('and shows it when the server asks, matching on the code not the wording', () => {
    // TOTP_REQUIRED arrives as a 401, which everywhere else here means "your
    // session is gone, start again". Telling them apart by message text would
    // break the next time the sentence is edited.
    assert.match(app, /err\.code = data\?\.error\?\.code/);
    assert.match(app, /ex\.code === 'TOTP_REQUIRED'/);
    assert.match(routes, /code: 'TOTP_REQUIRED'/, 'the server no longer sends the code');
  });

  test('enrolling shows the key and needs a verified code before it counts', () => {
    assert.match(app, /\/admin\/me\/totp\/setup/);
    assert.match(app, /\/admin\/me\/totp\/enable/);
    assert.match(html, /id="totpSecret"/);
    assert.match(html, /id="enableTotp"/);
  });

  test('turning it off asks for a code too', () => {
    // The route requires one. A screen that did not ask would send an empty
    // body and fail with a validation error the operator cannot act on.
    assert.match(html, /id="disableTotp"/);
    assert.match(app, /\/admin\/me\/totp\/disable[\s\S]{0,120}totp: code/);
  });

  test('an account without one is told, every time', () => {
    // The login response carries `totpEnabled` for exactly this reason, and it
    // went unread until there was somewhere to put it.
    assert.match(app, /totpEnabled = Boolean\(out\.totpEnabled/);
    assert.match(html, /id="totpNag"/);
  });
});

describe('the reset can be finished in the browser', () => {
  test('there is a form, not only a curl command', () => {
    assert.match(html, /id="resetForm"/);
    assert.match(app, /'\/admin\/auth\/reset'/);
  });

  test('and it does not pretend to sign you in', () => {
    // The route returns no session on purpose. A panel that jumped to the
    // practice list would be showing a screen it has no token to load.
    const block = app.slice(app.indexOf("'/admin/auth/reset'"));
    assert.ok(!/token = /.test(block.slice(0, 700)), 'the reset sets a session token');
    assert.match(block.slice(0, 900), /loginView'\)\.hidden = false/);
  });
});

describe('what the content security policy forbids', () => {
  /**
   * `script-src 'self'` with no `unsafe-inline` — see DEPLOY.md. Every one of
   * these works when the file is opened from disk and fails silently behind
   * nginx, which is the worst shape a bug can have.
   */
  test('no inline script', () => {
    assert.ok(!/<script(?![^>]*\ssrc=)[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/.test(html));
  });

  test('no inline style block or style attribute', () => {
    assert.ok(!/<style[\s>]/.test(html), 'a <style> block would be blocked');
    assert.ok(!/\sstyle="/.test(html), 'a style attribute would be blocked');
  });

  test('no on* handler attributes', () => {
    const inline = html.match(/\son(click|submit|change|input|load|error)=/g) ?? [];
    assert.deepEqual(inline, [], 'inline handlers are blocked; use addEventListener');
  });
});

describe('the session still does not touch storage', () => {
  test('no localStorage, sessionStorage or cookie', () => {
    // This account can suspend every practice on the platform. A closed tab
    // should be a signed-out session.
    //
    // Comments are stripped first: the file explains at length why it does not
    // use `localStorage`, and a search that counted the explanation as the
    // offence would be a test nobody could satisfy without deleting the reason.
    const code = app
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*(\/\/|\*)/.test(l))
      .join('\n');

    for (const bad of ['localStorage', 'sessionStorage', 'document.cookie']) {
      assert.ok(!code.includes(bad), `${bad} is used; the token must stay in memory`);
    }
  });
});

describe('the page and the script agree about what exists', () => {
  test('every element the script reaches for is in the html', () => {
    // `$('typo')` returns null and the listener attached to it throws at load,
    // taking every later listener with it — the panel renders and no button
    // works. A build step would catch this; there is no build step.
    const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    const missing = [...new Set([...app.matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1]))].filter(
      (id) => !ids.has(id),
    );
    assert.deepEqual(missing, [], `admin/app.js reaches for ids that do not exist: ${missing}`);
  });
});
