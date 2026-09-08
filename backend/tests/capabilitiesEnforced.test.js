import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { CAPABILITIES } from '../src/services/capabilities.js';

/**
 * A capability nobody asks is a plan feature nobody has.
 *
 * ---- The resolver decided things and one router listened ----------------
 *
 * Twelve capabilities, a type table, a plan table, a permission map, and
 * exactly one route that called `requireCapability` — the department one. Every
 * other surface was open regardless of what the practice was or had paid for,
 * so the plan was a label on an invoice.
 *
 * That is the same shape as everything else this codebase keeps finding:
 * machinery that is correct, complete, mounted, and asked by nothing.
 *
 * ---- And it was inert for patients anyway -------------------------------
 *
 * `requireCapability` resolved the practice through `practiceOf`, which reads
 * the caller's *membership*. A patient has none — they are enrolled, not
 * employed — so every patient-facing route got a null practice, which the guard
 * reads as "unknown, permit". The layer was switched off for the half of the
 * app with the most users, and nothing said so.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function read(rel) {
  return readFileSync(path.join(SRC, rel), 'utf8');
}

const routeSrc = readdirSync(path.join(SRC, 'routes'))
  .filter((n) => n.endsWith('.js'))
  .map((n) => readFileSync(path.join(SRC, 'routes', n), 'utf8'))
  .join('\n');

describe('the guard can see a patient’s practice', () => {
  const guard = read('middleware/requireCapability.js');

  test('a patient is resolved through their enrolment, not a membership', () => {
    assert.match(guard, /req\.user\?\.role === ROLES\.PATIENT/);
    assert.match(guard, /await practiceOfPatient\(req\.user\._id\)/);
  });

  test('and their membership stays null, which does not narrow', () => {
    // A patient has no role preset to be judged against. `effectiveCapabilities`
    // reads a null membership as "do not narrow", so they get what their
    // practice has — which is the right answer and worth not breaking.
    const resolver = read('services/capabilities.js');
    assert.match(resolver, /if \(!membership\) return held;/);
  });
});

describe('the capabilities that gate something, do', () => {
  /**
   * Not all twelve. Some describe a screen rather than a route — the analytics
   * split does not exist in the code yet, so gating the one analytics endpoint
   * on ADVANCED_ANALYTICS would empty a solo practice's dashboard rather than
   * withhold an advanced view of it.
   *
   * These are the ones with a route that means exactly them.
   */
  const WIRED = {
    PRESCRIPTION: 'routes/prescriptions.js',
    LAB_ORDER: 'routes/care.js',
    DEPARTMENT: 'routes/departments.js',
    MULTI_LOCATION: 'routes/clinics.js',
  };

  for (const [cap, file] of Object.entries(WIRED)) {
    test(`${cap} is checked in ${file}`, () => {
      const src = read(file);
      assert.ok(
        new RegExp(`CAPABILITIES\\.${cap}\\b`).test(src),
        `${file} does not ask for ${cap}`,
      );
    });
  }

  test('every name in the enum exists', () => {
    for (const cap of Object.keys(WIRED)) {
      assert.ok(CAPABILITIES[cap], `${cap} is not a capability any more`);
    }
  });
});

describe('a permission and a capability are different questions', () => {
  test('prescribing needs both', () => {
    // A diagnostic centre's pathologist holds PRESCRIBE from the clinician
    // preset and must still not issue one. That is about what the organisation
    // is licensed to do, not who it employs — so neither check substitutes for
    // the other.
    const src = read('routes/prescriptions.js');
    const at = src.indexOf('requirePermission(PERMISSIONS.PRESCRIBE)');
    assert.ok(at > 0, 'the prescribe permission check moved');
    assert.match(src.slice(at, at + 400), /requireCapability\(CAPABILITIES\.PRESCRIPTION\)/);
  });
});

describe('the first location is always allowed', () => {
  const src = read('routes/clinics.js');

  test('MULTI_LOCATION gates the second, not the first', () => {
    // A practice with no location cannot take a booking at all, so refusing
    // the first would be selling a plan that cannot be used.
    assert.match(src, /existing >= 1 && !\(await requestCan\(req, CAPABILITIES\.MULTI_LOCATION\)\)/);
  });

  test('and the cap is a separate answer with a separate message', () => {
    // They fail for different reasons and want different replies: a type that
    // has one building is not a thing to upsell; a number somebody agreed is.
    assert.match(src, /overLimit\('locations', existing\)/);
    assert.match(src, /Ask about a larger plan/);
    assert.match(src, /needs a practice type that has them/);
  });

  test('the refusal is reachable — conflict is imported', () => {
    // It was not. `node --check` passes on an undefined identifier and the
    // module loads; it would have thrown ReferenceError on the first practice
    // that actually hit the cap, which is the one customer it was written for.
    assert.match(src, /import \{[^}]*\bconflict\b[^}]*\} from '\.\.\/middleware\/errors\.js'/);
  });
});

describe('nothing gates a route it cannot answer for', () => {
  test('every file that checks a capability authenticates first', () => {
    // The context comes from req.user. Mounted before authentication it would
    // read undefined, resolve no practice, and permit everything — a guard that
    // looks present and is not.
    //
    // Per file, not across the concatenation: a lookback that runs off the end
    // of one file into the next proves nothing about either.
    const files = readdirSync(path.join(SRC, 'routes')).filter((n) => n.endsWith('.js'));

    for (const name of files) {
      const src = readFileSync(path.join(SRC, 'routes', name), 'utf8');
      if (!/requireCapability\(|requestCan\(/.test(src)) continue;

      assert.match(
        src,
        /router\.use\((requireAuth|requireClinician|requireDoctor)/,
        `${name} checks a capability without authenticating the router first`,
      );
    }
  });
});
