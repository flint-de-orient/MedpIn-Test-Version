import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Membership, PERMISSIONS } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Medication } from '../src/models/Medication.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * What a member of staff may do with a patient's record, as opposed to which
 * patients they may open.
 *
 * ---- The grant that was granted and never checked -------------------------
 *
 * `EDIT_RECORD` appeared in every preset that touches a patient, in the
 * capability payload the app reads, and in the console's permission list. A
 * practice could see it ticked beside somebody's name, untick it, and change
 * nothing whatsoever: no route asked.
 *
 * `VIEW_PATIENT` was asked by a handful of routes while the clinical routers —
 * readings, medicines, food logs, lab results, foot and eye records — asked
 * only `resolvePatientScope`, which answers "whose patient is this" and not
 * "what may this person do with them".
 *
 * Both are now decided by what the route does: a GET asks to see the record,
 * anything else writes to it, and changing a regimen needs PRESCRIBE on top.
 */

let practice;
let patient;
let doctor;
let desk;

/** Strip one grant from a member, leaving the rest of their preset. */
async function revoke(member, permission) {
  await Membership.updateOne({ _id: member.membership._id }, { $pull: { permissions: permission } });
}

const reading = { valueMgDl: 140, context: 'fasting', measuredAt: new Date().toISOString() };

describe('seeing a record and writing to it are different grants', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  });

  test('without EDIT_RECORD a reading cannot be written', async () => {
    await revoke(desk, PERMISSIONS.EDIT_RECORD);

    const res = await as(desk.token).post(`/patients/${patient.user._id}/glucose`, reading);

    assert.equal(res.status, 403, 'EDIT_RECORD was revoked and the write went through');
    assert.equal(await GlucoseReading.countDocuments({ patient: patient.user._id }), 0);
  });

  test('but the record can still be read', async () => {
    // The two are separate for a reason: somebody may be trusted to look at a
    // record and not to change it.
    await revoke(desk, PERMISSIONS.EDIT_RECORD);

    const res = await as(desk.token).get(`/patients/${patient.user._id}/glucose`);
    assert.equal(res.status, 200);
  });

  test('without VIEW_PATIENT the record cannot be read either', async () => {
    await revoke(desk, PERMISSIONS.VIEW_PATIENT);

    const res = await as(desk.token).get(`/patients/${patient.user._id}/glucose`);
    assert.equal(res.status, 403);
  });

  test('with the whole preset, the desk does its job', async () => {
    // A fix that stops the front desk taking a weight is not a fix.
    const write = await as(desk.token).post(`/patients/${patient.user._id}/glucose`, reading);
    assert.equal(write.status, 201);

    const read = await as(desk.token).get(`/patients/${patient.user._id}/glucose`);
    assert.equal(read.status, 200);
  });

  test('a patient writes to their own record with no membership at all', async () => {
    /*
     * Permissions describe what a practice's staff may do. A patient is not
     * staff and holds none — the guard has to let them through, or the app
     * stops working for the people it is for.
     */
    const res = await as(patient.token).post(`/patients/${patient.user._id}/glucose`, reading);
    assert.equal(res.status, 201);
  });

  test('the same rule covers food logs, lab results and the rest', async () => {
    // Mounted on the router rather than repeated per route, so a route added
    // later inherits it by existing.
    await revoke(desk, PERMISSIONS.EDIT_RECORD);

    const food = await as(desk.token).post(`/patients/${patient.user._id}/food-log`, {
      meal: 'lunch',
      items: [{ name: 'rice' }],
    });
    assert.equal(food.status, 403);

    const lab = await as(desk.token).post(`/patients/${patient.user._id}/labs`, {
      title: 'Lipid profile',
      testedOn: new Date().toISOString(),
    });
    assert.equal(lab.status, 403);
  });
});

describe('changing what somebody takes needs PRESCRIBE', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  });

  test('the desk cannot add a medicine', async () => {
    // EDIT_RECORD is right for noting a weight. Adding a drug is a different
    // act, and the desk preset does not carry PRESCRIBE.
    const res = await as(desk.token).post(`/patients/${patient.user._id}/medications`, {
      name: 'Metformin',
      strength: '500mg',
      dose: '1 tablet',
      schedule: [{ time: '08:00' }],
    });

    assert.equal(res.status, 403);
    assert.equal(await Medication.countDocuments({ patient: patient.user._id }), 0);
  });

  test('nor stop one', async () => {
    const med = await Medication.create({
      patient: patient.user._id,
      name: 'Metformin',
      strength: '500mg',
      isActive: true,
    });

    const res = await as(desk.token).del(`/patients/${patient.user._id}/medications/${med._id}`);

    assert.equal(res.status, 403);
    const after = await Medication.findById(med._id).lean();
    assert.notEqual(after.isActive, false, 'the desk stopped a patient’s medicine');
  });

  test('the doctor does both', async () => {
    const added = await as(doctor.token).post(`/patients/${patient.user._id}/medications`, {
      name: 'Metformin',
      strength: '500mg',
      dose: '1 tablet',
      schedule: [{ time: '08:00' }],
    });
    assert.equal(added.status, 201);

    const stopped = await as(doctor.token).del(
      `/patients/${patient.user._id}/medications/${added.body.medication.id}`,
    );
    assert.equal(stopped.status, 204);
  });

  test('and a patient still manages their own list', async () => {
    // Their own medicines, their own account, no membership anywhere. C3
    // separates a patient stopping a course from a doctor stopping it; until
    // then this must not become a refusal.
    const res = await as(patient.token).post(`/patients/${patient.user._id}/medications`, {
      name: 'Vitamin D',
      strength: '1000 IU',
      dose: '1 tablet',
      schedule: [{ time: '09:00' }],
    });
    assert.equal(res.status, 201);
  });
});
