import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { SHARED_READS, categoryOfRead } from '../src/services/sharing.js';

/**
 * Every windowed read has had its sharing decided.
 *
 * ---- Why this exists ---------------------------------------------------------
 *
 * A share grant lifts the enrolment window only on reads `services/sharing.js`
 * can put in a category, and it recognises a read by where the route is
 * mounted and which field the window is on. That fails closed: a route renamed
 * or added reads inside the enrolment whatever the patient shared. Which is
 * safe, and also silent — a patient who shared their lab reports would find
 * the practice still could not see them, and nobody would know why.
 *
 * So each `recordWindow` in a GET handler is either in a category or named
 * below with the reason it is never shared, and each entry in the table is
 * still a read that exists.
 */

const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));
const index = readFileSync(path.join(ROUTES, 'index.js'), 'utf8');

/** file → the path it is mounted at, from routes/index.js. */
const MOUNTS = (() => {
  const imports = new Map(
    [...index.matchAll(/import (\w+) from '\.\/([\w]+)\.js';/g)].map((m) => [m[1], `${m[2]}.js`]),
  );
  const out = new Map();
  for (const m of index.matchAll(/router\.use\('([^']+)', (\w+)\);/g)) {
    const file = imports.get(m[2]);
    if (!file) continue;
    if (!out.has(file)) out.set(file, []);
    out.get(file).push(m[1]);
  }
  return out;
})();

/**
 * Windowed reads that no grant widens, and why.
 *
 * Keyed `file METHOD path field`. Each needs a reason.
 */
const UNSHARED = new Map([
  [
    'chat.js GET /patients/:patientId/thread createdAt',
    'A conversation belongs to one practice’s relationship with the patient. A grant ' +
      'shares the patient’s records, not what they said to somebody else.',
  ],
  [
    'messages.js GET /patient/:patientId createdAt',
    'The same: direct messages are a relationship, not a record, and another ' +
      'practice’s correspondence is not the patient’s to hand over by category.',
  ],
  [
    'doctor.js GET /chat-review/:sessionId createdAt',
    'Reviewing what the assistant told a patient in this practice’s conversation. ' +
      'Nothing from before the enrolment belongs in a review of this practice’s thread.',
  ],
]);

/** Every `recordWindow(req, 'field')` with the route handler it sits in. */
function windowedReads() {
  const found = [];
  for (const file of readdirSync(ROUTES).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(path.join(ROUTES, file), 'utf8');
    for (const m of src.matchAll(/recordWindow\(req,\s*'([^']+)'\)/g)) {
      const before = src.slice(0, m.index);
      const routes = [...before.matchAll(/router\.(get|post|patch|put|delete)\(\s*\n?\s*'([^']+)'/g)];
      const route = routes[routes.length - 1];
      if (!route) continue;
      found.push({ file, method: route[1].toUpperCase(), path: route[2], field: m[1] });
    }
  }
  return found;
}

/** What `categoryOfRead` sees for a request to this handler. */
function fakeRequest(mount, routePath) {
  return {
    method: 'GET',
    baseUrl: `/api/v1${mount.replace(/:patientId/g, '64b000000000000000000001')}`,
    route: { path: routePath },
  };
}

describe('every windowed read has had its sharing decided', () => {
  const reads = windowedReads().filter((r) => r.method === 'GET');

  test('the reads were found', () => {
    assert.ok(reads.length >= 20, `only ${reads.length} windowed GET reads found`);
    assert.ok(MOUNTS.get('prescriptions.js'), 'routes/index.js was not parsed');
  });

  test('each one is in a category, or named as never shared with a reason', () => {
    const undecided = [];
    for (const r of reads) {
      const key = `${r.file} ${r.method} ${r.path} ${r.field}`;
      if (UNSHARED.has(key)) continue;
      const mounts = MOUNTS.get(r.file) ?? [];
      const mapped = mounts.some((mount) => categoryOfRead(fakeRequest(mount, r.path), r.field));
      if (!mapped) undecided.push(key);
    }
    assert.deepEqual(
      undecided,
      [],
      `\n\nThese reads are bounded by the enrolment and no grant can widen them:\n\n  ${undecided.join(
        '\n  ',
      )}\n\nAdd them to SHARED_READS in services/sharing.js under the category they belong to,\nor to UNSHARED here with the reason no patient could share them.\n`,
    );
  });

  test('and nothing named as unshared is quietly in a category after all', () => {
    for (const key of UNSHARED.keys()) {
      const [file, , routePath, field] = key.split(' ');
      for (const mount of MOUNTS.get(file) ?? []) {
        assert.equal(categoryOfRead(fakeRequest(mount, routePath), field), null, `${key} is widened by a grant`);
      }
    }
  });

  test('every unshared entry still exists, and says why', () => {
    const keys = new Set(reads.map((r) => `${r.file} ${r.method} ${r.path} ${r.field}`));
    for (const [key, reason] of UNSHARED) {
      assert.ok(keys.has(key), `${key} no longer exists`);
      assert.ok(reason.length > 40, `${key} is unshared without a real reason`);
    }
  });

  test('every category entry still matches a read', () => {
    const stale = SHARED_READS.filter(
      (entry) =>
        !reads.some(
          (r) =>
            r.field === entry.field &&
            (MOUNTS.get(r.file) ?? []).some((mount) => {
              const req = fakeRequest(mount, r.path);
              return entry.route.test(`${req.baseUrl}${req.route.path}`);
            }),
        ),
    );
    assert.deepEqual(stale.map((s) => `${s.route} ${s.field}`), [], 'a category names a read that no longer exists');
  });

  test('a write is never widened, whatever its path', () => {
    const req = { ...fakeRequest('/patients/:patientId/prescriptions', '/'), method: 'POST' };
    // categoryOfRead names the category; the method rule lives in
    // sharedHistoryCovers, which refuses anything but GET and HEAD first.
    const src = readFileSync(new URL('../src/services/sharing.js', import.meta.url), 'utf8');
    const body = src.slice(src.indexOf('export function sharedHistoryCovers'));
    assert.match(body.slice(0, 200), /if \(!READ_METHODS\.has\(req\.method\)\) return false;/);
    assert.ok(categoryOfRead(req, 'issuedOn'), 'the category table should still recognise the path');
  });
});
