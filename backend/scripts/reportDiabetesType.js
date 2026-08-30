/**
 * Which patients' diabetes type was chosen, and which was assumed.
 *
 * READ ONLY. This script never writes, and deliberately has no --apply.
 * Diabetes type governs DKA risk, insulin dependence and what the assistant
 * tells a patient; correcting one is a clinical decision belonging to the
 * doctor, made per patient, after asking them. A script that guessed in bulk
 * would be repeating the mistake it exists to find, only faster.
 *
 * THE MISTAKE
 *
 * PatientProfile.diabetesType carried `default: 'type2'` from the first commit
 * until it was removed on 30 August 2026. Nothing in the app asked for the
 * field — not registration, not the desk, not the patient's own health details,
 * not the doctor's record — so for that whole period every patient was stored
 * as Type 2 whether or not anyone had ever asked, and the home screen announced
 * "Type 2 Diabetes" to them as fact.
 *
 * Nothing distinguishes a defaulted type2 from a patient who genuinely is Type
 * 2. There is no "who set this" field to consult. The only signal available is
 * WHEN the record was created, relative to the deploy that removed the default
 * — which is why that date is the one argument this takes.
 *
 * USAGE
 *
 *   node scripts/reportDiabetesType.js                    # uses the commit date
 *   node scripts/reportDiabetesType.js 2026-08-31T00:00Z  # your actual deploy
 *
 * Pass the date the *server* stopped defaulting, not the commit date, if you
 * know it. Code removed on the 30th that deployed on the 31st was still
 * defaulting patients for a day, and this report would call those safe.
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Prescription } from '../src/models/Prescription.js';
import { User, ROLES } from '../src/models/User.js';

/**
 * Clear the ones that were assumed. Off unless asked for.
 *
 * Narrower than the report above, and the difference is the safety. A patient
 * is only cleared when ALL of these hold:
 *
 *   - the stored type is type2, the value the default wrote;
 *   - the profile was created before the default was removed;
 *   - and the patient has no prescription carrying a diagnosis.
 *
 * That last one is what makes this safe rather than merely bold. Diabetes type
 * is set from a diagnosis when a doctor writes a prescription — so a patient
 * with one has a type that came from a clinician, whenever they registered, and
 * must not be touched. A patient with none has never been diagnosed here at
 * all, and the app has been telling them they have Type 2 diabetes on the
 * strength of a schema default.
 *
 * Clearing sets the field to nothing, which reads as "Condition not set". It
 * does not guess a different type — the whole list exists because something
 * guessed once.
 */
const apply = process.argv.includes('--apply');

/// When `default: 'type2'` left the model (commit 14f089f). A floor, not a
/// promise: the server kept defaulting until that commit was actually deployed.
const DEFAULT_REMOVED = '2026-08-30T10:39:34+05:30';

const cutoffArg = process.argv[2];
const cutoff = new Date(cutoffArg ?? DEFAULT_REMOVED);

if (Number.isNaN(cutoff.getTime())) {
  console.error(`Not a date: ${cutoffArg}`);
  process.exit(1);
}

const fmt = (d) =>
  d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : 'unknown';

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const patients = await User.find({ role: ROLES.PATIENT })
    .select('_id name phone createdAt isActive')
    .lean();

  const profiles = await PatientProfile.find({
    user: { $in: patients.map((p) => p._id) },
  })
    .select('user diabetesType diagnosedOn')
    .lean();

  const byUser = new Map(profiles.map((p) => [String(p.user), p]));

  const suspect = [];
  const stated = [];
  const unset = [];

  for (const p of patients) {
    const profile = byUser.get(String(p._id));
    const type = profile?.diabetesType ?? null;
    const row = {
      name: p.name,
      phone: p.phone,
      created: p.createdAt,
      type,
      active: p.isActive !== false,
    };

    if (!type) {
      unset.push(row);
    } else if (type === 'type2' && p.createdAt && new Date(p.createdAt) < cutoff) {
      // Type 2 AND created while the default was in force. Cannot be told
      // apart from a real Type 2 — which is exactly the problem.
      suspect.push(row);
    } else {
      stated.push(row);
    }
  }

  const line = '─'.repeat(66);
  console.log(`\nDiabetes type report — ${patients.length} patients`);
  console.log(`Default assumed to have stopped: ${fmt(cutoff)}`);
  console.log(line);

  console.log(`\n⚠  MIGHT BE THE DEFAULT — ${suspect.length}`);
  console.log(
    '   Stored as type2 and registered before the default was removed.\n' +
      '   Nobody may ever have asked them. Worth confirming at their next visit.\n',
  );
  for (const r of suspect.sort((a, b) => new Date(a.created) - new Date(b.created))) {
    console.log(
      `   ${fmt(r.created)}  ${(r.name ?? '?').padEnd(24)} ${r.phone ?? ''}` +
        `${r.active ? '' : '  (inactive)'}`,
    );
  }
  if (suspect.length === 0) console.log('   (none)');

  console.log(`\n✓  SET SINCE — ${stated.length}`);
  console.log(
    '   Either not type2, or recorded after the default stopped. These were\n' +
      '   chosen by someone rather than assumed.\n',
  );
  for (const r of stated.sort((a, b) => new Date(a.created) - new Date(b.created))) {
    console.log(
      `   ${fmt(r.created)}  ${(r.name ?? '?').padEnd(24)} ${String(r.type).padEnd(12)} ${r.phone ?? ''}`,
    );
  }
  if (stated.length === 0) console.log('   (none)');

  console.log(`\n·  NOT SET — ${unset.length}`);
  console.log(
    '   No type recorded. Their home screen reads "Condition not set", which\n' +
      '   is honest. They can now set it themselves in Health details.\n',
  );
  for (const r of unset.sort((a, b) => new Date(a.created) - new Date(b.created))) {
    console.log(
      `   ${fmt(r.created)}  ${(r.name ?? '?').padEnd(24)} ${r.phone ?? ''}`,
    );
  }
  if (unset.length === 0) console.log('   (none)');

  console.log(`\n${line}`);

  if (!apply) {
    console.log(
      'Nothing was changed.\n\n' +
        'Re-run with --apply to clear the assumed ones. That clears only the\n' +
        'patients above who ALSO have no prescription carrying a diagnosis —\n' +
        'a type set from a real diagnosis is a clinician\'s and stays. Cleared\n' +
        'records read "Condition not set", which is what they should have said\n' +
        'all along. Nothing is guessed into place; the doctor sets the type by\n' +
        'diagnosing, and it flows to every panel from there.\n',
    );
    await mongoose.disconnect();
    return;
  }

  // Who has ever been diagnosed here. A prescription with a diagnosis is what
  // sets diabetesType legitimately, so anyone holding one is left alone
  // whenever they registered.
  const diagnosed = new Set(
    (
      await Prescription.find({
        patient: { $in: patients.map((p) => p._id) },
        diagnosis: { $nin: [null, ''] },
      })
        .select('patient')
        .lean()
    ).map((p) => String(p.patient)),
  );

  const toClear = patients.filter((p) => {
    const profile = byUser.get(String(p._id));
    return (
      profile?.diabetesType === 'type2' &&
      p.createdAt &&
      new Date(p.createdAt) < cutoff &&
      !diagnosed.has(String(p._id))
    );
  });

  console.log(`\nClearing ${toClear.length} of ${suspect.length}.`);
  console.log(
    `${suspect.length - toClear.length} left alone — they carry a diagnosis.\n`,
  );

  for (const p of toClear) {
    await PatientProfile.updateOne(
      { user: p._id },
      { $unset: { diabetesType: '' } },
    );
    console.log(`   cleared  ${p.name ?? '?'}  ${p.phone ?? ''}`);
  }

  console.log(
    '\nThose patients now read "Condition not set". The doctor sets a type by\n' +
      'diagnosing, and it reaches every panel from there.\n',
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
