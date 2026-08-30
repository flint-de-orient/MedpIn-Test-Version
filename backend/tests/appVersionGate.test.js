import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const envSrc = readFileSync(new URL('../src/config/env.js', import.meta.url), 'utf8');
const routeSrc = readFileSync(new URL('../src/routes/appVersion.js', import.meta.url), 'utf8');
const indexSrc = readFileSync(new URL('../src/routes/index.js', import.meta.url), 'utf8');

/**
 * The version gate, and the two ways it could do more harm than good.
 *
 * It exists because /scan changed shape: an older client photographs a
 * prescription, gets a preview it cannot read, and shows the patient nothing at
 * all — no error and no clue. Being told to update is better than a feature
 * that silently does nothing.
 *
 * But a gate is a lock, and a lock on a patient's own medicines has to be
 * harder to close by accident than to leave open.
 */
describe('the app version gate', () => {
  test('gates nobody until it is configured', () => {
    // A server nobody has told about builds must let everyone through. Locking
    // a patient out because an environment variable was mistyped is worse than
    // running a slightly old app.
    assert.match(
      envSrc,
      /ANDROID_MIN_BUILD:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.default\(0\)/,
      'the floor defaults to 0',
    );
    assert.match(
      envSrc,
      /ANDROID_LATEST_BUILD:\s*z\.coerce\.number\(\)\.int\(\)\.min\(0\)\.default\(0\)/,
    );
  });

  test('is reachable without signing in', () => {
    // The client this has to catch may be too old to log in. A gate you must
    // authenticate to read cannot answer the case it was built for.
    const at = indexSrc.indexOf("router.use('/app', appVersionRoutes)");
    const auth = indexSrc.indexOf("router.use('/auth', authRoutes)");
    assert.ok(at > -1, 'the route is mounted');
    assert.ok(at < auth, 'and mounted before the authenticated routers');
    assert.doesNotMatch(routeSrc, /requireAuth/, 'no auth on the route itself');
  });

  test('separates "you must update" from "you could update"', () => {
    // Two different numbers doing two different jobs. Collapsing them would
    // make every release a forced one.
    assert.match(routeSrc, /minBuild/);
    assert.match(routeSrc, /latestBuild/);
  });

  test('never hands back a download button that goes nowhere', () => {
    // Unset means null, and the client says to ring the clinic instead of
    // showing a button that does nothing when a patient is already stuck.
    assert.match(routeSrc, /env\.APP_DOWNLOAD_URL \|\| null/);
  });
});
