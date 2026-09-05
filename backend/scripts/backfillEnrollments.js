/**
 * Enrolls every existing patient at the founding practice.
 *
 * They have been patients of it for months; the row is a statement of what is
 * already true, not a new relationship. So the status is ACTIVE and no consent
 * code is sent — asking a patient to re-consent to a clinic they have been
 * attending would be the migration inventing a doubt nobody had.
 *
 * ---- enrolledOn is backdated, deliberately -------------------------------
 *
 * Access is not retroactive, and that rule would erase this clinic's own
 * history if applied naively: dated today, Dr. Dey could not read a
 * prescription he wrote last week.
 *
 * So each enrollment is dated from the patient's own beginning — their earliest
 * record, falling back to the account's creation. The practice keeps exactly
 * the reach it already had, and the rule starts biting from the second practice
 * onward, which is the one it was written for.
 *
 *   node scripts/backfillEnrollments.js          # report
 *   node scripts/backfillEnrollments.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { User, ROLES } from '../src/models/User.js';
import { Patient } from '../src/models/Patient.js';
import { Practice } from '../src/models/Practice.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const founding = await Practice.findOne({ isFounding: true }).select('_id name').lean();
  if (!founding) {
    console.log('\nNo founding practice. Run backfillPractices.js first.\n');
    await mongoose.disconnect();
    return;
  }

  // Patient rows if the previous migration has run, otherwise the patient
  // logins themselves — whose ids are the same values, which is the whole point
  // of how backfillPatients wrote them.
  let patients = await Patient.find({}).select('_id name').lean();
  let source = 'patient rows';
  if (!patients.length) {
    const logins = await User.find({ role: ROLES.PATIENT }).select('_id name').lean();
    patients = logins;
    source = 'patient logins (backfillPatients has not run)';
  }

  const existing = await Enrollment.find({ practice: founding._id })
    .select('patient')
    .lean();
  const done = new Set(existing.map((e) => String(e.patient)));
  const toWrite = patients.filter((p) => !done.has(String(p._id)));

  // The earliest thing on record for each patient, so the practice keeps the
  // reach it already had.
  const profiles = await PatientProfile.find({ user: { $in: toWrite.map((p) => p._id) } })
    .select('user createdAt')
    .lean();
  const firstSeen = new Map(profiles.map((p) => [String(p.user), p.createdAt]));

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  practice:   ${founding.name}`);
  console.log(`  source:     ${source}`);
  console.log(`  ${patients.length} patient(s)`);
  console.log(`  ${done.size} already enrolled — left alone`);
  console.log(`  ${toWrite.length} to enrol, ACTIVE, backdated to their first record`);
  console.log('\n  No consent code is sent: these are existing patients of this clinic.');

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const p of toWrite) {
    const since = firstSeen.get(String(p._id)) ?? p.createdAt ?? new Date(0);
    await Enrollment.updateOne(
      { patient: p._id, practice: founding._id },
      {
        $setOnInsert: {
          status: ENROLLMENT_STATUS.ACTIVE,
          enrolledOn: since,
          // Null on purpose: nobody enrolled these people. They were already
          // patients when practices came into being, and a migration should not
          // put a name against a decision no person made.
          enrolledBy: null,
          revokedAt: null,
          revokedBy: null,
        },
      },
      { upsert: true },
    );
    written += 1;
  }

  const orphans = await Enrollment.countDocuments({
    practice: founding._id,
    enrolledOn: { $exists: false },
  });

  console.log(`\n  enrolled ${written} patient(s)`);
  console.log(`  ${orphans} row(s) with no enrolledOn (expected 0)`);
  console.log('\nDone. Nothing was removed.\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
