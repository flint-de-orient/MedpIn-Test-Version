/**
 * Gives each location's doctor a diary of their own.
 *
 * `Clinic.weeklyHours` describes when the building is open, which is the same
 * thing as the doctor's diary only while there is one doctor. This copies each
 * location's hours onto an availability row for the doctor that location names.
 *
 * ---- Copies, never clears ------------------------------------------------
 *
 * The clinic keeps its hours. [services/scheduling.js] resolves a doctor's
 * availability and falls back to the building's, so a location with no row
 * behaves exactly as it did — before this runs, during a partial run, or if it
 * never runs at all. There is no window in which a patient cannot book.
 *
 * Skips a location with no doctor rather than guessing. An availability row
 * attached to the wrong doctor is worse than none: none falls back correctly,
 * and a wrong one silently offers a cardiologist's hours for a dermatologist.
 *
 *   node scripts/backfillAvailability.js          # report
 *   node scripts/backfillAvailability.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Clinic } from '../src/models/Clinic.js';
import { Availability } from '../src/models/Availability.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const clinics = await Clinic.find({})
    .select('_id name doctor weeklyHours overrides slotMinutes isActive')
    .lean();

  const withDoctor = clinics.filter((c) => c.doctor);
  const orphans = clinics.filter((c) => !c.doctor);

  const existing = await Availability.find({
    location: { $in: withDoctor.map((c) => c._id) },
  })
    .select('doctor location')
    .lean();
  const seen = new Set(existing.map((a) => `${a.doctor}:${a.location}`));

  const toWrite = withDoctor.filter((c) => !seen.has(`${c.doctor}:${c._id}`));

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${clinics.length} location(s)`);
  console.log(`  ${toWrite.length} diary row(s) to write`);
  console.log(`  ${withDoctor.length - toWrite.length} already have one — left alone`);
  if (orphans.length) {
    console.log(`  ${orphans.length} skipped — no doctor named on the location:`);
    for (const c of orphans) console.log(`       ${c.name}`);
  }
  for (const c of toWrite) {
    const sittings = (c.weeklyHours ?? []).length;
    console.log(`       ${c.name}: ${sittings} weekly sitting(s), ${c.slotMinutes}min slots`);
  }
  console.log('\n  Clinic hours are read, never modified.');

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const c of toWrite) {
    await Availability.updateOne(
      { doctor: c.doctor, location: c._id },
      {
        // `$setOnInsert`, so a re-run never resets a diary somebody has since
        // edited — the hours on the clinic may be stale by then.
        $setOnInsert: {
          slotMinutes: c.slotMinutes ?? 15,
          weeklyHours: c.weeklyHours ?? [],
          overrides: c.overrides ?? [],
          // Follows the location: a diary at a closed branch should not offer
          // slots the moment somebody reopens the doctor.
          isActive: c.isActive !== false,
        },
      },
      { upsert: true },
    );
    written += 1;
  }

  console.log(`\n  wrote ${written} diary row(s). Nothing was removed.\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
