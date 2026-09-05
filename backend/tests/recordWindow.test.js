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

describe('what is deliberately unbounded, and why', () => {
  /**
   * Two collections a clinician reads without a date bound, on purpose.
   *
   * `medications` — the sharp one. A doctor meeting a new patient must know
   * what that patient is currently taking, and a medication started before the
   * enrolment is still in their body. Hiding it would be a drug-interaction
   * hazard dressed up as privacy: the whole reason to ask "what are you on" is
   * that the answer predates you.
   *
   * `chat` — isolated already, and by something stronger. A thread belongs to
   * an enrolment, so one practice cannot see another's conversation whatever
   * the dates say. Adding a window on top would truncate a live conversation
   * mid-thread for no gain.
   *
   * Everything else a clinician reads is bounded. The list is short and each
   * line earns its place; a file appearing here without a reason above is the
   * exemption becoming a habit.
   */
  const EXEMPT = new Set(['medications.js', 'chat.js']);

  test('every unbounded clinical read is in a collection we chose to exempt', () => {
    const offenders = [];

    for (const f of readdirSync(ROUTES).filter((n) => n.endsWith('.js'))) {
      const src = readFileSync(path.join(ROUTES, f), 'utf8').split('\n');

      src.forEach((line, i) => {
        if (!line.includes('patient: req.patientId')) return;

        // The whole filter object, not the one line of it that names the
        // patient — a multi-line filter puts recordWindow on the next line,
        // and a line-by-line check calls that unbounded.
        const around = src.slice(Math.max(0, i - 6), i + 7).join('\n');
        if (around.includes('recordWindow')) return;

        const ops = around.match(/\.(find|findOne|countDocuments|aggregate)\(/g) ?? [];
        const writes = around.match(/\.(create|updateOne|updateMany|findOneAndUpdate|findOneAndDelete|deleteMany|deleteOne|insertMany)\(/g) ?? [];
        // A write is not a read, and bounding one would stop a patient logging
        // a reading on a day their practice had not yet enrolled them.
        if (!ops.length || writes.length) return;

        if (!EXEMPT.has(f)) offenders.push(`${f}:${i + 1}  ${line.trim().slice(0, 60)}`);
      });
    }

    assert.deepEqual(
      offenders,
      [],
      [
        '',
        'Clinical reads scoped only by patient:',
        '',
        ...offenders.map((o) => `  ${o}`),
        '',
        "Add ...recordWindow(req, '<dateField>'), or exempt the collection above",
        'with a reason. Unbounded, one practice can read what another wrote.',
      ].join('\n'),
    );
  });

  test('the exemption list has not grown', () => {
    // Two, and both argued. A third should require saying why out loud.
    assert.equal(EXEMPT.size, 2, 'a collection was exempted without discussion');
  });
});
