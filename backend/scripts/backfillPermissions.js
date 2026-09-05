/**
 * Writes the permission grant onto memberships created before it existed.
 *
 * The first backfill ran before `permissions` was a field, so every row it
 * wrote has an empty set. `Membership.can()` falls back to the role's preset
 * for exactly those rows, so nothing is broken while this has not run — but a
 * fallback is a compatibility shim, not a place to keep data. Once the rows say
 * what they grant, the shim is only there for the next deployment that has not
 * caught up.
 *
 * Only ever fills an empty set. A row that already lists permissions is left
 * alone, because that set may have been chosen rather than derived.
 *
 *   node scripts/backfillPermissions.js          # report
 *   node scripts/backfillPermissions.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Membership, presetFor } from '../src/models/Membership.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const rows = await Membership.find({
    $or: [{ permissions: { $exists: false } }, { permissions: { $size: 0 } }],
  })
    .select('_id user role isOwner')
    .lean();

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${rows.length} membership(s) with no grant`);

  for (const r of rows) {
    const grant = presetFor({ role: r.role, isOwner: r.isOwner });
    console.log(`    ${r.role}${r.isOwner ? ' (head)' : ''} → ${grant.join(', ')}`);
  }

  if (!rows.length) {
    console.log('\n  Nothing to do.\n');
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const r of rows) {
    await Membership.updateOne(
      { _id: r._id },
      { $set: { permissions: presetFor({ role: r.role, isOwner: r.isOwner }) } },
    );
    written += 1;
  }

  console.log(`\n  wrote ${written} grant(s)\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
