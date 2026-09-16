#!/usr/bin/env node
/**
 * Write down who was already looking after each patient's nutrition.
 *
 *   node scripts/backfillDieticianAssignments.js           # report
 *   node scripts/backfillDieticianAssignments.js --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * A dietician's caseload was "everyone at the practice, unless somebody has
 * been assigned to me — then only those". Assignment was a restriction, not a
 * grant, so a practice with one dietician needed no assignments at all: they
 * saw every patient by default.
 *
 * The default now widens nothing. The caseload is exactly what the assignments
 * say, and a practice with one dietician assigns them as each patient joins.
 * Without this script, the dietician at a practice that never assigned anybody
 * would open the app to an empty list on the morning this deploys — the same
 * people, the same work, and no way to see any of it.
 *
 * ---- Which patients, and whose --------------------------------------------
 *
 * Practices with exactly one active dietician, and within those, patients
 * currently enrolled who have no dietician recorded. That is precisely the set
 * the old default covered, so this writes down an arrangement that already
 * existed rather than making a new one.
 *
 * A practice with two or more is reported and left alone: which dietician
 * looks after which patient is a clinical allocation, and the old default gave
 * both of them everybody, so there is nothing here to write down faithfully.
 * The doctor assigns them on each patient's profile.
 *
 * A practice with none has nobody to assign.
 *
 * Dry run by default. An existing assignment is never overwritten, so a second
 * run changes nothing.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Practice } from '../src/models/Practice.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { ROLES } from '../src/models/User.js';

/** No dietician recorded: null, or the field never written. */
const UNASSIGNED = {
  $or: [{ assignedDietician: null }, { assignedDietician: { $exists: false } }],
};

/**
 * Who would be assigned where, without writing.
 *
 * @returns {Promise<{assign: object[], ambiguous: object[], none: object[]}>}
 */
export async function planDieticianAssignments() {
  const practices = await Practice.find({}).select('_id name').lean();

  const assign = [];
  const ambiguous = [];
  const none = [];

  for (const practice of practices) {
    const dieticians = await Membership.find({
      practice: practice._id,
      role: ROLES.DIETICIAN,
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
    })
      .select('user')
      .lean();

    if (dieticians.length === 0) {
      none.push({ practice });
      continue;
    }
    if (dieticians.length > 1) {
      ambiguous.push({ practice, count: dieticians.length });
      continue;
    }

    const patients = await Enrollment.distinct('patient', {
      practice: practice._id,
      status: ENROLLMENT_STATUS.ACTIVE,
      revokedAt: null,
    });
    if (patients.length === 0) continue;

    const unassigned = await PatientProfile.find({
      user: { $in: patients },
      ...UNASSIGNED,
    })
      .select('user')
      .lean();
    if (unassigned.length === 0) continue;

    assign.push({
      practice,
      dietician: dieticians[0].user,
      patients: unassigned.map((p) => p.user),
    });
  }

  return { assign, ambiguous, none };
}

/**
 * Write the assignments.
 *
 * The "no dietician recorded" condition is repeated in the update rather than
 * trusted from the plan, so somebody assigned by hand between the dry run and
 * this is left where the doctor put them.
 */
export async function applyDieticianAssignments(plan) {
  let changed = 0;
  for (const { dietician, patients } of plan.assign) {
    const result = await PatientProfile.updateMany(
      { user: { $in: patients }, ...UNASSIGNED },
      { $set: { assignedDietician: dietician } },
    );
    changed += result.modifiedCount ?? 0;
  }
  return changed;
}

async function main(argv) {
  const apply = argv.includes('--apply');

  await connectDb();
  try {
    const plan = await planDieticianAssignments();
    const total = plan.assign.reduce((n, a) => n + a.patients.length, 0);

    if (total === 0 && plan.ambiguous.length === 0) {
      console.log('Nothing to do: every patient who has a dietician already says so.');
      return;
    }

    for (const { practice, patients } of plan.assign) {
      console.log(`${practice.name}: ${patients.length} patient(s) → its one dietician`);
    }

    if (plan.ambiguous.length) {
      console.log('\n  Left alone — more than one dietician, so the allocation is a decision:');
      for (const { practice, count } of plan.ambiguous) {
        console.log(`    ${practice.name} (${count} dieticians)`);
      }
      console.log('  Assign these on each patient’s profile in the app.');
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }

    const changed = await applyDieticianAssignments(plan);
    console.log(`\nWritten: ${changed} patient(s).`);
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
