import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, ENROLLMENT_STATUS, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import {
  autoAssignDietician,
  chooseDietician,
  assignUndecidedToOnlyDietician,
} from '../src/services/dieticianAssignment.js';
import {
  planDieticianAssignments,
  applyDieticianAssignments,
} from '../scripts/backfillDieticianAssignments.js';

/**
 * Who looks after this patient's nutrition, at each practice, and who may
 * therefore read them.
 *
 * The caseload was "everyone at the practice, unless somebody has been
 * assigned to me"; then it was the patients whose profile named this
 * dietician, and a profile names one — so a patient at two practices could be
 * held by one practice's dietician at a time. The assignment is on the
 * enrolment now, with the history of who held it before, and the caseload is
 * what those enrolments say at the practice the dietician is working in.
 */

let practice;
let dietician;
let doctor;

const enrolmentOf = (patient, where = practice) =>
  Enrollment.findOne({ patient: patient.patient._id, practice: where._id }).lean();

async function world() {
  practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
}

describe('a dietician sees the patients they were given, at this practice', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
  });

  test('and not the ones they were not', async () => {
    const mine = await makePatient({ name: 'Assigned', practices: [practice] });
    const theirs = await makePatient({ name: 'Unassigned', practices: [practice] });
    await PatientProfile.create([{ user: mine.user._id }, { user: theirs.user._id }]);
    await chooseDietician({ enrollmentId: mine.enrollments[0]._id, dieticianId: dietician.user._id, by: doctor.user._id });

    const res = await as(dietician.token).get('/dietician/patients');
    assert.equal(res.status, 200);
    const names = (res.body.items ?? []).map((p) => p.name);
    assert.ok(names.includes('Assigned'), 'their own patient is missing');
    assert.ok(!names.includes('Unassigned'), 'a patient nobody assigned them was in the caseload');
  });

  test('a dietician with nobody assigned has an empty list, not the whole practice', async () => {
    const someone = await makePatient({ name: 'Somebody', practices: [practice] });
    await PatientProfile.create({ user: someone.user._id });

    const res = await as(dietician.token).get('/dietician/patients');
    assert.equal(res.status, 200);
    assert.equal((res.body.items ?? []).length, 0);
  });

  test('the profile field the assignment used to live in grants nothing', async () => {
    // Not read any more: it holds whichever practice assigned last.
    const legacy = await makePatient({ name: 'Legacy Field', practices: [practice] });
    await PatientProfile.create({ user: legacy.user._id, assignedDietician: dietician.user._id });

    const res = await as(dietician.token).get(`/dietician/patients/${legacy.user._id}/overview`);
    assert.equal(res.status, 404);
  });

  test('a patient who withdraws this practice leaves the list, and the assignment stays on record', async () => {
    const leaving = await makePatient({ name: 'Leaving', practices: [practice] });
    await PatientProfile.create({ user: leaving.user._id });
    await autoAssignDietician(leaving.user._id, practice._id);
    await Enrollment.updateOne(
      { _id: leaving.enrollments[0]._id },
      { $set: { status: ENROLLMENT_STATUS.REVOKED, revokedAt: new Date() } },
    );

    const res = await as(dietician.token).get(`/dietician/patients/${leaving.user._id}/overview`);
    assert.equal(res.status, 404);
    assert.equal(String((await enrolmentOf(leaving)).dietician), String(dietician.user._id));
  });
});

describe('the default: one active dietician is assigned', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('when there is exactly one, the patient gets them, marked as the default', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'New', practices: [practice] });

    const assigned = await autoAssignDietician(patient.user._id, practice._id);
    assert.equal(String(assigned), String(dietician.user._id));

    const enrolment = await enrolmentOf(patient);
    assert.equal(String(enrolment.dietician), String(dietician.user._id));
    assert.equal(enrolment.dieticianSource, DIETICIAN_SOURCE.AUTO);
    assert.ok(enrolment.dieticianSince);
    assert.equal(enrolment.dieticianBy, null);
  });

  test('when there are two, nobody is chosen for the doctor', async () => {
    await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'New', practices: [practice] });

    assert.equal(await autoAssignDietician(patient.user._id, practice._id), null);
    const enrolment = await enrolmentOf(patient);
    assert.equal(enrolment.dietician ?? null, null);
    assert.equal(enrolment.dieticianSource ?? null, null, 'the relationship was marked decided');
  });

  test('one active beside one suspended is one: the suspended one is not a choice', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const away = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    await Membership.updateOne({ _id: away.membership._id }, { $set: { status: MEMBERSHIP_STATUS.SUSPENDED } });

    const patient = await makePatient({ name: 'New', practices: [practice] });
    assert.equal(String(await autoAssignDietician(patient.user._id, practice._id)), String(dietician.user._id));
  });

  test('a pending enrolment is not assigned until it is consented to', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Pending', practices: [practice] });
    await Enrollment.updateOne({ _id: patient.enrollments[0]._id }, { $set: { status: ENROLLMENT_STATUS.PENDING } });

    assert.equal(await autoAssignDietician(patient.user._id, practice._id), null);
    assert.equal((await enrolmentOf(patient)).dietician ?? null, null);
  });

  test('and a decision the doctor made is never overwritten — a dietician, or nobody', async () => {
    const chosen = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const placed = await makePatient({ name: 'Placed', practices: [practice] });
    const declined = await makePatient({ name: 'Declined', practices: [practice] });
    const other = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    await chooseDietician({ enrollmentId: placed.enrollments[0]._id, dieticianId: other.user._id, by: doctor.user._id });
    await chooseDietician({ enrollmentId: declined.enrollments[0]._id, dieticianId: null, by: doctor.user._id });
    // Bose leaves, which leaves Roy the only one.
    await Membership.updateOne({ _id: other.membership._id }, { $set: { status: MEMBERSHIP_STATUS.SUSPENDED, endedOn: new Date() } });

    assert.equal(await autoAssignDietician(placed.user._id, practice._id), null);
    assert.equal(await autoAssignDietician(declined.user._id, practice._id), null);
    assert.equal(String((await enrolmentOf(placed)).dietician), String(other.user._id), 'the patient was moved to Roy');
    assert.equal((await enrolmentOf(declined)).dietician ?? null, null);
    assert.notEqual(String((await enrolmentOf(placed)).dietician), String(chosen.user._id));
  });

  test('the first dietician takes on the undecided — and only the undecided, at their own practice', async () => {
    const other = await makePractice('Behala', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const waiting = await makePatient({ name: 'Waiting', practices: [practice, other] });
    const declined = await makePatient({ name: 'Declined', practices: [practice] });
    await chooseDietician({ enrollmentId: declined.enrollments[0]._id, dieticianId: null, by: doctor.user._id });

    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const out = await assignUndecidedToOnlyDietician(practice._id);
    assert.equal(out.assigned, 1);

    assert.equal(String((await enrolmentOf(waiting)).dietician), String(dietician.user._id));
    assert.equal((await enrolmentOf(waiting, other)).dietician ?? null, null, 'another practice’s enrolment was assigned');
    assert.equal((await enrolmentOf(declined)).dietician ?? null, null, 'the doctor’s “nobody” was overridden');

    // A second one arriving changes nobody's assignment.
    await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const late = await makePatient({ name: 'Late', practices: [practice] });
    assert.equal((await assignUndecidedToOnlyDietician(practice._id)).assigned, 0);
    assert.equal((await enrolmentOf(late)).dietician ?? null, null);
    assert.equal(String((await enrolmentOf(waiting)).dietician), String(dietician.user._id));
  });
});

describe('the doctor’s choice, with its history', () => {
  let roy;
  let bose;
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
    roy = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    bose = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
  });

  test('each change keeps what stood before, with who ended it', async () => {
    const patient = await makePatient({ name: 'Moved Around', practices: [practice] });
    const id = patient.enrollments[0]._id;

    assert.deepEqual(await chooseDietician({ enrollmentId: id, dieticianId: roy.user._id, by: doctor.user._id }), {
      changed: true,
      dietician: roy.user._id,
    });
    await chooseDietician({ enrollmentId: id, dieticianId: bose.user._id, by: doctor.user._id });
    await chooseDietician({ enrollmentId: id, dieticianId: null, by: doctor.user._id });

    const enrolment = await enrolmentOf(patient);
    assert.equal(enrolment.dietician, null);
    assert.equal(enrolment.dieticianSource, DIETICIAN_SOURCE.DOCTOR);
    assert.deepEqual(
      enrolment.dieticianHistory.map((h) => String(h.dietician)),
      [String(roy.user._id), String(bose.user._id)],
    );
    for (const period of enrolment.dieticianHistory) {
      assert.equal(String(period.endedBy), String(doctor.user._id));
      assert.ok(period.endedAt);
    }
  });

  test('choosing who already holds the patient is not a change', async () => {
    const patient = await makePatient({ name: 'Same Again', practices: [practice] });
    const id = patient.enrollments[0]._id;
    await chooseDietician({ enrollmentId: id, dieticianId: roy.user._id, by: doctor.user._id });

    const again = await chooseDietician({ enrollmentId: id, dieticianId: roy.user._id, by: doctor.user._id });
    assert.equal(again.changed, false);
    assert.equal((await enrolmentOf(patient)).dieticianHistory.length, 0);
  });

  test('two identical choices at once: one assignment, no duplicate history', async () => {
    // No index is the guard here — the write is conditional on the state it
    // read — so none is built first.
    const patient = await makePatient({ name: 'Raced', practices: [practice] });
    const url = `/doctor/patients/${patient.user._id}/dietician`;
    const body = { dieticianId: String(roy.user._id) };

    const results = await Promise.all([1, 2, 3].map(() => as(doctor.token).patch(url, body)));
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200]);

    const enrolment = await enrolmentOf(patient);
    assert.equal(String(enrolment.dietician), String(roy.user._id));
    assert.equal(enrolment.dieticianHistory.length, 0, 'a repeat of the same choice was recorded as a change');
  });

  test('two different choices at once: nothing is lost, and nothing is overwritten unseen', async () => {
    // The strict version, with each screen saying what it showed, is in
    // c7ConcurrentChanges.test.js. This is the service's own guarantee.
    const patient = await makePatient({ name: 'Contested', practices: [practice] });
    const id = patient.enrollments[0]._id;

    const outcomes = await Promise.allSettled([
      chooseDietician({ enrollmentId: id, dieticianId: roy.user._id, by: doctor.user._id }),
      chooseDietician({ enrollmentId: id, dieticianId: bose.user._id, by: doctor.user._id }),
    ]);

    const enrolment = await enrolmentOf(patient);
    const recorded = [enrolment.dietician, ...enrolment.dieticianHistory.map((h) => h.dietician)].map(String);
    outcomes.forEach((outcome, i) => {
      const wanted = String([roy, bose][i].user._id);
      if (outcome.status === 'fulfilled') {
        assert.ok(recorded.includes(wanted), 'a choice reported as made is not on the record');
      } else {
        assert.equal(outcome.reason?.code, 'DIETICIAN_CHANGED', String(outcome.reason));
        assert.ok(!recorded.includes(wanted), 'a refused choice was written');
      }
    });
    assert.ok(outcomes.some((o) => o.status === 'fulfilled'));
  });

  test('the response keeps the shape older builds read, and adds the whole picture', async () => {
    const patient = await makePatient({ name: 'Old App', practices: [practice] });
    const res = await as(doctor.token).patch(`/doctor/patients/${patient.user._id}/dietician`, {
      dieticianId: String(roy.user._id),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.assignedDietician, { id: String(roy.user._id), name: 'Ms Roy', phone: roy.user.phone });
    assert.equal(res.body.reviewIntervalDays, null);
    assert.equal(res.body.nutritionCare.dietician.active, true);
    assert.equal(res.body.nutritionCare.decided, true);
    assert.equal(res.body.nutritionCare.activeDieticians, 2);
  });
});

describe('the backfill: profile assignments onto enrolments, then the default', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  /** The single field, as the old routes wrote it. */
  const legacy = (patient, dieticianId) =>
    PatientProfile.create({ user: patient.user._id, ...(dieticianId ? { assignedDietician: dieticianId } : {}) });

  test('each profile assignment lands on the enrolment at the dietician’s practice', async () => {
    const behala = await makePractice('Behala', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const roy = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    await makeMember(behala, { name: 'Behala Dietician', role: ROLES.DIETICIAN });
    const shared = await makePatient({ name: 'Shared', practices: [practice, behala] });
    await legacy(shared, roy.user._id);

    const plan = await planDieticianAssignments();
    assert.equal(plan.carry.length, 1);
    assert.equal(String(plan.carry[0].practice), String(practice._id));

    const written = await applyDieticianAssignments(plan);
    assert.equal(written.carried, 1);

    const here = await enrolmentOf(shared);
    assert.equal(String(here.dietician), String(roy.user._id));
    assert.equal(here.dieticianSource, DIETICIAN_SOURCE.MIGRATION);
    assert.equal(here.dieticianSince, null, 'an unknown date was written as today');
    // Behala has one dietician, and the patient had nobody there: the default.
    assert.equal((await enrolmentOf(shared, behala)).dieticianSource, DIETICIAN_SOURCE.AUTO);
  });

  test('an assignment that names a dietician who left is carried — it is history', async () => {
    const gone = await makeMember(practice, { name: 'Ms Gone', role: ROLES.DIETICIAN });
    await Membership.updateOne({ _id: gone.membership._id }, { $set: { status: MEMBERSHIP_STATUS.SUSPENDED, endedOn: new Date() } });
    const patient = await makePatient({ name: 'Old Patient', practices: [practice] });
    await legacy(patient, gone.user._id);

    await applyDieticianAssignments(await planDieticianAssignments());
    assert.equal(String((await enrolmentOf(patient)).dietician), String(gone.user._id));
  });

  test('one naming somebody who never worked where the patient is, or at two of their practices, is reported and not written', async () => {
    const behala = await makePractice('Behala', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const outsider = await makeMember(behala, { name: 'Behala Dietician', role: ROLES.DIETICIAN });
    const stray = await makePatient({ name: 'Salt Lake Only', practices: [practice] });
    await legacy(stray, outsider.user._id);

    const both = await makeMember(practice, { name: 'Ms Both', role: ROLES.DIETICIAN });
    await Membership.create({ user: both.user._id, practice: behala._id, role: ROLES.DIETICIAN });
    const shared = await makePatient({ name: 'Shared', practices: [practice, behala] });
    await legacy(shared, both.user._id);

    const plan = await planDieticianAssignments();
    assert.equal(plan.unattributable.length, 1);
    assert.equal(plan.contested.length, 1);
    assert.equal(plan.carry.length, 0);

    await applyDieticianAssignments(plan);

    // Neither was carried. What they have now is only the default, where the
    // practice has exactly one dietician: Ms Both at Salt Lake. Behala has two,
    // so the shared patient waits for the doctor there.
    const strayHere = await enrolmentOf(stray);
    assert.notEqual(String(strayHere.dietician), String(outsider.user._id), 'another practice’s dietician was carried in');
    assert.equal(strayHere.dieticianSource, DIETICIAN_SOURCE.AUTO);
    assert.equal((await enrolmentOf(shared)).dieticianSource, DIETICIAN_SOURCE.AUTO);
    assert.equal((await enrolmentOf(shared, behala)).dieticianSource ?? null, null);
  });

  test('a practice with one dietician: the patients nobody decided for are theirs', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const one = await makePatient({ name: 'One', practices: [practice] });
    const two = await makePatient({ name: 'Two', practices: [practice] });
    await legacy(one);
    await legacy(two);

    const plan = await planDieticianAssignments();
    assert.equal(plan.assign.length, 1);
    assert.equal(plan.assign[0].enrollments.length, 2);

    assert.deepEqual(await applyDieticianAssignments(plan), { carried: 0, assigned: 2 });
    for (const p of [one, two]) {
      assert.equal(String((await enrolmentOf(p)).dietician), String(dietician.user._id));
    }
  });

  test('a practice with two dieticians is reported and left alone', async () => {
    await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Nobody’s yet', practices: [practice] });
    await legacy(patient);

    const plan = await planDieticianAssignments();
    assert.equal(plan.assign.length, 0);
    assert.equal(plan.ambiguous.length, 1);
    assert.equal(plan.ambiguous[0].patients, 1);

    await applyDieticianAssignments(plan);
    assert.equal((await enrolmentOf(patient)).dietician ?? null, null);
  });

  test('a decision made between the report and the apply is kept', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Decided Meanwhile', practices: [practice] });
    await legacy(patient, dietician.user._id);

    const plan = await planDieticianAssignments();
    await chooseDietician({ enrollmentId: patient.enrollments[0]._id, dieticianId: null, by: doctor.user._id });

    assert.deepEqual(await applyDieticianAssignments(plan), { carried: 0, assigned: 0 });
    assert.equal((await enrolmentOf(patient)).dietician, null, 'the doctor’s unassignment was overwritten');
  });

  test('running it twice changes nothing the second time', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const one = await makePatient({ name: 'One', practices: [practice] });
    const two = await makePatient({ name: 'Two', practices: [practice] });
    await legacy(one, dietician.user._id);
    await legacy(two);

    assert.deepEqual(await applyDieticianAssignments(await planDieticianAssignments()), { carried: 1, assigned: 1 });

    const second = await planDieticianAssignments();
    assert.equal(second.carry.length, 0);
    assert.equal(second.assign.length, 0);
    assert.deepEqual(await applyDieticianAssignments(second), { carried: 0, assigned: 0 });
  });
});
