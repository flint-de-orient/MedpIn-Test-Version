import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { EcgReport } from '../src/models/EcgReport.js';
import { LabResult } from '../src/models/LabResult.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * What a cardiologist's panel reads that vitals alone could not give it: the
 * ECGs a clinician filed, and LDL from the lab reports patients uploaded.
 *
 * The ECG is a record before it is a panel, so the record is tested first —
 * who may file one, who may read it, and that a practice reads only the
 * tracings from its own enrolment onward. Then the two panels, bounded the way
 * every caseload panel is: this practice's patients, from the day each joined.
 */

let a;
let b;
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(Date.now() - n * DAY);

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return {
    practice: p,
    doctor: await makeMember(p, { name: `Dr ${name}`, isOwner: true }),
    desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
    labTech: await makeMember(p, { name: `${name} Lab`, role: ROLES.LAB_TECHNICIAN }),
    manager: await makeMember(p, { name: `${name} Manager`, role: ROLES.PRACTICE_MANAGER }),
    dietician: await makeMember(p, { name: `${name} Dietician`, role: ROLES.DIETICIAN }),
  };
}

/** A patient enrolled here some days ago, so earlier records are in the window. */
async function enrolled(where, name, since = 400) {
  const patient = await makePatient({ name, practices: [where.practice] });
  await Enrollment.updateOne({ patient: patient.patient._id, practice: where.practice._id }, { enrolledOn: daysAgo(since) });
  return patient;
}

const ecg = (who, fields) =>
  EcgReport.create({ patient: who.user._id, recordedOn: daysAgo(1), impression: 'normal', rhythm: 'sinus', ...fields });

/**
 * An LDL value read off an uploaded report. `filed` is when it was uploaded,
 * written through the driver because the timestamps plugin will not let a test
 * backdate `createdAt` any other way.
 */
async function ldl(who, value, { testedOn = null, filed = daysAgo(1), status = 'done' } = {}) {
  const r = await LabResult.create({
    patient: who.user._id,
    testName: 'Lipid profile',
    analysis: { status, ldl: value, ...(testedOn ? { testedOn } : {}) },
  });
  await LabResult.collection.updateOne({ _id: r._id }, { $set: { createdAt: filed } });
  return r;
}

const reading = {
  recordedOn: daysAgo(2).toISOString(),
  rhythm: 'atrial_fibrillation',
  heartRate: 112,
  qrsDurationMs: 96,
  impression: 'abnormal',
  findings: 'Irregularly irregular rhythm, no P waves.',
  readBy: 'Dr Salt Lake',
};

describe('an ECG is filed by the people who work the record', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('a doctor files one, stamped with their practice and their name', async () => {
    const patient = await enrolled(a, 'Irregular Pulse');

    const res = await as(a.doctor.token).post(`/patients/${patient.user._id}/ecg/reports`, reading);

    assert.equal(res.status, 201);
    assert.equal(res.body.report.rhythm, 'atrial_fibrillation');
    assert.equal(res.body.report.impression, 'abnormal');
    assert.equal(res.body.report.heartRate, 112);
    assert.equal(res.body.report.prIntervalMs, null, 'an interval nobody measured came back as a number');

    const stored = await EcgReport.findById(res.body.report.id).lean();
    assert.equal(String(stored.practice), String(a.practice._id), 'the record does not say which practice made it');
    assert.equal(String(stored.recordedBy), String(a.doctor.user._id));
  });

  test('a lab technician, who takes the tracing, may file it too', async () => {
    const patient = await enrolled(a, 'Walk-in Tracing');
    const res = await as(a.labTech.token).post(`/patients/${patient.user._id}/ecg/reports`, reading);
    assert.equal(res.status, 201);
  });

  test('a patient may read their own, and may not file one', async () => {
    const patient = await enrolled(a, 'Reads Their Own');
    await ecg(patient, { impression: 'borderline' });

    const list = await as(patient.token).get('/patients/me/ecg/reports');
    assert.equal(list.status, 200);
    assert.equal(list.body.items.length, 1);

    const filed = await as(patient.token).post('/patients/me/ecg/reports', reading);
    assert.equal(filed.status, 403, 'a patient filed a reading of their own heart');
    assert.equal(await EcgReport.countDocuments({ impression: 'abnormal' }), 0);
  });

  test('the dietician and the practice manager may not file one', async () => {
    const patient = await enrolled(a, 'Not Their Job');
    for (const who of ['dietician', 'manager']) {
      const res = await as(a[who].token).post(`/patients/${patient.user._id}/ecg/reports`, reading);
      assert.equal(res.status, 403, `the ${who} filed an ECG`);
    }
    assert.equal(await EcgReport.countDocuments({}), 0);
  });

  test('nobody at another practice reads or files one', async () => {
    const patient = await enrolled(a, 'Salt Lake Heart');
    await ecg(patient, { findings: 'Salt Lake: ST depression in V4–V6', impression: 'abnormal' });

    for (const who of ['doctor', 'desk', 'labTech']) {
      const read = await as(b[who].token).get(`/patients/${patient.user._id}/ecg/reports`);
      assert.ok([403, 404].includes(read.status), `Behala’s ${who} read Salt Lake’s ECGs (${read.status})`);
      assert.ok(!JSON.stringify(read.body ?? '').includes('ST depression'), 'the refusal carried the findings');

      const filed = await as(b[who].token).post(`/patients/${patient.user._id}/ecg/reports`, reading);
      assert.ok([403, 404].includes(filed.status), `Behala’s ${who} filed an ECG on Salt Lake’s patient (${filed.status})`);
    }
    assert.equal(await EcgReport.countDocuments({}), 1);
  });

  test('a practice reads the tracings from its enrolment onward, not before', async () => {
    const patient = await enrolled(a, 'Moved Here Last Week', 7);
    const before = await ecg(patient, { recordedOn: daysAgo(30), findings: 'taken elsewhere' });
    await ecg(patient, { recordedOn: daysAgo(2), findings: 'taken here' });

    const list = await as(a.doctor.token).get(`/patients/${patient.user._id}/ecg/reports`);
    assert.deepEqual(list.body.items.map((r) => r.findings), ['taken here']);

    const one = await as(a.doctor.token).get(`/patients/${patient.user._id}/ecg/reports/${before._id}`);
    assert.equal(one.status, 404, 'a tracing from before this practice enrolled the patient was opened by id');
  });

  test('a file that is neither the patient’s nor the caller’s is refused, and nothing is filed', async () => {
    const patient = await enrolled(a, 'Somebody Else’s Scan');
    const stranger = await makePatient({ name: 'A Stranger' });
    const asset = await MediaAsset.create({
      owner: stranger.user._id,
      uploadedBy: stranger.user._id,
      kind: 'other',
      storageKey: 'stranger/ecg.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 2048,
    });

    const res = await as(a.doctor.token).post(`/patients/${patient.user._id}/ecg/reports`, {
      ...reading,
      files: [String(asset._id)],
    });

    assert.equal(res.status, 404);
    assert.equal(await EcgReport.countDocuments({}), 0, 'refused, and filed anyway');
  });

  test('an ECG cannot be dated in the future', async () => {
    const patient = await enrolled(a, 'Tomorrow’s Tracing');
    const res = await as(a.doctor.token).post(`/patients/${patient.user._id}/ecg/reports`, {
      ...reading,
      recordedOn: new Date(Date.now() + 2 * DAY).toISOString(),
    });
    assert.equal(res.status, 400);
    assert.equal(await EcgReport.countDocuments({}), 0);
  });

  test('a retry of the same filing is answered with the first, and a reused key with other values is refused', async () => {
    const patient = await enrolled(a, 'Slow Network');
    const url = `/patients/${patient.user._id}/ecg/reports`;
    const key = { 'Idempotency-Key': 'ecg-form:retry-0001' };

    const first = await as(a.doctor.token).post(url, reading, key);
    const again = await as(a.doctor.token).post(url, reading, key);

    assert.equal(first.status, 201);
    assert.equal(again.status, 201);
    assert.equal(again.body.report.id, first.body.report.id, 'the retry filed a second ECG');
    assert.equal(await EcgReport.countDocuments({}), 1);

    const changed = await as(a.doctor.token).post(url, { ...reading, impression: 'normal' }, key);
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await EcgReport.countDocuments({}), 1);
  });

  test('a key already used for one patient is refused for another, and files nothing', async () => {
    const first = await enrolled(a, 'First Patient');
    const second = await enrolled(a, 'Second Patient');
    const key = { 'Idempotency-Key': 'ecg-form:reused-0001' };

    assert.equal((await as(a.doctor.token).post(`/patients/${first.user._id}/ecg/reports`, reading, key)).status, 201);
    const other = await as(a.doctor.token).post(`/patients/${second.user._id}/ecg/reports`, reading, key);

    assert.equal(other.status, 409, 'the second patient was answered with the first patient’s ECG');
    assert.ok(!JSON.stringify(other.body).includes('First Patient'));
    assert.equal(await EcgReport.countDocuments({ patient: second.user._id }), 0);
  });

  test('two copies of one filing in the same instant leave one ECG', async () => {
    await EcgReport.createIndexes();
    const patient = await enrolled(a, 'Double Tap');
    const url = `/patients/${patient.user._id}/ecg/reports`;
    const key = { 'Idempotency-Key': 'ecg-form:double-0001' };

    const results = await Promise.all(
      Array.from({ length: 6 }, () => as(a.doctor.token).post(url, reading, key)),
    );

    assert.deepEqual([...new Set(results.map((r) => r.status))], [201]);
    assert.equal(new Set(results.map((r) => r.body.report.id)).size, 1, 'parallel copies were answered with different ECGs');
    assert.equal(await EcgReport.countDocuments({}), 1, 'parallel copies each filed an ECG');
  });

  test('an attached tracing comes back with its type', async () => {
    const patient = await enrolled(a, 'Tracing Attached');
    const asset = await MediaAsset.create({
      owner: patient.user._id,
      uploadedBy: a.labTech.user._id,
      kind: 'ecg_tracing',
      storageKey: 'a/ecg.webp',
      mimeType: 'image/webp',
      sizeBytes: 4096,
    });

    const res = await as(a.labTech.token).post(`/patients/${patient.user._id}/ecg/reports`, {
      ...reading,
      files: [String(asset._id)],
    });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.report.files, [
      { id: String(asset._id), url: `/api/v1/uploads/${asset._id}/raw`, mimeType: 'image/webp' },
    ]);

    const list = await as(a.doctor.token).get(`/patients/${patient.user._id}/ecg/reports`);
    assert.equal(list.body.items[0].files[0].mimeType, 'image/webp');
  });

  test('a value outside what a tracing can show is refused rather than stored', async () => {
    const patient = await enrolled(a, 'Typo In The Rate');
    const res = await as(a.doctor.token).post(`/patients/${patient.user._id}/ecg/reports`, { ...reading, heartRate: 1120 });
    assert.equal(res.status, 400);
    assert.equal(await EcgReport.countDocuments({}), 0);
  });
});

describe('the ECG panel', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('counts each patient’s latest ECG by impression, and names abnormal before borderline', async () => {
    const abnormal = await enrolled(a, 'Abnormal Tracing');
    const borderline = await enrolled(a, 'Borderline Tracing');
    const recovered = await enrolled(a, 'Now Normal');
    await enrolled(a, 'Never Traced');

    await ecg(borderline, { impression: 'borderline', recordedOn: daysAgo(1) });
    await ecg(abnormal, { impression: 'abnormal', rhythm: 'atrial_fibrillation', heartRate: 118, recordedOn: daysAgo(5) });
    // The latest one counts: abnormal a month ago, normal since.
    await ecg(recovered, { impression: 'abnormal', recordedOn: daysAgo(30) });
    await ecg(recovered, { impression: 'normal', recordedOn: daysAgo(3) });

    const res = await as(a.doctor.token).get('/doctor/panels/ecg');

    assert.equal(res.status, 200);
    assert.equal(res.body.withEcg, 3);
    assert.equal(res.body.withoutEcg, 1, 'a patient nobody traced was folded into an impression');
    assert.deepEqual(res.body.impressions, { normal: 1, borderline: 1, abnormal: 1, unknown: 0 });
    assert.deepEqual(
      res.body.flagged.map((f) => f.name),
      ['Abnormal Tracing', 'Borderline Tracing'],
      'a borderline tracing was listed above an abnormal one',
    );
    assert.equal(res.body.flagged[0].rhythm, 'atrial_fibrillation');
  });

  test('shows nobody from another practice, and nothing from before enrolment or outside the window', async () => {
    const theirs = await enrolled(b, 'Behala Abnormal');
    await ecg(theirs, { impression: 'abnormal' });

    const joined = await enrolled(a, 'Joined Yesterday', 1);
    await ecg(joined, { impression: 'abnormal', recordedOn: daysAgo(10) });

    const old = await enrolled(a, 'Traced Last Year');
    await ecg(old, { impression: 'abnormal', recordedOn: daysAgo(300) });

    const res = await as(a.doctor.token).get('/doctor/panels/ecg');
    assert.equal(res.body.impressions.abnormal, 0);
    assert.equal(res.body.withoutEcg, 2);
    assert.ok(!JSON.stringify(res.body).includes('Behala Abnormal'), 'another practice’s patient was named');
  });
});

describe('the lipid panel', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
  });

  test('each patient’s latest LDL against the catalog’s limit, highest named first', async () => {
    const high = await enrolled(a, 'LDL 190');
    const higher = await enrolled(a, 'LDL 240');
    const controlled = await enrolled(a, 'LDL 90');
    await enrolled(a, 'Never Tested');

    await ldl(high, 190);
    await ldl(higher, 240);
    await ldl(controlled, 160, { testedOn: daysAgo(200), filed: daysAgo(199) });
    await ldl(controlled, 90, { testedOn: daysAgo(20), filed: daysAgo(19) });

    const res = await as(a.doctor.token).get('/doctor/panels/lipids');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body.target, { analyte: 'LDL', unit: 'mg/dL', high: 100 });
    assert.equal(res.body.source, 'uploaded lab reports', 'the panel does not say where its numbers came from');
    assert.equal(res.body.withResult, 3);
    assert.equal(res.body.withoutResult, 1);
    assert.equal(res.body.atOrBelow, 1);
    assert.deepEqual(res.body.above.map((x) => [x.name, x.ldl]), [['LDL 240', 240], ['LDL 190', 190]]);
  });

  test('latest means tested most recently, not uploaded most recently', async () => {
    const patient = await enrolled(a, 'Filed Out Of Order');
    await ldl(patient, 85, { testedOn: daysAgo(10), filed: daysAgo(9) });
    // An old report found in a drawer and uploaded today.
    await ldl(patient, 210, { testedOn: daysAgo(300), filed: daysAgo(0) });

    const res = await as(a.doctor.token).get('/doctor/panels/lipids');
    assert.equal(res.body.atOrBelow, 1, 'an old report uploaded late replaced the current result');
    assert.equal(res.body.aboveTotal, 0);
  });

  test('a report uploaded this week but tested two years ago is not a result in the window', async () => {
    const patient = await enrolled(a, 'Stale Report', 900);
    await ldl(patient, 220, { testedOn: daysAgo(730), filed: daysAgo(2) });

    const res = await as(a.doctor.token).get('/doctor/panels/lipids');
    assert.equal(res.body.withResult, 0);
    assert.equal(res.body.withoutResult, 1);
  });

  test('an unread report is not a value, and another practice’s patient is not named', async () => {
    const unread = await enrolled(a, 'Still Being Read');
    await ldl(unread, 200, { status: 'pending' });
    await ldl(unread, 210, { status: 'failed' });

    const theirs = await enrolled(b, 'Behala LDL');
    await ldl(theirs, 250);

    const res = await as(a.doctor.token).get('/doctor/panels/lipids');
    assert.equal(res.body.withResult, 0);
    assert.ok(!JSON.stringify(res.body).includes('Behala LDL'));
  });

  test('a report filed after enrolment is read, whenever the test was done — as the lab record reads it', async () => {
    // Enrolled five days ago; brought in a three-week-old report two days ago.
    // The patient's lab record here shows it (windowed by when it was filed),
    // so a panel that hid it would disagree with the record it summarises.
    const patient = await enrolled(a, 'Brought Old Report', 5);
    await ldl(patient, 180, { testedOn: daysAgo(20), filed: daysAgo(2) });

    const record = await as(a.doctor.token).get(`/patients/${patient.user._id}/lab-tests`);
    assert.equal(record.status, 200);
    assert.ok(JSON.stringify(record.body).includes('Lipid profile'), 'the premise: the record shows this report');

    const res = await as(a.doctor.token).get('/doctor/panels/lipids');
    assert.equal(res.body.withResult, 1, 'the panel hid a result the patient’s record shows');
    assert.equal(res.body.above[0]?.ldl, 180);
  });

  test('a report filed before this practice enrolled the patient is not read', async () => {
    const patient = await enrolled(a, 'Filed Before Joining', 5);
    await ldl(patient, 230, { testedOn: daysAgo(40), filed: daysAgo(30) });

    const res = await as(a.doctor.token).get('/doctor/panels/lipids');
    assert.equal(res.body.withResult, 0, 'a pre-enrolment lab result was read');
  });
});
