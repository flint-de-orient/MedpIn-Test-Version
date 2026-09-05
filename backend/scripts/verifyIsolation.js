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
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { LabResult } from '../src/models/LabResult.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { signAccessToken } from '../src/services/tokens.js';
import { AuditLog } from '../src/models/AuditLog.js';

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

  // A has had this patient for months; B was given access recently. Relative to
  // today rather than fixed dates, so the harness still means the same thing
  // next year.
  const daysAgo = (n) => new Date(Date.now() - n * 86_400_000);
  const A_ENROLLED = daysAgo(200);
  const B_ENROLLED = daysAgo(30);
  const OLD = daysAgo(120); // after A arrived, long before B did
  const RECENT = daysAgo(1); // after both

  for (const [practice, on] of [
    [practiceA, A_ENROLLED],
    [practiceB, B_ENROLLED],
  ]) {
    const e = await Enrollment.create({
      patient: patient._id,
      practice: practice._id,
      status: ENROLLMENT_STATUS.ACTIVE,
      enrolledOn: on,
    });
    created.push(['Enrollment', e._id]);
  }

  /**
   * Every clinical read the enrolment window bounds, and a pair of rows each.
   *
   * ---- Why a pair, and not just the old row ------------------------------
   *
   * Checking only that B cannot see the old row proves nothing on its own: a
   * window filtering on a field the collection does not have, or an enrolment
   * date read as `undefined` and coerced to now, would hide *everything* and
   * pass. So each collection gets one row from before B arrived and one from
   * after, and the check is that B sees exactly the second.
   *
   * ---- And not just prescriptions ----------------------------------------
   *
   * Eleven collections were bounded in the same commit and the harness covered
   * one. These four are the ones a clinician actually opens; the rest share
   * their `recordWindow` call verbatim, and `recordWindow.test.js` fails the
   * build if any read loses it.
   */
  const BOUNDED = [
    {
      label: 'prescriptions',
      path: 'prescriptions',
      Model: Prescription,
      make: (when, tag) => ({
        patient: patient._id,
        doctor: doctorA._id,
        referenceNo: tag,
        issuedOn: when,
      }),
    },
    {
      label: 'glucose readings',
      path: 'glucose',
      Model: GlucoseReading,
      make: (when) => ({ patient: patient._id, valueMgDl: 137, measuredAt: when }),
    },
    {
      label: 'vitals',
      path: 'vitals',
      Model: VitalRecord,
      make: (when) => ({ patient: patient._id, recordedAt: when }),
    },
    {
      label: 'lab results',
      path: 'lab-tests',
      Model: LabResult,
      make: (when, tag) => ({ patient: patient._id, testName: tag, testedOn: when }),
    },
  ];

  for (const b of BOUNDED) {
    // Recorded one at a time, immediately. Creating both and then registering
    // both leaves the first row orphaned if the second throws.
    b.old = await b.Model.create(b.make(OLD, `${TAG}-${stamp}-${b.path}-old`));
    created.push([b.Model.modelName, b.old._id]);
    b.recent = await b.Model.create(b.make(RECENT, `${TAG}-${stamp}-${b.path}-new`));
    created.push([b.Model.modelName, b.recent._id]);
  }

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

  console.log('\nWhat each practice may read, and from when:\n');

  // The id, not a field of it. Every one of these lists serialises `id`, and
  // matching on that cannot accidentally succeed against a different row.
  const shows = (body, doc) => JSON.stringify(body ?? {}).includes(String(doc._id));

  for (const b of BOUNDED) {
    const a = await get(`/patients/${patient._id}/${b.path}`, tokenA);
    const bb = await get(`/patients/${patient._id}/${b.path}`, tokenB);

    if (a.status !== 200 || bb.status !== 200) {
      check(`${b.label}: both practices can read the list`, false, `A ${a.status}, B ${bb.status}`);
      continue;
    }

    // A has been here throughout, so A sees the lot. If this fails the window
    // is not discriminating, it is emptying — and the check below would have
    // passed while hiding the clinic's own history.
    check(`${b.label}: A sees everything, including the old row`, shows(a.body, b.old) && shows(a.body, b.recent));

    check(
      `${b.label}: B sees the row from after they were enrolled`,
      shows(bb.body, b.recent),
      shows(bb.body, b.recent) ? '' : 'B sees nothing at all — the window is too wide, not too narrow',
    );

    const leak = shows(bb.body, b.old);
    check(
      `${b.label}: B cannot see the row from before`,
      !leak,
      leak ? 'A ROW WRITTEN BEFORE B WAS ENROLLED APPEARED IN B’S LIST' : '',
    );
  }

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

  console.log('\nThe clinician router, which never went through the middleware:\n');

  /**
   * A patient of A alone, so there is something B must not see.
   *
   * Rahul is shared, which makes him useless here: every answer about him is
   * "yes" for both practices. Sunita is enrolled at A only, and every check
   * below asks whether B can reach a patient it has no relationship with.
   *
   * These routes matter more than the ones above. `/patients/:id/prescriptions`
   * goes through `resolvePatientScope`, where the guards live. `/doctor/*`
   * mounts `requireAuth, requireClinician` and nothing else -- and it is the
   * surface a doctor actually uses all day.
   */
  const sunitaUser = await makeUser('Sunita', ROLES.PATIENT, `+9199${stamp}6`);
  const sunita = await Patient.create({
    _id: sunitaUser._id,
    login: sunitaUser._id,
    name: 'Sunita',
    relationship: RELATIONSHIP.SELF,
  });
  created.push(['Patient', sunita._id]);
  const sunitaProfile = await PatientProfile.create({
    user: sunitaUser._id,
    assignedDoctor: doctorA._id,
  });
  created.push(['PatientProfile', sunitaProfile._id]);
  const sunitaEnrol = await Enrollment.create({
    patient: sunita._id,
    practice: practiceA._id,
    status: ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: A_ENROLLED,
  });
  created.push(['Enrollment', sunitaEnrol._id]);

  const hasSunita = (body) => JSON.stringify(body ?? {}).includes(String(sunita._id));

  const aList = await get('/doctor/patients?limit=100', tokenA);
  check("A's patient list contains their own patient", hasSunita(aList.body), `HTTP ${aList.status}`);

  const bList = await get('/doctor/patients?limit=100', tokenB);
  const listLeak = hasSunita(bList.body);
  check(
    "B's patient list does not contain A's patient",
    !listLeak,
    listLeak ? "THE OTHER PRACTICE'S REGISTER IS VISIBLE" : `HTTP ${bList.status}`,
  );

  for (const [label, path] of [
    ['summary', `/doctor/patients/${sunita._id}/summary`],
    ['adherence', `/doctor/patients/${sunita._id}/adherence`],
  ]) {
    const r = await get(path, tokenB);
    check(
      `B cannot open A's patient by id (${label})`,
      r.status === 403,
      `HTTP ${r.status}${r.status === 200 ? ' -- THIS IS A LEAK' : ''}`,
    );
  }

  /**
   * The aggregates, which are not scoped yet.
   *
   * Listed as known and unfixed in doctorScope.test.js. They are checked here
   * rather than skipped because a release gate that passes while these leak is
   * a gate that lies -- the point of running it is to be told no.
   */
  for (const [label, path] of [
    ['worklist', '/doctor/worklist'],
    ['alerts', '/doctor/alerts'],
    ['overview', '/doctor/overview'],
    ['chat review', '/doctor/chat-review'],
  ]) {
    const r = await get(path, tokenB);
    const leak = hasSunita(r.body);
    check(
      `B's ${label} does not mention A's patient`,
      !leak,
      leak ? 'not yet scoped -- see NOT_YET in doctorScope.test.js' : `HTTP ${r.status}`,
    );
  }

  console.log('\nRevocation:\n');

  await Enrollment.updateOne(
    { patient: patient._id, practice: practiceB._id },
    { $set: { status: ENROLLMENT_STATUS.REVOKED, revokedAt: new Date() } },
  );

  const bAfter = await get(`/patients/${patient._id}/prescriptions`, tokenB);
  check('B loses access the moment it is revoked', bAfter.status === 403, `HTTP ${bAfter.status}`);

  const aAfter = await get(`/patients/${patient._id}/prescriptions`, tokenA);
  check('A is untouched by B being revoked', aAfter.status === 200, `HTTP ${aAfter.status}`);

  console.log('\nTokens and identifiers:\n');

  // A well-formed id for a document that does not exist. Should read as "not
  // found", never as a stack trace or a Mongoose CastError with internals in it.
  const ghost = new mongoose.Types.ObjectId();
  const missing = await get(`/patients/${ghost}/prescriptions`, tokenA);
  check(
    'An unknown patient id is refused cleanly',
    missing.status === 403 || missing.status === 404,
    `HTTP ${missing.status}`,
  );

  // A malformed id. The failure must be the API's, phrased for a caller, not
  // the database's phrased for a developer.
  const malformed = await get('/patients/not-an-id/prescriptions', tokenA);
  const leaked = JSON.stringify(malformed.body ?? {}).match(/CastError|ObjectId|mongoose|stack/i);
  check(
    'A malformed id does not leak internals',
    !leaked,
    leaked ? `response mentions ${leaked[0]}` : `HTTP ${malformed.status}`,
  );

  // The patient's own token against a clinical route for somebody else.
  const rahulToken = signAccessToken(rahul);
  const otherPatient = await makeUser('Someone Else', ROLES.PATIENT, `+9199${stamp}5`);
  const crossPatient = await get(
    `/patients/${otherPatient._id}/prescriptions`,
    rahulToken,
  );
  check(
    'A patient cannot read another patient',
    crossPatient.status === 403,
    `HTTP ${crossPatient.status}${crossPatient.status === 200 ? ' — THIS IS A LEAK' : ''}`,
  );

  // A token for a deactivated account must stop working immediately, not at
  // expiry — otherwise removing somebody leaves them two hours of access.
  await User.updateOne({ _id: stranger._id }, { $set: { isActive: false } });
  const deactivated = await get('/clinics', signAccessToken(stranger));
  check(
    'A deactivated account is refused at once',
    deactivated.status === 401,
    `HTTP ${deactivated.status}`,
  );

  console.log('\nWhat the log says:\n');

  // A denied cross-practice read is the single most interesting line in an
  // audit trail, and it is the one usually missing — the request failed, so
  // nothing wrote it down.
  const denials = await AuditLog.countDocuments({
    action: /denied|forbidden/i,
    createdAt: { $gte: new Date(Date.now() - 120_000) },
  });
  check(
    'Refused cross-practice reads are recorded',
    denials > 0,
    denials === 0 ? 'no denial appears in the audit log' : `${denials} recorded`,
  );

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
    GlucoseReading,
    VitalRecord,
    LabResult,
  };
  let removed = 0;
  const unknown = new Set();

  for (const [name, id] of created.reverse()) {
    // A model missing from the map used to throw here, on the line whose whole
    // job is to run after a failure — one added collection and the harness
    // leaves its rows behind on the box it was told not to dirty. Named and
    // counted instead, so the gap is visible rather than fatal.
    if (!models[name]) {
      unknown.add(name);
      continue;
    }
    await models[name].deleteOne({ _id: id }).catch(() => {});
    removed += 1;
  }

  // A belt-and-braces sweep for anything an earlier crashed run left behind.
  // Tagged rows only, in the collections that carry a name to tag.
  const stray = await User.deleteMany({ name: new RegExp(`^${TAG} `) });
  const strayRx = await Prescription.deleteMany({ referenceNo: new RegExp(`^${TAG}-`) });
  const strayLab = await LabResult.deleteMany({ testName: new RegExp(`^${TAG}-`) });
  const swept = stray.deletedCount + strayRx.deletedCount + strayLab.deletedCount;

  console.log(`Cleaned up ${removed} row(s)${swept ? ` and ${swept} stray` : ''}.`);
  if (unknown.size) {
    console.log(`\n  NOT CLEANED: ${[...unknown].join(', ')} — add them to the map in cleanup().`);
    console.log(`  Find them with { name: /^${TAG} / } or by the ${TAG} prefix.`);
  }
  console.log('');
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
