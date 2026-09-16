import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { autoAssignDietician } from '../src/services/dieticianAssignment.js';
import {
  planDieticianAssignments,
  applyDieticianAssignments,
} from '../scripts/backfillDieticianAssignments.js';

/**
 * Who looks after this patient's nutrition, and who may therefore read them.
 *
 * The caseload was "everyone at the practice, unless somebody has been
 * assigned to me". Assignment as a restriction rather than a grant — a fair
 * reading of a clinic with one dietician and hundreds of patients, and a
 * default that widens access everywhere else. A second dietician, a locum, or
 * somebody who has finished with a patient all inherited the practice.
 *
 * The default now lives where it can be recorded: a practice with exactly one
 * dietician assigns them as each patient joins. The caseload is what the
 * assignments say, and nothing else.
 */

let practice;
let dietician;
let doctor;

describe('a dietician sees the patients they were given', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake');
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
  });

  test('and not the ones they were not', async () => {
    const mine = await makePatient({ name: 'Assigned', practices: [practice] });
    const theirs = await makePatient({ name: 'Unassigned', practices: [practice] });
    await PatientProfile.create({ user: mine.user._id, assignedDietician: dietician.user._id });
    await PatientProfile.create({ user: theirs.user._id });

    const res = await as(dietician.token).get('/dietician/patients');
    assert.equal(res.status, 200);

    const names = (res.body.items ?? res.body.patients ?? []).map((p) => p.name);
    assert.ok(names.includes('Assigned'), 'their own patient is missing');
    assert.ok(
      !names.includes('Unassigned'),
      'a patient nobody assigned them was in the caseload',
    );
  });

  test('a dietician with nobody assigned has an empty list, not the whole practice', async () => {
    /*
     * The old default. It read as "the clinic's dietician covers everyone",
     * and it applied equally to a locum hired for a fortnight.
     */
    const someone = await makePatient({ name: 'Somebody', practices: [practice] });
    await PatientProfile.create({ user: someone.user._id });

    const res = await as(dietician.token).get('/dietician/patients');
    assert.equal(res.status, 200);
    assert.equal((res.body.items ?? res.body.patients ?? []).length, 0);
  });
});

describe('a practice with one dietician assigns them automatically', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake');
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  });

  test('when there is exactly one, the patient gets them', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'New', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id });

    const assigned = await autoAssignDietician(patient.user._id, practice._id);
    assert.equal(String(assigned), String(dietician.user._id));

    const profile = await PatientProfile.findOne({ user: patient.user._id }).lean();
    assert.equal(String(profile.assignedDietician), String(dietician.user._id));
  });

  test('when there are two, nobody is chosen for the doctor', async () => {
    // Picking one is a clinical allocation, and the first row the database
    // returns is not an answer to it.
    await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });

    const patient = await makePatient({ name: 'New', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id });

    assert.equal(await autoAssignDietician(patient.user._id, practice._id), null);
    const profile = await PatientProfile.findOne({ user: patient.user._id }).lean();
    assert.equal(profile.assignedDietician ?? null, null);
  });

  test('and an assignment the doctor made is never overwritten', async () => {
    const chosen = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Placed', practices: [practice] });
    await PatientProfile.create({
      user: patient.user._id,
      assignedDietician: doctor.user._id, // whoever the doctor put there
    });

    assert.equal(await autoAssignDietician(patient.user._id, practice._id), null);
    const profile = await PatientProfile.findOne({ user: patient.user._id }).lean();
    assert.notEqual(String(profile.assignedDietician), String(chosen.user._id));
  });
});

describe('the patients who already had a dietician by default', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake');
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  });

  test('are written down, so the dietician does not lose them', async () => {
    /*
     * Without this the dietician at a practice that never assigned anybody
     * opens the app to an empty list on the morning this deploys: the same
     * people, the same work, and no way to see any of it.
     */
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const one = await makePatient({ name: 'One', practices: [practice] });
    const two = await makePatient({ name: 'Two', practices: [practice] });
    await PatientProfile.create({ user: one.user._id });
    await PatientProfile.create({ user: two.user._id });

    const plan = await planDieticianAssignments();
    assert.equal(plan.assign.length, 1);
    assert.equal(plan.assign[0].patients.length, 2);

    assert.equal(await applyDieticianAssignments(plan), 2);
    for (const p of [one, two]) {
      const profile = await PatientProfile.findOne({ user: p.user._id }).lean();
      assert.equal(String(profile.assignedDietician), String(dietician.user._id));
    }
  });

  test('a practice with two dieticians is reported and left alone', async () => {
    // The old default gave both of them everybody, so there is no arrangement
    // here to write down faithfully.
    await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Nobody’s yet', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id });

    const plan = await planDieticianAssignments();
    assert.equal(plan.assign.length, 0);
    assert.equal(plan.ambiguous.length, 1);

    await applyDieticianAssignments(plan);
    const profile = await PatientProfile.findOne({ user: patient.user._id }).lean();
    assert.equal(profile.assignedDietician ?? null, null);
  });

  test('running it twice changes nothing the second time', async () => {
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const one = await makePatient({ name: 'One', practices: [practice] });
    await PatientProfile.create({ user: one.user._id });

    await applyDieticianAssignments(await planDieticianAssignments());

    const second = await planDieticianAssignments();
    assert.equal(second.assign.length, 0);
    assert.equal(await applyDieticianAssignments(second), 0);
  });
});
