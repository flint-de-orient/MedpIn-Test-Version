import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Enrollment, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { User, ROLES } from '../src/models/User.js';
import { dieticianRecipientsFor } from '../src/services/notifications.js';

/**
 * Who gets woken up when a patient writes to the nutrition thread.
 *
 * ---- What this replaced ------------------------------------------------------
 *
 * A routing rule over "the dieticians covering the clinic at large": with an
 * assigned dietician, them; otherwise every dietician without a list of their
 * own, narrowed to whoever last replied. That pool came from the days an
 * unassigned patient was on every dietician's list. The caseload has been the
 * assignments since, so the pool was being pushed a patient's name and first
 * words about somebody none of them could open — and the assigned dietician
 * was read off the profile, so a patient two practices care for woke whichever
 * practice's dietician had been assigned last.
 *
 * ---- The rule now --------------------------------------------------------
 *
 * The dietician assigned on the enrolment at the practice the conversation is
 * with, while they still work there. Nobody else. An urgent message pages the
 * practice's doctors through the clinical alert the nutrition route raises.
 */

let saltLake;
let behala;

async function holds(patient, practice, dietician) {
  await Enrollment.updateOne(
    { patient: patient.patient._id, practice: practice._id },
    { $set: { dietician: dietician.user._id, dieticianSource: DIETICIAN_SOURCE.DOCTOR } },
  );
}

const ids = (people) => people.map((p) => String(p._id)).sort();

describe('routing a patient’s nutrition message', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    saltLake = await makePractice('Salt Lake');
    behala = await makePractice('Behala');
  });

  test('the dietician holding the patient here, and not their colleague', async () => {
    const roy = await makeMember(saltLake, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(saltLake, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Rina', practices: [saltLake] });
    await holds(patient, saltLake, roy);

    const woken = await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: saltLake._id });
    assert.deepEqual(ids(woken), [String(roy.user._id)]);
  });

  test('nobody assigned is nobody — not every dietician at the practice', async () => {
    await makeMember(saltLake, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    await makeMember(saltLake, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Unassigned', practices: [saltLake] });

    assert.deepEqual(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: saltLake._id }), []);
  });

  test('a patient two practices care for wakes the dietician of the practice they wrote to', async () => {
    const roy = await makeMember(saltLake, { name: 'Salt Lake Dietician', role: ROLES.DIETICIAN });
    const das = await makeMember(behala, { name: 'Behala Dietician', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Shared', practices: [saltLake, behala] });
    await holds(patient, saltLake, roy);
    await holds(patient, behala, das);

    assert.deepEqual(
      ids(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: behala._id })),
      [String(das.user._id)],
    );
    // Asked without a practice, each practice answers for its own.
    assert.deepEqual(
      ids(await dieticianRecipientsFor({ patientId: patient.user._id })),
      [String(roy.user._id), String(das.user._id)].sort(),
    );
  });

  test('a dietician who has stopped working here is not woken', async () => {
    const patient = await makePatient({ name: 'Rina', practices: [saltLake] });

    const suspended = await makeMember(saltLake, { name: 'Suspended', role: ROLES.DIETICIAN });
    await holds(patient, saltLake, suspended);
    await Membership.updateOne({ _id: suspended.membership._id }, { $set: { status: MEMBERSHIP_STATUS.SUSPENDED } });
    assert.deepEqual(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: saltLake._id }), []);

    const left = await makeMember(saltLake, { name: 'Left', role: ROLES.DIETICIAN });
    await holds(patient, saltLake, left);
    await Membership.updateOne({ _id: left.membership._id }, { $set: { endedOn: new Date() } });
    assert.deepEqual(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: saltLake._id }), []);

    const switchedOff = await makeMember(saltLake, { name: 'Switched Off', role: ROLES.DIETICIAN });
    await holds(patient, saltLake, switchedOff);
    await User.updateOne({ _id: switchedOff.user._id }, { $set: { isActive: false } });
    assert.deepEqual(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: saltLake._id }), []);
  });

  test('another practice’s dietician named on this practice’s enrolment is not woken', async () => {
    // A row nothing should write — and if something did, it grants nothing.
    const outsider = await makeMember(behala, { name: 'Behala Dietician', role: ROLES.DIETICIAN });
    const patient = await makePatient({ name: 'Salt Lake Only', practices: [saltLake] });
    await holds(patient, saltLake, outsider);

    assert.deepEqual(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: saltLake._id }), []);
  });

  test('a patient enrolled nowhere wakes nobody', async () => {
    await makeMember(saltLake, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    const nobody = await makePatient({ name: 'Signed Up' });
    assert.deepEqual(await dieticianRecipientsFor({ patientId: nobody.user._id }), []);
  });
});
