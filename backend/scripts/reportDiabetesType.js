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
import { User, ROLES } from '../src/models/User.js';

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
  console.log(
    'Nothing was changed. To correct one, ask the patient and set it in the\n' +
      "app — Profile → Health details. There is no bulk fix on purpose: a type\n" +
      'assumed in bulk is how this list came to exist.\n',
  );

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
