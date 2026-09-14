/**
 * Enrols the patients a desk added before a new number was given an enrolment.
 *
 * Until the change that came with this script, `POST /doctor/patients` made an
 * account and a profile for a number MedPin had not seen, and no enrolment. So
 * every list scoped to a practice's enrolled patients left them out, and the
 * desk that had just added somebody could not find them. This finds them and
 * enrols each at the practice whose desk added them.
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
 * made, where that row could be nobody else, is matched. Anything else is
 * reported and left for a person: a wrong match gives somebody's record to the
 * wrong practice. Rows written since the change carry the account's id.
 *
 * ---- Which practice, and from when -----------------------------------------
 *
 * The practice the member of staff belonged to at the time; failing that, the
 * only practice they have ever belonged to. The enrolment is ACTIVE and dated
 * from when the account was made, so the practice keeps everything recorded
 * since, and a consent event says how it came to be.
 *
 *   node scripts/backfillDeskRegistrations.js           # report
 *   node scripts/backfillDeskRegistrations.js --apply   # write
 *
 * It reads `.env` from the directory it runs in, and that decides the database:
 * run it from the deployment's own `backend/`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { User, ROLES, CLINICIAN_ROLES } from '../src/models/User.js';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Membership } from '../src/models/Membership.js';
import { Practice } from '../src/models/Practice.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { ConsentEvent, CONSENT_ACTION, CONSENT_METHOD } from '../src/models/ConsentEvent.js';

/** How long after an account is made its registration's audit row may be written. */
export const MATCH_WINDOW_MS = 3000;

/**
 * Who would be enrolled where, without writing anything.
 *
 * @returns {Promise<{toEnrol: object[], skipped: object[], unmatched: number}>}
 */
export async function planDeskRegistrations({ windowMs = MATCH_WINDOW_MS } = {}) {
  const enrolled = new Set((await Enrollment.distinct('patient')).map(String));
  const orphans = (await User.find({ role: ROLES.PATIENT }).select('_id name createdAt').lean()).filter(
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
      practiceId,
      enrolledBy: row.actor ?? null,
      enrolledOn: o.createdAt,
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

/**
 * Write the plan. Idempotent: an enrolment that already exists is left alone.
 *
 * @returns {Promise<number>} enrolments written
 */
export async function applyDeskRegistrations(plan) {
  let written = 0;
  for (const e of plan.toEnrol) {
    const login = await User.findById(e.patientId).select('name dateOfBirth gender').lean();
    if (!login) continue;

    // The patient row the enrolment points at. A backfilled Patient shares its
    // login's id, which is why nothing else pointing at the patient moves.
    await Patient.updateOne(
      { _id: login._id },
      {
        $setOnInsert: {
          login: login._id,
          name: login.name,
          dateOfBirth: login.dateOfBirth ?? null,
          gender: login.gender ?? 'undisclosed',
          relationship: RELATIONSHIP.SELF,
        },
      },
      { upsert: true },
    );

    const result = await Enrollment.updateOne(
      { patient: login._id, practice: e.practiceId },
      {
        $setOnInsert: {
          status: ENROLLMENT_STATUS.ACTIVE,
          enrolledOn: e.enrolledOn,
          enrolledBy: e.enrolledBy ?? null,
          primaryDoctor: e.primaryDoctor ?? null,
          revokedAt: null,
          revokedBy: null,
        },
      },
      { upsert: true },
    );
    if (!result.upsertedId) continue;

    await ConsentEvent.record({
      enrollment: result.upsertedId,
      action: CONSENT_ACTION.GRANTED,
      actor: e.enrolledBy ?? null,
      method: CONSENT_METHOD.MIGRATION,
      note: 'Registered at this practice’s desk before new numbers were enrolled; enrolled by backfillDeskRegistrations',
    });
    written += 1;
  }
  return written;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  await connectDb();
  try {
    const plan = await planDeskRegistrations();
    const names = new Map(
      (await Practice.find({ _id: { $in: plan.toEnrol.map((e) => e.practiceId) } }).select('name').lean()).map(
        (p) => [String(p._id), p.name],
      ),
    );

    console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
    console.log(`  ${plan.toEnrol.length} patient(s) to enrol, ACTIVE, from the day they were added:`);
    for (const e of plan.toEnrol) {
      const since = new Date(e.enrolledOn).toISOString().slice(0, 10);
      console.log(`    ${e.name} → ${names.get(String(e.practiceId)) ?? e.practiceId}, from ${since}`);
    }
    console.log(`  ${plan.skipped.length} left for a person to decide:`);
    for (const s of plan.skipped) console.log(`    ${s.name} (${s.patientId}): ${s.reason}`);
    console.log(`  ${plan.unmatched} patient(s) with no enrolment and no desk registration (self sign-ups): left alone`);

    if (!apply) {
      console.log('\nRe-run with --apply.\n');
      return;
    }
    const written = await applyDeskRegistrations(plan);
    console.log(`\n  enrolled ${written} patient(s). Nothing was removed.\n`);
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
