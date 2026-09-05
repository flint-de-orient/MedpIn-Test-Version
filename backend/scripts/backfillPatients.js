/**
 * Gives every existing patient a `Patient` row — with their own `User._id`.
 *
 * ---- Why the id is reused, and why that is the whole point --------------
 *
 * Twenty-one collections point at a patient by `User._id`. If the new rows got
 * fresh ids, every one of those collections would need rewriting in a single
 * migration, and a half-finished run would leave prescriptions pointing at
 * nothing.
 *
 * Reusing the id means none of that happens. `Patient._id === User._id` for
 * every person who exists today, so every prescription, reading and appointment
 * already holds the correct value. Re-pointing a ref from `'User'` to
 * `'Patient'` is then a one-word change per collection, done on whatever day
 * suits, with no data migration behind it and nothing to roll back.
 *
 * The ids diverge only for a family member added after this — who has a
 * `Patient` row and no login of their own, which is precisely the case the old
 * shape could not express.
 *
 * ---- Copies, never clears ------------------------------------------------
 *
 * `User.name`, `dateOfBirth` and `gender` stay exactly where they are. Every
 * screen that reads them goes on reading them.
 *
 *   node scripts/backfillPatients.js          # report
 *   node scripts/backfillPatients.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { User, ROLES } from '../src/models/User.js';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  // Every patient login, active or not. An inactive account still has a record
  // that has to remain addressable.
  const logins = await User.find({ role: ROLES.PATIENT })
    .select('_id name dateOfBirth gender isActive')
    .lean();

  const existing = await Patient.find({ _id: { $in: logins.map((u) => u._id) } })
    .select('_id')
    .lean();
  const done = new Set(existing.map((p) => String(p._id)));
  const toWrite = logins.filter((u) => !done.has(String(u._id)));

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${logins.length} patient login(s)`);
  console.log(`  ${done.size} already have a patient row — left alone`);
  console.log(`  ${toWrite.length} to write`);
  console.log('\n  Each row reuses its login id, so no clinical collection moves.');
  console.log('  User.name, dateOfBirth and gender are read, never modified.');

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const u of toWrite) {
    await Patient.updateOne(
      { _id: u._id },
      {
        $setOnInsert: {
          login: u._id,
          name: u.name,
          dateOfBirth: u.dateOfBirth ?? null,
          gender: u.gender ?? 'undisclosed',
          // Everyone who exists today is their own account holder. Dependants
          // are added afterwards, by a person, one at a time.
          relationship: RELATIONSHIP.SELF,
          isActive: u.isActive !== false,
        },
      },
      { upsert: true },
    );
    written += 1;
  }

  // The property the rest of the migration depends on. Checked rather than
  // assumed, because a single row where it does not hold is a patient whose
  // prescriptions point at nothing the day a ref is re-pointed.
  const mismatched = await Patient.countDocuments({ $expr: { $ne: ['$_id', '$login'] } });

  console.log(`\n  wrote ${written} patient row(s)`);
  console.log(`  ${mismatched} row(s) where _id !== login (expected 0 at this stage)`);
  if (mismatched > 0) {
    console.log('  ⚠ investigate before re-pointing any ref — see the note in Patient.js');
  }
  console.log('\nDone. Nothing was removed from any account.\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
