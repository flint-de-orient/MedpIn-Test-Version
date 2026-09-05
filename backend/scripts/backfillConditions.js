/**
 * Turns the old illness columns into condition rows.
 *
 * Two sources, because the schema had two: `diabetesType` was one condition
 * with a type, and `comorbidities` was nine more as loose strings.
 *
 * ---- Copies, never clears ------------------------------------------------
 *
 * Neither column is touched. That is the whole safety argument, and it is the
 * same one the practice backfill made: 48 places read `diabetesType` today — 12
 * in the API, 36 in the app — and they go on reading it, unchanged, whether
 * this has run, half-run, or never run.
 *
 * The columns come out only when a search proves nothing reads them, and that
 * is a separate change on a separate day.
 *
 * Idempotent: a patient who already has a row for a condition is left alone,
 * so a second run cannot overwrite a type a clinician corrected by hand.
 *
 *   node scripts/backfillConditions.js          # report
 *   node scripts/backfillConditions.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Condition } from '../src/models/Condition.js';
import { PatientCondition, CONDITION_STATUS } from '../src/models/PatientCondition.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const conditions = await Condition.find({ practice: null }).select('_id key').lean();
  const byKey = new Map(conditions.map((c) => [c.key, c._id]));

  if (!byKey.size) {
    console.log('\nNo conditions seeded. Run seedConditions.js first.\n');
    await mongoose.disconnect();
    return;
  }

  const profiles = await PatientProfile.find({
    $or: [
      { diabetesType: { $nin: [null, ''] } },
      { comorbidities: { $exists: true, $ne: [] } },
    ],
  })
    .select('user diabetesType comorbidities diagnosedOn')
    .lean();

  /** Every row this run would write, before deduplication against what exists. */
  const planned = [];

  for (const p of profiles) {
    // `none` is an answer meaning "not diabetic". Writing a diabetes row for it
    // would put a sugar chart on the Home screen of somebody who does not have
    // diabetes — the exact failure conditions are meant to fix.
    if (p.diabetesType && p.diabetesType !== 'none' && byKey.has('diabetes')) {
      planned.push({
        patient: p.user,
        condition: byKey.get('diabetes'),
        detail: { type: p.diabetesType },
        diagnosedOn: p.diagnosedOn ?? null,
      });
    }

    for (const key of p.comorbidities ?? []) {
      if (!byKey.has(key)) continue;
      planned.push({ patient: p.user, condition: byKey.get(key), detail: {}, diagnosedOn: null });
    }
  }

  // Skip anything already recorded — a clinician may have corrected it.
  const existing = await PatientCondition.find({
    patient: { $in: [...new Set(planned.map((r) => String(r.patient)))] },
  })
    .select('patient condition')
    .lean();
  const seen = new Set(existing.map((r) => `${r.patient}:${r.condition}`));
  const toWrite = planned.filter((r) => !seen.has(`${r.patient}:${r.condition}`));

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${profiles.length} profile(s) carrying an illness`);
  console.log(`  ${planned.length} condition row(s) implied`);
  console.log(`  ${planned.length - toWrite.length} already recorded — left alone`);
  console.log(`  ${toWrite.length} to write`);
  console.log('\n  diabetesType and comorbidities are read, never modified.');

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const row of toWrite) {
    await PatientCondition.updateOne(
      { patient: row.patient, condition: row.condition },
      {
        $setOnInsert: {
          ...row,
          status: CONDITION_STATUS.ACTIVE,
          // Left null on purpose. Nobody recorded these; they were inferred
          // from a column, and a migration should not sign a diagnosis.
          diagnosedBy: null,
        },
      },
      { upsert: true },
    );
    written += 1;
  }

  console.log(`\n  wrote ${written} row(s). Nothing was removed from any profile.\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
