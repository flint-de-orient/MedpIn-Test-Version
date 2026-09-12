import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Staging and production are actually two things.
 *
 * ---- What goes wrong with a second environment -------------------------
 *
 * Not that it fails to work. That it stops being separate.
 *
 * A port reused, a database name copied, an upload directory shared — each is
 * invisible while both are healthy, and each turns "we tested it on staging"
 * into a sentence about production. By the time anybody asks whether the two
 * were ever really separate, the answer takes an afternoon to establish.
 *
 * The pm2 file declares both apps side by side so the differences are readable
 * in one screen. This reads them, so they stay differences.
 *
 * The configs are text; nothing here needs a server.
 */

const root = (p) => fileURLToPath(new URL(`../../${p}`, import.meta.url));
const read = (p) => readFileSync(root(p), 'utf8');

const ecosystem = read('deploy/ecosystem.config.cjs');
const stagingEnv = read('deploy/staging.env.example');
const stagingVhost = read('deploy/apache/staging.clinq.flintdeorient.in.conf');
const adminVhost = read('deploy/apache/admin.medpin.in.conf');
const runbook = read('deploy/STAGING.md');

/** The value of a key inside one pm2 app block. */
function appValue(appName, key) {
  const at = ecosystem.indexOf(`name: '${appName}'`);
  assert.ok(at > 0, `${appName} is not declared in ecosystem.config.cjs`);
  // Up to the next app, or the end.
  const next = ecosystem.indexOf("name: '", at + 10);
  const block = ecosystem.slice(at, next === -1 ? undefined : next);
  const m = block.match(new RegExp(`${key}:\\s*'?([^,'\\n]+)'?`));
  return m ? m[1].trim() : null;
}

describe('the two environments cannot be the same thing', () => {
  test('both are declared, in one file', () => {
    // Every assertion below reads that file. If a second one appears
    // elsewhere, these stop covering the environment that actually runs.
    assert.match(ecosystem, /name: 'clinq'/);
    assert.match(ecosystem, /name: 'clinq-staging'/);
  });

  test('they listen on different ports', () => {
    const prod = appValue('clinq', 'PORT');
    const staging = appValue('clinq-staging', 'PORT');
    assert.ok(prod && staging, 'a port is missing');
    assert.notEqual(prod, staging, `both apps are on port ${prod}`);
  });

  test('they read different .env files', () => {
    /*
     * The single most consequential difference. One env file shared is one
     * database, one set of signing keys and one set of messaging credentials —
     * at which point staging is production with a different hostname.
     */
    const prod = appValue('clinq', 'env_file');
    const staging = appValue('clinq-staging', 'env_file');
    assert.notEqual(prod, staging, 'both apps read the same configuration');
  });

  test('and run from different working copies', () => {
    // A shared checkout's failure mode is production running staging's code in
    // the window between a `git checkout` and a `pm2 restart`.
    assert.notEqual(appValue('clinq', 'cwd'), appValue('clinq-staging', 'cwd'));
  });

  test('the vhost points at the staging port, not production’s', () => {
    // Two files have to agree about a number, which is exactly the kind of
    // agreement that decays.
    const port = appValue('clinq-staging', 'PORT');
    assert.match(
      stagingVhost,
      new RegExp(`127\\.0\\.0\\.1:${port}`),
      `the staging vhost does not proxy to ${port}`,
    );
    assert.ok(
      !stagingVhost.includes(`127.0.0.1:${appValue('clinq', 'PORT')}`),
      'the staging vhost proxies to production',
    );
  });

  test('staging keeps its own database and its own uploads', () => {
    /*
     * Uploads are the one place the two would genuinely share state: a staging
     * test that deletes an asset would delete a patient's lab report.
     */
    assert.match(stagingEnv, /MONGODB_URI=.*staging/i, 'staging has no database of its own');
    assert.match(stagingEnv, /UPLOAD_DIR=.*staging/i, 'staging writes uploads into production’s');
  });

  test('and ships with no secrets in it', () => {
    // This file is in git. A template with a real value in it is a leaked
    // credential that looks like documentation.
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'ADMIN_JWT_SECRET',
      'GEMINI_API_KEY',
      'RAZORPAY_KEY_SECRET',
      'RAZORPAY_WEBHOOK_SECRET',
    ]) {
      assert.match(
        stagingEnv,
        new RegExp(`^${key}=\\s*$`, 'm'),
        `${key} in the template is not empty`,
      );
    }
  });
});

describe('staging cannot message a real patient by default', () => {
  test('every outward channel is blank in the template', () => {
    /*
     * The check that matters most, asserted on the file people copy.
     *
     * Each of these logs instead of sending when unset, so staging exercises
     * the same code paths and reaches nobody. A template that arrived with one
     * filled in would put a live channel on a rehearsal box on day one.
     */
    for (const key of [
      'MSG91_AUTH_KEY',
      'MSG91_SENDER_ID',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'SMTP_HOST',
    ]) {
      assert.match(
        stagingEnv,
        new RegExp(`^${key}=\\s*$`, 'm'),
        `${key} is pre-filled in the staging template`,
      );
    }
  });

  test('and the server is told which environment it is', () => {
    // Staging runs NODE_ENV=production on purpose, so this is the only thing
    // that lets the readiness check know to ask the question at all.
    assert.match(stagingEnv, /^DEPLOY_ENV=staging$/m);
    assert.match(stagingEnv, /^NODE_ENV=production$/m);
  });
});

describe('the console vhost carries the proxy the console needs', () => {
  test('both prefixes the console actually calls', () => {
    /*
     * `admin.medpin.in` proxies exactly `/api/v1/admin/` and
     * `/api/v1/applications/`, and the console calls exactly those two. That
     * narrowness is the right arrangement rather than a half-finished one:
     * `/auth/`, `/doctor/` and `/billing/` are not reachable behind the
     * console's first-party cookie at all.
     *
     * Recorded here because it was briefly reported as a production blocker —
     * a tool that assumed every host proxies the whole API said the console
     * had no API behind it. It has exactly enough.
     */
    assert.match(adminVhost, /ProxyPass\s+\/api\/v1\//);
    assert.match(adminVhost, /ProxyPassReverse\s+\/api\/v1\//);
  });

  test('and says why the cookie makes it necessary', () => {
    // SameSite=Strict forbids cross-origin, so the API has to come from the
    // console's own host or the console cannot authenticate at all.
    assert.match(adminVhost, /SameSite=Strict|first-party/i);
  });
});

describe('the runbook and the configuration agree', () => {
  test('the runbook names the same host as the vhost', () => {
    const server = stagingVhost.match(/ServerName\s+(\S+)/)?.[1];
    assert.ok(server, 'the staging vhost declares no ServerName');
    assert.ok(
      runbook.includes(server),
      `the runbook never mentions ${server} — one of the two has been renamed`,
    );
  });

  test('and tells somebody how to prove the deploy worked', () => {
    // A runbook that ends at "restart the process" is one where the last step
    // is somebody assuming.
    assert.match(runbook, /smoke\.mjs/);
  });

  test('and says what a rollback does not cover', () => {
    /*
     * Every script in backend/scripts/ is forward-only and none has a down, so
     * "roll back" means the code and not the data. A rollback plan that does
     * not say so is one that gets trusted at the worst moment.
     */
    assert.match(runbook, /forward-only|mongodump/i);
  });
});
