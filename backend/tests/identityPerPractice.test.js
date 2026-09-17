import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Clinic } from '../src/models/Clinic.js';
import { Prescription } from '../src/models/Prescription.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { User, ROLES } from '../src/models/User.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';
import { clinicIdentity, forgetClinicIdentity } from '../src/services/clinicIdentity.js';
import { Practice } from '../src/models/Practice.js';
import { env } from '../src/config/env.js';
import { buildSystemPrompt, fallbackReply } from '../src/services/ai/prompts.js';

/**
 * Whose name is on it.
 *
 * ---- The defect ----------------------------------------------------------
 *
 * `clinicIdentity()` with no argument answers with the first active location
 * on the platform, and caches that answer for a minute for everybody. Every
 * caller that decides what a patient reads called it that way: the assistant's
 * system prompt, the nutrition assistant, the foot and eye readers, lab
 * extraction — and the prescription letterhead, stamped at first render.
 *
 * With one practice the first location is the right one, which is why nothing
 * noticed. With two, the second practice's patients are told they are talking
 * to Dr Dey's clinic, and its prescriptions print his clinic's name and
 * registration number — on a legal document, permanently, because the
 * letterhead is snapshotted.
 *
 * `identityIsWired.test.js` pinned that the identity is *resolved*. Nothing
 * pinned *whose*.
 *
 * ---- Why no app boot -----------------------------------------------------
 *
 * These talk to the services directly against a throwaway database, so they
 * cannot reach — or be affected by — anything routed.
 */

let mongod;

before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri('medpin_identity_test'));
});

after(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

beforeEach(async () => {
  forgetClinicIdentity();
  await Promise.all(Object.values(mongoose.connection.collections).map((c) => c.deleteMany({})));
});

/** Created in order, so the first is "the first clinic on the platform". */
async function twoPractices() {
  const dey = await makePractice('Dey Diabetes Care', {
    doctorDisplayName: 'Dr. Amit Kumar Dey',
    registrationNo: 'WBMC-12345',
  });
  const deyClinic = await Clinic.create({ name: 'Salt Lake Clinic', practice: dey._id });

  const iyer = await makePractice('Lake Town Heart Centre', {
    doctorDisplayName: 'Dr. Meera Iyer',
    registrationNo: 'WBMC-67890',
  });
  const iyerClinic = await Clinic.create({ name: 'Lake Town Clinic', practice: iyer._id });

  return { dey, deyClinic, iyer, iyerClinic };
}

describe('a practice is named as itself', () => {
  test('not as the first clinic on the platform', async () => {
    const { iyer } = await twoPractices();
    const id = await clinicIdentity(null, { practiceId: iyer._id });

    // The practice's name, with its location beside it. See practiceIdentity
    // for why the practice comes first.
    assert.equal(id.clinicName, 'Lake Town Heart Centre');
    assert.equal(id.locationName, 'Lake Town Clinic');
    assert.equal(id.doctorName, 'Dr. Meera Iyer', 'another practice’s doctor named');
    assert.equal(id.registrationNo, 'WBMC-67890');
  });

  test('a practice with no printed doctor names its head doctor, never another practice’s', async () => {
    const { iyer } = await twoPractices();
    const head = await makeMember(iyer, { name: 'Dr. Kavya Rao', isOwner: true });
    await Practice.updateOne({ _id: iyer._id }, { $set: { doctorDisplayName: null, headDoctor: head.user._id } });

    const id = await clinicIdentity(null, { practiceId: iyer._id });
    assert.equal(id.doctorName, 'Dr. Kavya Rao');
  });

  test('and asking for one practice does not answer the next from the cache', async () => {
    const { dey, iyer } = await twoPractices();

    assert.equal((await clinicIdentity(null, { practiceId: dey._id })).doctorName, 'Dr. Amit Kumar Dey');
    assert.equal((await clinicIdentity(null, { practiceId: iyer._id })).doctorName, 'Dr. Meera Iyer');
    assert.equal((await clinicIdentity(null, { practiceId: dey._id })).doctorName, 'Dr. Amit Kumar Dey');
  });

  test('a practice with no location yet is still named as itself', async () => {
    await twoPractices();
    const fresh = await makePractice('Behala Evening Clinic', { doctorDisplayName: 'Dr. Rina Sen' });
    const id = await clinicIdentity(null, { practiceId: fresh._id });

    assert.equal(id.clinicName, 'Behala Evening Clinic');
    assert.equal(id.doctorName, 'Dr. Rina Sen');
  });

  test('a location asked for by id is that location, of that practice', async () => {
    const { iyerClinic } = await twoPractices();
    const id = await clinicIdentity(iyerClinic._id);
    assert.equal(id.locationName, 'Lake Town Clinic');
    assert.equal(id.clinicName, 'Lake Town Heart Centre');
  });

  test('with nothing to go on, it names nobody', async () => {
    // This answered with the first active location on the platform — "as it
    // always did" — and that was the founding clinic, for every caller that
    // did not say whose patient this was. No practice is the neutral identity.
    await twoPractices();
    const id = await clinicIdentity();
    assert.equal(id.neutral, true);
    assert.equal(id.clinicName, null, 'a caller with no practice was given the first clinic’s name');
    assert.equal(id.doctorName, null, 'a caller with no practice was given the founding doctor');
  });

  test('saving a practice’s profile forgets that practice’s cached name', async () => {
    const { iyer } = await twoPractices();
    assert.equal((await clinicIdentity(null, { practiceId: iyer._id })).clinicName, 'Lake Town Heart Centre');

    await Practice.updateOne({ _id: iyer._id }, { name: 'Lake Town Heart Clinic' });
    forgetClinicIdentity();

    assert.equal((await clinicIdentity(null, { practiceId: iyer._id })).clinicName, 'Lake Town Heart Clinic');
  });
});

describe('a prescription is lettered by the practice that issued it', () => {
  let n = 0;
  const rx = (overrides) => {
    n += 1;
    return Prescription.create({
      referenceNo: `RX-IDENTITY-${Date.now()}-${n}`,
      items: [{ name: 'Metformin 500 mg' }],
      ...overrides,
    });
  };

  /** Loaded per test, so a missing export fails the test that needs it. */
  async function resolver() {
    const pdf = await import('../src/services/prescriptionPdf.js');
    assert.equal(typeof pdf.letterheadIdentityFor, 'function', 'no letterhead resolver is exported');
    return pdf.letterheadIdentityFor;
  }

  test('its doctor’s practice, not the first on the platform', async () => {
    const { iyer } = await twoPractices();
    const doctor = await makeMember(iyer, { name: 'Dr. Meera Iyer', isOwner: true });
    const patient = await makePatient({ name: 'Lake Town Patient', practices: [iyer] });

    const letterheadIdentityFor = await resolver();
    const id = await letterheadIdentityFor(await rx({ patient: patient.user._id, doctor: doctor.user._id }));

    assert.equal(id.clinicName, 'Lake Town Heart Centre', 'a prescription was lettered with another practice’s name');
    assert.equal(id.registrationNo, 'WBMC-67890', 'a prescription carries another practice’s registration number');
  });

  test('the practice it records, before the doctor’s memberships', async () => {
    // A doctor at two practices has two memberships, and the first one the
    // database returns is not a decision about whose letterhead this is.
    const { dey, iyer } = await twoPractices();
    const doctor = await makeMember(dey, { name: 'Dr. Two Places', isOwner: true });
    await Membership.create({
      user: doctor.user._id,
      practice: iyer._id,
      role: ROLES.DOCTOR,
      permissions: presetFor({ role: ROLES.DOCTOR }),
      status: MEMBERSHIP_STATUS.ACTIVE,
    });
    const patient = await makePatient({ name: 'Two Place Patient', practices: [dey, iyer] });

    const letterheadIdentityFor = await resolver();
    const id = await letterheadIdentityFor(
      await rx({ patient: patient.user._id, doctor: doctor.user._id, practice: iyer._id }),
    );
    assert.equal(id.clinicName, 'Lake Town Heart Centre');
  });

  test('and one whose practice nobody can tell is lettered by nobody', async () => {
    await twoPractices();
    const departed = await User.create({ name: 'Dr. Gone', phone: '+918800000009', role: ROLES.DOCTOR, isActive: true });
    const stranger = await makePatient({ name: 'Nobody’s Patient' });

    const letterheadIdentityFor = await resolver();
    const id = await letterheadIdentityFor(await rx({ patient: stranger.user._id, doctor: departed._id }));
    assert.equal(id.clinicName, null, 'an unplaceable prescription was lettered with the first clinic');
    assert.equal(id.doctorName, null);
  });

  test('the patient’s practice when the doctor no longer belongs to one', async () => {
    const { iyer } = await twoPractices();
    const current = await makeMember(iyer, { name: 'Dr. Meera Iyer', isOwner: true });
    const departed = await User.create({ name: 'Dr. Gone', phone: '+918800000002', role: ROLES.DOCTOR, isActive: true });
    const patient = await makePatient({ name: 'Lake Town Patient', practices: [iyer] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: current.user._id });

    const letterheadIdentityFor = await resolver();
    const id = await letterheadIdentityFor(await rx({ patient: patient.user._id, doctor: departed._id }));

    assert.equal(id.clinicName, 'Lake Town Heart Centre');
  });

  test('and one already lettered keeps the letterhead it was issued under', async () => {
    const { iyer } = await twoPractices();
    const doctor = await makeMember(iyer, { name: 'Dr. Meera Iyer', isOwner: true });
    const patient = await makePatient({ name: 'Lake Town Patient', practices: [iyer] });
    const issued = await rx({
      patient: patient.user._id,
      doctor: doctor.user._id,
      letterhead: { clinicName: 'Lake Town Clinic (as it was)', registrationNo: 'WBMC-00001' },
    });

    const letterheadIdentityFor = await resolver();
    const id = await letterheadIdentityFor(issued);

    assert.equal(id.clinicName, 'Lake Town Clinic (as it was)');
    assert.equal(id.registrationNo, 'WBMC-00001');
  });
});

describe('the number a patient is told to ring is their own practice’s', () => {
  /*
   * The one reply where a wrong answer costs most. On an emergency or urgent
   * verdict the assistant tells the patient to ring the clinic, and that
   * number was `CLINIC_EMERGENCY_PHONE` — one value for the whole platform, and
   * it is Dr Dey's clinic. A second practice's patient with chest pain would be
   * given a stranger's switchboard.
   *
   * Now one rule for every practice, the founding one included: the practice's
   * own `emergencyPhone`, then the phone of its only location, then none. The
   * configured number is nobody's practice's, so nobody's patients are given
   * it: "go to the nearest hospital" on its own is the correct advice, which
   * clinicContact.js already says of a missing number.
   */
  const CONFIGURED = '+918981540690';
  let saved;
  before(() => {
    saved = env.CLINIC_EMERGENCY_PHONE;
    env.CLINIC_EMERGENCY_PHONE = CONFIGURED;
  });
  after(() => {
    env.CLINIC_EMERGENCY_PHONE = saved;
  });

  const prompt = (identity) =>
    buildSystemPrompt({
      language: 'en',
      triage: { urgency: 'emergency' },
      patientContext: '',
      groundingContext: '',
      careTeamNotes: '',
      identity,
    });

  test('another practice is given its own location’s number, not the configured one', async () => {
    const { iyer, iyerClinic } = await twoPractices();
    await Clinic.updateOne({ _id: iyerClinic._id }, { phone: '+913324001234' });
    const identity = await clinicIdentity(null, { practiceId: iyer._id });

    assert.equal(identity.emergencyPhone, '+913324001234');
    assert.ok(prompt(identity).includes('+913324001234'));
    assert.ok(!prompt(identity).includes(CONFIGURED), 'another practice’s patients are told to ring Dr Dey’s clinic');

    const reply = fallbackReply('emergency', 'en', identity);
    assert.ok(reply.includes('+913324001234'));
    assert.ok(!reply.includes(CONFIGURED));
  });

  test('a practice with no callable number is given none — never another practice’s', async () => {
    const { iyer } = await twoPractices();
    const identity = await clinicIdentity(null, { practiceId: iyer._id });
    assert.equal(identity.emergencyPhone, null);

    const reply = fallbackReply('emergency', 'en', identity);
    assert.ok(!reply.includes(CONFIGURED));
    assert.ok(!/call the clinic/.test(reply), 'a clause offering a number, with no number in it');
    assert.ok(/nearest hospital/.test(reply), 'the emergency advice itself went missing');
    assert.ok(!prompt(identity).includes(CONFIGURED));
  });

  test('a placeholder saved on a location is not a number', async () => {
    const { iyer, iyerClinic } = await twoPractices();
    await Clinic.updateOne({ _id: iyerClinic._id }, { phone: '+91-0000000000' });
    assert.equal((await clinicIdentity(null, { practiceId: iyer._id })).emergencyPhone, null);
  });

  test('the practice’s own number comes first, whatever its location says', async () => {
    const { iyer, iyerClinic } = await twoPractices();
    await Clinic.updateOne({ _id: iyerClinic._id }, { phone: '+913324001234' });
    await Practice.updateOne({ _id: iyer._id }, { emergencyPhone: '+913324009999' });

    const identity = await clinicIdentity(null, { practiceId: iyer._id });

    assert.equal(identity.emergencyPhone, '+913324009999');
    assert.ok(prompt(identity).includes('+913324009999'));
  });

  test('two locations and no number of its own is no number — never whichever sorts first', async () => {
    const { iyer, iyerClinic } = await twoPractices();
    await Clinic.updateOne({ _id: iyerClinic._id }, { phone: '+913324001234' });
    await Clinic.create({ name: 'Lake Town Annexe', practice: iyer._id, phone: '+913324005678' });

    assert.equal((await clinicIdentity(null, { practiceId: iyer._id })).emergencyPhone, null);
  });

  test('the founding practice follows the same rule — the configured number is not its own', async () => {
    const { dey } = await twoPractices();
    await Practice.updateOne({ _id: dey._id }, { isFounding: true });
    assert.equal(
      (await clinicIdentity(null, { practiceId: dey._id })).emergencyPhone,
      null,
      'the founding practice was handed the deployment’s configured number',
    );

    // Given it on purpose — which is what scripts/backfillEmergencyPhone.js does.
    await Practice.updateOne({ _id: dey._id }, { emergencyPhone: CONFIGURED });
    forgetClinicIdentity();
    assert.equal((await clinicIdentity(null, { practiceId: dey._id })).emergencyPhone, CONFIGURED);
  });

  test('with nothing to go on, no number', async () => {
    await twoPractices();
    assert.equal(
      (await clinicIdentity()).emergencyPhone,
      null,
      'a caller that named no practice was given the founding clinic’s number',
    );
  });
});
