#!/usr/bin/env node
/**
 * Verify a deployed origin, from outside it.
 *
 *   node scripts/smoke.mjs https://staging.clinq.flintdeorient.in
 *   node scripts/smoke.mjs https://testadmin.medpin.in        # the console's proxy
 *
 * Exits non-zero if anything fails, so a deploy can gate on it.
 *
 * ---- Read-only, and that is a hard rule ---------------------------------
 *
 * Every request here is a GET, or a deliberately-unauthorised request whose
 * whole purpose is to be refused. Nothing creates a record, sends a message,
 * or costs money.
 *
 * That is not caution for its own sake. A smoke test that posts to
 * `/applications/verify/send` sends a real SMS to whatever number is in the
 * fixture, and it does it every time anybody runs the script — which has
 * already happened once here, against production. A verification tool that
 * changes the thing it verifies is worse than no tool, because its side
 * effects arrive looking like the system working.
 *
 * If a check ever needs to write, it belongs in the HTTP suite against an
 * in-memory database, not here.
 *
 * ---- What this cannot tell you ------------------------------------------
 *
 * Whether the application is correct. That is what 1600 tests are for. This
 * answers a narrower question that tests cannot: is the thing that is actually
 * running, on the actual box, behind the actual proxy, the thing that was
 * meant to be deployed.
 */

const origin = (process.argv[2] ?? '').replace(/\/+$/, '');
const surfaceArg = (process.argv[3] ?? '').replace(/^--/, '');

if (!origin) {
  console.error('usage: node scripts/smoke.mjs <origin> [--api|--console]');
  console.error('   eg: node scripts/smoke.mjs https://staging.clinq.flintdeorient.in');
  console.error('       node scripts/smoke.mjs https://testadmin.medpin.in --console');
  process.exit(2);
}

/**
 * Which API surface this host is *supposed* to expose.
 *
 * ---- Why this is a parameter and not an assumption ---------------------
 *
 * The first version of this script assumed every host proxies the whole API,
 * ran against the console, and reported three failures including "the API is
 * not proxied from this host". That was wrong, and wrong in the expensive
 * direction: it had already gone into an audit report as a production blocker.
 *
 * `testadmin.medpin.in` proxies exactly two prefixes — `/api/v1/admin/` and
 * `/api/v1/applications/` — and the console calls exactly those two and
 * nothing else. It is not a partial deployment. It is a correctly narrow one,
 * and narrow is better: `/auth/`, `/doctor/` and `/billing/` are not reachable
 * from the console's origin at all, which is one fewer surface behind a
 * first-party cookie.
 *
 * A tool that reports a deliberate decision as a fault teaches people to
 * ignore it.
 */
const surface = surfaceArg || (/^admin\./.test(new URL(origin).hostname) ? 'console' : 'api');
if (!['api', 'console'].includes(surface)) {
  console.error(`unknown surface "${surface}" — expected --api or --console`);
  process.exit(2);
}

const api = `${origin}/api/v1`;
const TIMEOUT_MS = 15000;

const results = [];
let group = '';

function section(name) {
  group = name;
}

function record(ok, name, detail) {
  results.push({ group, ok, name, detail });
}

/** A request that never throws — a refused connection is a result, not a crash. */
async function req(path, { method = 'GET', headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(api + path, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
      redirect: 'manual',
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text.slice(0, 200);
    }
    return { status: res.status, headers: res.headers, body: parsed };
  } catch (err) {
    return { status: 0, headers: new Headers(), body: null, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
section('Reachability');

const health = await req('/health');

if (surface === 'api') {
  record(
    health.status === 200,
    'the API answers /health',
    health.status === 0
      ? `no response: ${health.error}`
      : health.status === 404
        ? '404 — the API is not proxied from this host. See deploy/apache/'
        : `HTTP ${health.status}`,
  );
} else {
  /*
   * On the console, /health being unreachable is correct.
   *
   * That host proxies `/admin/` and `/applications/` and nothing else, which
   * is the narrower and better arrangement — the rest of the API is simply
   * not exposed behind its first-party cookie.
   */
  record(
    health.status === 404,
    'the console exposes no API beyond what it calls',
    health.status === 404
      ? '/health is not routed here, which is correct'
      : `HTTP ${health.status} — this host proxies more of the API than the console uses`,
  );
}

if (health.status === 200) {
  record(
    health.body?.db === 'connected',
    'the database is reachable and readable',
    /*
     * `db` distinguishes `unauthorized` from `error` from `disconnected`,
     * because the health check lists collections rather than pinging — ping
     * succeeds without authentication and would report an outage as healthy.
     */
    `db: ${health.body?.db}`,
  );

  record(
    typeof health.body?.uptime === 'number',
    'the process reports its uptime',
    `${health.body?.uptime}s — a low number confirms a fresh restart`,
  );
}

// ---------------------------------------------------------------------------
section('Configuration');

if (surface === 'api' && health.status === 200) {
  /*
   * The summary is a count with no reasons, on purpose — an unauthenticated
   * reader learning "payments: no webhook secret" has been told which forged
   * request to send. The detail is at /admin/readiness, behind the guard.
   */
  const config = health.body?.config;
  record(
    config === 'ready',
    'no subsystem is misconfigured',
    config === undefined
      ? 'this build predates the readiness check — deploy is behind'
      : config === 'ready'
        ? 'ready'
        : `${health.body?.degradedCount} degraded — GET /admin/readiness as an operator for the reasons`,
  );
}

const version = await req('/app/version').catch(() => null);
if (version && version.status === 200) {
  record(true, 'the app version endpoint answers', JSON.stringify(version.body).slice(0, 120));
}

// ---------------------------------------------------------------------------
section('Authentication');

/*
 * Every one of these expects a refusal. That is what makes them safe to run
 * against production: the correct outcome is that nothing happens.
 */
if (surface === 'api') {
  const noToken = await req('/auth/me');
  record(
    noToken.status === 401,
    'an unauthenticated request is refused',
    `HTTP ${noToken.status} (expected 401)`,
  );

  const badToken = await req('/auth/me', {
    headers: { Authorization: 'Bearer not.a.real.token' },
  });
  record(
    badToken.status === 401,
    'a forged token is refused',
    `HTTP ${badToken.status} (expected 401)`,
  );
}

/*
 * The console's own surface, reachable from both hosts and meaning different
 * things on each. On the API origin it proves the guard is mounted; on the
 * console origin it proves the proxy reaches the API at all.
 */
const adminNoSession = await req('/admin/practices');
record(
  adminNoSession.status === 401 || adminNoSession.status === 403,
  'the platform console refuses an unauthenticated caller',
  `HTTP ${adminNoSession.status} (expected 401 or 403)`,
);

if (surface === 'console') {
  // The public signup surface, which is the other half of what this host
  // proxies and the only part of it that answers anonymously.
  const options = await req('/applications/options');
  record(
    options.status === 200 && Array.isArray(options.body?.types),
    'the public registration surface answers',
    options.status === 200
      ? `${options.body?.types?.length ?? 0} practice types offered`
      : `HTTP ${options.status}`,
  );
}

// ---------------------------------------------------------------------------
section('Surfaces the running box has never served');

/*
 * The routes added since the last deployment, proven mounted and guarded.
 *
 * This is the check that catches the failure this deploy is most exposed to:
 * a `git pull` into a directory pm2 does not execute. Everything else here
 * passes against the *old* code — /health answers, the database is connected,
 * an anonymous caller is refused — and a router that was never loaded answers
 * 404, which is the only signal that the restart served the previous release.
 *
 * GETs and refusals only, per the rule at the top of this file. The two
 * genuinely new POSTs — `/team/phone/otp` and `/applications/verify/send` —
 * each send a real SMS, so what is proven is that their router is mounted and
 * turns an anonymous caller away. Their handlers belong to the HTTP suite.
 */
if (surface === 'api') {
  const summaries = await req('/chat-summaries');
  record(
    summaries.status === 401,
    'the chat summary surface is mounted and guarded',
    summaries.status === 404
      ? '404 — either this release predates chat summaries, or the running checkout is not the one that was pulled'
      : `HTTP ${summaries.status} (expected 401)`,
  );

  const team = await req('/team');
  record(
    team.status === 401,
    'the team surface, which carries the hire codes, refuses an anonymous caller',
    team.status === 404
      ? '404 — this release predates hiring by phone code'
      : `HTTP ${team.status} (expected 401)`,
  );
}

if (surface === 'console') {
  /*
   * A reference no application can hold. 404 proves the status route is
   * mounted; 200 would mean it had answered about somebody else's.
   */
  const unknown = await req('/applications/SMOKE-0000-0000');
  record(
    unknown.status === 404,
    'an unknown application reference is refused, and the status route exists',
    `HTTP ${unknown.status} (expected 404)`,
  );
}

// ---------------------------------------------------------------------------
section('Error handling');

const missing = await req(surface === 'console' ? '/admin/nope' : '/this-route-does-not-exist');
record(
  missing.status === 404 || missing.status === 401,
  'an unknown route does not fall through to something else',
  `HTTP ${missing.status}`,
);

record(
  typeof missing.body !== 'string' || !/at\s+\w+\s+\(/.test(missing.body),
  'no stack trace is returned to an anonymous caller',
  'a stack names internal paths and module layout',
);

// ---------------------------------------------------------------------------
section('Transport');

if (origin.startsWith('https://')) {
  const hsts = health.headers.get('strict-transport-security');
  record(Boolean(hsts), 'HSTS is set', hsts ?? 'absent');

  const nosniff = health.headers.get('x-content-type-options');
  record(nosniff === 'nosniff', 'X-Content-Type-Options is nosniff', nosniff ?? 'absent');
} else {
  record(false, 'the origin is https', 'plain http — cookies cannot be Secure');
}

/*
 * Staging says so in a header.
 *
 * Not a nicety: the whole risk of a second environment is somebody acting on
 * one thinking it is the other. Anything reading this host can tell which it
 * is without parsing a hostname.
 */
const envHeader = health.headers.get('x-medpin-environment');
if (envHeader) record(true, `this host identifies itself as ${envHeader}`, '');

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.ok);
let last = '';

console.log(`\n  ${origin}\n`);
for (const r of results) {
  if (r.group !== last) {
    console.log(`  ${r.group}`);
    last = r.group;
  }
  const mark = r.ok ? '  ok  ' : ' FAIL ';
  console.log(`   ${mark} ${r.name}`);
  if (r.detail) console.log(`          ${r.detail}`);
}

console.log(
  `\n  ${results.length - failed.length}/${results.length} passed` +
    (failed.length ? ` — ${failed.length} failed\n` : '\n'),
);

process.exit(failed.length ? 1 : 0);
