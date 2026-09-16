import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Prescription } from '../src/models/Prescription.js';
import { RECORD_STATE } from '../src/models/plugins/clinicalRecord.js';
import {
  planRecordState,
  applyRecordState,
} from '../scripts/backfillPrescriptionRecordState.js';

/**
 * Prescriptions switched off with a bare flag, before the route used `endAs`.
 *
 * `isActive: false` with `recordState: current` can only have come from the
 * one line that did that, so the state is recoverable rather than guessed —
 * and so is the link, because the prescription written in its place stores
 * `supersedes` pointing back at it.
 *
 * What is not recoverable is who ended it. The old line recorded no actor, so
 * `endedBy` stays null and the reason says the record does not say: a clinical
 * row naming a doctor who may not have done it would be worse than a blank.
 */

let practice;
let doctor;
let patient;
let seq = 0;

/** A prescription for the practice's patient, issued on a given day. */
async function prescription(day, extra = {}) {
  seq += 1;
  return Prescription.create({
    patient: patient.user._id,
    doctor: doctor.user._id,
    referenceNo: `TEST-2026-${String(seq).padStart(6, '0')}`,
    issuedOn: day,
    items: [{ name: 'Metformin', strength: '500mg' }],
    ...extra,
  });
}

/** What the old line did: clear the flag, leave the state alone. */
async function switchedOffTheOldWay(row) {
  await Prescription.updateOne({ _id: row._id }, { $set: { isActive: false } });
}

describe('prescriptions ended before there was a record state', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    seq = 0;
    practice = await makePractice('Salt Lake');
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    patient = await makePatient({ name: 'Rahul', practices: [practice] });
  });

  test('one replaced by a later prescription is linked to it', async () => {
    const old = await prescription(new Date('2026-05-04'));
    await switchedOffTheOldWay(old);
    const replacement = await prescription(new Date('2026-06-01'), { supersedes: old._id });

    const plan = await planRecordState();
    assert.equal(plan.linked.length, 1);
    assert.equal(plan.unlinked.length, 0);

    assert.equal(await applyRecordState(plan), 1);

    const after = await Prescription.findById(old._id).lean();
    assert.equal(after.recordState, RECORD_STATE.SUPERSEDED);
    assert.equal(String(after.replacedBy), String(replacement._id));
    assert.match(after.endedReason, new RegExp(replacement.referenceNo));
    // Nobody is named, because the row never recorded who.
    assert.equal(after.endedBy ?? null, null);
  });

  test('one whose replacement cannot be found still gets a state, and says so', async () => {
    const orphan = await prescription(new Date('2026-05-04'));
    await switchedOffTheOldWay(orphan);

    const plan = await planRecordState();
    assert.equal(plan.linked.length, 0);
    assert.equal(plan.unlinked.length, 1);

    await applyRecordState(plan);

    const after = await Prescription.findById(orphan._id).lean();
    assert.equal(after.recordState, RECORD_STATE.SUPERSEDED);
    assert.equal(after.replacedBy ?? null, null);
    assert.match(after.endedReason, /does not say which/i);
  });

  test('a prescription ended properly is not touched', async () => {
    /*
     * Including one voided through `POST /records/prescriptions/:id/end`.
     * Rewriting that as `superseded` would turn "issued in error, do not act
     * on it" into "replaced by a better one", which is the opposite reading.
     */
    const voided = await prescription(new Date('2026-05-04'));
    voided.endAs(RECORD_STATE.VOIDED, {
      by: doctor.user._id,
      reason: 'Issued to the wrong patient.',
    });
    await voided.save();

    const plan = await planRecordState();
    assert.equal(plan.linked.length + plan.unlinked.length, 0);

    const after = await Prescription.findById(voided._id).lean();
    assert.equal(after.recordState, RECORD_STATE.VOIDED);
    assert.match(after.endedReason, /wrong patient/i);
  });

  test('a prescription still in force is not ended by a backfill', async () => {
    const standing = await prescription(new Date('2026-06-01'));

    const plan = await planRecordState();
    assert.equal(plan.linked.length + plan.unlinked.length, 0);

    const after = await Prescription.findById(standing._id).lean();
    assert.equal(after.recordState, RECORD_STATE.CURRENT);
    assert.notEqual(after.isActive, false);
  });

  test('two prescriptions claiming the same one are reported, not linked', async () => {
    // The route cannot produce this. If the data holds it, a person should see
    // it rather than have the first match written into a clinical record.
    const old = await prescription(new Date('2026-05-04'));
    await switchedOffTheOldWay(old);
    await prescription(new Date('2026-06-01'), { supersedes: old._id });
    await prescription(new Date('2026-06-02'), { supersedes: old._id });

    const plan = await planRecordState();
    assert.equal(plan.linked.length, 0);
    assert.equal(plan.unlinked.length, 1);
    assert.equal(plan.unlinked[0].claims, 2);

    await applyRecordState(plan);
    const after = await Prescription.findById(old._id).lean();
    assert.equal(after.replacedBy ?? null, null, 'a contested link was written anyway');
  });

  test('running it twice changes nothing the second time', async () => {
    const old = await prescription(new Date('2026-05-04'));
    await switchedOffTheOldWay(old);
    await prescription(new Date('2026-06-01'), { supersedes: old._id });

    await applyRecordState(await planRecordState());
    const first = await Prescription.findById(old._id).lean();

    const second = await planRecordState();
    assert.equal(second.linked.length + second.unlinked.length, 0);
    assert.equal(await applyRecordState(second), 0);

    const again = await Prescription.findById(old._id).lean();
    assert.deepEqual(again.endedAt, first.endedAt);
    assert.equal(again.endedReason, first.endedReason);
  });
});
