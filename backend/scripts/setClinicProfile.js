/**
 * Put the real clinic's identity on the Clinic record.
 *
 * The seed creates two invented locations — "Salt Lake Diabetes & Endocrine
 * Centre" and a Behala evening clinic — with invented numbers, and they are
 * ACTIVE and BOOKABLE. A patient opening the app today can request an
 * appointment at a place that does not exist. That is the first thing this
 * fixes; the branding is the second.
 *
 * A clinic's phone numbers are contact details, not logins. Both go here, and
 * patients see them. Signing in is a different thing entirely: it is per
 * person, because an OTP has to reach a handset somebody is holding and because
 * the care thread now labels every reply with who wrote it. A shared desk
 * account would attribute every message to "Clinic Reception" and make the
 * audit trail useless. Give each staff member their own account with their own
 * number — scripts/setAccountPhone.js does that one.
 *
 * Reports by default and writes nothing:
 *
 *   node scripts/setClinicProfile.js
 *   node scripts/setClinicProfile.js --apply
 *
 * Any field can be overridden:
 *
 *   node scripts/setClinicProfile.js --name "New Name" --phone 9876543210 --apply
 *
 * Everything set here is editable afterwards from the clinic settings screen —
 * this is a starting point, not a hard-coding.
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Clinic } from '../src/models/Clinic.js';
import { Practice } from '../src/models/Practice.js';
import { User, ROLES } from '../src/models/User.js';
import { toE164 } from '../src/utils/phone.js';
import { logger } from '../src/config/logger.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
/** Read `--flag value`, or fall back. */
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i > -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};

/*
 * Every value is the operator's, typed on the command line. These defaulted to
 * one clinic's real name, doctor and switchboard, so a run that forgot a flag
 * wrote that clinic's identity onto whichever location sorted first.
 */
const PROFILE = {
  name: flag('name', ''),
  tagline: flag('tagline', ''),
  doctorDisplayName: flag('doctor', ''),
  phone: flag('phone', ''),
  altPhone: flag('alt-phone', ''),
  addressLine: flag('address', ''),
  city: flag('city', ''),
  registrationNo: flag('reg-no', ''),
};

/** Whether a clinic looks like one the seed invented. */
const isSeeded = (c) =>
  /Salt Lake Diabetes|Behala/i.test(c.name ?? '') || /^\+913340000/.test(c.phone ?? '');

async function main() {
  await connectDb();

  /*
   * A single-clinic tool, and it refuses to be anything else.
   *
   * It renames the first location and deactivates every other one on the
   * database. With practices, "every other location" is other practices'
   * buildings — their bookings would stop the moment it ran. A practice's
   * identity is edited from the app and the operator console now.
   */
  if ((await Practice.estimatedDocumentCount()) > 0) {
    logger.error(
      'This database has practices. Edit a practice from the operator console or the app; ' +
        'this script only ever applied to the single-clinic deployment.',
    );
    process.exitCode = 1;
    return;
  }
  if (!PROFILE.name || !PROFILE.phone) {
    logger.error('Say what to write: --name "<clinic name>" --phone <number> [--doctor "<printed name>"]');
    process.exitCode = 1;
    return;
  }

  const doctor = await User.findOne({ role: ROLES.DOCTOR, isActive: true }).select('_id name').lean();
  if (!doctor) {
    logger.error('No active doctor account. Run the seed first, or create one.');
    process.exitCode = 1;
    return;
  }

  const clinics = await Clinic.find().sort({ sortIndex: 1, createdAt: 1 });
  // The one to become the real clinic: the first, or a fresh one if there are
  // none. Chosen rather than guessed at, and reported before anything is
  // written — renaming the wrong row would move every appointment booked at it.
  const primary = clinics[0] ?? null;
  const others = clinics.slice(1).filter((c) => c.isActive);

  const phone = toE164(PROFILE.phone) ?? PROFILE.phone;
  const altPhone = PROFILE.altPhone ? (toE164(PROFILE.altPhone) ?? PROFILE.altPhone) : null;

  console.log('');
  console.log('  Doctor            :', doctor.name);
  console.log('  Clinics on record :', clinics.length);
  console.log('');
  if (primary) {
    console.log('  Updating this one:');
    console.log('    was  :', primary.name, primary.phone ? `(${primary.phone})` : '');
    console.log('    now  :', PROFILE.name, `(${phone}${altPhone ? `, ${altPhone}` : ''})`);
  } else {
    console.log('  No clinic exists — one will be created:');
    console.log('    name :', PROFILE.name);
  }

  if (others.length) {
    console.log('');
    console.log('  Also DEACTIVATING these, which patients can currently book at:');
    for (const c of others) {
      console.log(`    - ${c.name}${isSeeded(c) ? '  (looks like seed data)' : '  *** NOT seed data — check this ***'}`);
    }
    console.log('');
    console.log('  Deactivating is reversible and keeps their history: appointments');
    console.log('  already booked there keep a valid clinic reference.');
  }

  if (!apply) {
    console.log('');
    console.log('  Nothing written. Re-run with --apply to make these changes.');
    console.log('');
    return;
  }

  const fields = {
    name: PROFILE.name,
    tagline: PROFILE.tagline || undefined,
    doctorDisplayName: PROFILE.doctorDisplayName || undefined,
    phone,
    altPhone: altPhone ?? undefined,
    addressLine: PROFILE.addressLine || undefined,
    city: PROFILE.city || undefined,
    registrationNo: PROFILE.registrationNo || undefined,
    doctor: doctor._id,
    isActive: true,
  };

  if (primary) {
    Object.assign(primary, fields);
    await primary.save();
  } else {
    await Clinic.create({ ...fields, slotMinutes: 15, weeklyHours: [], sortIndex: 0 });
  }

  for (const c of others) {
    c.isActive = false;
    await c.save();
  }

  console.log('');
  console.log('  Done. The clinic profile is now editable from the app.');
  if (!PROFILE.addressLine) {
    console.log('  No address was set — add one from the clinic settings screen; it');
    console.log('  prints on the prescription letterhead.');
  }
  console.log('');
}

main()
  .catch((err) => {
    logger.error({ err: err.message }, 'setClinicProfile failed');
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
