import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { autoAssignDietician } from '../src/services/dieticianAssignment.js';
import { dieticianRecipientsFor } from '../src/services/notifications.js';
import { responsibleFor } from '../src/services/careResponsibility.js';
import { signPhoneToken } from '../src/services/otp.js';
import { signAccessToken } from '../src/services/tokens.js';

/**
 * §18: a dietician becomes inactive.
 *
 *   - the historical assignment is preserved, and visible as history
 *   - the patient is not silently transferred to anybody
 *   - the future work stops: caseload, pushes, the patient's screen, the
 *     "who answers for this patient" lists
 *
 * Each read below is the one a person actually makes — the dietician's own
 * list, the doctor's patient record and home, the patient's nutrition screen —
 * with the push recipients and the responsibility map asked directly, because
 * a push that was never sent has nothing to observe over HTTP.
 */

let seq = 0;
const freshPhone = () => `+9196${String(Date.now()).slice(-6)}${String((seq += 1)).padStart(2, '0')}`;

let practice;
let doctor;
let roy;

async function world() {
  practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  roy = await makeMember(practice, { name: 'Ms Roy', role: ROLES.DIETICIAN });
}

/** A patient here, with a profile, held by the practice's only dietician by default. */
async function heldByRoy(name) {
  const patient = await makePatient({ name, practices: [practice] });
  await PatientProfile.create({ user: patient.user._id });
  assert.equal(String(await autoAssignDietician(patient.user._id, practice._id)), String(roy.user._id));
  return patient;
}

const suspend = (member) =>
  as(doctor.token).patch(`/team/${member.membership._id}`, { status: MEMBERSHIP_STATUS.SUSPENDED });

const summaryOf = (patient) => as(doctor.token).get(`/doctor/patients/${patient.user._id}/summary`);

async function caseloadNames(token) {
  const res = await as(token).get('/dietician/patients');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.items.map((p) => p.name);
}

describe('§18 a dietician who is suspended', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('keeps the assignment on the record, shown to the doctor as no longer active', async () => {
    const patient = await heldByRoy('Rina Das');
    assert.equal((await suspend(roy)).status, 200);

    const res = await summaryOf(patient);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const care = res.body.nutritionCare;
    assert.equal(care.dietician.id, String(roy.user._id), 'the assignment was erased');
    assert.equal(care.dietician.name, 'Ms Roy');
    assert.equal(care.dietician.active, false, 'somebody suspended was shown as looking after the patient');
    assert.equal(care.decided, true);
    assert.equal(care.source, DIETICIAN_SOURCE.AUTO);
    // Builds that cannot say "no longer active" are told nobody, not her name.
    assert.equal(res.body.profile.assignedDietician, null);

    const enrolment = await Enrollment.findOne({ patient: patient.patient._id, practice: practice._id }).lean();
    assert.equal(String(enrolment.dietician), String(roy.user._id));
  });

  test('gets no more work: no caseload, no push, no place on the patient’s screen, no ownership', async () => {
    const patient = await heldByRoy('Rina Das');

    // While active, all four are hers.
    assert.deepEqual(await caseloadNames(roy.token), ['Rina Das']);
    assert.deepEqual(
      (await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: practice._id })).map((u) => String(u._id)),
      [String(roy.user._id)],
    );
    const before = await as(patient.token).get('/chat/nutrition');
    assert.equal(before.status, 200);
    assert.equal(before.body.dietician?.name, 'Ms Roy');
    let responsible = await responsibleFor({ practiceId: practice._id, patientIds: [patient.user._id] });
    assert.ok(responsible.get(String(patient.user._id)).has(String(roy.user._id)));

    assert.equal((await suspend(roy)).status, 200);

    const list = await as(roy.token).get('/dietician/patients');
    assert.equal(list.status, 403, `a suspended dietician read their caseload: ${list.status}`);
    const record = await as(roy.token).get(`/dietician/patients/${patient.user._id}/overview`);
    assert.equal(record.status, 403);

    assert.deepEqual(await dieticianRecipientsFor({ patientId: patient.user._id, practiceId: practice._id }), []);

    const after = await as(patient.token).get('/chat/nutrition');
    assert.equal(after.status, 200);
    assert.equal(after.body.dietician, null, 'the patient was told a suspended dietician is looking after them');

    responsible = await responsibleFor({ practiceId: practice._id, patientIds: [patient.user._id] });
    assert.equal(responsible.get(String(patient.user._id)).size, 0, 'the patient still counted as hers');
  });

  test('is not replaced behind the doctor’s back — not by a dietician already here, not by the next hire', async () => {
    const patient = await heldByRoy('Rina Das');
    const bose = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    assert.equal((await suspend(roy)).status, 200);

    assert.deepEqual(await caseloadNames(bose.token), [], 'the patient was handed to the remaining dietician');

    // Bose leaves too, and the practice hires somebody new: one active
    // dietician again, arriving to a patient who was decided for.
    assert.equal((await suspend(bose)).status, 200);
    const hired = await as(doctor.token).post('/team', {
      role: ROLES.DIETICIAN,
      name: 'Ms Pal',
      phoneToken: signPhoneToken(freshPhone()),
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
    const pal = await User.findById(hired.body.userId);
    assert.deepEqual(await caseloadNames(signAccessToken(pal)), [], 'the new hire inherited the suspended dietician’s patient');

    // The doctor is told, and decides.
    const overview = await as(doctor.token).get('/doctor/overview');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.nutrition.needsDieticianAssignment, 1);
    assert.equal(overview.body.nutrition.dietPatients, 0);

    const chosen = await as(doctor.token).patch(`/doctor/patients/${patient.user._id}/dietician`, {
      dieticianId: hired.body.userId,
    });
    assert.equal(chosen.status, 200, JSON.stringify(chosen.body));
    assert.deepEqual(await caseloadNames(signAccessToken(pal)), ['Rina Das']);

    // And Ms Roy's time with the patient is history, not gone.
    const care = (await summaryOf(patient)).body.nutritionCare;
    assert.equal(care.dietician.name, 'Ms Pal');
    assert.equal(care.dietician.active, true);
    assert.deepEqual(
      care.history.map((h) => h.dietician?.name),
      ['Ms Roy'],
    );
    assert.equal(care.history[0].source, DIETICIAN_SOURCE.AUTO);
    assert.equal(care.history[0].endedBy.name, 'Dr Sen');

    const after = await as(doctor.token).get('/doctor/overview');
    assert.equal(after.body.nutrition.needsDieticianAssignment, 0);
    assert.equal(after.body.nutrition.dietPatients, 1);
  });

  test('coming back brings back the patients nobody moved, and not the ones the doctor did', async () => {
    const moved = await heldByRoy('Moved On');
    const kept = await heldByRoy('Still Hers');
    const bose = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    assert.equal((await suspend(roy)).status, 200);
    assert.equal(
      (await as(doctor.token).patch(`/doctor/patients/${moved.user._id}/dietician`, { dieticianId: String(bose.user._id) })).status,
      200,
    );

    const back = await as(doctor.token).patch(`/team/${roy.membership._id}`, { status: MEMBERSHIP_STATUS.ACTIVE });
    assert.equal(back.status, 200, JSON.stringify(back.body));

    assert.deepEqual(await caseloadNames(roy.token), ['Still Hers']);
    assert.deepEqual(await caseloadNames(bose.token), ['Moved On']);
    assert.ok(kept);
  });

  test('may not switch the assistant off in a conversation they were never given', async () => {
    const patient = await heldByRoy('Rina Das');
    const bose = await makeMember(practice, { name: 'Mr Bose', role: ROLES.DIETICIAN });
    const enrolment = await Enrollment.findOne({ patient: patient.patient._id, practice: practice._id }).lean();
    await ChatSession.create({ patient: patient.user._id, kind: 'nutrition', enrollment: enrolment._id });

    const outsider = await as(bose.token).patch(`/chat/patients/${patient.user._id}/assistant`, {
      kind: 'nutrition',
      enabled: false,
    });
    assert.equal(outsider.status, 404, 'a dietician silenced the assistant for somebody else’s patient');

    const holder = await as(roy.token).patch(`/chat/patients/${patient.user._id}/assistant`, {
      kind: 'nutrition',
      enabled: false,
    });
    assert.equal(holder.status, 200, JSON.stringify(holder.body));
  });
});

describe('§18 a dietician at two practices who leaves one', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('keeps the other practice’s patients, and only those', async () => {
    const behala = await makePractice('Behala', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    await Membership.create({ user: roy.user._id, practice: behala._id, role: ROLES.DIETICIAN });

    const saltLakePatient = await heldByRoy('Salt Lake Patient');
    const behalaPatient = await makePatient({ name: 'Behala Patient', practices: [behala] });
    await PatientProfile.create({ user: behalaPatient.user._id });
    await autoAssignDietician(behalaPatient.user._id, behala._id);

    // Working at both, she chooses which one each request is for.
    const header = (p) => ({ 'x-medpin-practice': String(p._id) });
    assert.deepEqual(
      (await as(roy.token).get('/dietician/patients', header(practice))).body.items.map((p) => p.name),
      ['Salt Lake Patient'],
    );
    assert.deepEqual(
      (await as(roy.token).get('/dietician/patients', header(behala))).body.items.map((p) => p.name),
      ['Behala Patient'],
    );

    await Membership.updateOne({ _id: roy.membership._id }, { $set: { status: MEMBERSHIP_STATUS.SUSPENDED, endedOn: new Date() } });

    assert.deepEqual(await caseloadNames(roy.token), ['Behala Patient']);
    // Naming the practice she left changes nothing: with one current practice
    // that is the practice the request is for, and the patient is not there.
    const reach = await as(roy.token).get(`/dietician/patients/${saltLakePatient.user._id}/overview`, header(practice));
    assert.ok([403, 404, 409].includes(reach.status), `answered ${reach.status}: she read the practice she left`);
  });
});
