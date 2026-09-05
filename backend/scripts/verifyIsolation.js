/**
 * Two practices, one shared patient, over real HTTP against real rows.
 *
 * ---- Why this exists when there is already an isolation test -------------
 *
 * `tests/isolation.test.js` stubs its two queries. That makes it fast enough to
 * run on every commit, and it pins the rule — but it proves the rule, not the
 * system. It cannot catch a route that forgets `resolvePatientScope`, a
 * middleware ordered after the handler, a populate that leaks a field, or an
 * index that was never built.
 *
 * This one makes actual documents, signs actual tokens, and sends actual
 * requests through the whole stack. It is slower, it needs a database, and it
 * is the one the specification means by "nothing ships to a real second
 * customer until it is green".
 *
 * ---- It writes, so it refuses to guess where -----------------------------
 *
 * Everything it creates is prefixed and deleted afterwards, but a bug in the
 * cleanup on a production database is a worse day than any test is worth. So it
 * will not run without `ALLOW_ISOLATION_TEST=true`, and it stops if the
 * database already holds more patients than a staging box plausibly would.
 *
 *   ALLOW_ISOLATION_TEST=true node scripts/verifyIsolation.js
 *   ALLOW_ISOLATION_TEST=true API=http://localhost:3000/api/v1 node scripts/verifyIsolation.js
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { User, ROLES } from '../src/models/User.js';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Prescription } from '../src/models/Prescription.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { signAccessToken } from '../src/services/tokens.js';

const API = process.env.API ?? 'http://localhost:3000/api/v1';
const TAG = 'ISOTEST';
const MAX_PATIENTS_FOR_A_STAGING_BOX = 50;

const results = [];
let created = [];

function check(name, passed, detail = '') {
  results.push({ name, passed, detail });
  console.log(`  ${passed ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function get(path, token) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${token}` } });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* not json */
  }
  return { status: res.status, body };
}

/** A throwaway account, tagged so cleanup can find it even if this crashes. */
async function makeUser(name, role, phone) {
  const u = await User.create({ name: `${TAG} ${name}`, phone, role, isActive: true });
  created.push(['User', u._id]);
  return u;
}

async function main() {
  if (process.env.ALLOW_ISOLATION_TEST !== 'true') {
    console.log('\nThis script writes to the database.');
    console.log('Re-run with ALLOW_ISOLATION_TEST=true, on staging, not production.\n');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);

  const patientCount = await User.countDocuments({ role: ROLES.PATIENT });
  if (patientCount > MAX_PATIENTS_FOR_A_STAGING_BOX) {
    console.log(
      `\nThis database holds ${patientCount} patients. That looks like production,` +
        ' and this script creates and deletes rows.\n',
    );
    await mongoose.disconnect();
    process.exit(1);
  }

  const health = await fetch(`${API.replace(/\/v1$/, '/v1')}/health`).catch(() => null);
  if (!health?.ok) {
    console.log(`\nNo API answering at ${API}. Start it, or set API=...\n`);
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\nTwo practices, one patient, against ${API}\n`);

  // ---- the world ---------------------------------------------------------
  const stamp = Date.now().toString().slice(-8);

  const practiceA = await Practice.create({
    name: `${TAG} Practice A`,
    status: PRACTICE_STATUS.ACTIVE,
    verification: VERIFICATION.VERIFIED,
  });
  const practiceB = await Practice.create({
    name: `${TAG} Practice B`,
    status: PRACTICE_STATUS.ACTIVE,
    verification: VERIFICATION.VERIFIED,
  });
  created.push(['Practice', practiceA._id], ['Practice', practiceB._id]);

  const doctorA = await makeUser('Doctor A', ROLES.DOCTOR, `+9199${stamp}1`);
  const doctorB = await makeUser('Doctor B', ROLES.DOCTOR, `+9199${stamp}2`);
  const rahul = await makeUser('Rahul', ROLES.PATIENT, `+9199${stamp}3`);

  for (const [doctor, practice] of [
    [doctorA, practiceA],
    [doctorB, practiceB],
  ]) {
    const m = await Membership.create({
      user: doctor._id,
      practice: practice._id,
      role: ROLES.DOCTOR,
      isOwner: true,
      permissions: presetFor({ role: ROLES.DOCTOR, isOwner: true }),
      status: MEMBERSHIP_STATUS.ACTIVE,
    });
    created.push(['Membership', m._id]);
  }

  // The patient's row reuses the login id, as the backfill writes them.
  const patient = await Patient.create({
    _id: rahul._id,
    login: rahul._id,
    name: 'Rahul',
    relationship: RELATIONSHIP.SELF,
  });
  const profile = await PatientProfile.create({ user: rahul._id, assignedDoctor: doctorA._id });
  created.push(['Patient', patient._id], ['PatientProfile', profile._id]);

  // Enrolled at A in March, at B in September — so the retroactivity rule has
  // something to bite on.
  const MARCH = new Date('2026-03-01');
  const SEPTEMBER = new Date('2026-09-01');
  for (const [practice, on] of [
    [practiceA, MARCH],
    [practiceB, SEPTEMBER],
  ]) {
    const e = await Enrollment.create({
      patient: patient._id,
      practice: practice._id,
      status: ENROLLMENT_STATUS.ACTIVE,
      enrolledOn: on,
    });
    created.push(['Enrollment', e._id]);
  }

  // A prescription A wrote in May — before B was ever given access.
  const may = await Prescription.create({
    patient: patient._id,
    doctor: doctorA._id,
    referenceNo: `${TAG}-${stamp}`,
    issuedOn: new Date('2026-05-01'),
  });
  created.push(['Prescription', may._id]);

  const tokenA = signAccessToken(doctorA);
  const tokenB = signAccessToken(doctorB);

  // ---- the checks --------------------------------------------------------
  console.log('Reading the patient:\n');

  const aReads = await get(`/patients/${patient._id}/prescriptions`, tokenA);
  check("Doctor A can open their own patient", aReads.status === 200, `HTTP ${aReads.status}`);

  const bReads = await get(`/patients/${patient._id}/prescriptions`, tokenB);
  check(
    'Doctor B can open the patient they share',
    bReads.status === 200,
    `HTTP ${bReads.status}`,
  );

  // The one that matters most: B is enrolled, so they may open the patient —
  // but the May prescription predates their access and must not be listed.
  const bSawMay = JSON.stringify(bReads.body ?? {}).includes(`${TAG}-${stamp}`);
  check(
    "Doctor B cannot see A's prescription from before B was enrolled",
    !bSawMay,
    bSawMay ? 'the May prescription appeared in B’s list' : '',
  );

  const aSawMay = JSON.stringify(aReads.body ?? {}).includes(`${TAG}-${stamp}`);
  check('Doctor A can see it, because it is theirs', aSawMay);

  console.log('\nA practice with no relationship:\n');

  const stranger = await makeUser('Stranger', ROLES.DOCTOR, `+9199${stamp}4`);
  const practiceC = await Practice.create({
    name: `${TAG} Practice C`,
    status: PRACTICE_STATUS.ACTIVE,
  });
  created.push(['Practice', practiceC._id]);
  const mC = await Membership.create({
    user: stranger._id,
    practice: practiceC._id,
    role: ROLES.DOCTOR,
    isOwner: true,
    permissions: presetFor({ role: ROLES.DOCTOR, isOwner: true }),
    status: MEMBERSHIP_STATUS.ACTIVE,
  });
  created.push(['Membership', mC._id]);

  const cReads = await get(`/patients/${patient._id}/prescriptions`, signAccessToken(stranger));
  check(
    'A third practice is refused outright',
    cReads.status === 403,
    `HTTP ${cReads.status}${cReads.status === 200 ? ' — THIS IS A LEAK' : ''}`,
  );

  console.log('\nRevocation:\n');

  await Enrollment.updateOne(
    { patient: patient._id, practice: practiceB._id },
    { $set: { status: ENROLLMENT_STATUS.REVOKED, revokedAt: new Date() } },
  );

  const bAfter = await get(`/patients/${patient._id}/prescriptions`, tokenB);
  check('B loses access the moment it is revoked', bAfter.status === 403, `HTTP ${bAfter.status}`);

  const aAfter = await get(`/patients/${patient._id}/prescriptions`, tokenA);
  check('A is untouched by B being revoked', aAfter.status === 200, `HTTP ${aAfter.status}`);

  // ---- verdict -----------------------------------------------------------
  const failed = results.filter((r) => !r.passed);
  console.log(`\n${results.length - failed.length}/${results.length} passed\n`);
  if (failed.length) {
    console.log('NOT SAFE FOR A SECOND CUSTOMER. Failing checks:\n');
    for (const f of failed) console.log(`  - ${f.name}`);
    console.log('');
  } else {
    console.log('Isolation holds over real HTTP against real rows.\n');
  }

  return failed.length;
}

/** Remove exactly what was created, whatever happened. */
async function cleanup() {
  const models = {
    User,
    Patient,
    Practice,
    Membership,
    Enrollment,
    Prescription,
    PatientProfile,
  };
  let removed = 0;
  for (const [name, id] of created.reverse()) {
    await models[name].deleteOne({ _id: id }).catch(() => {});
    removed += 1;
  }
  // A belt-and-braces sweep for anything an earlier crashed run left behind.
  const stray = await User.deleteMany({ name: new RegExp(`^${TAG} `) });
  console.log(`Cleaned up ${removed} row(s)${stray.deletedCount ? ` and ${stray.deletedCount} stray` : ''}.\n`);
}

let code = 1;
try {
  code = await main();
} catch (err) {
  console.error('\n', err);
} finally {
  await cleanup().catch((e) => console.error('CLEANUP FAILED — remove ISOTEST rows by hand:', e));
  await mongoose.disconnect().catch(() => {});
}
process.exit(code ? 1 : 0);
