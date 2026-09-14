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

/**
 * Is it confined to the caller's own practice, by any mechanism?
 *
 * `practiceSessions` and `sessionBelongsTo` are the narrower form for
 * conversations: a patient another practice also cares for has a conversation
 * there too, and a patient scope alone admitted it. See
 * services/conversationPractice.js.
 */
const isScoped = (r) =>
  /assertSamePractice|enrollmentGate|practicePatients|practiceOf\(req\)|practiceSessions\(req\)|sessionBelongsTo\(/.test(r.body);

describe('the clinician router asks which practice', () => {
  /**
   * Empty, and it stays empty.
   *
   * It held nine aggregates for one commit — the worklist, the overview, the
   * analytics, the alerts, the notification bell and the four chat-review
   * routes. Each reached patients through a different collection, so each
   * needed its own field, which is why they were written down rather than
   * rushed.
   *
   * A name appearing here again is somebody deciding a screen may span
   * practices. That should be hard to do quietly.
   */
  const NOT_YET = new Set([]);

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
        '', 'Apply practicePatients(req, <field>) to the query, or practiceSessions(req) for conversations.'].join('\n'),
    );
  });

  test('nothing is exempt', () => {
    assert.equal(NOT_YET.size, 0, `a route was exempted from practice scoping: ${[...NOT_YET]}`);
  });

  test('and every route touching patients is covered by one of the two rules above', () => {
    // Belt and braces on the two tests' own filters. If a change to
    // `touchesPatients` stopped matching, both would pass by examining nothing.
    const covered = routes().filter(touchesPatients);
    assert.ok(covered.length >= 12, `only ${covered.length} routes look patient-related`);
    assert.ok(covered.every(isScoped), 'a patient-touching route is unscoped');
  });
});

describe('the guards still permit when the practice is unknown', () => {
  test('an unknown practice yields no filter, not an empty result', () => {
    // The whole reason nine migrations landed on a live clinic without a
    // maintenance window. A caller with no membership must be unrestricted, and
    // a database with no enrolments at all means the backfill has not run —
    // where an empty `$in` would look exactly like data loss.
    const scope = readFileSync(new URL('../src/middleware/practiceScope.js', import.meta.url), 'utf8');
    const ids = scope.slice(scope.indexOf('export async function practicePatientIds'));

    assert.match(
      ids.slice(0, 500),
      /if \(!practiceId \|\| !\(await enrolmentsExist\(\)\)\) \{\s*\n\s*req\._practicePatientIds = null;/,
    );
    // `null` and `[]` mean opposite things here — "everyone" and "nobody" — and
    // the filter builder has to tell them apart.
    assert.match(scope, /return ids \? \{ \[field\]: \{ \$in: ids \} \} : \{\};/);
  });

  test('the analytics cache is keyed by practice', () => {
    // It is process-wide and was keyed on the day range alone, so the first
    // clinic to ask for 30 days answered for every clinic that asked next — a
    // leak with a time limit, which is the hardest kind to reproduce.
    assert.match(src, /const key = `d\$\{days\}:p\$\{\(await practiceOf\(req\)\) \?\? 'none'\}`;/);
  });

  test('marking a conversation reviewed reads before it writes', () => {
    // `findByIdAndUpdate` changes the row before anything can be asked about
    // it, and marking another practice's thread reviewed both writes into their
    // record and hides it from them.
    // Order, not the absence of a word: the comment above the fix explains why
    // `findByIdAndUpdate` is not used, and a negative match on the name finds
    // the explanation and calls it the bug.
    const block = src.slice(src.indexOf("'/chat-review/:sessionId/reviewed'")).slice(0, 1200);
    const read = block.indexOf('ChatSession.findById(');
    const check = block.indexOf('assertSamePractice(req, session.patient)');
    const write = block.indexOf('await session.save()');

    assert.ok(read > -1 && check > -1 && write > -1, 'the reviewed route no longer looks like this');
    assert.ok(read < check, 'it checks before it has a row to check');
    assert.ok(check < write, 'it writes before it checks');
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
