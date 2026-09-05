/**
 * Attaches existing conversations to the enrollment they belong to.
 *
 * Every care session predates enrollments, so all of them have none. Each
 * patient had exactly one practice when their thread was written — the founding
 * one — so that is the enrollment it belongs to, and there is no ambiguity to
 * resolve.
 *
 * ---- The department is left null, deliberately ---------------------------
 *
 * A null department is the practice's general thread, which is what a
 * single-specialty clinic has. Filling it in with diabetology would relabel
 * every existing conversation for no gain: the patient would open a thread that
 * used to be theirs and find a specialty heading on it.
 *
 * Departments start appearing on threads when a patient actually sees a second
 * specialty, which is a thing that has not happened yet.
 *
 *   node scripts/backfillThreads.js          # report
 *   node scripts/backfillThreads.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const loose = await ChatSession.find({
    kind: { $ne: 'nutrition' },
    $or: [{ enrollment: null }, { enrollment: { $exists: false } }],
  })
    .select('_id patient')
    .lean();

  const patientIds = [...new Set(loose.map((s) => String(s.patient)))];
  const enrollments = await Enrollment.find({
    patient: { $in: patientIds },
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
  })
    .sort({ enrolledOn: 1 })
    .select('patient practice')
    .lean();

  // Earliest enrollment per patient: the practice they were with when the
  // thread was written.
  const firstFor = new Map();
  for (const e of enrollments) {
    if (!firstFor.has(String(e.patient))) firstFor.set(String(e.patient), e._id);
  }

  const linkable = loose.filter((s) => firstFor.has(String(s.patient)));
  const orphans = loose.filter((s) => !firstFor.has(String(s.patient)));

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${loose.length} care thread(s) with no enrollment`);
  console.log(`  ${linkable.length} can be linked`);
  if (orphans.length) {
    console.log(`  ${orphans.length} skipped — the patient has no active enrollment.`);
    console.log('       Run backfillEnrollments.js first, then re-run this.');
  }
  console.log('\n  The department is left null: that is the practice general thread.');

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  let written = 0;
  for (const s of linkable) {
    await ChatSession.updateOne(
      { _id: s._id },
      { $set: { enrollment: firstFor.get(String(s.patient)) } },
    );
    written += 1;
  }

  console.log(`\n  linked ${written} thread(s). No message or department was touched.\n`);
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
