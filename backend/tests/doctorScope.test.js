import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * `/doctor/*` never went through `resolvePatientScope`.
 *
 * Every clinical route in the app funnels through that middleware, and it is
 * where the five questions get asked: who is the caller, which practice, is the
 * membership active, is the patient enrolled there, does the permission set
 * allow it. Adding `assertSamePractice` to it was the commit called "A
 * clinician at one practice should not open records at another".
 *
 * This router mounts `requireAuth, requireClinician` and nothing else. It reads
 * patients straight off `req.params.id`. So the guard that commit added was
 * never on the clinician's own daily surface — the patient list, the summary
 * sheet, the worklist, chat review — and `GET /doctor/patients` was building
 * `{ role: PATIENT, isActive: true }`, which is every patient on the platform.
 *
 * With one practice all of that read correctly, which is exactly why it
 * survived: there was nothing to leak to. It becomes a breach on the day the
 * second practice signs in, which is the day it was going to be turned on.
 *
 * The isolation harness would not have caught it either. It probes
 * `/patients/:id/prescriptions` — a route that does go through the middleware.
 */
const src = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');

/** Each route in the file, with its handler body. */
function routes() {
  const rx = /^router\.(get|post|patch|put|delete)\(\s*\n\s*'([^']+)'/gm;
  const marks = [...src.matchAll(rx)];
  return marks.map((m, i) => ({
    method: m[1].toUpperCase(),
    path: m[2],
    body: src.slice(m.index, marks[i + 1]?.index ?? src.length),
  }));
}

/** Does it read or write anything belonging to a patient? */
const touchesPatients = (r) =>
  /ROLES\.PATIENT|PatientProfile|GlucoseReading|VitalRecord|ChatSession/.test(r.body);

/** Is it confined to the caller's own practice, by either mechanism? */
const isScoped = (r) =>
  /assertSamePractice|enrollmentGate|practicePatients|practiceOf\(req\)/.test(r.body);

describe('the clinician router asks which practice', () => {
  /**
   * Aggregates still to do, and the reason they are listed rather than fixed:
   * each one reaches patients through a different collection — alerts through
   * Alert, chat review through ChatSession, the worklist and overview through
   * their own pipelines — so each needs its own field passed to
   * `practicePatients`, and getting one of those wrong empties a screen the
   * clinic uses every morning rather than merely leaking on a day that has not
   * come yet.
   *
   * They leak the same way the list did. Nothing may be added to this; the only
   * allowed edit is a deletion.
   */
  const NOT_YET = new Set([
    'GET /notifications',
    'GET /overview',
    'GET /analytics',
    'GET /worklist',
    'GET /alerts',
    'GET /chat-review',
    'GET /chat-review/:sessionId',
    'POST /chat-review/:sessionId/reviewed',
    'POST /chat-review/:sessionId/message',
  ]);

  test('every route addressing one patient is guarded', () => {
    // These are the sharp ones: they name a patient, so anyone who learns an id
    // reaches them directly. Two of them write.
    const byId = routes().filter((r) => r.path.includes(':id') && touchesPatients(r));
    const open = byId.filter((r) => !isScoped(r)).map((r) => `${r.method} /doctor${r.path}`);

    assert.deepEqual(
      open,
      [],
      ['', 'A route naming a patient with no practice check:', '', ...open.map((s) => `  ${s}`),
        '', 'Add assertSamePractice + enrollmentGate, as resolvePatientScope does.'].join('\n'),
    );
  });

  test('and the lists do not span practices', () => {
    const lists = routes().filter((r) => !r.path.includes(':id') && touchesPatients(r));
    const open = lists
      .filter((r) => !isScoped(r))
      .map((r) => `${r.method} ${r.path}`)
      .filter((k) => !NOT_YET.has(k));

    assert.deepEqual(
      open,
      [],
      ['', 'A list spanning every practice:', '', ...open.map((s) => `  ${s}`),
        '', 'Apply practicePatients(req, <field>) to the query.'].join('\n'),
    );
  });

  test('the list of unfixed ones only ever shrinks', () => {
    // A ratchet, not a permission. Nine today; a tenth means somebody added a
    // route that spans practices and wrote down that it was fine.
    assert.ok(NOT_YET.size <= 9, `NOT_YET has grown to ${NOT_YET.size}`);

    // And every name in it still refers to a real, still-unscoped route —
    // otherwise a fixed route keeps its exemption and the count stops meaning
    // anything.
    const stale = [...NOT_YET].filter((k) => {
      const r = routes().find((x) => `${x.method} ${x.path}` === k);
      return !r || isScoped(r);
    });
    assert.deepEqual(stale, [], `fixed or gone — remove from NOT_YET: ${stale.join(', ')}`);
  });
});

describe('the guards still permit when the practice is unknown', () => {
  test('practicePatients returns an empty filter, not an empty result', () => {
    // The whole reason nine migrations landed on a live clinic without a
    // maintenance window. A caller with no membership must be unrestricted, and
    // a database with no enrolments at all means the backfill has not run —
    // where an empty `$in` would look exactly like data loss.
    const scope = readFileSync(new URL('../src/middleware/practiceScope.js', import.meta.url), 'utf8');
    const fn = scope.slice(scope.indexOf('export async function practicePatients'));

    assert.match(fn.slice(0, 400), /if \(!practiceId\) return \{\};/);
    assert.match(fn.slice(0, 400), /if \(!\(await enrolmentsExist\(\)\)\) return \{\};/);
  });

  test('the risk-band filter narrows the practice scope rather than replacing it', () => {
    // `userFilter._id = {...}` after the scope was spread in would overwrite it,
    // and choosing "high risk" would silently widen the list to every practice.
    assert.match(src, /const allowed = scope\._id \? scope\._id\.\$in\.map\(String\) : null;/);
    assert.ok(
      !/if \(riskBand\) userFilter\._id = \{ \$in: matchingProfiles/.test(src),
      'the risk-band branch is assigning _id again',
    );
  });
});
