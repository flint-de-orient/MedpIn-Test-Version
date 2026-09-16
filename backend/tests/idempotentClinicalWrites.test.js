import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Prescription } from '../src/models/Prescription.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * A consultation submitted twice, because the first answer never arrived.
 *
 * On a clinic's 4G the request reaches the server, the vitals and the
 * prescription are written, and the response is lost on the way back. The app
 * shows a timeout and the doctor taps again. Nothing refused the second
 * request, so the patient had two prescriptions from one visit and two
 * blood-pressure readings from one cuff — and the trend chart and the risk score
 * that orders the waiting list were built on both.
 *
 * The client now names each submission with an `Idempotency-Key` and sends the
 * same key when it retries it:
 *
 *   same key, same request   → the record already written
 *   same key, other request  → refused, IDEMPOTENCY_KEY_REUSED
 *   no key                   → a new record, as before
 */

let practice;
let doctor;
let patient;
let other;

const rx = (strength = '500mg') => ({
  items: [{ name: 'Metformin', strength, frequency: '1-0-1' }],
  syncToMedications: false,
});
const KEY = (n = 1) => `consult-7f3a9c2e:rx:${n}`;

async function world() {
  await wipe();
  // The unique indexes are what make a race safe rather than merely checked.
  await Promise.all([Prescription.createIndexes(), VitalRecord.createIndexes(), GlucoseReading.createIndexes()]);
  practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
  other = await makePatient({ name: 'Mira Das', practices: [practice] });
  for (const p of [patient, other]) {
    await PatientProfile.create({ user: p.user._id, assignedDoctor: doctor.user._id });
  }
}

describe('a prescription retried', () => {
  before(boot);
  after(shutdown);
  beforeEach(world);

  const issue = (who, body, key, headers = {}) =>
    as(doctor.token).post(`/patients/${who.user._id}/prescriptions`, body, {
      ...(key ? { 'Idempotency-Key': key } : {}),
      ...headers,
    });

  test('after a lost answer is the prescription already issued, not a second one', async () => {
    const first = await issue(patient, rx(), KEY());
    const again = await issue(patient, rx(), KEY());

    assert.equal(first.status, 201);
    assert.equal(again.status, 201);
    assert.equal(again.body.prescription.id, first.body.prescription.id, 'the retry made a new prescription');
    assert.equal(await Prescription.countDocuments({ patient: patient.user._id }), 1);
  });

  test('sent four times at once is still one prescription', async () => {
    // A double tap and two retries racing the first attempt: every copy finds
    // nothing before any of them writes. The unique index refuses all but one.
    const answers = await Promise.all([1, 2, 3, 4].map(() => issue(patient, rx(), KEY())));

    assert.deepEqual(answers.map((r) => r.status), [201, 201, 201, 201]);
    assert.equal(new Set(answers.map((r) => r.body.prescription.id)).size, 1);
    assert.equal(await Prescription.countDocuments({ patient: patient.user._id }), 1);
  });

  test('with the same key and different medicines is refused, not answered with the old one', async () => {
    /*
     * A doctor who corrected the strength after a failed attempt. Answering
     * with the first prescription would silently discard the correction; the
     * refusal says nothing was changed.
     */
    await issue(patient, rx('500mg'), KEY());
    const corrected = await issue(patient, rx('1000mg'), KEY());

    assert.equal(corrected.status, 409);
    assert.equal(corrected.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await Prescription.countDocuments({ patient: patient.user._id }), 1);
  });

  test('with the same key for another patient is refused', async () => {
    await issue(patient, rx(), KEY());
    const elsewhere = await issue(other, rx(), KEY());

    assert.equal(elsewhere.status, 409);
    assert.equal(await Prescription.countDocuments({ patient: other.user._id }), 0);
  });

  test('without a key still issues a new prescription each time', async () => {
    // An app that sends no key is no worse off than it was — and two genuine
    // prescriptions for one patient on one day are a real thing.
    await issue(patient, rx());
    await issue(patient, rx());
    assert.equal(await Prescription.countDocuments({ patient: patient.user._id }), 2);
  });

  test('that superseded another does not try to supersede it twice', async () => {
    /*
     * The first attempt ended the old prescription. Checked before anything
     * else, the retry would be refused — "that prescription is already
     * superseded" — and the doctor told a successful consultation had failed.
     */
    const old = await Prescription.create({
      patient: patient.user._id,
      doctor: doctor.user._id,
      referenceNo: 'OLD-2026-000001',
      issuedOn: new Date(),
      items: [{ name: 'Glimepiride', strength: '1mg' }],
    });

    const body = { ...rx(), supersedes: String(old._id) };
    const first = await issue(patient, body, KEY());
    const again = await issue(patient, body, KEY());

    assert.equal(first.status, 201);
    assert.equal(again.status, 201, 'the retry of a supersede was refused');
    assert.equal(again.body.prescription.id, first.body.prescription.id);
    assert.equal((await Prescription.findById(old._id).lean()).recordState, 'superseded');
  });

  test('a key that is not a key is refused before anything is written', async () => {
    const res = await issue(patient, rx(), 'x');
    assert.equal(res.status, 400);
    assert.equal(await Prescription.countDocuments({}), 0);
  });
});

describe('consult vitals retried', () => {
  before(boot);
  after(shutdown);
  beforeEach(world);

  const vitals = { systolic: 150, diastolic: 95, pulse: 88, glucoseMgDl: 212 };
  const record = (body, key) =>
    as(doctor.token).post(`/doctor/patients/${patient.user._id}/vitals`, body, key ? { 'Idempotency-Key': key } : {});

  test('after a lost answer are the readings already taken, not a second set', async () => {
    const first = await record(vitals, 'consult-7f3a9c2e:vitals');
    const again = await record(vitals, 'consult-7f3a9c2e:vitals');

    assert.equal(first.status, 201);
    assert.equal(again.status, 201);
    assert.equal(await VitalRecord.countDocuments({ patient: patient.user._id }), 1, 'two blood pressures from one cuff');
    assert.equal(await GlucoseReading.countDocuments({ patient: patient.user._id }), 1, 'two sugars from one prick');
  });

  test('sent four times at once is still one set', async () => {
    const answers = await Promise.all([1, 2, 3, 4].map(() => record(vitals, 'consult-7f3a9c2e:vitals')));

    assert.deepEqual(answers.map((r) => r.status), [201, 201, 201, 201]);
    assert.equal(await VitalRecord.countDocuments({ patient: patient.user._id }), 1);
    assert.equal(await GlucoseReading.countDocuments({ patient: patient.user._id }), 1);
  });

  test('with the same key and a corrected reading is refused, and the correction is not lost silently', async () => {
    await record(vitals, 'consult-7f3a9c2e:vitals');
    const corrected = await record({ ...vitals, systolic: 140 }, 'consult-7f3a9c2e:vitals');

    assert.equal(corrected.status, 409);
    assert.equal(corrected.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
    assert.equal(await VitalRecord.countDocuments({ patient: patient.user._id }), 1);
  });

  test('a sugar on its own is protected the same way', async () => {
    // No blood pressure, so the glucose reading is the only record carrying the key.
    await record({ glucoseMgDl: 180 }, 'consult-sugar-only:vitals');
    await record({ glucoseMgDl: 180 }, 'consult-sugar-only:vitals');
    assert.equal(await GlucoseReading.countDocuments({ patient: patient.user._id }), 1);
  });
});
