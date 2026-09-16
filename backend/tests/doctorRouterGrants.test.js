import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Membership, PERMISSIONS } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * The doctor's panel, and who else could open it.
 *
 * ---- What the permission sweep missed ------------------------------------
 *
 * The sweep put VIEW_PATIENT and EDIT_RECORD on the six routers mounted under
 * `/patients/:patientId`. The doctor router is not one of them. It is guarded by
 * `requireClinician`, which admits every role in CLINICIAN_ROLES — the dietician
 * and the practice manager included — and nine of its reads return patients:
 * the register, a patient's summary, adherence, alerts, the worklist, the
 * overview, analytics, the lab overview and the notification bell.
 *
 * So a practice manager, whose preset says it "reads no clinical record", could
 * read all of them. And a dietician, whose caseload C1 had just narrowed to the
 * patients assigned to them, could open `/doctor/patients` and read the whole
 * practice's register instead.
 *
 * Its writes asked no permission either: vitals could be recorded, and a
 * patient registered, by somebody whose EDIT_RECORD had been revoked.
 */

let practice;
let doctor;
let desk;
let manager;
let dietician;
let patient;

const PATIENT_READS = [
  '/doctor/patients',
  () => `/doctor/patients/${patient.user._id}/summary`,
  () => `/doctor/patients/${patient.user._id}/adherence`,
  '/doctor/alerts',
  '/doctor/worklist',
  '/doctor/notifications',
];

describe('the doctor’s panel reads patients for the people allowed to', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    desk = await makeMember(practice, { name: 'Front Desk', role: ROLES.STAFF });
    manager = await makeMember(practice, { name: 'Practice Manager', role: ROLES.PRACTICE_MANAGER });
    dietician = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
    await PatientProfile.create({ user: patient.user._id, assignedDoctor: doctor.user._id });
  });

  for (const read of PATIENT_READS) {
    const label = typeof read === 'function' ? read.toString().match(/`(.*)`/)[1] : read;

    test(`the practice manager cannot open ${label}`, async () => {
      // "Administers the practice and reads no clinical record" — the preset's
      // own words, and the only one without VIEW_PATIENT.
      const path = typeof read === 'function' ? read() : read;
      const res = await as(manager.token).get(path);
      assert.equal(res.status, 403, `a practice manager read ${path}`);
      assert.ok(!JSON.stringify(res.body ?? '').includes('Rahul Bose'));
    });
  }

  test('a dietician cannot read the practice register through the doctor’s panel', async () => {
    /*
     * Their caseload is the patients assigned to them, and the dietician panel
     * enforces that. The doctor's register would have handed them everybody.
     */
    const res = await as(dietician.token).get('/doctor/patients');
    assert.equal(res.status, 403, 'a dietician read the whole practice register');
    assert.ok(!JSON.stringify(res.body ?? '').includes('Rahul Bose'));
  });

  test('the doctor and the desk still read all of it', async () => {
    for (const who of [doctor, desk]) {
      for (const read of PATIENT_READS) {
        const path = typeof read === 'function' ? read() : read;
        const res = await as(who.token).get(path);
        assert.equal(res.status, 200, `${who.name} was refused ${path}`);
      }
    }
  });

  test('without EDIT_RECORD, vitals cannot be recorded', async () => {
    await Membership.updateOne({ _id: desk.membership._id }, { $pull: { permissions: PERMISSIONS.EDIT_RECORD } });

    const res = await as(desk.token).post(`/doctor/patients/${patient.user._id}/vitals`, {
      systolic: 150,
      diastolic: 95,
    });

    assert.equal(res.status, 403, 'EDIT_RECORD was revoked and vitals were written');
    assert.equal(await VitalRecord.countDocuments({ patient: patient.user._id }), 0);
  });
});
