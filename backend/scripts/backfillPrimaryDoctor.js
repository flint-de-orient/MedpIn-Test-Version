/**
 * Names the patient's doctor on enrolments that name none, from their legacy doctor.
 *
 *   node scripts/backfillPrimaryDoctor.js --dry     # report only; writes nothing (the default)
 *   node scripts/backfillPrimaryDoctor.js --apply   # write the safe ones, and report
 *
 * ---- Why --------------------------------------------------------------------
 *
 * backfillEnrollments.js enrolled every existing patient at the founding
 * practice, ACTIVE, without a `primaryDoctor`. Their doctor stayed on the older
 * `PatientProfile.assignedDoctor`. Everything that names a patient's doctor,
 * and decides which specialty's assistant answers them, reads the enrolment, so
 * those patients had no doctor: the chat header showed the practice, and the
 * assistant said it was unavailable for their care team. careDoctor.js now
 * falls back to the legacy doctor; this writes the same answer onto the
 * enrolment so the fallback is not needed.
 *
 * ---- What it writes, and when ----------------------------------------------
 *
 * `Enrollment.primaryDoctor`, and nothing else. Only on an active enrolment
 * that still names nobody at the moment of writing (the update is conditional,
 * so an existing doctor is never overwritten), and only when the legacy doctor
 * is safe by the rule in careDoctor.js (legacyDoctorsFor): a doctor's account,
 * active, and a current doctor member of that same practice. A doctor at
 * another practice, one who has left, or a switched-off account is reported
 * and left alone. Messages, conversations, profiles and every other record are
 * not touched.
 *
 * Patients are shown by the end of their id and their initials, not their
 * names: enough to find them, and no more of their record than that.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Patient } from '../src/models/Patient.js';
import { Practice } from '../src/models/Practice.js';
import { legacyDoctorsFor, LEGACY_VERDICT } from '../src/services/careDoctor.js';

/** An active enrolment that names no doctor. `null` also matches a missing field. */
const UNNAMED = Object.freeze({ status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null, primaryDoctor: null });

const WHY = {
  [LEGACY_VERDICT.NO_LEGACY_DOCTOR]: 'no legacy doctor on the profile',
  [LEGACY_VERDICT.DOCTOR_ACCOUNT_MISSING]: 'the legacy doctor account no longer exists',
  [LEGACY_VERDICT.DOCTOR_ACCOUNT_INACTIVE]: 'the legacy doctor account is switched off',
  [LEGACY_VERDICT.NOT_A_DOCTOR]: 'the legacy doctor is not a doctor account',
  [LEGACY_VERDICT.NOT_A_CURRENT_MEMBER_HERE]: 'the legacy doctor is not a current member of this practice',
};

const initials = (name) =>
  String(name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join('') || '?';

/** Everything --dry reports and --apply acts on. Reads only. */
export async function planPrimaryDoctorBackfill() {
  const enrolments = await Enrollment.find(UNNAMED).select('_id patient practice').lean();
  const verdicts = await legacyDoctorsFor(
    enrolments.map((e) => ({ key: String(e._id), practice: String(e.practice), patient: String(e.patient) })),
  );
  const [patients, practices] = await Promise.all([
    Patient.find({ _id: { $in: enrolments.map((e) => e.patient) } }).select('name').lean(),
    Practice.find({ _id: { $in: [...new Set(enrolments.map((e) => String(e.practice)))] } }).select('name').lean(),
  ]);
  const patientName = new Map(patients.map((p) => [String(p._id), p.name]));
  const practiceName = new Map(practices.map((p) => [String(p._id), p.name]));

  const rows = enrolments.map((e) => {
    const v = verdicts.get(String(e._id));
    return {
      enrollment: String(e._id),
      patient: String(e.patient),
      patientLabel: `patient …${String(e.patient).slice(-6)} (${initials(patientName.get(String(e.patient)))})`,
      practice: String(e.practice),
      practiceName: practiceName.get(String(e.practice)) ?? String(e.practice),
      doctor: v?.doctor ?? null,
      doctorName: v?.doctorName ?? null,
      verdict: v?.verdict ?? LEGACY_VERDICT.NO_LEGACY_DOCTOR,
    };
  });
  return {
    rows,
    safe: rows.filter((r) => r.verdict === LEGACY_VERDICT.SAFE),
    unsafe: rows.filter((r) => r.verdict !== LEGACY_VERDICT.SAFE),
  };
}

/**
 * Writes the safe rows. Each write is conditional on the enrolment still being
 * active and still naming nobody, so a doctor named since the report is kept.
 */
export async function applyPrimaryDoctorBackfill(plan) {
  const result = { updated: 0, skipped: 0, unsafe: plan.unsafe.length, errors: 0 };
  for (const row of plan.safe) {
    try {
      const r = await Enrollment.updateOne({ _id: row.enrollment, ...UNNAMED }, { $set: { primaryDoctor: row.doctor } });
      if (r.modifiedCount) result.updated += 1;
      else result.skipped += 1;
    } catch (err) {
      result.errors += 1;
      console.error(`  error on ${row.patientLabel}: ${err?.message ?? err}`);
    }
  }
  return result;
}

function report(plan) {
  console.log(`  Active enrolments naming no doctor: ${plan.rows.length}\n`);
  console.log(`  Fixable (safe): ${plan.safe.length}`);
  for (const r of plan.safe) console.log(`    ${r.patientLabel} → ${r.doctorName} → ${r.practiceName} → SAFE`);
  console.log(`\n  Not fixable: ${plan.unsafe.length}`);
  for (const r of plan.unsafe) {
    const who = r.doctorName ? ` → ${r.doctorName}` : '';
    console.log(`    ${r.patientLabel}${who} → ${r.practiceName} → ${WHY[r.verdict] ?? r.verdict}`);
  }
}

async function main(argv) {
  const apply = argv.includes('--apply');
  if (apply && argv.includes('--dry')) {
    console.error('Pass --dry or --apply, not both.');
    process.exitCode = 1;
    return;
  }
  await connectDb();
  try {
    const plan = await planPrimaryDoctorBackfill();
    console.log(`\n${apply ? 'WRITING' : 'DRY RUN: nothing will be written'}\n`);
    report(plan);

    if (!apply) {
      console.log('\nReview the list, then re-run with --apply to name the doctor on the safe ones.\n');
      return;
    }
    const r = await applyPrimaryDoctorBackfill(plan);
    console.log(`\n  Updated: ${r.updated}`);
    console.log(`  Skipped: ${r.skipped} (named or no longer active since the report)`);
    console.log(`  Unsafe:  ${r.unsafe} (left alone)`);
    console.log(`  Errors:  ${r.errors}`);
    console.log('\n  Only Enrollment.primaryDoctor was written. No message, conversation, profile or');
    console.log('  other record was touched.\n');
    if (r.errors) process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
