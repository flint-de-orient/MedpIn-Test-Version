import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Practice } from '../src/models/Practice.js';
import { User, ROLES } from '../src/models/User.js';
import { LEGACY_VERDICT } from '../src/services/careDoctor.js';
import { planPrimaryDoctorBackfill, applyPrimaryDoctorBackfill } from '../scripts/backfillPrimaryDoctor.js';

/**
 * backfillPrimaryDoctor.js names the doctor on enrolments that name none, from
 * the patient's legacy doctor, and only where that is safe: a doctor's account,
 * active, and a current doctor member of the same practice. It writes nothing
 * else, never overwrites a named doctor, and --dry writes nothing at all.
 */

let mongod;
let uri;
let phones = 0;
const phone = () => `+9181${String((phones += 1)).padStart(8, '0')}`;

async function account(name, role = ROLES.DOCTOR, extra = {}) {
  return User.create({ name, phone: phone(), role, isActive: true, ...extra });
}
async function member(user, practice, extra = {}) {
  return Membership.create({ user: user._id, practice: practice._id, role: user.role, status: MEMBERSHIP_STATUS.ACTIVE, ...extra });
}
async function legacyPatient(name, practice, { legacyDoctor = null, primaryDoctor = null, status = ENROLLMENT_STATUS.ACTIVE } = {}) {
  const login = await account(name, ROLES.PATIENT);
  await Patient.create({ _id: login._id, login: login._id, name, relationship: RELATIONSHIP.SELF });
  await PatientProfile.create({ user: login._id, ...(legacyDoctor ? { assignedDoctor: legacyDoctor._id } : {}) });
  const enrollment = await Enrollment.create({
    patient: login._id,
    practice: practice._id,
    status,
    ...(primaryDoctor ? { primaryDoctor: primaryDoctor._id } : {}),
  });
  return { login, enrollment };
}

let w;
async function world() {
  const a = await Practice.create({ name: "Dr. Dey's Diabetes Clinic", status: 'active' });
  const b = await Practice.create({ name: 'Lake Town Clinic', status: 'active' });
  const dey = await account('Dr. Amit Kumar Dey');
  await member(dey, a, { isOwner: true });
  const rahman = await account('Rahman');
  await member(rahman, a);
  const iyer = await account('Dr. Iyer');
  await member(iyer, b);
  const leftDoctor = await account('Dr. Gone');
  await member(leftDoctor, a, { endedOn: new Date() });
  const offDoctor = await account('Dr. Switched Off', ROLES.DOCTOR, { isActive: false });
  await member(offDoctor, a);
  const desk = await account('Front Desk', ROLES.STAFF);
  await member(desk, a);

  return {
    a, b, dey, rahman, iyer,
    safeDey: await legacyPatient('Rina Das', a, { legacyDoctor: dey }),
    safeRahman: await legacyPatient('Sunil Paul', a, { legacyDoctor: rahman }),
    otherPractice: await legacyPatient('Mitali Sen', a, { legacyDoctor: iyer }),
    left: await legacyPatient('Arun Roy', a, { legacyDoctor: leftDoctor }),
    switchedOff: await legacyPatient('Bina Ghosh', a, { legacyDoctor: offDoctor }),
    notADoctor: await legacyPatient('Kamal Nath', a, { legacyDoctor: desk }),
    noLegacy: await legacyPatient('Tara Bose', a),
    alreadyNamed: await legacyPatient('Neel Kar', a, { legacyDoctor: dey, primaryDoctor: rahman }),
    pending: await legacyPatient('Pia Sen', a, { legacyDoctor: dey, status: ENROLLMENT_STATUS.PENDING }),
  };
}

/** Everything the script must not touch, as it stands now. */
async function untouched() {
  const [sessions, messages, profiles, patients] = await Promise.all([
    ChatSession.find().sort({ _id: 1 }).lean(),
    ChatMessage.find().sort({ _id: 1 }).lean(),
    PatientProfile.find().sort({ _id: 1 }).lean(),
    Patient.find().sort({ _id: 1 }).lean(),
  ]);
  return JSON.stringify({ sessions, messages, profiles, patients });
}

const enrolmentsNow = async () =>
  JSON.stringify(await Enrollment.find().sort({ _id: 1 }).select('primaryDoctor status').lean());

const primaryOf = async (p) => (await Enrollment.findById(p.enrollment._id).lean()).primaryDoctor?.toString() ?? null;

/**
 * Runs the script as an operator would. Asynchronously: the in-memory mongod
 * is a child of this process, and a synchronous spawn stops this process
 * reading mongod's output, which stalls mongod and the script with it.
 */
function runScript(flag) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['scripts/backfillPrimaryDoctor.js', flag], {
      cwd: new URL('..', import.meta.url),
      env: { ...process.env, MONGODB_URI: uri, NODE_TEST_CONTEXT: '', LOG_LEVEL: 'silent' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('backfillPrimaryDoctor.js', () => {
  before(async () => {
    mongod = await MongoMemoryServer.create();
    uri = mongod.getUri('medpin_backfill_primary_doctor');
    await mongoose.connect(uri);
  });
  after(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });
  beforeEach(async () => {
    await mongoose.connection.dropDatabase();
    w = await world();
    // A conversation and a message the script must leave exactly as they are.
    const session = await ChatSession.create({ patient: w.safeDey.login._id, kind: 'care', title: 'Old chat', messageCount: 1 });
    await ChatMessage.create({ session: session._id, patient: w.safeDey.login._id, seq: 0, role: 'user', content: 'hello', language: 'en' });
  });

  test('the plan: only a current doctor member of the same practice is safe', async () => {
    const plan = await planPrimaryDoctorBackfill();
    const verdictOf = (p) => plan.rows.find((r) => r.enrollment === String(p.enrollment._id))?.verdict;

    assert.equal(verdictOf(w.safeDey), LEGACY_VERDICT.SAFE);
    assert.equal(verdictOf(w.safeRahman), LEGACY_VERDICT.SAFE);
    assert.equal(verdictOf(w.otherPractice), LEGACY_VERDICT.NOT_A_CURRENT_MEMBER_HERE, 'a doctor from another practice');
    assert.equal(verdictOf(w.left), LEGACY_VERDICT.NOT_A_CURRENT_MEMBER_HERE, 'a doctor who left');
    assert.equal(verdictOf(w.switchedOff), LEGACY_VERDICT.DOCTOR_ACCOUNT_INACTIVE);
    assert.equal(verdictOf(w.notADoctor), LEGACY_VERDICT.NOT_A_DOCTOR);
    assert.equal(verdictOf(w.noLegacy), LEGACY_VERDICT.NO_LEGACY_DOCTOR);
    assert.equal(verdictOf(w.alreadyNamed), undefined, 'an enrolment that names a doctor is not in the plan');
    assert.equal(verdictOf(w.pending), undefined, 'a pending enrolment is not in the plan');

    assert.equal(plan.safe.length, 2);
    assert.equal(plan.unsafe.length, 5);
    assert.ok(plan.rows.every((r) => !r.patientLabel.includes('Rina') && !r.patientLabel.includes('Das')), 'a patient name is printed');
  });

  test('planning writes nothing', async () => {
    const before = [await enrolmentsNow(), await untouched()];
    await planPrimaryDoctorBackfill();
    assert.deepEqual([await enrolmentsNow(), await untouched()], before);
  });

  test('applying names the doctor on the safe enrolments only, and nothing else changes', async () => {
    const before = await untouched();
    const result = await applyPrimaryDoctorBackfill(await planPrimaryDoctorBackfill());

    assert.deepEqual(result, { updated: 2, skipped: 0, unsafe: 5, errors: 0 });
    assert.equal(await primaryOf(w.safeDey), String(w.dey._id));
    assert.equal(await primaryOf(w.safeRahman), String(w.rahman._id));
    for (const p of [w.otherPractice, w.left, w.switchedOff, w.notADoctor, w.noLegacy, w.pending]) {
      assert.equal(await primaryOf(p), null, 'an unsafe enrolment was given a doctor');
    }
    assert.equal(await primaryOf(w.alreadyNamed), String(w.rahman._id), 'a named doctor was overwritten');
    assert.equal(await untouched(), before, 'a message, conversation, profile or patient changed');
  });

  test('a doctor named between the report and the write is kept', async () => {
    const plan = await planPrimaryDoctorBackfill();
    await Enrollment.updateOne({ _id: w.safeDey.enrollment._id }, { $set: { primaryDoctor: w.rahman._id } });
    const result = await applyPrimaryDoctorBackfill(plan);
    assert.equal(result.skipped, 1);
    assert.equal(await primaryOf(w.safeDey), String(w.rahman._id));
  });

  test('running it twice changes nothing the second time', async () => {
    await applyPrimaryDoctorBackfill(await planPrimaryDoctorBackfill());
    const second = await applyPrimaryDoctorBackfill(await planPrimaryDoctorBackfill());
    assert.deepEqual(second, { updated: 0, skipped: 0, unsafe: 5, errors: 0 });
  });

  test('from the command line: --dry reports and writes nothing, --apply writes and says what it wrote', async () => {
    const before = [await enrolmentsNow(), await untouched()];
    const dry = await runScript('--dry');
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /DRY RUN: nothing will be written/);
    assert.match(dry.stdout, /Fixable \(safe\): 2/);
    assert.match(dry.stdout, /Not fixable: 5/);
    assert.match(dry.stdout, /Dr\. Amit Kumar Dey → Dr\. Dey's Diabetes Clinic → SAFE/);
    assert.match(dry.stdout, /Dr\. Iyer → Dr\. Dey's Diabetes Clinic → the legacy doctor is not a current member of this practice/);
    assert.deepEqual([await enrolmentsNow(), await untouched()], before, '--dry wrote something');

    const applied = await runScript('--apply');
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Updated: 2/);
    assert.match(applied.stdout, /Unsafe: {2}5/);
    assert.match(applied.stdout, /Errors: {2}0/);
    assert.match(applied.stdout, /Only Enrollment\.primaryDoctor was written/);
    assert.equal(await untouched(), before[1]);
  });
});
