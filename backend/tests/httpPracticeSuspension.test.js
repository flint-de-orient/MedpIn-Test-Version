import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { switchAdminOn, switchAdminBack, makeOperator } from './helpers/adminSession.js';
import { PLAN, PRACTICE_STATUS, PRACTICE_TYPE, Practice } from '../src/models/Practice.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Prescription } from '../src/models/Prescription.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ROLES } from '../src/models/User.js';

/**
 * A suspended practice, as its staff and its patients meet it.
 *
 * ---- The defect -----------------------------------------------------------
 *
 * An operator could suspend a practice, with a reason, and nothing read the
 * status. The admin router's own description promised its staff could not work;
 * its doctors went on prescribing and its desk went on booking.
 *
 * ---- The policy these pin -------------------------------------------------
 *
 *   - its staff are refused its operational and clinical routes with
 *     PRACTICE_SUSPENDED — a code of its own, not NO_PRACTICE;
 *   - they can still see that it is suspended (`GET /practices/mine`);
 *   - somebody who also works at an active practice carries on there;
 *   - its patients keep their own records;
 *   - nothing is deleted, and reinstating restores access at once;
 *   - both directions need a reason, and both are in the audit log.
 */

let operator;
let suspendedPractice;
let otherPractice;
let doctor;
let desk;
let dietician;
let otherDoctor;
let twoPlaceDoctor;
let patient;
let prescriptionId;

const refusedAsSuspended = (res, what) => {
  assert.equal(res.status, 403, `${what}: ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body?.error?.code, 'PRACTICE_SUSPENDED', `${what} was refused with ${res.body?.error?.code}`);
};

async function suspend(reason = 'Registration lapsed; council confirmation pending (ticket 4411).') {
  return as(operator.token).post(`/admin/practices/${suspendedPractice._id}/status`, {
    status: PRACTICE_STATUS.SUSPENDED,
    ...(reason ? { reason } : {}),
  });
}

describe('a suspended practice', () => {
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
    operator = await makeOperator();

    const extra = { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL };
    suspendedPractice = await makePractice('Salt Lake Diabetes Care', extra);
    otherPractice = await makePractice('Lake Town Heart Centre', extra);

    doctor = await makeMember(suspendedPractice, { name: 'Dr. Suspended', isOwner: true });
    desk = await makeMember(suspendedPractice, { name: 'Front Desk', role: ROLES.STAFF });
    dietician = await makeMember(suspendedPractice, { name: 'Diet Person', role: ROLES.DIETICIAN });
    otherDoctor = await makeMember(otherPractice, { name: 'Dr. Unaffected', isOwner: true });

    // Works at both. A second membership, not a second account.
    twoPlaceDoctor = await makeMember(otherPractice, { name: 'Dr. Two Places' });
    await Membership.create({
      user: twoPlaceDoctor.user._id,
      practice: suspendedPractice._id,
      role: ROLES.DOCTOR,
      permissions: presetFor({ role: ROLES.DOCTOR }),
      status: MEMBERSHIP_STATUS.ACTIVE,
    });

    patient = await makePatient({ name: 'Rahul Das', practices: [suspendedPractice] });

    const issued = await as(doctor.token).post(`/patients/${patient.user._id}/prescriptions`, {
      items: [{ name: 'Metformin', strength: '500 mg', frequency: 'BD' }],
      syncToMedications: true,
    });
    assert.equal(issued.status, 201, 'the practice could not prescribe before it was suspended');
    prescriptionId = issued.body.prescription.id;
  });

  test('suspending needs a reason, and is recorded with what it was', async () => {
    const bare = await suspend(null);
    assert.equal(bare.status, 400);
    assert.equal((await Practice.findById(suspendedPractice._id).lean()).status, PRACTICE_STATUS.ACTIVE);

    const res = await suspend();
    assert.equal(res.status, 200);
    assert.equal(res.body.practice.status, PRACTICE_STATUS.SUSPENDED);

    const row = await AdminAuditLog.findOne({ action: 'admin.practice.status.suspended' }).lean();
    assert.ok(row, 'the suspension was not audited');
    assert.equal(String(row.practice), String(suspendedPractice._id));
    assert.match(row.reason, /ticket 4411/);
    assert.deepEqual(row.before, { status: PRACTICE_STATUS.ACTIVE });
    assert.deepEqual(row.after, { status: PRACTICE_STATUS.SUSPENDED });
  });

  test('its staff are refused its clinical and operational routes, by name', async () => {
    assert.equal((await as(doctor.token).get('/doctor/patients')).status, 200, 'not working before the suspension');
    await suspend();

    refusedAsSuspended(await as(doctor.token).get('/doctor/patients'), 'the patient list');
    refusedAsSuspended(
      await as(doctor.token).get(`/patients/${patient.user._id}/prescriptions`),
      'reading a patient’s prescriptions',
    );
    refusedAsSuspended(
      await as(doctor.token).post(`/patients/${patient.user._id}/prescriptions`, {
        items: [{ name: 'Glimepiride', strength: '1 mg', frequency: 'OD' }],
      }),
      'writing a prescription',
    );
    refusedAsSuspended(await as(doctor.token).get(`/patients/${patient.user._id}/glucose`), 'a patient’s readings');
    refusedAsSuspended(await as(desk.token).get('/appointments'), 'the desk’s diary');
    refusedAsSuspended(await as(desk.token).get('/team'), 'the team list');
    refusedAsSuspended(await as(dietician.token).get('/dietician/patients'), 'the dietician’s caseload');
    refusedAsSuspended(await as(doctor.token).get('/auth/me/capabilities'), 'what the practice can do');

    // And the refusal is written down, like every other one.
    assert.ok(await AuditLog.exists({ action: 'denied.practice_suspended', actor: doctor.user._id }));
  });

  test('its staff can still sign in and see that it is suspended', async () => {
    await suspend();
    const me = await as(doctor.token).get('/auth/me');
    assert.equal(me.status, 200);

    const mine = await as(doctor.token).get('/practices/mine');
    assert.equal(mine.status, 200);
    assert.equal(mine.body.practice.status, PRACTICE_STATUS.SUSPENDED);
  });

  test('somebody who also works elsewhere carries on there, and is refused only by name', async () => {
    await suspend();

    // One practice left to work at: no header needed, and no PRACTICE_REQUIRED.
    assert.equal((await as(twoPlaceDoctor.token).get('/doctor/patients')).status, 200);
    const there = await as(twoPlaceDoctor.token).get('/doctor/patients', {
      'x-medpin-practice': String(otherPractice._id),
    });
    assert.equal(there.status, 200);

    refusedAsSuspended(
      await as(twoPlaceDoctor.token).get('/doctor/patients', {
        'x-medpin-practice': String(suspendedPractice._id),
      }),
      'naming the suspended practice',
    );
  });

  test('another practice is untouched', async () => {
    await suspend();
    assert.equal((await as(otherDoctor.token).get('/doctor/patients')).status, 200);
    assert.equal((await as(otherDoctor.token).get('/team')).status, 200);
  });

  test('its patients keep their own records', async () => {
    await suspend();

    const rx = await as(patient.token).get('/patients/me/prescriptions');
    assert.equal(rx.status, 200);
    assert.ok(rx.body.items.some((p) => String(p.id) === String(prescriptionId)), 'the patient lost their prescription');

    const pdf = await as(patient.token).get(`/patients/me/prescriptions/${prescriptionId}/pdf`);
    assert.equal(pdf.status, 200, 'the patient could not open their prescription');

    assert.equal((await as(patient.token).get('/patients/me/medications')).status, 200);
    assert.equal((await as(patient.token).get('/patients/me/glucose')).status, 200);
    assert.equal((await as(patient.token).get('/auth/me')).status, 200);
    assert.equal(
      (await as(patient.token).post('/patients/me/glucose', { valueMgDl: 132, context: 'fasting' })).status,
      201,
      'the patient could not log their own reading',
    );
  });

  test('nothing is deleted or rewritten', async () => {
    const before = {
      prescriptions: await Prescription.countDocuments({}),
      enrolments: await Enrollment.find({}).lean(),
      memberships: await Membership.find({ practice: suspendedPractice._id }).lean(),
    };
    await suspend();
    // A refused request on the way through changes nothing either.
    await as(doctor.token).get('/doctor/patients');

    assert.equal(await Prescription.countDocuments({}), before.prescriptions);
    assert.deepEqual(await Enrollment.find({}).lean(), before.enrolments);
    assert.deepEqual(await Membership.find({ practice: suspendedPractice._id }).lean(), before.memberships);
  });

  test('reinstating needs a reason too, and restores access on the next request', async () => {
    await suspend();
    refusedAsSuspended(await as(doctor.token).get('/doctor/patients'), 'while suspended');

    const bare = await as(operator.token).post(`/admin/practices/${suspendedPractice._id}/status`, {
      status: PRACTICE_STATUS.ACTIVE,
    });
    assert.equal(bare.status, 400);
    refusedAsSuspended(await as(doctor.token).get('/doctor/patients'), 'after a refused reinstatement');

    const res = await as(operator.token).post(`/admin/practices/${suspendedPractice._id}/status`, {
      status: PRACTICE_STATUS.ACTIVE,
      reason: 'Council confirmed the registration on 16 Sep.',
    });
    assert.equal(res.status, 200);

    assert.equal((await as(doctor.token).get('/doctor/patients')).status, 200, 'access did not come back');
    assert.equal((await as(desk.token).get('/appointments')).status, 200);

    const row = await AdminAuditLog.findOne({ action: 'admin.practice.status.active' }).lean();
    assert.deepEqual(row.before, { status: PRACTICE_STATUS.SUSPENDED });
    assert.match(row.reason, /Council confirmed/);
  });

  test('setting the status it already has records nothing', async () => {
    const res = await as(operator.token).post(`/admin/practices/${suspendedPractice._id}/status`, {
      status: PRACTICE_STATUS.ACTIVE,
    });
    assert.equal(res.status, 200);
    assert.equal(await AdminAuditLog.countDocuments({ action: /^admin\.practice\.status\./ }), 0);
  });
});
