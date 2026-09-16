import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * A reading taken in the clinic is a reading.
 *
 * A patient logging their own blood pressure had it banded — normal, stage 1,
 * stage 2, crisis — and their risk recomputed. The same numbers measured by the
 * doctor during a consultation, or by the desk at registration, were stored with
 * no band at all and changed nothing. So 190/120 recorded in the consulting room
 * was invisible to anything that asks "whose blood pressure is out of control",
 * and a patient's risk — which orders the waiting list — ignored every reading
 * the clinic itself took.
 *
 * Whether a reading taken in clinic should also raise an alert is a separate,
 * clinical decision and is deliberately not made here.
 */

let practice;
let doctor;
let desk;
let patient;

describe('readings taken in the clinic are banded like any other', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  });

  test('a crisis blood pressure recorded in a consultation is stored as a crisis', async () => {
    const res = await as(doctor.token).post(`/doctor/patients/${patient.user._id}/vitals`, {
      systolic: 190,
      diastolic: 120,
    });
    assert.equal(res.status, 201);

    const record = await VitalRecord.findOne({ patient: patient.user._id }).lean();
    assert.equal(record.flag, 'hypertensive_crisis', 'the consulting room’s own reading carried no band');
  });

  test('and a sugar taken there is banded against the patient’s own targets', async () => {
    await as(doctor.token).post(`/doctor/patients/${patient.user._id}/vitals`, { glucoseMgDl: 420 });

    const reading = await GlucoseReading.findOne({ patient: patient.user._id }).lean();
    assert.ok(reading.flag, 'a clinic sugar of 420 carried no band');
    assert.notEqual(reading.flag, 'in_range');
  });

  test('the patient’s risk is recomputed from what the clinic measured', async () => {
    await as(doctor.token).post(`/doctor/patients/${patient.user._id}/vitals`, {
      systolic: 190,
      diastolic: 120,
    });

    // Recomputed in the background, as the self-logged path does.
    let profile;
    for (let i = 0; i < 20; i += 1) {
      profile = await PatientProfile.findOne({ user: patient.user._id }).lean();
      if (profile.lastRiskComputedAt) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(profile.lastRiskComputedAt, 'the risk that orders the waiting list ignored the clinic’s reading');
  });

  test('intake readings the desk takes at registration are banded too', async () => {
    const res = await as(desk.token).post('/doctor/patients', {
      name: 'Mira Das',
      phone: '+919812345601',
      systolic: 150,
      diastolic: 96,
      glucoseMgDl: 260,
    });
    assert.ok([200, 201].includes(res.status), `registration answered ${res.status}`);

    const id = res.body.id ?? res.body.patient?.id ?? res.body.user?.id;
    assert.ok(id, `registration answered without an id: ${JSON.stringify(res.body)}`);
    const vitals = await VitalRecord.findOne({ patient: id }).lean();
    const sugar = await GlucoseReading.findOne({ patient: id }).lean();
    assert.equal(vitals?.flag, 'stage2', 'the intake blood pressure carried no band');
    assert.ok(sugar?.flag, 'the intake sugar carried no band');
  });
});
