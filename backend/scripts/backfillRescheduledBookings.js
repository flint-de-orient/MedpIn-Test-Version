#!/usr/bin/env node
/**
 * Give appointments moved before the reschedule fix the status they should
 * have had.
 *
 *   node scripts/backfillRescheduledBookings.js           # report
 *   node scripts/backfillRescheduledBookings.js --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------------
 *
 * Moving an appointment cancelled the original and wrote its replacement as
 * `requested`, with a time on it and no day the patient had asked for. So a
 * visit the patient or the desk had moved left the booked list and sat under
 * "Waiting for a time" as a request with no day, while holding the slot it was
 * moved into. The route now writes the replacement as `confirmed`; the rows it
 * wrote before still say `requested`.
 *
 * ---- What it writes ------------------------------------------------------------
 *
 * Only replacements that are still exactly what the old route left — status
 * `requested`, a `rescheduledFrom` pointing at a cancelled appointment, a time,
 * no preferred day — and whose time is still ahead. Those become `confirmed`.
 * The time passed the same slot check a booking passes when it was chosen, it
 * has held that slot ever since, and a booking made that way today is confirmed.
 * Nobody is notified: the patient already believes they have that time.
 *
 * ---- What it only reports ------------------------------------------------------
 *
 * Replacements whose time has passed. Whether that visit happened is not
 * something the database knows, and marking a past row confirmed would say a
 * booking stood that nobody can now vouch for. The desk can close them from the
 * app; the list tells them which.
 *
 * Replacements whose original is missing or not cancelled. The old route could
 * not produce that, so something else did, and it is left for a person.
 *
 * Dry run by default. Every write repeats its condition, so a row the desk
 * confirmed, declined or moved between the report and the apply is kept as the
 * desk left it, and a second run changes nothing. Reads `.env` from the
 * directory it runs in — run it from the deployment's own `backend/`, after a
 * mongodump of `appointments`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Appointment } from '../src/models/Appointment.js';

/** A replacement the old reschedule route wrote, still as it wrote it. */
export const LEFT_AS_REQUEST = Object.freeze({
  status: 'requested',
  rescheduledFrom: { $ne: null },
  scheduledFor: { $ne: null },
  preferredFor: null,
});

/**
 * Which rows applying would confirm, and which it would leave, without writing.
 *
 * @returns {Promise<{confirm: object[], past: object[], unexplained: object[]}>}
 */
export async function planRescheduledBookings({ now = new Date() } = {}) {
  const rows = await Appointment.find(LEFT_AS_REQUEST)
    .select('_id patient doctor practice scheduledFor rescheduledFrom')
    .sort({ scheduledFor: 1 })
    .lean();

  const originals = new Map(
    (
      await Appointment.find({ _id: { $in: rows.map((r) => r.rescheduledFrom) } })
        .select('_id status')
        .lean()
    ).map((o) => [String(o._id), o]),
  );

  const plan = { confirm: [], past: [], unexplained: [] };
  for (const row of rows) {
    if (originals.get(String(row.rescheduledFrom))?.status !== 'cancelled') {
      plan.unexplained.push(row);
    } else if (new Date(row.scheduledFor) < now) {
      plan.past.push(row);
    } else {
      plan.confirm.push(row);
    }
  }
  return plan;
}

/** Writes the plan. Each write keeps its "still as the old route left it" condition. */
export async function applyRescheduledBookings(plan, { now = new Date() } = {}) {
  let confirmed = 0;
  for (const row of plan.confirm) {
    const r = await Appointment.updateOne(
      { _id: row._id, ...LEFT_AS_REQUEST, scheduledFor: { $gte: now } },
      { $set: { status: 'confirmed' } },
    );
    confirmed += r.modifiedCount ?? 0;
  }
  return { confirmed };
}

async function main(argv) {
  const apply = argv.includes('--apply');
  await connectDb();
  try {
    const plan = await planRescheduledBookings();
    const sample = (rows) =>
      rows
        .slice(0, 20)
        .map((r) => `${r._id} (${new Date(r.scheduledFor).toISOString()})`)
        .join(', ');

    console.log(`Moved appointments still waiting as requests, time still ahead: ${plan.confirm.length}.`);
    if (plan.confirm.length) console.log(`  Would confirm: ${sample(plan.confirm)}`);
    console.log(`Moved appointments whose time has passed (reported, not written): ${plan.past.length}.`);
    if (plan.past.length) console.log(`  ${sample(plan.past)}`);
    console.log(`Rows that look moved but whose original is not a cancelled appointment (left alone): ${plan.unexplained.length}.`);
    if (plan.unexplained.length) console.log(`  ${sample(plan.unexplained)}`);

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }
    console.log('\nWritten:', await applyRescheduledBookings(plan));
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
