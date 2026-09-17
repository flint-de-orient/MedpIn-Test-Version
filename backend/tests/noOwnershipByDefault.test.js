import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * No practice is given patients, clinics or clinicians by default — V-49 and
 * deploy/DATA-DECISIONS.md §3.
 *
 * The founding-practice migration did exactly that, once, in production, on
 * 4 September 2026: every existing patient enrolled ACTIVE at the founding
 * practice with no consent code, backdated, and every clinic and clinician
 * attached to it. It is recorded as a one-time exception. These tests keep it
 * one-time: the two scripts cannot run, and no other script may repeat the
 * pattern without being named here with its reason.
 */

const BACKEND = fileURLToPath(new URL('..', import.meta.url));
const SCRIPTS = path.join(BACKEND, 'scripts');
const RETIRED = ['backfillEnrollments.js', 'backfillPractices.js'];

/**
 * Scripts allowed to write an ACTIVE enrolment, and why. A new entry is a
 * decision about consent, not a formality.
 */
const MAY_WRITE_ACTIVE_ENROLMENTS = new Map([
  [
    'backfillDeskRegistrations.js',
    'turns in-person desk registrations — made by the practice, with the patient at the desk — into the enrolment each already was',
  ],
  ['verifyIsolation.js', 'creates its own synthetic practices and patients to probe isolation, and removes them'],
]);

/** Source with comments removed, so a sentence explaining a rule is not the rule broken. */
function code(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the founding-practice migration stays a one-time exception', () => {
  for (const name of RETIRED) {
    test(`${name} refuses to run, and never reaches the database`, () => {
      const run = spawnSync(process.execPath, [path.join(SCRIPTS, name), '--apply'], {
        cwd: BACKEND,
        encoding: 'utf8',
        timeout: 60000,
        // Nowhere to connect to: had it tried, it would fail on the connection,
        // not with the retirement notice.
        env: { ...process.env, MONGODB_URI: 'mongodb://127.0.0.1:1/never' },
      });
      assert.equal(run.status, 1, `${name} did not exit with an error`);
      assert.match(run.stderr, /This migration is retired/);
      assert.ok(!/MongooseServerSelectionError|ECONNREFUSED/.test(run.stderr), `${name} tried to connect`);
    });

    test(`${name} no longer calls main()`, () => {
      const src = code(readFileSync(path.join(SCRIPTS, name), 'utf8'));
      assert.ok(!/^main\(\)/m.test(src), `${name} runs again`);
    });
  }

  const others = readdirSync(SCRIPTS).filter((f) => f.endsWith('.js') && !RETIRED.includes(f));

  test('no other script assigns anything to the founding practice', () => {
    const offenders = others.filter((f) => /isFounding/.test(code(readFileSync(path.join(SCRIPTS, f), 'utf8'))));
    assert.deepEqual(offenders, [], 'a script gives the founding practice something by default');
  });

  test('no other script writes an ACTIVE enrolment unless it is named, with its reason', () => {
    const offenders = others.filter((f) => {
      if (MAY_WRITE_ACTIVE_ENROLMENTS.has(f)) return false;
      const src = code(readFileSync(path.join(SCRIPTS, f), 'utf8'));
      const writes = [...src.matchAll(/Enrollment\.(create|insertMany|updateOne|updateMany|findOneAndUpdate)\(/g)];
      return writes.some((m) => /ENROLLMENT_STATUS\.ACTIVE/.test(src.slice(m.index, m.index + 600)));
    });
    assert.deepEqual(offenders, [], 'a script enrols patients ACTIVE without a recorded consent basis');
  });

  test('the decision is written down where the next person will look', () => {
    const doc = readFileSync(path.join(BACKEND, '..', 'deploy', 'DATA-DECISIONS.md'), 'utf8');
    assert.match(doc, /one-time historical exception/);
    assert.match(doc, /4 September 2026/);
  });
});
