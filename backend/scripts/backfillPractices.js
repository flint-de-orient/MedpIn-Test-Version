/**
 * Gives the existing clinic rows a practice to belong to.
 *
 * Before this, a `Clinic` row carried both the brand and the address. One
 * practice with two branches would have meant two copies of the logo and the
 * registration number, and a rename that took in one row and not the other.
 * `Practice` now holds the brand; this puts the clinic that is already running
 * underneath one.
 *
 * ---- What it does not do -------------------------------------------------
 *
 * It copies the brand fields up. It does not clear them from the clinic.
 *
 * That is the whole safety argument. [services/clinicIdentity.js] resolves
 * location first, practice second, so a clinic row that still has its own name
 * and logo behaves exactly as it did yesterday whether this script has run, has
 * half-run, or has never run. There is no window in which the letterhead is
 * blank, and no rollback to write.
 *
 * Idempotent: the practice it creates is marked `isFounding`, and a second run
 * finds that one rather than making another.
 *
 *   node scripts/backfillPractices.js          # report
 *   node scripts/backfillPractices.js --apply  # write
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Clinic } from '../src/models/Clinic.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { User, ROLES } from '../src/models/User.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';

const apply = process.argv.includes('--apply');

/**
 * The row whose brand becomes the practice's.
 *
 * The same ordering [clinicIdentity] uses with no clinic id — the row the app
 * already treats as canonical. Picking a different one here would move the
 * letterhead onto a branch nobody has been printing.
 */
function primaryOf(clinics) {
  return (
    [...clinics]
      .filter((c) => c.isActive)
      .sort(
        (a, b) =>
          (a.sortIndex ?? 0) - (b.sortIndex ?? 0) ||
          new Date(a.createdAt) - new Date(b.createdAt),
      )[0] ?? clinics[0]
  );
}

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const clinics = await Clinic.find({}).lean();
  if (clinics.length === 0) {
    console.log('\nNo clinics. Nothing to do.\n');
    await mongoose.disconnect();
    return;
  }

  const primary = primaryOf(clinics);
  const unlinked = clinics.filter((c) => !c.practice);
  let founding = await Practice.findOne({ isFounding: true });

  // The clinic's own doctor if it names one; otherwise the sole doctor account,
  // which is every deployment that exists today. Left null rather than guessed
  // when there is more than one and the clinic does not say.
  let headDoctor = primary.doctor ?? null;
  if (!headDoctor) {
    const doctors = await User.find({ role: ROLES.DOCTOR, isActive: true }).select('_id name').lean();
    if (doctors.length === 1) headDoctor = doctors[0]._id;
  }

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  ${clinics.length} clinic row(s), ${unlinked.length} not yet linked`);
  console.log(`  brand taken from: ${primary.name}`);
  console.log(`  practice:         ${founding ? `existing — ${founding.name}` : 'to be created'}`);
  console.log(`  head doctor:      ${headDoctor ? String(headDoctor) : 'none — set it in the admin surface'}`);
  const clinicianCount = await User.countDocuments({
    role: { $in: [ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN] },
    isActive: true,
  });
  console.log(`  people to enrol:  ${clinicianCount}`);
  console.log('\n  brand fields stay on every clinic row; this only copies them up.');
  console.log('  User.role is copied, never moved — nothing reads memberships yet.');

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  if (!founding) {
    founding = await Practice.create({
      name: primary.name || env.CLINIC_NAME,
      tagline: primary.tagline ?? null,
      doctorDisplayName: primary.doctorDisplayName || env.DOCTOR_DISPLAY_NAME || null,
      registrationNo: primary.registrationNo ?? null,
      logoLightAssetId: primary.logoLightAssetId ?? null,
      logoDarkAssetId: primary.logoDarkAssetId ?? null,
      logoNeedsDarkChip: Boolean(primary.logoNeedsDarkChip),
      headDoctor,
      status: PRACTICE_STATUS.ACTIVE,
      // The clinic that was here before verification existed is verified by
      // the fact that it has been seeing patients. Marking it unverified would
      // put a pending badge on a running practice.
      verification: VERIFICATION.VERIFIED,
      verifiedAt: new Date(),
      isFounding: true,
    });
    console.log(`\n  created practice ${founding._id}`);
  }

  const linked = await Clinic.updateMany(
    { practice: null },
    { $set: { practice: founding._id } },
  );

  console.log(`  linked ${linked.modifiedCount} clinic row(s)`);

  // Everyone already working here becomes a member of it. Without this the
  // practice exists with nobody in it, and the first authorisation check that
  // reads memberships would lock the whole clinic out.
  //
  // `User.role` is copied, not moved. Nothing reads memberships for
  // authorisation yet, and flipping that over in the same commit that creates
  // the rows is how a clinic finds itself logged out on a Monday morning.
  const clinicians = await User.find({
    role: { $in: [ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN] },
    isActive: true,
  })
    .select('_id role')
    .lean();

  let enrolled = 0;
  for (const person of clinicians) {
    // `$setOnInsert`, so a re-run never resets somebody whose role was
    // corrected by hand after the first pass.
    const res = await Membership.updateOne(
      { user: person._id, practice: founding._id },
      {
        $setOnInsert: {
          role: person.role,
          // The head doctor owns the practice. Everyone else is added by them.
          isOwner: String(person._id) === String(headDoctor ?? ''),
          // Seeded here as well as in the model's pre-validate hook, because
          // updateOne with upsert never constructs a document and so never
          // runs it. A row inserted with no grant would be a member who can
          // do nothing the moment the middleware starts reading grants.
          permissions: presetFor({
            role: person.role,
            isOwner: String(person._id) === String(headDoctor ?? ''),
          }),
          status: MEMBERSHIP_STATUS.ACTIVE,
          startedOn: new Date(),
          endedOn: null,
        },
      },
      { upsert: true },
    );
    if (res.upsertedCount) enrolled += 1;
  }

  console.log(`  enrolled ${enrolled} of ${clinicians.length} clinician(s)`);
  console.log('Done. Nothing was removed from any clinic row.\n');
  await mongoose.disconnect();
}

/*
 * RETIRED — this script ran once, in production, on 4 September 2026, and must
 * never run again.
 *
 * It created the founding practice and attached every existing clinic and clinician to it. That was recorded as a one-time historical exception (see
 * deploy/DATA-DECISIONS.md, "The founding-practice migration"): the practices
 * model arrived after the clinic had been running for months, and the rows it
 * wrote describe relationships that already existed.
 *
 * Run today it would do the same to everybody who has joined since — patients
 * who signed up alone, and other practices' patients and staff — which is the
 * pattern the platform now forbids: no practice is ever given a patient, a
 * clinic or a clinician by default, and no enrolment is ever written without
 * consent. So main() is no longer called. The code above is kept, unchanged, as
 * the record of exactly what that migration did.
 */
console.error(
  '\nThis migration is retired. It ran once, on 4 September 2026, as a recorded one-time ' +
    'exception, and must not run again. See deploy/DATA-DECISIONS.md.\n',
);
process.exitCode = 1;
