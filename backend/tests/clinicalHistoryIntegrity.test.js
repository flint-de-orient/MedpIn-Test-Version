import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { Hba1cRecord } from '../src/models/Hba1cRecord.js';
import { LabResult } from '../src/models/LabResult.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { WITH_VOIDED } from '../src/models/plugins/clinicalRecord.js';
import { recomputePatientRisk } from '../src/services/analytics.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * C4 — clinical history is corrected, never erased.
 *
 * A reading typed wrongly, a lab report uploaded for the wrong person: each
 * must stop counting everywhere, and each used to be deleted — the lab report
 * taking with it every clinic reading that shared its value and date. Now they
 * are voided with who, in what capacity and why, and every ordinary read leaves
 * them out.
 */

let a;
let b;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return { practice: p, doctor: await makeMember(p, { name: `Dr ${name}`, isOwner: true }) };
}

/** Enrolled here a month ago, so last week's readings are inside the practice's record window. */
async function enrolled(where, name) {
  const patient = await makePatient({ name, practices: [where.practice] });
  await Enrollment.updateOne({ patient: patient.patient._id, practice: where.practice._id }, { enrolledOn: daysAgo(30) });
  return patient;
}

const glucose = (who, fields) =>
  GlucoseReading.create({ patient: who.user._id, valueMgDl: 140, context: 'fasting', measuredAt: daysAgo(1), ...fields });

describe('a glucose reading taken off the record', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('is voided with who and why, leaves every list and trend, and stays in the clinician’s full history', async () => {
    const patient = await enrolled(a, 'Typed 420 For 42');
    const wrong = await glucose(patient, { valueMgDl: 420, flag: 'very_high' });
    await glucose(patient, { valueMgDl: 110, flag: 'in_range', measuredAt: daysAgo(2) });

    const res = await as(patient.token).del(`/patients/me/glucose/${wrong._id}`, undefined, { reason: 'I typed 420, it was 42' });
    assert.equal(res.status, 204);

    const row = await GlucoseReading.findOne({ _id: wrong._id, ...WITH_VOIDED }).lean();
    assert.ok(row, 'the reading was deleted');
    assert.equal(row.recordState, 'voided');
    assert.equal(String(row.endedBy), String(patient.user._id));
    assert.equal(row.endedByRole, 'patient');
    assert.equal(row.endedReason, 'I typed 420, it was 42');

    const mine = await as(patient.token).get('/patients/me/glucose');
    assert.deepEqual(mine.body.items.map((r) => r.valueMgDl), [110], 'the removed reading was still listed');

    const trends = await as(patient.token).get('/patients/me/glucose/trends?days=7');
    assert.ok(!JSON.stringify(trends.body).includes('420'), 'the removed reading still shaped the trend');

    const full = await as(a.doctor.token).get(`/patients/${patient.user._id}/glucose?includeRemoved=true`);
    const shown = full.body.items.find((r) => r.valueMgDl === 420);
    assert.ok(shown, 'the clinician could not see what was removed');
    assert.equal(shown.removed.reason, 'I typed 420, it was 42');
    assert.equal(shown.removed.byRole, 'patient');

    const asPatient = await as(patient.token).get('/patients/me/glucose?includeRemoved=true');
    assert.equal(asPatient.body.items.length, 1, 'the patient’s own list showed removed entries');
  });

  test('counts, aggregates and lookups on the model leave it out unless they ask for it', async () => {
    const patient = await makePatient({ name: 'Model Reads', practices: [a.practice] });
    const gone = await glucose(patient, { valueMgDl: 500 });
    await glucose(patient, { valueMgDl: 120 });
    await GlucoseReading.updateOne({ _id: gone._id }, { recordState: 'voided', endedReason: 'test' });

    const who = patient.user._id;
    assert.equal(await GlucoseReading.countDocuments({ patient: who }), 1);
    assert.equal((await GlucoseReading.find({ patient: who }).lean()).length, 1);
    assert.equal(await GlucoseReading.findOne({ _id: gone._id }).lean(), null);
    const [agg] = await GlucoseReading.aggregate([{ $match: { patient: who } }, { $group: { _id: null, n: { $sum: 1 } } }]);
    assert.equal(agg.n, 1, 'an aggregate still counted the removed reading');
    assert.equal(await GlucoseReading.countDocuments({ patient: who, ...WITH_VOIDED }), 2);
  });

  test('the risk score is worked out again without it, and keeps its reasons', async () => {
    const patient = await makePatient({ name: 'Critical Typo', practices: [a.practice] });
    await PatientProfile.create({ user: patient.user._id });
    const typo = await glucose(patient, { valueMgDl: 590, flag: 'critical_high' });
    await recomputePatientRisk(patient.user._id);
    const before = await PatientProfile.findOne({ user: patient.user._id }).lean();
    assert.ok(before.riskScore > 0);
    assert.ok(before.riskReasons.some((r) => /critical reading/.test(r)), 'the reasons were not kept');

    await as(patient.token).del(`/patients/me/glucose/${typo._id}`);

    let after;
    for (let i = 0; i < 20; i += 1) {
      after = await PatientProfile.findOne({ user: patient.user._id }).lean();
      if (after.riskScore === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(after.riskScore, 0, 'a removed critical reading still held the patient in a risk band');
    assert.deepEqual(after.riskReasons, []);
  });

  test('a practice cannot remove a reading from before it enrolled the patient', async () => {
    // Enrolled here today; the reading is from last week, before this practice
    // could see the record at all. The old delete did not ask.
    const patient = await makePatient({ name: 'Joined Today', practices: [a.practice] });
    const older = await glucose(patient, { valueMgDl: 260, measuredAt: daysAgo(7) });

    const res = await as(a.doctor.token).del(`/patients/${patient.user._id}/glucose/${older._id}`);
    assert.equal(res.status, 404, 'a reading outside the record window was removed');
    assert.equal((await GlucoseReading.findById(older._id).lean()).recordState ?? 'current', 'current');
  });

  test('removing twice is one removal, and another practice cannot remove it', async () => {
    const patient = await makePatient({ name: 'Salt Lake Only', practices: [a.practice] });
    const reading = await glucose(patient, { valueMgDl: 210 });

    const theirs = await as(b.doctor.token).del(`/patients/${patient.user._id}/glucose/${reading._id}`);
    assert.ok([403, 404].includes(theirs.status), `Behala removed Salt Lake’s patient’s reading (${theirs.status})`);
    assert.equal((await GlucoseReading.findById(reading._id).lean()).recordState ?? 'current', 'current');

    assert.equal((await as(patient.token).del(`/patients/me/glucose/${reading._id}`)).status, 204);
    const first = await GlucoseReading.findOne({ _id: reading._id, ...WITH_VOIDED }).lean();
    assert.equal((await as(patient.token).del(`/patients/me/glucose/${reading._id}`)).status, 204);
    const second = await GlucoseReading.findOne({ _id: reading._id, ...WITH_VOIDED }).lean();
    assert.deepEqual(second.endedAt, first.endedAt, 'a second removal rewrote the first');
  });
});

describe('a lab report withdrawn', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  async function reportWithReadings(patient) {
    const testedOn = daysAgo(3);
    const report = await LabResult.create({
      patient: patient.user._id,
      testName: 'Blood sugar profile',
      analysis: { status: 'done', fastingGlucoseMgDl: 180, hba1cPercent: 8.4, testedOn },
    });
    const fromReport = await glucose(patient, {
      valueMgDl: 180,
      context: 'fasting',
      measuredAt: testedOn,
      source: 'clinic',
      notes: 'From Blood sugar profile report',
      labResult: report._id,
    });
    const hba1c = await Hba1cRecord.create({ patient: patient.user._id, percentage: 8.4, testedOn, labResult: report._id });
    // The desk typed the same fasting value from the same printout.
    const typedByDesk = await glucose(patient, {
      valueMgDl: 180,
      context: 'fasting',
      measuredAt: testedOn,
      source: 'clinic',
      notes: 'Entered at the desk',
    });
    return { report, fromReport, hba1c, typedByDesk, testedOn };
  }

  test('takes exactly its own readings with it, never a reading that merely shares their value', async () => {
    const patient = await makePatient({ name: 'Wrong Report', practices: [a.practice] });
    const { report, fromReport, hba1c, typedByDesk } = await reportWithReadings(patient);

    const res = await as(patient.token).del(`/patients/me/lab-tests/${report._id}`, undefined, { reason: 'This is my father’s report' });
    assert.equal(res.status, 204);

    const withdrawn = await LabResult.findOne({ _id: report._id, ...WITH_VOIDED }).lean();
    assert.equal(withdrawn.recordState, 'voided', 'the report was deleted rather than withdrawn');
    assert.equal(withdrawn.endedReason, 'This is my father’s report');

    assert.equal((await GlucoseReading.findOne({ _id: fromReport._id, ...WITH_VOIDED }).lean()).recordState, 'voided');
    assert.match((await GlucoseReading.findOne({ _id: fromReport._id, ...WITH_VOIDED }).lean()).endedReason, /Blood sugar profile report was withdrawn/);
    assert.equal((await Hba1cRecord.findOne({ _id: hba1c._id, ...WITH_VOIDED }).lean()).recordState, 'voided');
    assert.equal(
      (await GlucoseReading.findById(typedByDesk._id).lean())?.recordState ?? null,
      'current',
      'a reading the desk typed was taken off with the report because it shared the value',
    );

    const list = await as(patient.token).get('/patients/me/lab-tests');
    assert.ok(!JSON.stringify(list.body.results ?? list.body).includes('Blood sugar profile'), 'the withdrawn report was still listed');

    assert.equal((await as(patient.token).del(`/patients/me/lab-tests/${report._id}`)).status, 204, 'a retry was refused');
  });

  test('removing a duplicate upload leaves the readings of the copy that stays', async () => {
    // The same printout uploaded twice. The reader filed the readings once, from
    // the first copy; the patient removes the second. The first copy — and its
    // readings — must stay exactly as they are.
    const patient = await makePatient({ name: 'Uploaded Twice', practices: [a.practice] });
    const { report: kept, fromReport, hba1c, testedOn } = await reportWithReadings(patient);
    const duplicate = await LabResult.create({
      patient: patient.user._id,
      testName: 'Blood sugar profile',
      analysis: { status: 'done', fastingGlucoseMgDl: 180, hba1cPercent: 8.4, testedOn },
    });

    assert.equal((await as(patient.token).del(`/patients/me/lab-tests/${duplicate._id}`)).status, 204);

    assert.equal((await LabResult.findById(kept._id).lean())?.recordState ?? null, 'current');
    assert.equal(
      (await GlucoseReading.findById(fromReport._id).lean())?.recordState ?? null,
      'current',
      'the reading filed from the copy that stays went with the duplicate',
    );
    assert.equal((await Hba1cRecord.findById(hba1c._id).lean())?.recordState ?? null, 'current');
  });

  test('readings written before they carried the report’s id go by the report’s own note, not by value', async () => {
    const patient = await makePatient({ name: 'Older Report', practices: [a.practice] });
    const testedOn = daysAgo(10);
    const report = await LabResult.create({
      patient: patient.user._id,
      testName: 'Glucose fasting',
      analysis: { status: 'done', fastingGlucoseMgDl: 160, testedOn },
    });
    const { insertedId: legacy } = await GlucoseReading.collection.insertOne({
      patient: patient.user._id,
      valueMgDl: 160,
      context: 'fasting',
      measuredAt: testedOn,
      source: 'clinic',
      notes: 'From Glucose fasting report',
    });
    const { insertedId: sameValue } = await GlucoseReading.collection.insertOne({
      patient: patient.user._id,
      valueMgDl: 160,
      context: 'fasting',
      measuredAt: testedOn,
      source: 'clinic',
      notes: 'Clinic glucometer',
    });

    await as(patient.token).del(`/patients/me/lab-tests/${report._id}`);

    assert.equal((await GlucoseReading.findOne({ _id: legacy, ...WITH_VOIDED }).lean()).recordState, 'voided');
    assert.equal(
      (await GlucoseReading.findOne({ _id: sameValue, ...WITH_VOIDED }).lean()).recordState ?? 'current',
      'current',
      'an older reading with the same value was withdrawn with a report it did not come from',
    );
  });
});
