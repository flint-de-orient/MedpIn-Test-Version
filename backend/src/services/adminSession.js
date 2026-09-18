import crypto from 'node:crypto';

/**
 * The admin session, as a cookie the page cannot read.
 *
 * ---- Why this replaced a token held in JavaScript ------------------------
 *
 * The console used to keep its token in a module variable. The reasoning was
 * that `localStorage` is readable by anything that can run script on the
 * origin, and this account can suspend every practice on the platform — so
 * holding it in memory meant a closed tab was a signed-out session.
 *
 * That was half an argument. It is true that memory beats `localStorage`, and
 * false that those were the only two options. An `httpOnly` cookie is not
 * readable by script at all, which is *stronger* than memory on the axis that
 * mattered — and it survives a refresh, which memory does not.
 *
 * So the old design paid a real cost, every reload, for a security property it
 * did not actually have over the better option. It is a cookie now.
 *
 * ---- SameSite=Strict, and what that forces -------------------------------
 *
 * A strict cookie is never sent on a cross-site request, which is the whole
 * CSRF defence rather than a mitigation of it. The price is that the console
 * and the API must be the same site: a cookie set by `clinq.flintdeorient.in`
 * will not be sent from a page on `testadmin.medpin.in`, because those are
 * different registrable domains.
 *
 * So production reverse-proxies `/api/v1/admin/` from the console's own host.
 * That is not a workaround — it is better than the cross-origin arrangement it
 * replaces. The cookie is now scoped to `testadmin.medpin.in` and is never sent
 * anywhere else, so a script running on the *clinic* app cannot reach the admin
 * API with credentials even if it tries.
 *
 * In development the console's dev server and the API are two ports on one
 * machine. Cookies ignore the port, so that is one site — but only while both
 * are addressed by the same host name. `localhost` and `127.0.0.1` are
 * different sites: a console on http://localhost:3000 calling
 * http://127.0.0.1:4000 never sends the strict session cookie, and cannot read
 * the CSRF cookie the API sets, so every write is refused as a forgery. The
 * console builds its development API address from its own host name for that
 * reason — see `apiBase()` in web/src/lib/api.ts.
 *
 * ---- And a CSRF token anyway ---------------------------------------------
 *
 * `SameSite` is enforced by the browser, and browsers have bugs and
 * configuration. The token below binds a random value into the session itself
 * and requires it echoed in a header, so a request that arrives with the cookie
 * but without the header is refused. An attacker on another origin cannot read
 * the value to echo it, and cannot fixate one either — a cookie they plant will
 * not match the claim inside the signed session.
 */

const SESSION = 'medpin_admin';
const CSRF = 'medpin_admin_csrf';

/** Two hours, matching the token's own expiry. */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

export const COOKIE_NAMES = Object.freeze({ SESSION, CSRF });

/** A value the client can read and echo, and an attacker on another site cannot. */
export function newCsrfToken() {
  return crypto.randomBytes(24).toString('base64url');
}

/**
 * Parse the Cookie header.
 *
 * By hand, rather than adding a dependency for eleven lines. The header is a
 * list of `name=value` pairs; a value containing `=` (a JWT does not, but a
 * base64 one might) must keep everything after the first separator.
 */
export function cookiesFrom(req) {
  const header = req.headers?.cookie;
  if (!header) return {};

  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (!name) continue;
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      // A malformed escape is not worth failing the whole request over; the
      // cookie simply does not parse and the caller reads it as absent.
    }
  }
  return out;
}

/**
 * The session cookie's path.
 *
 * Not the whole site: a session cookie attached to every image and font request
 * is a session cookie in more logs than it needs to be.
 */
const SESSION_PATH = '/api/v1/admin';

function base(req) {
  return {
    // `secure` everywhere except plain-http localhost, where it would stop the
    // cookie being set at all and make the console impossible to develop
    // against. `req.secure` is true behind a proxy only when `trust proxy` is
    // set, so the header is checked too.
    secure:
      process.env.NODE_ENV === 'production' ||
      req.secure ||
      req.get('x-forwarded-proto') === 'https',
    sameSite: 'strict',
  };
}

/** Sign in: the session, and the value that proves a request came from our page. */
export function setSessionCookies(req, res, { token, csrf }) {
  const opts = base(req);

  res.cookie(SESSION, token, {
    ...opts,
    httpOnly: true, // the entire point: script cannot read it
    path: SESSION_PATH,
    maxAge: MAX_AGE_MS,
  });

  /**
   * The anti-forgery half, readable and rooted at `/`.
   *
   * ---- Why not the same narrow path as the session ----------------------
   *
   * `document.cookie` only returns cookies whose path matches the *document's*
   * path. The console is served from `/`, so a cookie scoped to
   * `/api/v1/admin` is invisible to it — the browser would faithfully attach
   * the cookie to API requests while the page could never read the value it
   * has to echo in the header, and every write would be refused as forgery.
   *
   * A path that is right for the credential is wrong for the thing that has to
   * be read, which is why they are set separately rather than sharing `base`.
   *
   * Widening it costs nothing: this is not a secret to be kept, it is a value
   * an attacker on another origin cannot read. That property comes from the
   * origin, not from the path.
   */
  res.cookie(CSRF, csrf, {
    ...opts,
    httpOnly: false,
    path: '/',
    maxAge: MAX_AGE_MS,
  });
}

/**
 * Sign out.
 *
 * Clearing the cookie ends the session in the browser. It does not revoke the
 * token, because nothing here tracks issued tokens — a copy taken beforehand
 * stays valid until it expires. That is stated plainly on the Account screen
 * rather than implied by a button that looks like it does more.
 */
export function clearSessionCookies(req, res) {
  // Cleared on the same paths they were set on. A clearCookie with a different
  // path writes a second, empty cookie and leaves the original in place.
  const opts = base(req);
  res.clearCookie(SESSION, { ...opts, httpOnly: true, path: SESSION_PATH });
  res.clearCookie(CSRF, { ...opts, httpOnly: false, path: '/' });
}

/** Constant-time compare, because this is a secret being checked. */
export function csrfMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
