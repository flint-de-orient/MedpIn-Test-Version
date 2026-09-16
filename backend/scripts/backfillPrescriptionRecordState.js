#!/usr/bin/env node
/**
 * Give the prescriptions that were switched off with a bare flag a state.
 *
 *   node scripts/backfillPrescriptionRecordState.js           # report
 *   node scripts/backfillPrescriptionRecordState.js --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * Creating a prescription with `supersedes` used to run
 *
 *     Prescription.updateOne({ _id: body.supersedes }, { isActive: false })
 *
 * which ends a clinical record by clearing a boolean. `recordState` stayed
 * `current`, so the row reads as in force while every screen treats it as
 * gone, and nothing says who ended it, why, or what replaced it. A pharmacist
 * looking at the history cannot tell a prescription replaced by a better one
 * from one voided as issued in error.
 *
 * The route now calls `endAs(SUPERSEDED, …)`. This gives the rows written
 * before that the same shape.
 *
 * ---- What it can honestly recover ---------------------------------------
 *
 * The state, and the link. `isActive: false` with `recordState: current` can
 * only have come from that one line — every other ending goes through
 * `endAs`, which sets both — so `superseded` is the true state, not a guess.
 *
 * The replacement is recoverable too: the prescription written in its place
 * stores `supersedes`, pointing back. Where exactly one does, `replacedBy`
 * links them and the reason names it. Where none does, the row is still
 * marked superseded and the reason says plainly that the record does not say
 * what replaced it — which is the honest entry, and better than inventing one.
 *
 * `endedBy` stays null throughout. The old line recorded no actor and there is
 * nothing in the row to infer one from; a guess here would be a clinical
 * record naming a doctor who may not have done it.
 *
 * ---- Safety --------------------------------------------------------------
 *
 * Dry run by default. It touches only rows that are `isActive: false` and
 * `recordState: current`, so a second run changes nothing, and it never
 * rewrites a row that already carries a state — including one ended by hand
 * through `POST /records/prescriptions/:id/end`.
 *
 * It reads `.env` from the directory it runs in, and that file alone decides
 * which database it writes to: run it from the deployment's own `backend/`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Prescription } from '../src/models/Prescription.js';
import { RECORD_STATE } from '../src/models/plugins/clinicalRecord.js';

/** The rows the old line left behind: switched off, with no state. */
export const STRANDED = { isActive: false, recordState: RECORD_STATE.CURRENT };

/**
 * What applying would do, without doing it.
 *
 * @returns {Promise<{linked: object[], unlinked: object[]}>}
 */
export async function planRecordState() {
  const stranded = await Prescription.find(STRANDED)
    .select('_id patient referenceNo issuedOn updatedAt')
    .sort({ issuedOn: 1 })
    .lean();

  const linked = [];
  const unlinked = [];

  for (const row of stranded) {
    /*
     * Its replacement names it. More than one would mean two prescriptions
     * claiming to replace the same record — which the route cannot produce and
     * a person should look at, so it is reported rather than linked to the
     * first.
     */
    const replacements = await Prescription.find({ supersedes: row._id })
      .select('_id referenceNo issuedOn')
      .lean();

    if (replacements.length === 1) linked.push({ row, by: replacements[0] });
    else unlinked.push({ row, claims: replacements.length });
  }

  return { linked, unlinked };
}

/**
 * Write the state, and the link where there is one.
 *
 * The `STRANDED` condition is repeated in each update rather than trusted from
 * the plan, so a prescription ended properly between the dry run and this is
 * left exactly as it was ended.
 */
export async function applyRecordState(plan) {
  let changed = 0;

  for (const { row, by } of plan.linked) {
    const result = await Prescription.updateOne(
      { _id: row._id, ...STRANDED },
      {
        $set: {
          recordState: RECORD_STATE.SUPERSEDED,
          endedAt: row.updatedAt ?? row.issuedOn,
          endedReason: `Replaced by prescription ${by.referenceNo}. Recorded by backfill; the original ending stored no reason.`,
          replacedBy: by._id,
        },
      },
    );
    changed += result.modifiedCount ?? 0;
  }

  for (const { row } of plan.unlinked) {
    const result = await Prescription.updateOne(
      { _id: row._id, ...STRANDED },
      {
        $set: {
          recordState: RECORD_STATE.SUPERSEDED,
          endedAt: row.updatedAt ?? row.issuedOn,
          endedReason:
            'Ended when a later prescription replaced it. Recorded by backfill; the record does not say which, or who ended it.',
        },
      },
    );
    changed += result.modifiedCount ?? 0;
  }

  return changed;
}

async function main(argv) {
  const apply = argv.includes('--apply');

  await connectDb();
  try {
    const plan = await planRecordState();
    const total = plan.linked.length + plan.unlinked.length;

    if (total === 0) {
      console.log('Nothing to do: every ended prescription already carries a state.');
      return;
    }

    console.log(`${total} prescription(s) were switched off without a state:`);
    console.log(`  ${plan.linked.length} can be linked to the prescription that replaced them`);
    console.log(`  ${plan.unlinked.length} cannot — the reason will say so`);

    const contested = plan.unlinked.filter((u) => u.claims > 1);
    if (contested.length) {
      console.log(
        `\n  ${contested.length} of those are claimed by more than one prescription. Read these before applying:`,
      );
      for (const { row, claims } of contested) {
        console.log(`    ${row.referenceNo} — ${claims} prescriptions name it`);
      }
    }

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }

    const changed = await applyRecordState(plan);
    console.log(`\nWritten: ${changed} row(s).`);
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
