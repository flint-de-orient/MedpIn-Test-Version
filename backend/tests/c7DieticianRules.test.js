import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { enrolByPhone, confirmEnrolment } from '../src/services/enrolByPhone.js';
import { OtpChallenge, hashOtp } from '../src/models/OtpChallenge.js';
import { autoAssignDietician } from '../src/services/dieticianAssignment.js';
import { signPhoneToken } from '../src/services/otp.js';
import { signAccessToken } from '../src/services/tokens.js';
import {
  planDieticianAssignments,
  applyDieticianAssignments,
} from '../scripts/backfillDieticianAssignments.js';

/**
 * §18, rule by rule, asked only through what a person can do.
 *
 *   0 active dieticians  — nobody is assigned
 *   1 active dietician   — assigned by default; the doctor can unassign, and
 *                          the unassignment stays unassigned
 *   2 or more            — the doctor chooses; nothing picks the first
 *   and never across a practice boundary
 *
 * Every assertion here reads the dietician's own caseload, the doctor's own
 * action and the backfill a deploy runs — never the field the assignment is
 * stored in — so the same file says what the rules were before the assignment
 * moved onto the enrolment, and holds the new code to them after. Run against
 * the single `PatientProfile.assignedDietician` field, the desk registration,
 * the sticking unassignment, the first-dietician hire and both two-practice
 * tests failed.
 */

let seq = 0;
/** A number no factory has handed out: 98 rather than the factories' 99. */
const freshPhone = () => `+9198${String(Date.now()).slice(-6)}${String((seq += 1)).padStart(2, '0')}`;

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return {
    practice: p,
    doctor: await makeMember(p, { name: `Dr ${name}`, isOwner: true }),
    desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
  };
}

const dietician = (where, name) => makeMember(where.practice, { name, role: ROLES.DIETICIAN });

/** Who is on this dietician's list, by name, as their own app asks. */
async function caseload(who) {
  const res = await as(who.token).get('/dietician/patients');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body.items ?? []).map((p) => p.name);
}

/** The desk registering a walk-in, the way the counter does it. */
async function deskRegisters(where, name) {
  const res = await as(where.desk.token).post('/doctor/patients', { name, phone: freshPhone() });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

/** A patient already on the books here, with the profile every patient has. */
async function enrolled(where, name, others = []) {
  const patient = await makePatient({ name, practices: [where.practice, ...others.map((o) => o.practice)] });
  await PatientProfile.create({ user: patient.user._id });
  return patient;
}

const assign = (where, patientId, dieticianId) =>
  as(where.doctor.token).patch(`/doctor/patients/${patientId}/dietician`, {
    dieticianId: dieticianId ? String(dieticianId) : null,
  });

describe('§18 with no active dietician', () => {
  let a;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
  });

  test('registering a patient assigns nobody, and there is nobody to choose', async () => {
    const id = await deskRegisters(a, 'Nobody’s Yet');
    const dieticians = await as(a.doctor.token).get('/doctor/dieticians');
    assert.equal(dieticians.status, 200);
    assert.deepEqual(dieticians.body.items, []);
    // An assignment needs a dietician of this practice; there is none.
    const res = await assign(a, id, a.doctor.user._id);
    assert.equal(res.status, 404, 'a doctor was assigned as the dietician');
  });

  test('the first dietician the practice hires takes on the patients nobody had decided for', async () => {
    /*
     * One active dietician is the default, whenever that becomes true. A
     * practice that ran for a month without one and then hires one would
     * otherwise give them an empty list and the doctor a form per patient.
     */
    const id = await deskRegisters(a, 'Waiting For Cover');
    const phone = freshPhone();
    const hired = await as(a.doctor.token).post('/team', {
      role: ROLES.DIETICIAN,
      name: 'Ms Roy',
      phoneToken: signPhoneToken(phone),
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));

    const roy = await User.findById(hired.body.userId);
    assert.deepEqual(await caseload({ token: signAccessToken(roy) }), ['Waiting For Cover']);
    assert.ok(id);
  });
});

describe('§18 with one active dietician', () => {
  let a;
  let roy;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    roy = await dietician(a, 'Ms Roy');
  });

  test('a patient the desk registers is theirs by default', async () => {
    await deskRegisters(a, 'Walked In');
    assert.deepEqual(await caseload(roy), ['Walked In']);
  });

  test('so is somebody who already uses MedPin and joins this practice', async () => {
    const phone = freshPhone();
    const existing = await User.create({ name: 'Self Signed', phone, role: ROLES.PATIENT, isActive: true });
    await PatientProfile.create({ user: existing._id });

    // An existing account joins only when its owner gives the code (V-14,
    // merged from C8): until then the practice has no patient, and neither
    // does its dietician.
    const out = await enrolByPhone({ phone, name: 'Self Signed', practiceId: a.practice._id });
    assert.equal(out.enrollment.status, ENROLLMENT_STATUS.PENDING);
    assert.deepEqual(await caseload(roy), [], 'the dietician took a patient who had not consented');

    await OtpChallenge.updateOne(
      { phone, purpose: 'enrol' },
      { $set: { codeHash: hashOtp('424242', phone, 'enrol') } },
    );
    const confirmed = await confirmEnrolment({ enrollmentId: out.enrollment._id, code: '424242', practiceId: a.practice._id });
    assert.equal(confirmed.status, ENROLLMENT_STATUS.ACTIVE);
    assert.deepEqual(await caseload(roy), ['Self Signed']);
  });

  test('the doctor unassigns, and it sticks — through the backfill a deploy runs', async () => {
    const patient = await enrolled(a, 'Taken Off');
    await autoAssignDietician(patient.user._id, a.practice._id);
    assert.deepEqual(await caseload(roy), ['Taken Off']);

    const off = await assign(a, patient.user._id, null);
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.deepEqual(await caseload(roy), []);

    await applyDieticianAssignments(await planDieticianAssignments());
    assert.deepEqual(await caseload(roy), [], 'the backfill put the patient back behind the doctor');
  });

  test('and through the patient consenting to this practice again', async () => {
    const patient = await enrolled(a, 'Came Back');
    await autoAssignDietician(patient.user._id, a.practice._id);
    assert.equal((await assign(a, patient.user._id, null)).status, 200);

    // Withdrawn and granted again: the same enrolment row, reactivated, and
    // the step confirmEnrolment takes once the code comes back.
    await Enrollment.updateOne(
      { patient: patient.patient._id, practice: a.practice._id },
      { $set: { status: ENROLLMENT_STATUS.REVOKED, revokedAt: new Date() } },
    );
    await Enrollment.updateOne(
      { patient: patient.patient._id, practice: a.practice._id },
      { $set: { status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null } },
    );
    await autoAssignDietician(patient.user._id, a.practice._id);

    assert.deepEqual(await caseload(roy), [], 'consent put the patient back behind the doctor');
  });

  test('and the doctor can put them back', async () => {
    const patient = await enrolled(a, 'Back Again');
    await autoAssignDietician(patient.user._id, a.practice._id);
    await assign(a, patient.user._id, null);

    const on = await assign(a, patient.user._id, roy.user._id);
    assert.equal(on.status, 200, JSON.stringify(on.body));
    assert.deepEqual(await caseload(roy), ['Back Again']);
  });
});

describe('§18 with two active dieticians', () => {
  let a;
  let roy;
  let bose;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    roy = await dietician(a, 'Ms Roy');
    bose = await dietician(a, 'Mr Bose');
  });

  test('nothing picks one — not the desk registration, not the enrolment', async () => {
    await deskRegisters(a, 'Walked In');
    const patient = await enrolled(a, 'Joined');
    await autoAssignDietician(patient.user._id, a.practice._id);

    assert.deepEqual(await caseload(roy), []);
    assert.deepEqual(await caseload(bose), []);
  });

  test('the doctor’s choice is the only person who has the patient', async () => {
    const id = await deskRegisters(a, 'Chosen For');
    const res = await assign(a, id, bose.user._id);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    assert.deepEqual(await caseload(bose), ['Chosen For']);
    assert.deepEqual(await caseload(roy), []);
  });

  test('two identical choices at once are one assignment', async () => {
    const patient = await enrolled(a, 'Double Tap');
    const [one, two] = await Promise.all([
      assign(a, patient.user._id, roy.user._id),
      assign(a, patient.user._id, roy.user._id),
    ]);
    assert.deepEqual([one.status, two.status], [200, 200]);
    assert.deepEqual(await caseload(roy), ['Double Tap']);
    assert.deepEqual(await caseload(bose), []);
  });

  test('the backfill leaves the choice to the doctor', async () => {
    await enrolled(a, 'Still Undecided');
    const plan = await planDieticianAssignments();
    assert.equal(plan.ambiguous.length, 1);
    await applyDieticianAssignments(plan);
    assert.deepEqual(await caseload(roy), []);
    assert.deepEqual(await caseload(bose), []);
  });
});

describe('§18 never crosses a practice boundary', () => {
  let a;
  let b;
  let aDietician;
  let bDietician;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    a = await practice('Salt Lake');
    b = await practice('Behala');
    aDietician = await dietician(a, 'Salt Lake Dietician');
    bDietician = await dietician(b, 'Behala Dietician');
  });

  test('a patient at both practices is held by each practice’s own dietician', async () => {
    const shared = await enrolled(a, 'Shared Patient', [b]);
    await autoAssignDietician(shared.user._id, a.practice._id);
    await autoAssignDietician(shared.user._id, b.practice._id);

    assert.deepEqual(await caseload(aDietician), ['Shared Patient']);
    assert.deepEqual(await caseload(bDietician), ['Shared Patient'], 'the second practice’s dietician was never given them');
  });

  test('one practice’s choice does not take the patient from the other', async () => {
    const shared = await enrolled(a, 'Shared Patient', [b]);
    assert.equal((await assign(a, shared.user._id, aDietician.user._id)).status, 200);
    assert.equal((await assign(b, shared.user._id, bDietician.user._id)).status, 200);

    assert.deepEqual(await caseload(aDietician), ['Shared Patient'], 'Behala’s choice replaced Salt Lake’s');
    assert.deepEqual(await caseload(bDietician), ['Shared Patient']);

    // And unassigning at one leaves the other alone.
    assert.equal((await assign(b, shared.user._id, null)).status, 200);
    assert.deepEqual(await caseload(aDietician), ['Shared Patient']);
    assert.deepEqual(await caseload(bDietician), []);
  });

  test('another practice’s dietician cannot be assigned, and gets nothing', async () => {
    const patient = await enrolled(a, 'Salt Lake Only');
    const res = await assign(a, patient.user._id, bDietician.user._id);
    assert.equal(res.status, 404);
    assert.deepEqual(await caseload(bDietician), []);
  });

  test('another practice’s doctor cannot assign this practice’s patient', async () => {
    const patient = await enrolled(a, 'Salt Lake Only');
    const res = await assign(b, patient.user._id, bDietician.user._id);
    assert.ok([403, 404].includes(res.status), `answered ${res.status}`);
    assert.deepEqual(await caseload(bDietician), []);
    assert.deepEqual(await caseload(aDietician), []);
  });

  test('and inside the practice, only a doctor with the record grant assigns', async () => {
    const patient = await enrolled(a, 'Salt Lake Only');
    const byDesk = await as(a.desk.token).patch(`/doctor/patients/${patient.user._id}/dietician`, {
      dieticianId: String(aDietician.user._id),
    });
    assert.equal(byDesk.status, 403, 'the desk decided who may see a patient');

    const readOnly = await makeMember(a.practice, { name: 'Dr Read Only', permissions: ['VIEW_PATIENT'] });
    const byReader = await as(readOnly.token).patch(`/doctor/patients/${patient.user._id}/dietician`, {
      dieticianId: String(aDietician.user._id),
    });
    assert.equal(byReader.status, 403, 'a doctor without EDIT_RECORD changed the record');
    assert.deepEqual(await caseload(aDietician), []);
  });
});
