import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Clinic } from '../src/models/Clinic.js';
import { Prescription } from '../src/models/Prescription.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { User, ROLES } from '../src/models/User.js';
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

    assert.equal(id.clinicName, 'Lake Town Clinic');
    assert.equal(id.doctorName, 'Dr. Meera Iyer', 'another practice’s doctor named');
    assert.equal(id.registrationNo, 'WBMC-67890');
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

  test('a location asked for by id is that location', async () => {
    const { iyerClinic } = await twoPractices();
    assert.equal((await clinicIdentity(iyerClinic._id)).clinicName, 'Lake Town Clinic');
  });

  test('with nothing to go on, it answers as it always did', async () => {
    // The single-practice deployment passes nothing anywhere this is not yet
    // known, and must be unchanged.
    await twoPractices();
    assert.equal((await clinicIdentity()).clinicName, 'Salt Lake Clinic');
  });

  test('saving a practice’s profile forgets that practice’s cached name', async () => {
    const { iyer, iyerClinic } = await twoPractices();
    assert.equal((await clinicIdentity(null, { practiceId: iyer._id })).clinicName, 'Lake Town Clinic');

    await Clinic.updateOne({ _id: iyerClinic._id }, { name: 'Lake Town Heart Clinic' });
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

    assert.equal(id.clinicName, 'Lake Town Clinic', 'a prescription was lettered with another practice’s name');
    assert.equal(id.registrationNo, 'WBMC-67890', 'a prescription carries another practice’s registration number');
  });

  test('the patient’s practice when the doctor no longer belongs to one', async () => {
    const { iyer } = await twoPractices();
    const current = await makeMember(iyer, { name: 'Dr. Meera Iyer', isOwner: true });
    const departed = await User.create({ name: 'Dr. Gone', phone: '+918800000002', role: ROLES.DOCTOR, isActive: true });
    const patient = await makePatient({ name: 'Lake Town Patient', practices: [iyer] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: current.user._id });

    const letterheadIdentityFor = await resolver();
    const id = await letterheadIdentityFor(await rx({ patient: patient.user._id, doctor: departed._id }));

    assert.equal(id.clinicName, 'Lake Town Clinic');
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
   * The configured number belongs to the founding practice and to a deployment
   * that does not know its practice yet. Any other practice is given its own
   * location's number or none: "go to the nearest hospital" on its own is the
   * correct advice, which clinicContact.js already says of a missing number.
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

  test('the founding practice keeps the configured number', async () => {
    const { dey } = await twoPractices();
    await Practice.updateOne({ _id: dey._id }, { isFounding: true });
    assert.equal((await clinicIdentity(null, { practiceId: dey._id })).emergencyPhone, CONFIGURED);
  });

  test('with nothing to go on, the configured number, as before', async () => {
    await twoPractices();
    assert.equal((await clinicIdentity()).emergencyPhone, CONFIGURED);
    // And a reply built with no identity still reads the configured number, at
    // the time it is built rather than when the module loaded.
    assert.ok(fallbackReply('emergency', 'en').includes(CONFIGURED));
  });
});
