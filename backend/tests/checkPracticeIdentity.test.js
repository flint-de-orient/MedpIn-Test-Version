import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { Clinic } from '../src/models/Clinic.js';
import { Practice } from '../src/models/Practice.js';
import { planIdentityCheck } from '../scripts/checkPracticeIdentity.js';

/**
 * The pre-deploy look at what each practice will be called.
 *
 * Identity stopped borrowing from the environment and started naming the
 * practice before its location in the same release. This report is how an
 * operator sees, before patients do, which practices that changes.
 */
describe('the practice identity check', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('a practice that names itself and its doctor needs no look', async () => {
    const p = await makePractice('Lake Town Heart Centre', { doctorDisplayName: 'Dr. Meera Iyer' });
    await Clinic.create({ name: 'Lake Town Heart Centre', practice: p._id });

    const { rows, needsLook } = await planIdentityCheck();
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].notes, []);
    assert.equal(rows[0].doctor, 'Dr. Meera Iyer');
    assert.equal(needsLook, false);
  });

  test('the head doctor counts as a doctor to name', async () => {
    const p = await makePractice('Meridian Clinic');
    const head = await makeMember(p, { name: 'Dr. Kavya Rao', isOwner: true });
    await Practice.updateOne({ _id: p._id }, { $set: { headDoctor: head.user._id } });

    const { rows } = await planIdentityCheck();
    assert.equal(rows[0].doctor, 'Dr. Kavya Rao');
    assert.deepEqual(rows[0].notes, []);
  });

  test('no doctor to name, and a name that changes, are both reported', async () => {
    const p = await makePractice('Dey Diabetes Care');
    await Clinic.create({ name: "Dr. Dey's Diabetes Clinic", practice: p._id });

    const { rows, needsLook } = await planIdentityCheck();
    assert.equal(needsLook, true);
    assert.equal(rows[0].notes.length, 2);
    assert.match(rows[0].notes.join('\n'), /your doctor/);
    assert.match(rows[0].notes.join('\n'), /"Dr\. Dey's Diabetes Clinic" becomes "Dey Diabetes Care"/);
  });

  test('a location with no practice is counted', async () => {
    await Clinic.create({ name: 'Unlinked Clinic' });
    const { unlinked, needsLook } = await planIdentityCheck();
    assert.equal(unlinked, 1);
    assert.equal(needsLook, true);
  });

  test('and it writes nothing', async () => {
    const p = await makePractice('Dey Diabetes Care');
    await Clinic.create({ name: 'Other Name', practice: p._id });
    const before = await Practice.findById(p._id).lean();
    await planIdentityCheck();
    assert.deepEqual(await Practice.findById(p._id).lean(), before);
  });
});
