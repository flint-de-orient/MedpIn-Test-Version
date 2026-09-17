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
import { FootAssessment } from '../src/models/FootAssessment.js';
import { LifestyleLog } from '../src/models/LifestyleLog.js';
import { FoodLog } from '../src/models/FoodLog.js';
import { ShareGrant, SHARE_CATEGORY } from '../src/models/ShareGrant.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Each category, over the wire, through every screen that reads it.
 *
 * `sharedReadsAreMapped.test.js` proves every windowed read has a category on
 * paper. This proves the paper is right: a row from before the enrolment is
 * hidden with no grant, hidden under a grant for any other category, and
 * visible under a grant for its own — read by id in the body the real route
 * returns.
 *
 * The categories are the lead's list: prescriptions, lab results, vitals and
 * readings, eye, foot, ECG, food logs, documents and uploads, notes. The last
 * two have no windowed read today, so a grant for either must open nothing on
 * any of these screens.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

let salt;
let doctor;
let patient;
let rows;

const has = (list, id) => (list ?? []).some((i) => String(i.id) === String(id));

/** Where each category's rows are read, and how to tell the row from before is on screen. */
function screens() {
  const p = `/patients/${patient.user._id}`;
  return {
    prescriptions: [
      { path: `${p}/prescriptions`, shows: (body) => has(body.items, rows.prescription) },
      { path: `${p}/lab-tests`, shows: (body) => body.advised.includes('Vitamin B12 from before') },
    ],
    readings: [
      { path: `${p}/glucose`, shows: (body) => has(body.items, rows.glucose) },
      { path: `${p}/vitals`, shows: (body) => has(body.items, rows.vital) },
    ],
    lab_results: [
      { path: `${p}/hba1c`, shows: (body) => has(body.items, rows.hba1c) },
      { path: `${p}/labs`, shows: (body) => has(body.items, rows.labReport) },
      { path: `${p}/lab-tests`, shows: (body) => has(body.results, rows.labResult) },
    ],
    ecg: [{ path: `${p}/ecg/reports`, shows: (body) => has(body.items, rows.ecg) }],
    eye: [{ path: `${p}/eye/reports`, shows: (body) => has(body.items, rows.eye) }],
    foot: [{ path: `${p}/foot/assessments`, shows: (body) => has(body.items, rows.foot) }],
    food_logs: [
      { path: `${p}/lifestyle`, shows: (body) => has(body.items, rows.lifestyle) },
      { path: `${p}/food-log`, shows: (body) => has(body.items, rows.food) },
    ],
  };
}

/** Put a row in with its date field backdated — through the driver, for fields Mongoose manages. */
async function backdated(Model, fields, then) {
  const { insertedId } = await Model.collection.insertOne({ ...fields, createdAt: then, updatedAt: then });
  return insertedId;
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
    foot: (await FootAssessment.create({ patient: id, site: 'left_sole', assessedAt: then }))._id,
    lifestyle: (await LifestyleLog.create({ patient: id, kind: 'water', volumeMl: 900, loggedAt: then }))._id,
    labResult: await backdated(LabResult, { patient: id, testName: 'Lipids from before' }, then),
    eye: await backdated(EyeReport, { patient: id, reportDate: then, reportedGrade: 'unknown' }, then),
    food: await backdated(FoodLog, { patient: id, mealType: 'lunch', note: 'Rice and dal, from before' }, then),
  };
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

  test('the categories are exactly the ones agreed', () => {
    assert.deepEqual(
      Object.values(SHARE_CATEGORY).sort(),
      ['documents', 'ecg', 'eye', 'food_logs', 'foot', 'lab_results', 'notes', 'prescriptions', 'readings'],
    );
  });

  test('with nothing shared, nothing from before the enrolment is shown anywhere', async () => {
    for (const [category, screensFor] of Object.entries(await visible())) {
      for (const s of screensFor) assert.equal(s.shown, false, `${category} from before was shown at ${s.path}`);
    }
  });

  for (const category of Object.values(SHARE_CATEGORY)) {
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
