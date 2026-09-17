import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Enrollment, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';

/**
 * The assistant cannot become a way round the ordinary rules.
 *
 * ---- Why the AI layer is where the next hole lives ---------------------
 *
 * Because it is the one part of the product that reads a patient's whole
 * record on purpose. Everywhere else a route touches one collection and the
 * tenant filter is visible in the query; here a `patientId` goes in and a
 * summary of somebody's clinical history comes out, and the scoping is three
 * calls away in `buildPatientContext`.
 *
 * The sweep that found five cross-practice writes in ordinary routes had not
 * looked at the controls *around* the assistant, and that is where these were:
 * switching the assistant off for a patient, and holding it back while a
 * clinician reads. Both take `:patientId` from the URL, both were guarded by a
 * role list alone.
 *
 * ---- What switching it off actually does -------------------------------
 *
 * The patient stops getting replies. Not an error, not a message — silence, in
 * a thread they are using to describe symptoms. Nobody at their own practice
 * is told, because from that side nothing happened.
 *
 * `presence` is the same failure with a timer: a heartbeat from any clinician
 * on the platform holds another practice's assistant back for ninety seconds,
 * and a heartbeat is something a client sends every few seconds anyway.
 */

let origin;
let a;
let b;

async function twoPractices() {
  const mk = async (name) => {
    const practice = await makePractice(name, {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
    const patient = await makePatient({ name: `${name} Patient`, practices: [practice] });
    // A thread with something in it, so the controls have something to act on.
    const session = await ChatSession.create({
      patient: patient.user._id,
      kind: 'care',
      language: 'en',
      assistantEnabled: true,
    });
    await ChatMessage.create({
      session: session._id,
      patient: patient.user._id,
      seq: 1,
      role: 'user',
      content: 'My foot has been sore since Tuesday.',
    });
    return { practice, doctor, patient, session };
  };
  a = await mk('Salt Lake');
  b = await mk('Behala');
}

describe('a clinician cannot silence another practice’s assistant', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('switching it off is refused', async () => {
    /*
     * The one that changes care. A patient describing symptoms into a thread
     * that has quietly stopped answering has no way to tell that somebody at
     * an unrelated clinic turned it off.
     */
    const res = await as(a.doctor.token).patch(
      `/chat/patients/${b.patient.user._id}/assistant`,
      { kind: 'care', enabled: false },
    );

    assert.equal(res.status, 404, 'a doctor at another practice switched off this assistant');

    const after = await ChatSession.findById(b.session._id).lean();
    assert.notEqual(after.assistantEnabled, false, 'the assistant was switched off');
  });

  test('and reading the switch is refused too', async () => {
    // Lower stakes and the same boundary: whether a thread exists, and whether
    // somebody has turned its assistant off, is a fact about another practice.
    const res = await as(a.doctor.token).get(
      `/chat/patients/${b.patient.user._id}/assistant?kind=care`,
    );
    assert.equal(res.status, 404);
  });

  test('presence cannot hold back another practice’s assistant', async () => {
    /*
     * A heartbeat, sent every few seconds by any open thread screen. Pointed
     * at somebody else's patient it silences their assistant for ninety
     * seconds at a time, renewably, and leaves `clinicianPresentUntil` set on
     * a session belonging to a clinic that has never heard of the caller.
     */
    const res = await as(a.doctor.token).post(
      `/chat/patients/${b.patient.user._id}/presence`,
      { kind: 'care' },
    );

    assert.equal(res.status, 404);
    const after = await ChatSession.findById(b.session._id).lean();
    assert.ok(!after.clinicianPresentUntil, 'another practice was recorded as present');
  });

  test('but their own practice’s assistant is still theirs to control', async () => {
    // The half that has to keep working. A doctor reading their own patient's
    // thread must still be able to hold the assistant back and switch it off.
    const off = await as(a.doctor.token).patch(
      `/chat/patients/${a.patient.user._id}/assistant`,
      { kind: 'care', enabled: false },
    );
    assert.equal(off.status, 200);
    assert.equal(off.body.assistantEnabled, false);

    const read = await as(a.doctor.token).get(
      `/chat/patients/${a.patient.user._id}/assistant?kind=care`,
    );
    assert.equal(read.status, 200);
  });

  test('and a dietician keeps the nutrition thread they work in', async () => {
    /*
     * Worth its own test because the obvious fix breaks it.
     *
     * `resolvePatientScope` would scope these correctly and also refuse every
     * dietician: they are deliberately absent from DIRECT_PATIENT_ACCESS,
     * because they reach their assigned patients through /dietician, which
     * enforces the assignment. They still need to turn the assistant off in a
     * nutrition thread they are answering.
     */
    const dietician = await makeMember(a.practice, {
      name: 'Ms Roy',
      role: ROLES.DIETICIAN,
    });
    await ChatSession.create({
      patient: a.patient.user._id,
      kind: 'nutrition',
      language: 'en',
      assistantEnabled: true,
    });
    // The thread they answer is a patient assigned to them, at this practice —
    // the same caseload /dietician enforces. See c7DieticianInactive.test.js
    // for a dietician who was not given the patient.
    await Enrollment.updateOne(
      { _id: a.patient.enrollments[0]._id },
      { $set: { dietician: dietician.user._id, dieticianSource: DIETICIAN_SOURCE.DOCTOR } },
    );

    const res = await as(dietician.token).patch(
      `/chat/patients/${a.patient.user._id}/assistant`,
      { kind: 'nutrition', enabled: false },
    );
    assert.equal(res.status, 200, 'a dietician lost the thread they work in');
  });
});

describe('and the assistant reads no record it was not asked about', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('a patient’s own thread is keyed on their token, never on a body field', () => {
    /*
     * The reason the patient-facing assistant has never been the risk: the
     * route does not accept a patient id at all.
     *
     *     handlePatientMessage({ patientId: req.user._id, ... })
     *
     * Asserted on the source because there is no request that can prove a
     * negative — the field would have to exist before it could be abused, and
     * the point is that it does not.
     */
    const src = readFileSync(
      fileURLToPath(new URL('../src/routes/chat.js', import.meta.url)),
      'utf8',
    );
    /*
     * The claim is that the patient comes from the token — not that it is
     * written one particular way, and not that a path appears once.
     *
     * Two earlier versions of this failed on /nutrition for reasons that were
     * both mine. The first required `patientId: req.user._id` inline, and the
     * POST says `const patientId = req.user._id;` a line earlier. The second
     * took `indexOf`, and there are two /nutrition routes — a GET that says
     * `patient: req.user._id` and a POST that says `patientId`. Three
     * spellings of one property, and a test that fails on spelling is one
     * somebody edits to make green.
     *
     * The third failure was the regex itself: `patients?Id?` requires a
     * literal `I`, so it never matched `patient:` at all. The route was
     * correct the whole time and the test was wrong three times running —
     * worth recording, because a source-reading test that keeps failing is
     * usually the test.
     *
     * So: every handler at every one of these paths derives its subject from
     * the token, and none of them reads a patient from the request.
     */
    for (const route of ["'/message'", "'/message/stream'", "'/nutrition'"]) {
      let at = -1;
      let seen = 0;

      while ((at = src.indexOf(route, at + 1)) > -1) {
        // Route declarations only — the same string appears in a zod enum.
        if (!/router\.(get|post)\(\s*$/.test(src.slice(Math.max(0, at - 20), at))) continue;
        seen += 1;

        const handler = src.slice(at, src.indexOf('\nrouter.', at));
        assert.match(
          handler,
          /patient(?:s|Id)?\s*[:=]\s*req\.user\._id/,
          `${route} takes its patient from somewhere other than the token`,
        );
        assert.ok(
          !/patient(?:s|Id)?\s*[:=]\s*req\.(body|params|query)\./.test(handler),
          `${route} accepts a patient from the request`,
        );
      }

      assert.ok(seen > 0, `${route} moved or was renamed`);
    }
  });

  test('and a clinician reading a thread goes through the tenant guard', () => {
    // The two clinician-facing read paths use resolvePatientScope, which is
    // where "may this person open this record" is decided once.
    const src = readFileSync(
      fileURLToPath(new URL('../src/routes/chat.js', import.meta.url)),
      'utf8',
    );
    for (const route of ["'/patients/:patientId/thread'", "'/patients/:patientId/clinician-message'"]) {
      const at = src.indexOf(route);
      const handler = src.slice(at, src.indexOf('\nrouter.', at));
      assert.match(handler, /resolvePatientScope/, `${route} is not tenant-scoped`);
    }
  });
});
