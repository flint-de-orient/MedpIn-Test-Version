#!/usr/bin/env node
/**
 * Mark the feedback already on record for what it is: unattributed, and private.
 *
 *   node scripts/backfillFeedbackRouting.js           # report
 *   node scripts/backfillFeedbackRouting.js --apply   # write
 *
 * ---- Why ----------------------------------------------------------------------
 *
 * Feedback used to store the patient and nothing else, and every practice that
 * patient was enrolled at read all of it. New feedback records where it went —
 * a practice, and the enrolment it went through, or MedPin — and each inbox
 * reads only what went to it.
 *
 * The rows from before cannot be given that answer. Nothing on them says which
 * clinic a complaint was about, and for a patient at two practices the old
 * inbox had already shown it to both. Guessing — the patient's only practice at
 * the time, say — would be inventing an address for somebody's words. So they
 * are recorded as `legacy_unattributed`, routed nowhere, and stay readable by
 * the patient who wrote them and nobody else.
 *
 * Every inbox already ignores them — they ask for a route explicitly — so the
 * application behaves the same before and after this runs. What it adds is the
 * provenance on the row, so the data says what the code assumes.
 *
 * ---- What it writes -----------------------------------------------------------
 *
 * On rows with no `origin` only:
 *
 *   origin         legacy_unattributed
 *   route          none
 *   state          open — no reply could be sent to them
 *   createdBy      the row's patient. The old route stored the signed-in account
 *                  as the patient and refused anybody who was not a patient, so
 *                  this is what the row already said, not a guess.
 *   createdByRole  patient, for the same reason
 *
 * Nothing is deleted, and the old `reviewedAt` / `reviewedBy` stay as they are.
 * Every write repeats its "no origin" condition, so a second run changes
 * nothing. Dry run by default; reads `.env` from the directory it runs in — run
 * it from the deployment's own `backend/`, after a mongodump of `feedbacks`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Feedback, FEEDBACK_ORIGIN, FEEDBACK_ROUTE, FEEDBACK_STATE } from '../src/models/Feedback.js';

const UNATTRIBUTED = { origin: { $exists: false } };

/** What applying would write, without writing it. */
export async function planFeedbackRouting() {
  const rows = await Feedback.find(UNATTRIBUTED).select('_id patient about reviewedAt createdAt').lean();
  return {
    rows: rows.map((r) => ({ id: r._id, patient: r.patient, about: r.about, reviewed: Boolean(r.reviewedAt) })),
    about: {
      app: rows.filter((r) => r.about === 'app').length,
      clinic: rows.filter((r) => r.about === 'clinic').length,
    },
  };
}

/** Writes the plan. Each write keeps its "no origin" condition. */
export async function applyFeedbackRouting(plan) {
  let written = 0;
  for (const row of plan.rows) {
    const r = await Feedback.updateOne(
      { _id: row.id, ...UNATTRIBUTED },
      {
        $set: {
          origin: FEEDBACK_ORIGIN.LEGACY_UNATTRIBUTED,
          route: FEEDBACK_ROUTE.NONE,
          state: FEEDBACK_STATE.OPEN,
          createdBy: row.patient,
          createdByRole: 'patient',
        },
      },
    );
    written += r.modifiedCount ?? 0;
  }
  return written;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  await connectDb();
  try {
    const plan = await planFeedbackRouting();
    console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
    console.log(`  Feedback with no recorded destination: ${plan.rows.length}`);
    console.log(`    about the app: ${plan.about.app}, about a clinic: ${plan.about.clinic}`);
    console.log(`    of which a practice had marked reviewed: ${plan.rows.filter((r) => r.reviewed).length}`);
    console.log('  Each becomes legacy_unattributed: private to the patient who wrote it, in no inbox.');

    if (!apply) {
      console.log('\nRe-run with --apply to write it.\n');
      return;
    }
    console.log(`\n  marked ${await applyFeedbackRouting(plan)} row(s). Nothing was removed.\n`);
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
