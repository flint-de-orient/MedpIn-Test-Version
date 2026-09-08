/**
 * Rewrite the plans that were named after their customers.
 *
 * `solo`, `clinic` and `hospital` described who was buying rather than what
 * they got, and two of them collided with a practice *type*: "a hospital on the
 * hospital plan" reads as a tautology, and "a clinic that is not on the clinic
 * plan" reads as a bug report. They are `essential`, `professional` and
 * `enterprise` now.
 *
 * ---- Why this exists when the model already handles it ------------------
 *
 * `Practice` normalises a legacy value before validation, so nothing breaks
 * without this script. But that hook is a safety net rather than a fix: it only
 * fires when a document is saved, so a practice nobody edits keeps its old
 * value indefinitely — and every query that filters on `plan` quietly misses
 * it. A practice on `clinic` would not appear under Professional in the
 * console, and would not match a capability lookup for either name.
 *
 * So the hook keeps the app working and this makes the data true.
 *
 *   node scripts/backfillPlanNames.js          # report
 *   node scripts/backfillPlanNames.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Practice, PLAN, LEGACY_PLANS } from '../src/models/Practice.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const legacy = Object.keys(LEGACY_PLANS);
  const rows = await Practice.find({ plan: { $in: legacy } }).select('name plan').lean();

  console.log(`\n  ${await Practice.estimatedDocumentCount()} practice(s) in total`);
  console.log(`  ${rows.length} still on an old plan name\n`);

  if (rows.length === 0) {
    console.log('  Nothing to do. The LEGACY_PLANS map and the pre-validate hook');
    console.log('  in models/Practice.js can be deleted once this is true in');
    console.log('  production as well as here.\n');
    return;
  }

  for (const r of rows) {
    console.log(`    ${r.name}: ${r.plan} -> ${LEGACY_PLANS[r.plan]}`);
  }

  if (!apply) {
    console.log('\n  Re-run with --apply.\n');
    return;
  }

  // One update per old name rather than one per practice: three statements
  // instead of however many customers there turn out to be.
  let changed = 0;
  for (const [from, to] of Object.entries(LEGACY_PLANS)) {
    const res = await Practice.updateMany({ plan: from }, { $set: { plan: to } });
    changed += res.modifiedCount;
  }

  console.log(`\n  Rewrote ${changed} practice(s).`);

  // Verified rather than assumed. An updateMany that matched nothing reports
  // success, and the point of the run is that none is left.
  const left = await Practice.countDocuments({ plan: { $in: legacy } });
  if (left > 0) {
    console.error(`\n  ${left} still on an old name. Something is writing them back.\n`);
    process.exitCode = 1;
    return;
  }

  // And that what replaced them is a plan the app knows.
  const unknown = await Practice.countDocuments({ plan: { $nin: Object.values(PLAN) } });
  if (unknown > 0) {
    console.error(`\n  ${unknown} practice(s) hold a plan that is not in the enum.\n`);
    process.exitCode = 1;
    return;
  }

  console.log('  None left.\n');
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
