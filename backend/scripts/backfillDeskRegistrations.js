/**
 * Lists the patients a desk added before a new number was given an enrolment,
 * so each can be enrolled one at a time — with their consent — rather than in
 * bulk.
 *
 * Until the change that came with this script, `POST /doctor/patients` made an
 * account and a profile for a number MedPin had not seen, and no enrolment. So
 * every list scoped to a practice's enrolled patients left them out, and the
 * desk that had just added somebody could not find them.
 *
 * ---- Why it no longer writes -------------------------------------------------
 *
 * It used to enrol every patient it matched, ACTIVE, in one run. That is a bulk
 * backfill of real patients into practices, decided by matching audit rows to
 * accounts by time, and the specification rules it out: enrolment is one
 * patient at a time, approved. A wrong match here would hand a stranger's record
 * to a practice with nobody having said yes — and "the desk made the account"
 * is not the same sentence as "the patient agreed to this practice", least of
 * all for an account that has been used on its own since.
 *
 * So `--apply` is gone. The report is still worth having: it tells each
 * practice exactly who it registered and cannot see. The desk registers each
 * one again from the app; the number already has an account, so the patient is
 * texted a code and the enrolment exists when they read it back. The history
 * from before is then theirs to share or not, through the question the app asks
 * them once.
 *
 * ---- Which patients ------------------------------------------------------
 *
 * A patient account with no enrolment anywhere is either one of these or a self
 * sign-up. A self sign-up is unaffiliated by decision until a practice enrols
 * them, so it must be left alone — and its profile cannot tell it apart, since
 * sign-up assigns a doctor too. What tells them apart is the desk route's audit
 * row: `create User` on `POST /patients`, answered 201 by a member of staff. A
 * known number answered 200 and made no account.
 *
 * Those rows did not record the account's id, so the two are matched by time.
 * The row is written as the response finishes, moments after the account is
 * made. A patient with exactly one such row within MATCH_WINDOW_MS of being
 * made, where that row could be nobody else, is listed against that practice.
 * Anything else is listed as unresolved. Rows written since the change carry
 * the account's id.
 *
 *   node scripts/backfillDeskRegistrations.js           # report; writes nothing, ever
 *
 * It reads `.env` from the directory it runs in, and that decides the database:
 * run it from the deployment's own `backend/`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { User, ROLES, CLINICIAN_ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Membership } from '../src/models/Membership.js';
import { Practice } from '../src/models/Practice.js';
import { AuditLog } from '../src/models/AuditLog.js';

/** How long after an account is made its registration's audit row may be written. */
export const MATCH_WINDOW_MS = 3000;

/**
 * Who each practice registered and cannot see, without writing anything.
 *
 * @returns {Promise<{toEnrol: object[], skipped: object[], unmatched: number}>}
 *   `toEnrol` is the list for each desk to register again, one at a time.
 */
export async function planDeskRegistrations({ windowMs = MATCH_WINDOW_MS } = {}) {
  const enrolled = new Set((await Enrollment.distinct('patient')).map(String));
  const orphans = (await User.find({ role: ROLES.PATIENT }).select('_id name phone createdAt').lean()).filter(
    (u) => !enrolled.has(String(u._id)),
  );

  const toEnrol = [];
  const skipped = [];
  if (!orphans.length) return { toEnrol, skipped, unmatched: 0 };

  const audits = await AuditLog.find({
    action: 'create',
    resource: 'User',
    actorRole: { $in: CLINICIAN_ROLES },
    'meta.method': 'POST',
    'meta.path': '/patients',
    'meta.status': 201,
  })
    .select('_id actor at resourceId')
    .lean();

  // Each orphan's candidate rows, and each row's candidate orphans.
  const rowsFor = new Map();
  const orphansFor = new Map();
  for (const o of orphans) {
    const made = new Date(o.createdAt).getTime();
    const near = audits.filter((a) => {
      if (a.resourceId) return String(a.resourceId) === String(o._id);
      const at = new Date(a.at).getTime();
      return at >= made && at - made <= windowMs;
    });
    rowsFor.set(String(o._id), near);
    for (const a of near) {
      const key = String(a._id);
      if (!orphansFor.has(key)) orphansFor.set(key, []);
      orphansFor.get(key).push(o);
    }
  }

  let unmatched = 0;
  for (const o of orphans) {
    const near = rowsFor.get(String(o._id));
    if (!near.length) {
      // A self sign-up, or an account no desk made. Not this script's to place.
      unmatched += 1;
      continue;
    }
    if (near.length > 1 || orphansFor.get(String(near[0]._id)).length > 1) {
      skipped.push({ patientId: o._id, name: o.name, reason: 'More than one registration could be this patient' });
      continue;
    }

    const row = near[0];
    const practiceId = await practiceOfActorAt(row.actor, row.at);
    if (!practiceId) {
      skipped.push({
        patientId: o._id,
        name: o.name,
        reason: 'The member of staff who added them did not belong to exactly one practice',
      });
      continue;
    }

    const profile = await PatientProfile.findOne({ user: o._id }).select('assignedDoctor').lean();
    const doctorHere = profile?.assignedDoctor
      ? await Membership.exists({ user: profile.assignedDoctor, practice: practiceId })
      : null;

    toEnrol.push({
      patientId: o._id,
      name: o.name,
      phone: o.phone ?? null,
      practiceId,
      addedBy: row.actor ?? null,
      addedOn: o.createdAt,
      primaryDoctor: doctorHere ? profile.assignedDoctor : null,
    });
  }

  return { toEnrol, skipped, unmatched };
}

/** The practice somebody belonged to at a moment, or the only one they ever did. */
async function practiceOfActorAt(actor, at) {
  if (!actor) return null;
  const rows = await Membership.find({ user: actor }).select('practice startedOn endedOn').lean();
  const when = new Date(at).getTime();
  const then = [
    ...new Set(
      rows
        .filter(
          (m) =>
            (!m.startedOn || new Date(m.startedOn).getTime() <= when) &&
            (!m.endedOn || new Date(m.endedOn).getTime() >= when),
        )
        .map((m) => String(m.practice)),
    ),
  ];
  if (then.length === 1) return then[0];
  if (then.length > 1) return null;
  const ever = [...new Set(rows.map((m) => String(m.practice)))];
  return ever.length === 1 ? ever[0] : null;
}

async function main(argv) {
  if (argv.includes('--apply')) {
    // Said, rather than silently ignored: somebody following an old runbook
    // should learn why nothing happened.
    console.log(
      '\n--apply no longer exists. Patients are not enrolled in bulk: each desk registers its\n' +
        'patients again from the app, and each patient reads back their own code. The list\n' +
        'below is who to register.\n',
    );
  }
  await connectDb();
  try {
    const plan = await planDeskRegistrations();
    const names = new Map(
      (await Practice.find({ _id: { $in: plan.toEnrol.map((e) => e.practiceId) } }).select('name').lean()).map(
        (p) => [String(p._id), p.name],
      ),
    );

    console.log('\nREPORT — nothing is written\n');
    console.log(`  ${plan.toEnrol.length} patient(s) a desk added and its practice cannot see.`);
    console.log('  Register each again from that practice’s app; the patient reads back a code:');
    for (const e of plan.toEnrol) {
      const since = new Date(e.addedOn).toISOString().slice(0, 10);
      console.log(`    ${names.get(String(e.practiceId)) ?? e.practiceId}: ${e.name} (${e.phone ?? 'no number'}), added ${since}`);
    }
    console.log(`  ${plan.skipped.length} that could not be matched to one practice — ask the practices:`);
    for (const s of plan.skipped) console.log(`    ${s.name} (${s.patientId}): ${s.reason}`);
    console.log(`  ${plan.unmatched} patient(s) with no enrolment and no desk registration (self sign-ups): left alone\n`);
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
