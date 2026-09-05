import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { recordWindow } from '../src/middleware/authorise.js';

/**
 * "Access is not retroactive" — the half that was missing.
 *
 * `enrollmentGate` answers whether a practice may open a patient. It cannot
 * answer which of that patient's rows they may see, because it does not know
 * what is about to be queried.
 *
 * So the rule was enforced on the door and not on the shelves. A practice that
 * enrolled Rahul in September could open him and read a prescription written in
 * May by somebody else — which is the exact thing the enrolment date exists to
 * prevent, and it was one `$gte` away the whole time.
 *
 * The staging harness would have caught it. Reading the route caught it first,
 * which is luck rather than method, and these exist so the next one is method.
 */
const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));

describe('the window itself', () => {
  test('an enrolment bounds the query', () => {
    const req = { enrollment: { enrolledOn: new Date('2026-09-01') } };
    const w = recordWindow(req, 'issuedOn');
    assert.deepEqual(Object.keys(w), ['issuedOn']);
    assert.equal(w.issuedOn.$gte.toISOString(), new Date('2026-09-01').toISOString());
  });

  test('no enrolment restricts nothing', () => {
    // A patient the migration has not reached, or a caller with no practice.
    // Unknown never restricts, for the same reason unknown never denies —
    // returning a bound here would empty the lists of the clinic running today.
    assert.deepEqual(recordWindow({}), {});
    assert.deepEqual(recordWindow({ enrollment: null }), {});
    assert.deepEqual(recordWindow({ enrollment: {} }), {});
  });

  test('the field is named by the caller, not guessed', () => {
    // `issuedOn` for a prescription, `takenAt` for a reading. A helper that
    // guessed would silently filter on a field the collection does not have,
    // which matches everything and looks like it worked.
    assert.ok('takenAt' in recordWindow({ enrollment: { enrolledOn: new Date() } }, 'takenAt'));
  });
});

describe('the gate keeps the enrolment for the reads that follow', () => {
  test('it is stored on the request when access is allowed', () => {
    const src = readFileSync(new URL('../src/middleware/authorise.js', import.meta.url), 'utf8');
    assert.match(src, /req\.enrollment = verdict\.enrollment \?\? null;/);
  });
});

describe('prescriptions are bounded, list and fetch alike', () => {
  const src = readFileSync(path.join(ROUTES, 'prescriptions.js'), 'utf8');

  test('the list applies it', () => {
    assert.match(src, /patient: req\.patientId, \.\.\.recordWindow\(req, 'issuedOn'\)/);
  });

  test('and so does fetching one directly', () => {
    // A list that hides a row while its own URL still serves it is a filter,
    // not a rule.
    const one = src.slice(src.indexOf("Prescription.findOne({"));
    assert.match(one.slice(0, 300), /recordWindow\(req, 'issuedOn'\)/);
  });
});

describe('what is still unbounded, and it must not grow', () => {
  /**
   * Clinical reads scoped only by patient, with no enrolment window.
   *
   * Fifty-nine of them at the time of writing. Applying the window to all
   * mechanically would mean guessing a date field per collection and touching
   * writes as well as reads, which is how a sweeping change breaks something
   * quietly. So the number is pinned instead: the gap is visible, countable,
   * and cannot widen while nobody is looking.
   *
   * Lower this as routes adopt `recordWindow`. It is the same ratchet the token
   * linter uses, for the same reason.
   */
  const CEILING = 59;

  test('the count has not gone up', () => {
    let unbounded = 0;
    const byFile = {};

    for (const f of readdirSync(ROUTES).filter((n) => n.endsWith('.js'))) {
      const src = readFileSync(path.join(ROUTES, f), 'utf8');
      const hits = src
        .split('\n')
        .filter((l) => l.includes('patient: req.patientId') && !l.includes('recordWindow'));
      if (hits.length) byFile[f] = hits.length;
      unbounded += hits.length;
    }

    assert.ok(
      unbounded <= CEILING,
      `${unbounded} unbounded clinical reads, up from ${CEILING}.\n` +
        `${JSON.stringify(byFile, null, 2)}\n\n` +
        'A new read scoped only by patient can show one practice what another wrote.\n' +
        "Add ...recordWindow(req, '<dateField>') to it, or lower the ceiling if you\n" +
        'have fixed some and this is now stale.',
    );
  });
});
