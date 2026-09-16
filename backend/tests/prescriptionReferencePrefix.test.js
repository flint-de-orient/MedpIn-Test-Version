import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { switchAdminOn, switchAdminBack, makeOperator } from './helpers/adminSession.js';
import { Prescription } from '../src/models/Prescription.js';
import { Practice, PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';

/**
 * Whose initials are on a prescription.
 *
 * ---- The defect -----------------------------------------------------------
 *
 * Every reference was `AKD-<year>-<n>` — Dr. Amit Kumar Dey's initials, on the
 * legal prescription of every practice on the platform. A second practice's
 * patient carried a document numbered as though the founding doctor had
 * written it.
 *
 * ---- What replaced it -----------------------------------------------------
 *
 * The practice's own prefix, set by an operator, or the neutral `RX` when it
 * has none. One counter per prefix per year, drawn atomically. References
 * already issued are never rewritten.
 */

const year = dayjs().year();
const item = (n) => ({ name: 'Metformin', strength: `${500 + n}mg`, frequency: '1-0-1' });

let first;
let second;
let firstDoctor;
let secondDoctor;
let firstPatient;
let secondPatient;
let operator;

async function issue(doctor, patient, n = 0) {
  return as(doctor.token).post(`/patients/${patient.user._id}/prescriptions`, {
    items: [item(n)],
    syncToMedications: false,
  });
}

describe('prescription references', () => {
  before(async () => {
    await boot();
    switchAdminOn();
  });
  after(async () => {
    switchAdminBack();
    await shutdown();
  });
  beforeEach(async () => {
    await wipe();
    await Prescription.createIndexes();
    await Practice.createIndexes();

    const extra = { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL };
    first = await makePractice('Dey Diabetes Care', { ...extra, isFounding: true });
    second = await makePractice('Lake Town Heart Centre', extra);
    firstDoctor = await makeMember(first, { name: 'Dr. Amit Kumar Dey', isOwner: true });
    secondDoctor = await makeMember(second, { name: 'Dr. Meera Iyer', isOwner: true });
    firstPatient = await makePatient({ name: 'Founding Patient', practices: [first] });
    secondPatient = await makePatient({ name: 'Lake Town Patient', practices: [second] });
    operator = await makeOperator();
  });

  test('neither practice’s new references carry AKD, and existing ones are untouched', async () => {
    const legacy = await Prescription.create({
      patient: firstPatient.user._id,
      doctor: firstDoctor.user._id,
      practice: first._id,
      referenceNo: `AKD-${year}-000412`,
      issuedOn: new Date(),
      items: [item(0)],
    });

    const a = await issue(firstDoctor, firstPatient, 1);
    const b = await issue(secondDoctor, secondPatient, 2);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);

    for (const ref of [a.body.prescription.referenceNo, b.body.prescription.referenceNo]) {
      assert.ok(!ref.startsWith('AKD-'), `a new reference carries the founding initials: ${ref}`);
      assert.match(ref, new RegExp(`^RX-${year}-\\d{6}$`));
    }

    const kept = await Prescription.findById(legacy._id).lean();
    assert.equal(kept.referenceNo, `AKD-${year}-000412`, 'an issued reference was rewritten');
  });

  test('a practice with its own prefix issues it, and the other stays neutral', async () => {
    const set = await as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: 'lth' });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body.practice.prescriptionPrefix, 'LTH', 'the prefix was not normalised to capitals');

    const mine = await issue(secondDoctor, secondPatient);
    const theirs = await issue(firstDoctor, firstPatient);
    assert.equal(mine.body.prescription.referenceNo, `LTH-${year}-000001`);
    assert.equal(theirs.body.prescription.referenceNo, `RX-${year}-000001`);

    // Recorded, with what it was before.
    const row = await AdminAuditLog.findOne({ action: 'admin.practice.edit' }).lean();
    assert.equal(row.before.prescriptionPrefix, null);
    assert.equal(row.after.prescriptionPrefix, 'LTH');
  });

  test('references stay unique when two practices issue at once', async () => {
    await as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: 'LTH' });
    const third = await makePractice('Behala Clinic', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const thirdDoctor = await makeMember(third, { name: 'Dr. Rina Sen', isOwner: true });
    const thirdPatient = await makePatient({ name: 'Behala Patient', practices: [third] });

    const callers = [
      [firstDoctor, firstPatient],
      [secondDoctor, secondPatient],
      [thirdDoctor, thirdPatient],
    ];
    const issued = await Promise.all(
      Array.from({ length: 12 }, (_, n) => issue(callers[n % 3][0], callers[n % 3][1], n)),
    );

    assert.deepEqual(issued.map((r) => r.status), Array(12).fill(201));
    const refs = issued.map((r) => r.body.prescription.referenceNo);
    assert.equal(new Set(refs).size, 12, `references collided: ${refs.join(', ')}`);
    assert.equal(refs.filter((r) => r.startsWith('LTH-')).length, 4);
    // The two practices without a prefix share one neutral series, gap-free between them.
    const neutral = refs.filter((r) => r.startsWith('RX-')).map((r) => Number(r.slice(-6))).sort((x, y) => x - y);
    assert.deepEqual(neutral, [1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('RX is nobody’s, and a malformed prefix is refused', async () => {
    const rx = await as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: 'RX' });
    assert.equal(rx.status, 400);
    const bad = await as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: '9AB' });
    assert.equal(bad.status, 400);
    assert.equal((await Practice.findById(second._id).lean()).prescriptionPrefix ?? null, null);
  });

  test('two practices cannot hold one prefix', async () => {
    assert.equal((await as(operator.token).patch(`/admin/practices/${first._id}`, { prescriptionPrefix: 'MED' })).status, 200);
    const again = await as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: 'MED' });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /Dey Diabetes Care/);
  });

  test('two operators racing for one prefix leave exactly one holder', async () => {
    const [x, y] = await Promise.all([
      as(operator.token).patch(`/admin/practices/${first._id}`, { prescriptionPrefix: 'RACE' }),
      as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: 'RACE' }),
    ]);
    assert.deepEqual([x.status, y.status].sort(), [200, 409]);
    assert.equal(await Practice.countDocuments({ prescriptionPrefix: 'RACE' }), 1);
  });

  test('AKD cannot be picked up by a practice that did not issue those references', async () => {
    await Prescription.create({
      patient: firstPatient.user._id,
      doctor: firstDoctor.user._id,
      practice: first._id,
      referenceNo: `AKD-${year}-000412`,
      issuedOn: new Date(),
      items: [item(0)],
    });

    const theirs = await as(operator.token).patch(`/admin/practices/${second._id}`, { prescriptionPrefix: 'AKD' });
    assert.equal(theirs.status, 409, 'another practice took the founding clinic’s series');

    // The practice that issued every one of them may continue its own series,
    // if an operator decides it should — and it carries on from the highest.
    const own = await as(operator.token).patch(`/admin/practices/${first._id}`, { prescriptionPrefix: 'AKD' });
    assert.equal(own.status, 200);
    const next = await issue(firstDoctor, firstPatient, 3);
    assert.equal(next.body.prescription.referenceNo, `AKD-${year}-000413`);
  });

  test('a series with a row nobody can place is nobody’s to take', async () => {
    await Prescription.create({
      patient: firstPatient.user._id,
      doctor: firstDoctor.user._id,
      referenceNo: `AKD-${year}-000009`,
      issuedOn: new Date(),
      items: [item(0)],
    });
    const res = await as(operator.token).patch(`/admin/practices/${first._id}`, { prescriptionPrefix: 'AKD' });
    assert.equal(res.status, 409);
  });

  test('the neutral series is not the old counter carried on', async () => {
    // The old counter key was the year alone and counted the AKD series. RX
    // starts its own, so a practice's first reference is not numbered after
    // somebody else's four hundredth.
    await Prescription.create({
      patient: firstPatient.user._id,
      doctor: firstDoctor.user._id,
      practice: first._id,
      referenceNo: `AKD-${year}-000412`,
      issuedOn: new Date(),
      items: [item(0)],
    });
    const res = await issue(secondDoctor, secondPatient);
    assert.equal(res.body.prescription.referenceNo, `RX-${year}-000001`);
  });
});
