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
 * will not be sent from a page on `admin.medpin.in`, because those are
 * different registrable domains.
 *
 * So production reverse-proxies `/api/v1/admin/` from the console's own host.
 * That is not a workaround — it is better than the cross-origin arrangement it
 * replaces. The cookie is now scoped to `admin.medpin.in` and is never sent
 * anywhere else, so a script running on the *clinic* app cannot reach the admin
 * API with credentials even if it tries.
 *
 * In development the console is on :8144 and the API on :4000. Cookies ignore
 * the port, so those are the same site and a strict cookie works between them.
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
    // Not the whole site. The console is served from the same host in
    // production, and a session cookie sent with every image and font request
    // is a session cookie in more logs than it needs to be.
    path: '/api/v1/admin',
  };
}

/** Sign in: the session, and the value that proves a request came from our page. */
export function setSessionCookies(req, res, { token, csrf }) {
  const opts = base(req);

  res.cookie(SESSION, token, {
    ...opts,
    httpOnly: true, // the entire point: script cannot read it
    maxAge: MAX_AGE_MS,
  });

  res.cookie(CSRF, csrf, {
    ...opts,
    // Readable on purpose — the page has to echo it back in a header, and a
    // header is the thing a cross-site request cannot forge.
    httpOnly: false,
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
  const opts = base(req);
  res.clearCookie(SESSION, { ...opts, httpOnly: true });
  res.clearCookie(CSRF, { ...opts, httpOnly: false });
}

/** Constant-time compare, because this is a secret being checked. */
export function csrfMatches(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
