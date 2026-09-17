import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

/**
 * The real app, over real HTTP, against a real database.
 *
 * ---- The gap this fills -------------------------------------------------
 *
 * There were two isolation tests and neither ran the system. `isolation.test.js`
 * stubs its queries: fast, runs on every commit, and it proves the *rule*. It
 * cannot see a route that forgets `resolvePatientScope`, a middleware ordered
 * after its handler, a populate that leaks a field, or a filter that was written
 * and never awaited. `scripts/verifyIsolation.js` does run the system, but it
 * needs a staging box, a server already listening, and `ALLOW_ISOLATION_TEST` —
 * so it has never once been run.
 *
 * Eight cross-tenant leaks were found in this codebase by reading it. Every one
 * of them looked like correct code, and every one would have been caught by a
 * second practice asking a real question over a real socket.
 *
 * So: an ephemeral mongod, the real `createApp()`, a real port, real tokens.
 * No fixtures, no stubs, nothing to remember to switch on.
 *
 * ---- Why it cannot touch your database ----------------------------------
 *
 * `connectDb()` reads `env.MONGODB_URI`, which on a developer's machine is the
 * development database and on the server is the clinic's. This connects
 * mongoose to the memory server's URI directly and never calls it. That is the
 * whole safety argument, and it is why `wipe()` below is allowed to exist —
 * deleting every collection is only ever a sentence about a database that was
 * created three milliseconds ago.
 */

let mongod = null;
let server = null;
let origin = null;

/** Boot the stack. Idempotent, so `before()` in several suites is fine. */
export async function boot() {
  if (origin) return origin;

  // A minute to start, not the library's ten seconds. On a machine running
  // several suites at once mongod routinely takes longer than ten seconds to
  // come up, and every test in the file was then reported cancelled — a
  // failure about the machine, read as a failure about the code.
  mongod = await MongoMemoryServer.create({ instance: { launchTimeout: 60000 } });
  await mongoose.connect(mongod.getUri('medpin_http_test'));

  const { createApp } = await import('../../src/app.js');
  server = createApp().listen(0);
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });

  origin = `http://127.0.0.1:${server.address().port}/api/v1`;
  return origin;
}

export async function shutdown() {
  if (server) await new Promise((r) => server.close(r));
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (mongod) await mongod.stop();
  server = null;
  mongod = null;
  origin = null;
}

/**
 * Empty every collection.
 *
 * Between tests rather than between files: a test that passes only because of
 * what the previous one left behind is worse than no test, and the failure it
 * produces is a reordering away from being invisible.
 */
export async function wipe() {
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}

/**
 * A caller. `as(null)` is an anonymous one, which is worth testing too.
 *
 * Returns `{ status, body }` and never throws on a non-2xx — the status IS the
 * assertion in most of these, and a helper that threw would turn "correctly
 * refused" into a test error.
 */
export function as(token) {
  const call = async (method, path, body, headers = {}) => {
    const res = await fetch(origin + path, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        // Whatever else the request needs to say — which practice this is for,
        // above all. A harness that cannot send a header is a header nothing
        // in the suite has ever exercised.
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text; // An HTML error page is more use than a parse failure.
    }
    return { status: res.status, body: parsed };
  };

  return {
    get: (path, headers) => call('GET', path, undefined, headers),
    post: (path, body, headers) => call('POST', path, body, headers),
    patch: (path, body, headers) => call('PATCH', path, body, headers),
    // Four routes use PUT and this helper had no verb for them, so nothing in
    // the suite had ever sent one. A harness that cannot express a request is
    // a set of routes nobody tests.
    put: (path, body, headers) => call('PUT', path, body, headers),
    // A body is optional: a removal can carry its reason, which belongs in the
    // body rather than in a URL that access logs keep.
    del: (path, headers, body) => call('DELETE', path, body, headers),
  };
}

/**
 * Every string in a response body, however deeply nested.
 *
 * The leaks worth catching are not "the wrong array came back". They are one
 * other practice's patient name inside a populated field on an object three
 * levels down, which an assertion about `body.length` sails straight past.
 */
export function allText(value) {
  const out = [];
  const walk = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(value);
  return out.join(' ');
}
