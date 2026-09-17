import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { pdfText } from './helpers/pdfText.js';
import { Clinic } from '../src/models/Clinic.js';
import { Prescription } from '../src/models/Prescription.js';
import { User, ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { forgetClinicIdentity } from '../src/services/clinicIdentity.js';

/**
 * Whose name a document and a screen carry, asked over HTTP.
 *
 * ---- The defect -----------------------------------------------------------
 *
 * Identity had a founding fallback at three depths. `CLINIC_NAME` and
 * `DOCTOR_DISPLAY_NAME` defaulted to Dr. Amit Kumar Dey's clinic and name; the
 * resolver answered "the platform's first clinic" when it was not told whose
 * patient this was; and the patient-facing text written into the routes named
 * him outright. A second practice's documents and a patient of no practice
 * each met one of those.
 *
 * The service tests pin the resolver's order. These pin what leaves the
 * server: the prescription PDF a second practice's patient downloads, the
 * contact card, the dashboard's advice, and a prescription nobody can place.
 */

const FOUNDING_NAMES = /Amit|Dey\b|Dey's|AKD/;

let founding;
let second;
let secondDoctor;
let secondPatient;

async function pdf(token, path) {
  const res = await fetch(`${await boot()}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200, `${path} answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

describe('a second practice is never introduced as the founding one', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    forgetClinicIdentity();

    // Created first, so it is "the first clinic on the platform" to anything
    // that still asks that question.
    founding = await makePractice('Dey Diabetes Care', {
      doctorDisplayName: 'Dr. Amit Kumar Dey',
      registrationNo: 'WBMC-12345',
      isFounding: true,
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    await Clinic.create({ name: "Dr. Dey's Diabetes Clinic", practice: founding._id, phone: '+913340001111' });
    await makeMember(founding, { name: 'Dr. Amit Kumar Dey', isOwner: true });

    second = await makePractice('Lake Town Heart Centre', {
      registrationNo: 'WBMC-67890',
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    await Clinic.create({ name: 'Lake Town', practice: second._id, phone: '+913324001234' });
    secondDoctor = await makeMember(second, { name: 'Dr. Meera Iyer', isOwner: true });
    secondPatient = await makePatient({ name: 'Rahul Das', practices: [second] });
  });

  test('its prescription PDF carries its own name and nobody else’s', async () => {
    const issued = await as(secondDoctor.token).post(`/patients/${secondPatient.user._id}/prescriptions`, {
      complaint: 'Breathless on stairs',
      items: [{ name: 'Atorvastatin', strength: '20 mg', frequency: 'HS' }],
      syncToMedications: false,
    });
    assert.equal(issued.status, 201);

    const text = pdfText(
      await pdf(secondPatient.token, `/patients/me/prescriptions/${issued.body.prescription.id}/pdf`),
    );
    assert.match(text, /Lake Town Heart Centre/);
    assert.match(text, /Dr\. Meera Iyer/);
    // The reference line included: it carried the founding doctor's initials
    // on every practice's prescriptions. See prescriptionReferencePrefix.test.js.
    assert.ok(!FOUNDING_NAMES.test(text), `the second practice's prescription names the founding clinic:\n${text}`);

    // And the letterhead stamped on first render is its own, so the next copy is too.
    const stamped = await Prescription.findById(issued.body.prescription.id).lean();
    assert.equal(stamped.letterhead.clinicName, 'Lake Town Heart Centre');
  });

  test('its patient’s contact card names their practice', async () => {
    const res = await as(secondPatient.token).get('/auth/me/contact');
    assert.equal(res.status, 200);
    assert.equal(res.body.practice.name, 'Lake Town Heart Centre');
    assert.ok(!FOUNDING_NAMES.test(allText(res.body)));
  });

  test('the dashboard’s advice names nobody’s doctor', async () => {
    // A patient with no readings is told to log one, and that sentence named
    // the founding doctor to every patient on the platform.
    const res = await as(secondPatient.token).get('/patients/me/dashboard');
    assert.equal(res.status, 200);
    const advice = allText(res.body.recommendations);
    assert.match(advice, /your doctor/);
    assert.ok(!FOUNDING_NAMES.test(advice), advice);
  });
});

describe('a context with no practice is neutral', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    forgetClinicIdentity();
    founding = await makePractice('Dey Diabetes Care', {
      doctorDisplayName: 'Dr. Amit Kumar Dey',
      isFounding: true,
    });
    await Clinic.create({ name: "Dr. Dey's Diabetes Clinic", practice: founding._id, phone: '+913340001111' });
  });

  test('a patient enrolled nowhere has no practice and no number', async () => {
    const stranger = await makePatient({ name: 'Nobody Yet' });
    const res = await as(stranger.token).get('/auth/me/contact');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { practice: null, phone: null });
  });

  test('a prescription nobody can place is headed by its doctor, not the first clinic', async () => {
    /*
     * A row from before prescriptions recorded their practice, written by a
     * doctor who has since left every practice, for a patient enrolled nowhere.
     * The resolver answered "the first active location" for exactly this, and
     * the PDF stamped it permanently.
     */
    const stranger = await makePatient({ name: 'Nobody Yet' });
    const departed = await User.create({
      name: 'Dr. Rina Sen',
      phone: '+918800000077',
      role: ROLES.DOCTOR,
      isActive: true,
    });
    const rx = await Prescription.create({
      patient: stranger.user._id,
      doctor: departed._id,
      referenceNo: 'RX-2025-000001',
      issuedOn: new Date(),
      items: [{ name: 'Metformin', strength: '500 mg', frequency: 'BD' }],
    });

    const text = pdfText(await pdf(stranger.token, `/patients/me/prescriptions/${rx._id}/pdf`));
    assert.ok(!FOUNDING_NAMES.test(text), `an unplaced prescription was lettered as the founding clinic:\n${text}`);
    assert.match(text, /Dr\. Rina Sen/);

    // Nothing borrowed was stamped, so nothing borrowed is kept.
    const stamped = await Prescription.findById(rx._id).lean();
    assert.equal(stamped.letterhead?.clinicName ?? null, null);
  });
});
