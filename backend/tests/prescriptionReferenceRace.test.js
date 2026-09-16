import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Prescription } from '../src/models/Prescription.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Two doctors pressing "Issue" in the same second.
 *
 * ---- What went wrong ----------------------------------------------------
 *
 * The reference printed on a prescription was
 *
 *     countDocuments({ referenceNo: /^AKD-2026-/ }) + 1
 *
 * (with the founding doctor's initials as its prefix, since replaced)
 *
 * against a field with a unique index. Two requests in the same instant both
 * count 411 and both write 000412. The second is refused by the index, the
 * error handler turns the duplicate key into 409 "An account with that
 * referenceNo already exists", and a doctor who has just finished a
 * consultation is told their prescription is an account that already exists.
 * The prescription is not written. Nothing retries.
 *
 * A reference is now drawn from an atomic counter: one document per year,
 * incremented in a single operation the database will not interleave.
 */

let practice;
let doctors;
let patients;

const item = (n) => ({ name: 'Metformin', strength: `${500 + n}mg`, frequency: '1-0-1' });

describe('prescriptions issued at the same moment', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    // The unique index is what turns a race into a refusal. Built explicitly,
    // because Mongoose builds indexes once per process and this suite may not
    // be the first to connect.
    await Prescription.createIndexes();

    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctors = [];
    patients = [];
    for (let i = 0; i < 4; i += 1) {
      const doctor = await makeMember(practice, { name: `Dr ${i}`, isOwner: i === 0 });
      const patient = await makePatient({ name: `Patient ${i}`, practices: [practice] });
      await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
      doctors.push(doctor);
      patients.push(patient);
    }
  });

  test('all of them are written, each with its own reference', async () => {
    const issued = await Promise.all(
      Array.from({ length: 8 }, (_, n) =>
        as(doctors[n % 4].token).post(`/patients/${patients[n % 4].user._id}/prescriptions`, {
          items: [item(n)],
          syncToMedications: false,
        }),
      ),
    );

    const statuses = issued.map((r) => r.status);
    assert.deepEqual(
      statuses,
      Array(8).fill(201),
      `a prescription issued in the same second was lost: ${statuses.join(', ')}`,
    );

    const references = issued.map((r) => r.body.prescription.referenceNo);
    assert.equal(new Set(references).size, 8, `references collided: ${references.join(', ')}`);
    assert.equal(await Prescription.countDocuments({}), 8);
  });

  test('numbering carries on from the prescriptions already issued', async () => {
    /*
     * The counter is new and the references are not. Starting it at one would
     * collide with the first prescription this clinic ever wrote — so it starts
     * from the highest reference already printed this year with the same
     * prefix. (The prefix itself stopped being the founding doctor's initials;
     * see prescriptionReferencePrefix.test.js.)
     */
    const year = dayjs().year();
    await Prescription.create({
      patient: patients[0].user._id,
      doctor: doctors[0].user._id,
      referenceNo: `RX-${year}-000412`,
      issuedOn: new Date(),
      items: [item(0)],
    });

    const res = await as(doctors[0].token).post(`/patients/${patients[0].user._id}/prescriptions`, {
      items: [item(1)],
      syncToMedications: false,
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.prescription.referenceNo, `RX-${year}-000413`);
  });
});
