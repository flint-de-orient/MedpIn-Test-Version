import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { cookiesFrom, csrfMatches, newCsrfToken, COOKIE_NAMES } from '../src/services/adminSession.js';

/**
 * The session is a cookie the page cannot read.
 *
 * ---- What this replaced, and why the old reasoning was half right --------
 *
 * The console used to keep its token in a JavaScript variable. The argument
 * was that `localStorage` is readable by anything that can run script on the
 * origin, and this account can suspend every practice on the platform.
 *
 * True, and incomplete. Memory does beat `localStorage`; it does not beat an
 * `httpOnly` cookie, which script cannot read *at all*. The old design charged
 * an operator a full sign-in on every reload for a property it did not have
 * over the option it had skipped — which is how "opening the Account tab asks
 * me to log in again" came to be the reported symptom of a security decision.
 */
const session = readFileSync(new URL('../src/services/adminSession.js', import.meta.url), 'utf8');
const guard = readFileSync(new URL('../src/middleware/requireAdmin.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const api = readFileSync(new URL('../../web/src/lib/api.ts', import.meta.url), 'utf8');

describe('the cookie itself', () => {
  test('the session half cannot be read by script', () => {
    const set = session.slice(session.indexOf('export function setSessionCookies'));
    assert.match(set, /httpOnly: true/);
  });

  test('and the anti-forgery half deliberately can', () => {
    // It exists to be echoed in a header, and a header is the thing a
    // cross-site request cannot set.
    const set = session.slice(session.indexOf('export function setSessionCookies'));
    assert.match(set, /httpOnly: false/);
  });

  test('strict, so it is never sent cross-site', () => {
    assert.match(session, /sameSite: 'strict'/);
  });

  test('scoped to the admin API, not the whole site', () => {
    // A session cookie attached to every image and font request is a session
    // cookie in more logs than it needs to be.
    assert.match(session, /path: '\/api\/v1\/admin'/);
  });

  test('secure in production, and not only there', () => {
    // `req.secure` is false behind a proxy unless `trust proxy` is set, so the
    // forwarded header is checked too — otherwise the cookie silently drops to
    // plaintext on exactly the deployment that terminates TLS upstream.
    assert.match(session, /process\.env\.NODE_ENV === 'production'/);
    assert.match(session, /x-forwarded-proto'\) === 'https'/);
  });
});

describe('parsing a Cookie header', () => {
  test('reads a plain pair', () => {
    const req = { headers: { cookie: 'a=1; b=two' } };
    assert.deepEqual(cookiesFrom(req), { a: '1', b: 'two' });
  });

  test('keeps everything after the first separator', () => {
    // A base64 value can end in `=`. Splitting on every `=` would truncate it,
    // and the session would fail to verify for a reason nothing explains.
    const req = { headers: { cookie: 'jwt=aaa.bbb.ccc==' } };
    assert.equal(cookiesFrom(req).jwt, 'aaa.bbb.ccc==');
  });

  test('no header is no cookies, not a crash', () => {
    assert.deepEqual(cookiesFrom({ headers: {} }), {});
    assert.deepEqual(cookiesFrom({}), {});
  });

  test('a malformed escape does not fail the whole request', () => {
    // One bad cookie set by something else on the domain must not make the
    // console unusable.
    const req = { headers: { cookie: 'good=1; bad=%E0%A4%A' } };
    assert.equal(cookiesFrom(req).good, '1');
  });
});

describe('the anti-forgery token', () => {
  test('is long enough that guessing is pointless', () => {
    assert.ok(newCsrfToken().length >= 24);
    assert.notEqual(newCsrfToken(), newCsrfToken());
  });

  test('is compared in constant time', () => {
    assert.match(session, /crypto\.timingSafeEqual/);
    assert.ok(csrfMatches('abc', 'abc'));
    assert.ok(!csrfMatches('abc', 'abd'));
    assert.ok(!csrfMatches('abc', 'abcd'));
    assert.ok(!csrfMatches(undefined, 'abc'));
    assert.ok(!csrfMatches('abc', undefined));
  });

  test('is bound into the signed session, not just a second cookie', () => {
    // A plain double-submit lets an attacker who can set cookies on the domain
    // plant a value and echo it. Binding it into the JWT means a planted cookie
    // does not match the claim, and the claim cannot be forged.
    const tokens = readFileSync(new URL('../src/services/adminTokens.js', import.meta.url), 'utf8');
    assert.match(tokens, /\.\.\.\(csrf \? \{ csrf \} : \{\}\)/);
    assert.match(guard, /csrfMatches\(req\.get\('x-csrf-token'\), payload\.csrf\)/);
  });
});

describe('the guard', () => {
  test('takes the cookie first and the header second', () => {
    // The cookie is what makes a reload survive. The header stays supported for
    // the callers that are not a browser.
    const order = guard.indexOf('cookiesFrom(req)') < guard.indexOf("req.get('authorization')");
    assert.ok(order, 'the Authorization header is read before the cookie');
  });

  test('enforces the token only on cookie-authenticated writes', () => {
    // A bearer token is not attached automatically, so a cross-site request
    // carrying one was written by somebody who already had it — there is
    // nothing for CSRF to protect against.
    assert.match(guard, /const mutating = !\['GET', 'HEAD', 'OPTIONS'\]\.includes\(req\.method\)/);
    assert.match(guard, /if \(fromCookie && mutating\)/);
  });

  test('a GET is exempt, and says why', () => {
    assert.match(guard, /already logged, so a forged one is visible/);
  });
});

describe('signing out', () => {
  test('does not require a valid session', () => {
    // An operator whose session has expired must still be able to clear the
    // stale cookie, and clearing one for somebody not signed in does nothing.
    const logout = routes.indexOf("'/auth/logout'");
    const guardLine = routes.indexOf('router.use(requireAdmin)');
    assert.ok(logout > -1 && logout < guardLine, 'logout sits behind the admin guard');
  });

  test('is recorded when we can tell who it was', () => {
    const block = routes.slice(routes.indexOf("'/auth/logout'"), routes.indexOf('router.use(requireAdmin)'));
    assert.match(block, /action: 'admin\.logout'/);
    // Best effort: an audit write that failed must not leave somebody holding
    // the session they were trying to drop.
    assert.match(block, /\} catch \{/);
  });

  test('and clears both cookies', () => {
    assert.match(session, /res\.clearCookie\(SESSION/);
    assert.match(session, /res\.clearCookie\(CSRF/);
  });
});

describe('the console holds no token at all', () => {
  test('nothing stores one', () => {
    for (const bad of ['localStorage.setItem("medpin_admin', 'sessionStorage', 'let token']) {
      assert.ok(!api.includes(bad), `${bad} is used; the session must stay in the cookie`);
    }
  });

  test('and every request carries the cookie', () => {
    // Without this the cookie is not attached, every request is anonymous, and
    // it is confusing to debug because the sign-in itself appears to work.
    assert.match(api, /credentials: "include"/);
  });

  test('reading the anti-forgery cookie by name, not by position', () => {
    assert.ok(api.includes(COOKIE_NAMES.CSRF), 'the console reads a different cookie name');
    assert.match(api, /"X-CSRF-Token": csrf/);
  });
});
