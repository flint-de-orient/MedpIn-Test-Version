import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Medication } from '../src/models/Medication.js';
import { Prescription } from '../src/models/Prescription.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { planMedicineLifecycle, applyMedicineLifecycle } from '../scripts/backfillMedicineLifecycle.js';

/**
 * The medicines and prescriptions already on record, before C3.
 *
 * Written straight to the collections, without the fields C3 adds — exactly as
 * the old routes left them.
 */

const DAY = 24 * 60 * 60 * 1000;
let seq = 0;

async function legacyPrescription(doctor, patient) {
  const { insertedId } = await Prescription.collection.insertOne({
    patient: patient.user._id,
    doctor: doctor.user._id,
    referenceNo: `LEGACY-${++seq}`,
    issuedOn: new Date(),
    items: [{ name: 'Metformin', strength: '500mg' }],
    isActive: true,
  });
  return insertedId;
}

async function legacyMedicine(fields) {
  const { insertedId } = await Medication.collection.insertOne({
    name: 'Metformin',
    strength: '500mg',
    schedule: [{ time: '08:00', relationToMeal: 'any' }],
    daysOfWeek: [],
    source: 'clinic',
    isActive: true,
    startDate: new Date(Date.now() - 30 * DAY),
    ...fields,
  });
  return insertedId;
}

describe('backfilling the medicine lifecycle', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('each prescription and prescribed medicine gets the practice that issued it; the ambiguous are listed, not guessed', async () => {
    const salt = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const solo = await makeMember(salt, { name: 'Dr Solo', isOwner: true });
    // A doctor at both practices, with the patient enrolled at both: nothing
    // on the old row says which of the two issued it.
    const both = await makeMember(salt, { name: 'Dr Both' });
    await Membership.create({
      user: both.user._id,
      practice: behala._id,
      role: both.membership.role,
      permissions: both.membership.permissions,
      status: MEMBERSHIP_STATUS.ACTIVE,
    });

    const patient = await makePatient({ name: 'Shared', practices: [salt, behala] });

    const clear = await legacyPrescription(solo, patient);
    const unclear = await legacyPrescription(both, patient);
    const fromRx = await legacyMedicine({ patient: patient.user._id, prescribedBy: solo.user._id, prescription: clear });
    const unclearMed = await legacyMedicine({ patient: patient.user._id, prescribedBy: both.user._id });

    const plan = await planMedicineLifecycle();
    await applyMedicineLifecycle(plan);

    assert.equal(String((await Prescription.findById(clear).lean()).practice), String(salt._id));
    assert.equal((await Prescription.findById(unclear).lean()).practice ?? null, null, 'an ambiguous prescription was guessed');
    assert.ok(plan.prescriptions.unresolved.map(String).includes(String(unclear)));

    assert.equal(String((await Medication.findById(fromRx).lean()).practice), String(salt._id));
    assert.equal((await Medication.findById(unclearMed).lean()).practice ?? null, null);
  });

  test('a medicine the patient added is relabelled as theirs, and states are recorded without inventing who stopped what', async () => {
    const salt = await makePractice('Salt Lake');
    const doctor = await makeMember(salt, { name: 'Dr Salt', isOwner: true });
    const patient = await makePatient({ name: 'Old Rows', practices: [salt] });

    const own = await legacyMedicine({ patient: patient.user._id, name: 'Vitamin D3' });
    const running = await legacyMedicine({ patient: patient.user._id, prescribedBy: doctor.user._id });
    const stopped = await legacyMedicine({ patient: patient.user._id, prescribedBy: doctor.user._id, isActive: false, endDate: new Date(Date.now() - 5 * DAY) });
    const finished = await legacyMedicine({ patient: patient.user._id, prescribedBy: doctor.user._id, name: 'Amoxicillin', endDate: new Date(Date.now() - DAY) });

    const plan = await planMedicineLifecycle();
    assert.equal((await Medication.findById(own).lean()).source, 'clinic', 'the report wrote something');

    await applyMedicineLifecycle(plan);

    const ownRow = await Medication.findById(own).lean();
    assert.equal(ownRow.source, 'manual');
    assert.equal(ownRow.practice ?? null, null);

    assert.equal((await Medication.findById(running).lean()).prescriptionState, 'active');
    const legacy = await Medication.findById(stopped).lean();
    assert.equal(legacy.prescriptionState, 'ended_legacy', 'an old stop was attributed to someone');
    assert.equal(legacy.stoppedByDoctor?.at, undefined);
    const done = await Medication.findById(finished).lean();
    assert.equal(done.prescriptionState, 'completed');
    assert.equal(done.isActive, false);

    const again = await applyMedicineLifecycle(await planMedicineLifecycle());
    assert.deepEqual(again, { prescriptions: 0, medicines: 0, relabelled: 0, states: 0, completed: 0 }, 'a second run changed something');
  });
});
