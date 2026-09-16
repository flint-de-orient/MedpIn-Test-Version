import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Prescription } from '../src/models/Prescription.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { Hba1cRecord } from '../src/models/Hba1cRecord.js';
import { LabReport } from '../src/models/LabReport.js';
import { LabResult } from '../src/models/LabResult.js';
import { EcgReport } from '../src/models/EcgReport.js';
import { EyeReport } from '../src/models/EyeReport.js';
import { LifestyleLog } from '../src/models/LifestyleLog.js';
import { ShareGrant } from '../src/models/ShareGrant.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Each category, over the wire, through every screen that reads it.
 *
 * `sharedReadsAreMapped.test.js` proves every windowed read has a category on
 * paper. This proves the paper is right: a row from before the enrolment is
 * hidden with no grant, hidden under a grant for any other category, and
 * visible under a grant for its own — read by id in the body the real route
 * returns.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

let salt;
let doctor;
let patient;
let rows;

/** Where each category's rows are read, and which ids should appear there. */
function screens() {
  const p = `/patients/${patient.user._id}`;
  return {
    prescriptions: [
      { path: `${p}/prescriptions`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.prescription)) },
      { path: `${p}/lab-tests`, shows: (body) => body.advised.includes('Vitamin B12 from before') },
    ],
    readings: [
      { path: `${p}/glucose`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.glucose)) },
      { path: `${p}/vitals`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.vital)) },
    ],
    lab_results: [
      { path: `${p}/hba1c`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.hba1c)) },
      { path: `${p}/labs`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.labReport)) },
      { path: `${p}/ecg/reports`, shows: (body) => (body.items ?? []).some((i) => String(i.id) === String(rows.ecg)) },
      { path: `${p}/lab-tests`, shows: (body) => body.results.some((i) => String(i.id) === String(rows.labResult)) },
    ],
    examinations: [
      { path: `${p}/eye/reports`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.eye)) },
    ],
    lifestyle: [
      { path: `${p}/lifestyle`, shows: (body) => body.items.some((i) => String(i.id) === String(rows.lifestyle)) },
    ],
  };
}

async function seed() {
  salt = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  doctor = await makeMember(salt, { name: 'Dr Salt Lake', isOwner: true });
  patient = await makePatient({ name: 'Rahul Bose', practices: [salt] });
  await Enrollment.updateOne({ _id: patient.enrollments[0]._id }, { $set: { enrolledOn: ago(10) } });

  const id = patient.user._id;
  const then = ago(30);
  rows = {
    prescription: (
      await Prescription.create({
        patient: id,
        doctor: doctor.user._id,
        referenceNo: 'CAT-BEFORE-000001',
        issuedOn: then,
        items: [{ name: 'Glimepiride' }],
        labTestsAdvised: ['Vitamin B12 from before'],
      })
    )._id,
    glucose: (await GlucoseReading.create({ patient: id, valueMgDl: 240, measuredAt: then }))._id,
    vital: (await VitalRecord.create({ patient: id, systolic: 166, diastolic: 96, recordedAt: then }))._id,
    hba1c: (await Hba1cRecord.create({ patient: id, percentage: 9.1, testedOn: then }))._id,
    labReport: (await LabReport.create({ patient: id, title: 'Kidney panel from before', testedOn: then }))._id,
    ecg: (await EcgReport.create({ patient: id, recordedOn: then, recordedBy: doctor.user._id }))._id,
    lifestyle: (await LifestyleLog.create({ patient: id, kind: 'water', volumeMl: 900, loggedAt: then }))._id,
  };
  // Windowed on `createdAt`, which Mongoose will not backdate on create.
  rows.labResult = (
    await LabResult.collection.insertOne({ patient: id, testName: 'Lipids from before', createdAt: then, updatedAt: then })
  ).insertedId;
  rows.eye = (
    await EyeReport.collection.insertOne({ patient: id, reportDate: then, reportedGrade: 'unknown', createdAt: then, updatedAt: then })
  ).insertedId;
}

async function visible() {
  const out = {};
  for (const [category, list] of Object.entries(screens())) {
    out[category] = [];
    for (const screen of list) {
      const res = await as(doctor.token).get(screen.path);
      assert.equal(res.status, 200, `${screen.path} answered ${res.status}: ${JSON.stringify(res.body)}`);
      out[category].push({ path: screen.path, shown: screen.shows(res.body) });
    }
  }
  return out;
}

describe('each category opens its own screens and no others', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await seed();
  });

  test('with nothing shared, nothing from before the enrolment is shown anywhere', async () => {
    for (const [category, screensFor] of Object.entries(await visible())) {
      for (const s of screensFor) assert.equal(s.shown, false, `${category} from before was shown at ${s.path}`);
    }
  });

  for (const category of ['prescriptions', 'readings', 'lab_results', 'examinations', 'lifestyle']) {
    test(`sharing ${category} shows ${category}, and only ${category}`, async () => {
      const res = await as(patient.token).post('/sharing/grants', { practiceId: String(salt._id), categories: [category] });
      assert.equal(res.status, 201, JSON.stringify(res.body));

      for (const [other, screensFor] of Object.entries(await visible())) {
        for (const s of screensFor) {
          // The lab-tests screen reads two categories, and each half answers to
          // its own grant — so it is expected to show exactly the half shared.
          assert.equal(
            s.shown,
            other === category,
            `sharing ${category}: ${other} from before was ${s.shown ? 'shown' : 'hidden'} at ${s.path}`,
          );
        }
      }
      await ShareGrant.deleteMany({});
    });
  }
});
