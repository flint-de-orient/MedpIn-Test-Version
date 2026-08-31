/**
 * Clears the demo data before real patients are onboarded.
 *
 * The clinic has been running on invented people — Rahul Das, Ayesha Rahman,
 * Sunita Sharma and the rest — with invented readings, chats, prescriptions and
 * appointments behind them. None of it should be in the database on the morning
 * the first real patient walks in: it makes the doctor's lists lie, it makes
 * every count wrong, and a demo name sitting in the care inbox next to a real
 * one is a mistake waiting to be made.
 *
 * Reports by default. Nothing is written without --apply.
 *
 *   node scripts/wipeDemoData.js                          # show what would go
 *   node scripts/wipeDemoData.js --apply                  # do it
 *   node scripts/wipeDemoData.js --apply --drop-dieticians
 *
 * ---- What survives --------------------------------------------------------
 *
 * The clinic and the people who work in it. Specifically:
 *
 *   - the doctor, the front desk, and (unless --drop-dieticians) the dietician
 *   - the Clinic row: name, tagline, address, phones, opening hours, slot
 *     length, and the logo
 *   - ClinicSettings
 *   - the clinic's logo and the doctor's signature images
 *   - MedicineBrand, the medicine dictionary — reference data, not demo data
 *   - KnowledgeChunk, what the assistant answers patients from
 *
 * The logo and the signature are the two that a naive "delete every
 * MediaAsset" would take with it, and they are the two nobody would think to
 * check until a prescription printed with a blank letterhead. They are found by
 * following the references rather than by guessing at `kind`, so an asset the
 * clinic is actually using is kept whatever it was uploaded as.
 *
 * ---- Why this deletes rather than deactivates -----------------------------
 *
 * `retireTestPatients.js` deactivates, and is right to: it flips a flag on a
 * user while every chat message, food log and prescription pointing at them
 * stays. Deleting the user there would leave all of that dangling.
 *
 * Here the referencing data goes too — every patient-scoped collection is
 * emptied in the same run — so there is nothing left to dangle. A pre-launch
 * database with no rows pointing at nothing is worth more than an audit trail
 * of people who never existed.
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { User, ROLES } from '../src/models/User.js';
import { Clinic } from '../src/models/Clinic.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { RefreshToken } from '../src/models/RefreshToken.js';

import { Appointment } from '../src/models/Appointment.js';
import { AppointmentWaitlist } from '../src/models/AppointmentWaitlist.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { DietPlan } from '../src/models/DietPlan.js';
import { DietPlanRevision } from '../src/models/DietPlanRevision.js';
import { DirectMessage } from '../src/models/DirectMessage.js';
import { EyeReport } from '../src/models/EyeReport.js';
import { Feedback } from '../src/models/Feedback.js';
import { FoodLog } from '../src/models/FoodLog.js';
import { FootAssessment } from '../src/models/FootAssessment.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { Hba1cRecord } from '../src/models/Hba1cRecord.js';
import { LabReport } from '../src/models/LabReport.js';
import { LabResult } from '../src/models/LabResult.js';
import { LifestyleLog } from '../src/models/LifestyleLog.js';
import { Medication } from '../src/models/Medication.js';
import { MedicationLog } from '../src/models/MedicationLog.js';
import { OtpChallenge } from '../src/models/OtpChallenge.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Prescription } from '../src/models/Prescription.js';
import { ReminderRun } from '../src/models/ReminderRun.js';
import { VitalRecord } from '../src/models/VitalRecord.js';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dropDieticians = args.includes('--drop-dieticians');

/**
 * Emptied completely. Every one of these is patient-scoped by definition —
 * there is no such thing as a glucose reading or a food log that belongs to the
 * clinic rather than to somebody.
 */
const PATIENT_SCOPED = [
  ['appointments', Appointment],
  ['appointment waitlist', AppointmentWaitlist],
  ['chat messages', ChatMessage],
  ['chat sessions', ChatSession],
  ['clinical alerts', ClinicalAlert],
  ['diet plans', DietPlan],
  ['diet plan revisions', DietPlanRevision],
  ['direct messages', DirectMessage],
  ['eye reports', EyeReport],
  ['feedback', Feedback],
  ['food logs', FoodLog],
  ['foot assessments', FootAssessment],
  ['glucose readings', GlucoseReading],
  ['HbA1c records', Hba1cRecord],
  ['lab reports', LabReport],
  ['lab results', LabResult],
  ['lifestyle logs', LifestyleLog],
  ['medications', Medication],
  ['medication logs', MedicationLog],
  ['patient profiles', PatientProfile],
  ['prescriptions', Prescription],
  ['vital records', VitalRecord],
  // Not patient data, but demo runtime state: half-finished OTPs and the
  // record of which reminder passes have already fired today.
  ['OTP challenges', OtpChallenge],
  ['reminder runs', ReminderRun],
  // An audit trail of people who never existed.
  ['audit log', AuditLog],
];

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const keptRoles = [ROLES.DOCTOR, ROLES.STAFF];
  if (!dropDieticians) keptRoles.push(ROLES.DIETICIAN);

  const kept = await User.find({ role: { $in: keptRoles } })
    .select('_id name role phone avatarAssetId signatureAssetId')
    .lean();
  const going = await User.find({ role: { $nin: keptRoles } })
    .select('_id name role')
    .lean();

  // Followed, not guessed. An asset is kept because something the clinic still
  // uses points at it — which is true of the logo whatever `kind` it was
  // uploaded under, and stays true if a field is added later.
  const clinics = await Clinic.find()
    .select('name logoLightAssetId logoDarkAssetId')
    .lean();
  const keepAssets = new Set(
    [
      ...clinics.flatMap((c) => [c.logoLightAssetId, c.logoDarkAssetId]),
      ...kept.flatMap((u) => [u.avatarAssetId, u.signatureAssetId]),
    ]
      .filter(Boolean)
      .map(String),
  );

  const assetTotal = await MediaAsset.countDocuments();

  console.log(`\n${apply ? 'WIPING' : 'DRY RUN — nothing will be written'}\n`);

  console.log('Keeping these accounts:');
  for (const u of kept) console.log(`  ${u.role.padEnd(10)} ${u.name} (${u.phone ?? '—'})`);
  if (!kept.some((u) => u.role === ROLES.DOCTOR)) {
    console.error('\nREFUSING: no doctor account would survive this.');
    console.error('That is not a demo wipe, it is an empty clinic. Check the roles.');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`\nKeeping ${clinics.length} clinic row(s): ${clinics.map((c) => c.name).join(', ')}`);
  if (clinics.length > 1) {
    // The one thing here a script cannot decide. A second clinic row is either
    // a real second location or a leftover from the demo, and only a person
    // knows which — so it is named rather than guessed at. Left behind, a demo
    // clinic appears in the desk's booking picker and a patient can be given an
    // appointment at an address that does not exist.
    console.log('  ^ more than one clinic. Any demo ones must be deleted by hand');
    console.log('    (Profile -> Clinics) — this script keeps every clinic row.');
  }
  console.log(`Keeping ${keepAssets.size} image(s) — clinic logo and signature.`);
  console.log(`\nDeleting ${going.length} account(s):`);
  for (const u of going.slice(0, 25)) console.log(`  ${u.role.padEnd(10)} ${u.name}`);
  if (going.length > 25) console.log(`  … and ${going.length - 25} more`);

  console.log('\nCollections:');
  for (const [label, Model] of PATIENT_SCOPED) {
    const n = await Model.countDocuments();
    if (n) console.log(`  ${String(n).padStart(6)}  ${label}`);
  }
  console.log(`  ${String(assetTotal - keepAssets.size).padStart(6)}  uploaded files (of ${assetTotal})`);

  if (!apply) {
    console.log('\nRe-run with --apply to carry this out.\n');
    await mongoose.disconnect();
    return;
  }

  for (const [label, Model] of PATIENT_SCOPED) {
    const { deletedCount } = await Model.deleteMany({});
    if (deletedCount) console.log(`  removed ${deletedCount} ${label}`);
  }

  const assets = await MediaAsset.deleteMany({ _id: { $nin: [...keepAssets] } });
  console.log(`  removed ${assets.deletedCount} uploaded files`);

  // Sessions belonging to accounts that no longer exist. The clinic's own stay,
  // so nobody is signed out on the morning they are onboarding patients.
  const tokens = await RefreshToken.deleteMany({
    user: { $in: going.map((u) => u._id) },
  });
  console.log(`  removed ${tokens.deletedCount} sessions`);

  const users = await User.deleteMany({ role: { $nin: keptRoles } });
  console.log(`  removed ${users.deletedCount} accounts`);

  console.log('\nDone. The files themselves are still on disk under UPLOAD_DIR —');
  console.log('nothing references them now, and they can be cleared at leisure.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
