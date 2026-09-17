#!/usr/bin/env node
/**
 * Write down who looks after each patient's nutrition, at each practice.
 *
 *   node scripts/backfillDieticianAssignments.js           # report
 *   node scripts/backfillDieticianAssignments.js --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * Two changes, one migration.
 *
 * The assignment moved. It was `assignedDietician`, one field on the patient's
 * profile, so a patient enrolled at two practices could be held by one
 * practice's dietician at a time and the second practice's choice overwrote the
 * first. It is now on the enrolment — the row that already says "this patient,
 * at this practice" — and nothing reads the old field. Without step 1 below,
 * every assignment a doctor made before this release would vanish from the
 * dietician's list on the morning it deploys.
 *
 * And the caseload became the assignments. A dietician used to see everyone at
 * their practice unless somebody had been assigned to them; a practice with one
 * dietician therefore needed no assignments at all. The caseload is now exactly
 * what the assignments say, and a practice with one dietician assigns them as
 * each patient joins. Step 2 writes that down for the patients who joined
 * before.
 *
 * ---- 1. Carrying the profile's dietician onto the right enrolment ---------
 *
 * The practice is the one the dietician works at — or worked at: a dietician
 * who has since left still held the patient there, and the record should say
 * so — among the practices the patient is enrolled at.
 *
 *   exactly one  → written onto that enrolment, marked `migration`
 *   none         → reported and not written. The field named somebody who never
 *                  worked where the patient is enrolled; it granted nothing
 *                  under the old rules either, and must keep granting nothing
 *   several      → reported and not written. Which practice it was is not in
 *                  the data, and a guess would hand one practice's patient to
 *                  the other's dietician
 *
 * ---- 2. The default, for practices with exactly one active dietician -----
 *
 * Every current enrolment there with nothing decided is assigned to them — the
 * set the old default covered. A practice with two or more is reported and left
 * alone: the old default gave all of them everybody, so there is no arrangement
 * to write down faithfully, and the doctor chooses on each patient's profile. A
 * practice with none has nobody to assign.
 *
 * ---- Safe to repeat -------------------------------------------------------
 *
 * Every write repeats "nothing decided yet" in its own filter, so a doctor's
 * decision made between the report and the apply — including unassigning — is
 * kept, and a second run changes nothing. The profile field is left exactly as
 * it was; take a mongodump of `enrollments` first, which is the rollback.
 * Reads `.env` from the directory it runs in: run it from the deployment's own
 * `backend/`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Practice } from '../src/models/Practice.js';
import { Membership } from '../src/models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { activeDieticianIds } from '../src/services/dieticianAssignment.js';

/** Nothing decided for this relationship yet. Matches a field never written, too. */
const UNDECIDED = { dieticianSource: null };

/** A relationship that grants anything now. */
const CURRENT = { status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null };

/**
 * What applying would write, without writing it.
 *
 * @returns {Promise<{
 *   carry: {enrollment, patient, practice, dietician}[],
 *   unattributable: {patient, dietician}[],
 *   contested: {patient, dietician, practices}[],
 *   assign: {practice, dietician, enrollments, patients}[],
 *   ambiguous: {practice, count, patients}[],
 *   none: {practice}[],
 * }>}
 */
export async function planDieticianAssignments() {
  // ---- 1. the profile's dietician, onto the enrolment it belongs to --------
  const carry = [];
  const unattributable = [];
  const contested = [];

  const practicesOf = new Map();
  const worksAt = async (userId) => {
    const key = String(userId);
    if (!practicesOf.has(key)) {
      // Every membership, ended and suspended ones included. See above.
      const rows = await Membership.find({ user: userId }).select('practice').lean();
      practicesOf.set(key, new Set(rows.map((r) => String(r.practice))));
    }
    return practicesOf.get(key);
  };

  const profiles = await PatientProfile.find({ assignedDietician: { $ne: null } })
    .select('user assignedDietician')
    .lean();

  for (const profile of profiles) {
    const theirs = await worksAt(profile.assignedDietician);
    const enrolments = await Enrollment.find({ patient: profile.user })
      .select('_id practice dieticianSource')
      .lean();
    const matches = enrolments.filter((e) => theirs.has(String(e.practice)));

    if (matches.length === 0) {
      unattributable.push({ patient: profile.user, dietician: profile.assignedDietician });
    } else if (matches.length > 1) {
      contested.push({
        patient: profile.user,
        dietician: profile.assignedDietician,
        practices: matches.map((m) => m.practice),
      });
    } else if (matches[0].dieticianSource == null) {
      carry.push({
        enrollment: matches[0]._id,
        patient: profile.user,
        practice: matches[0].practice,
        dietician: profile.assignedDietician,
      });
    }
  }

  // ---- 2. the default, where there is exactly one active dietician --------
  const carried = new Set(carry.map((c) => String(c.enrollment)));
  const assign = [];
  const ambiguous = [];
  const none = [];

  for (const practice of await Practice.find({}).select('_id name').lean()) {
    const dieticians = await activeDieticianIds(practice._id);
    if (dieticians.length === 0) {
      none.push({ practice });
      continue;
    }

    const open = (
      await Enrollment.find({ practice: practice._id, ...CURRENT, ...UNDECIDED }).select('_id patient').lean()
    ).filter((e) => !carried.has(String(e._id)));

    if (dieticians.length > 1) {
      ambiguous.push({ practice, count: dieticians.length, patients: open.length });
      continue;
    }
    if (open.length === 0) continue;

    assign.push({
      practice,
      dietician: dieticians[0],
      enrollments: open.map((e) => e._id),
      patients: open.map((e) => e.patient),
    });
  }

  return { carry, unattributable, contested, assign, ambiguous, none };
}

/**
 * Write the plan.
 *
 * "Nothing decided yet" is repeated in every filter rather than trusted from
 * the plan, so anything decided between the report and this — by a doctor, or
 * by a patient joining — is left as it was decided.
 *
 * @returns {Promise<{carried: number, assigned: number}>}
 */
export async function applyDieticianAssignments(plan) {
  let carried = 0;
  for (const { enrollment, dietician } of plan.carry) {
    const result = await Enrollment.updateOne(
      { _id: enrollment, ...UNDECIDED },
      {
        $set: {
          dietician,
          dieticianSource: DIETICIAN_SOURCE.MIGRATION,
          // When it was made is not on record. Unknown, not today.
          dieticianSince: null,
          dieticianBy: null,
        },
      },
    );
    carried += result.modifiedCount ?? 0;
  }

  let assigned = 0;
  for (const { dietician, enrollments } of plan.assign) {
    const result = await Enrollment.updateMany(
      { _id: { $in: enrollments }, ...CURRENT, ...UNDECIDED },
      {
        $set: {
          dietician,
          dieticianSource: DIETICIAN_SOURCE.AUTO,
          dieticianSince: new Date(),
          dieticianBy: null,
        },
      },
    );
    assigned += result.modifiedCount ?? 0;
  }

  return { carried, assigned };
}

async function main(argv) {
  const apply = argv.includes('--apply');

  await connectDb();
  try {
    const plan = await planDieticianAssignments();
    const defaults = plan.assign.reduce((n, a) => n + a.enrollments.length, 0);
    const sample = (rows) => rows.slice(0, 20).map((r) => String(r.patient)).join(', ');

    console.log(`1. Profile assignments to carry onto their enrolment: ${plan.carry.length}`);
    if (plan.unattributable.length) {
      console.log(
        `   Not carried — the dietician never worked where the patient is enrolled: ${plan.unattributable.length}` +
          ` (patients ${sample(plan.unattributable)})`,
      );
    }
    if (plan.contested.length) {
      console.log(
        `   Not carried — the dietician works at more than one of the patient’s practices: ${plan.contested.length}` +
          ` (patients ${sample(plan.contested)}). Assign these on the patient’s profile.`,
      );
    }

    console.log(`2. Patients to assign to their practice’s only dietician: ${defaults}`);
    for (const { practice, enrollments } of plan.assign) {
      console.log(`   ${practice.name}: ${enrollments.length}`);
    }
    if (plan.ambiguous.length) {
      console.log('   Left alone — more than one active dietician, so the allocation is the doctor’s:');
      for (const { practice, count, patients } of plan.ambiguous) {
        console.log(`   ${practice.name} (${count} dieticians, ${patients} patient(s) undecided)`);
      }
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }

    const written = await applyDieticianAssignments(plan);
    console.log(`\nWritten: ${written.carried} carried over, ${written.assigned} assigned by default.`);
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
