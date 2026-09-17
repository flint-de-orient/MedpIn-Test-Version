import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ROLES } from '../src/models/User.js';
import { Enrollment, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Two doctors choosing a patient's dietician at the same moment.
 *
 * The choice was a whole-state save with nothing checking what it was made
 * against: the second doctor to press Save replaced the first doctor's
 * dietician, and neither was told.
 *
 * ---- Optimistic concurrency, and what the client says ----------------------
 *
 * The write lands only on the state it was decided against, and the screen
 * says which state that was — the dietician it showed — so whichever request
 * reaches the database second is refused with DIETICIAN_CHANGED, whether the
 * two overlapped inside the server or arrived one after the other from two
 * screens opened at the same time. Real parallel requests over HTTP, not a
 * mocked interleaving.
 *
 * Builds of the app from before this send no expectation. For them the tests
 * assert what can still be promised: one consistent outcome, and no choice
 * lost without a trace.
 */

let practice;
let owner;
let second;
let roy;
let bose;
let patient;

/** Resolves once `check` returns something truthy — for audit rows written after the response. */
async function eventually(check, ms = 3000) {
  const until = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value || Date.now() > until) return value;
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Waits for audit rows to stop arriving, then returns them. */
async function settledAudit(filter, expected) {
  await eventually(async () => (await AuditLog.countDocuments(filter)) >= expected);
  await new Promise((r) => setTimeout(r, 150));
  return AuditLog.find(filter).lean();
}

describe('two doctors assigning different dieticians at once', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    owner = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    second = await makeMember(practice, { name: 'Dr Das' });
    roy = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    bose = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    patient = await makePatient({ name: 'Rina Das', practices: [practice] });
  });

  const url = () => `/doctor/patients/${patient.user._id}/dietician`;
  const enrolment = () => Enrollment.findOne({ patient: patient.patient._id, practice: practice._id }).lean();
  const auditFilter = () => ({ resource: 'Enrollment', action: 'update', subjectPatient: patient.user._id });

  test('leave one consistent, audited assignment: one choice stands, the other doctor is told', async () => {
    // Both screens showed nobody holding the patient.
    const [bySen, byDas] = await Promise.all([
      as(owner.token).patch(url(), { dieticianId: String(roy.user._id), expectedDieticianId: null }),
      as(second.token).patch(url(), { dieticianId: String(bose.user._id), expectedDieticianId: null }),
    ]);

    assert.deepEqual([bySen.status, byDas.status].sort(), [200, 409], `answered ${bySen.status} and ${byDas.status}`);
    const [winner, loser] = bySen.status === 200 ? [bySen, byDas] : [byDas, bySen];
    const winningDoctor = bySen.status === 200 ? owner : second;
    const chosen = bySen.status === 200 ? roy : bose;
    assert.equal(loser.body.error.code, 'DIETICIAN_CHANGED');

    const row = await enrolment();
    assert.equal(String(row.dietician), String(chosen.user._id));
    assert.equal(String(row.dieticianBy), String(winningDoctor.user._id), 'the record names the wrong doctor');
    assert.equal(row.dieticianSource, DIETICIAN_SOURCE.DOCTOR);
    assert.equal(row.dieticianHistory.length, 0, 'the refused choice was pushed into the history');
    assert.equal(winner.body.nutritionCare.dietician.id, String(chosen.user._id));

    // One audit row, for the change that happened: who, about whom, on which relationship.
    const rows = await settledAudit(auditFilter(), 1);
    assert.equal(rows.length, 1, `${rows.length} audit rows for one assignment`);
    assert.equal(String(rows[0].actor), String(winningDoctor.user._id));
    assert.equal(String(rows[0].resourceId), String(row._id));
  });

  test('a doctor whose screen is out of date is told, not obeyed', async () => {
    assert.equal(
      (await as(owner.token).patch(url(), { dieticianId: String(roy.user._id), expectedDieticianId: null })).status,
      200,
    );

    // Dr Das opened the patient before that, while nobody held them.
    const stale = await as(second.token).patch(url(), {
      dieticianId: String(bose.user._id),
      expectedDieticianId: null,
    });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'DIETICIAN_CHANGED');
    assert.equal(String((await enrolment()).dietician), String(roy.user._id), 'the stale choice was applied');

    // Having seen Ms Roy, the change is theirs to make, and Ms Roy becomes history.
    const current = await as(second.token).patch(url(), {
      dieticianId: String(bose.user._id),
      expectedDieticianId: String(roy.user._id),
    });
    assert.equal(current.status, 200, JSON.stringify(current.body));
    const after = await enrolment();
    assert.equal(String(after.dietician), String(bose.user._id));
    assert.deepEqual(after.dieticianHistory.map((h) => String(h.dietician)), [String(roy.user._id)]);
    assert.equal(String(after.dieticianHistory[0].endedBy), String(second.user._id));
  });

  test('the same choice from two stale screens is one assignment and two successes', async () => {
    const results = await Promise.all([
      as(owner.token).patch(url(), { dieticianId: String(roy.user._id), expectedDieticianId: null }),
      as(second.token).patch(url(), { dieticianId: String(roy.user._id), expectedDieticianId: null }),
    ]);
    assert.deepEqual(results.map((r) => r.status), [200, 200]);
    const row = await enrolment();
    assert.equal(String(row.dietician), String(roy.user._id));
    assert.equal(row.dieticianHistory.length, 0);
  });

  test('older builds, which say nothing about what they saw: one outcome, nothing lost silently', async () => {
    const [bySen, byDas] = await Promise.all([
      as(owner.token).patch(url(), { dieticianId: String(roy.user._id) }),
      as(second.token).patch(url(), { dieticianId: String(bose.user._id) }),
    ]);
    const answers = [
      [bySen, roy],
      [byDas, bose],
    ];
    const row = await enrolment();
    const recorded = [row.dietician, ...row.dieticianHistory.map((h) => h.dietician)].map(String);

    for (const [res, dietician] of answers) {
      if (res.status === 200) {
        assert.ok(recorded.includes(String(dietician.user._id)), 'a choice reported as saved is nowhere on the record');
      } else {
        // Overlapping inside the server: the later write is still refused.
        assert.equal(res.status, 409);
        assert.equal(res.body.error.code, 'DIETICIAN_CHANGED');
        assert.ok(!recorded.includes(String(dietician.user._id)), 'a refused choice was written');
      }
    }
    assert.ok([String(roy.user._id), String(bose.user._id)].includes(String(row.dietician)));

    const saved = answers.filter(([res]) => res.status === 200).length;
    const rows = await settledAudit(auditFilter(), saved);
    assert.equal(rows.length, saved, 'the audit trail does not match the changes made');
  });
});
