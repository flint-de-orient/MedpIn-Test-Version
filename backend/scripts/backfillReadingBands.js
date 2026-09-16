#!/usr/bin/env node
/**
 * Band the readings the clinic took before clinic readings were banded.
 *
 *   node scripts/backfillReadingBands.js           # report
 *   node scripts/backfillReadingBands.js --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * A blood pressure or sugar a patient logged themselves was stored with its
 * clinical band — normal, stage 2, crisis; in range, high. The same numbers
 * taken by a doctor in a consultation, or by the desk at registration, were
 * stored with none. Those writes band their readings now; this gives the ones
 * already in the record the same answer, so a panel asking "whose blood
 * pressure is out of control" does not skip every reading the clinic took.
 *
 * ---- What it does not do --------------------------------------------------
 *
 * Raise alerts. These are history — a crisis reading from March was either
 * acted on in the room in March or it was not, and paging a doctor about it
 * today would be noise wearing the look of an emergency.
 *
 * Touch a reading that already has a band. The bands come from the same
 * thresholds the live writes use (services/clinicalReadings.js), and a sugar is
 * banded against the patient's own targets as they stand now, which is what
 * the live path would have used had it banded them at the time — the nearest
 * honest answer the record allows.
 *
 * Dry run by default. Only unbanded rows are written, so a second run changes
 * nothing. It reads `.env` from the directory it runs in: run it from the
 * deployment's own `backend/`.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { bloodPressureBand, glucoseTargetsFor } from '../src/services/clinicalReadings.js';
import { classifyGlucose } from '../src/services/triage/engine.js';

const UNBANDED = { $or: [{ flag: null }, { flag: { $exists: false } }] };

/**
 * What applying would write, without writing it.
 *
 * @returns {Promise<{vitals: object[], glucose: object[], skipped: number}>}
 */
export async function planReadingBands() {
  const vitalsRows = await VitalRecord.find({
    ...UNBANDED,
    systolic: { $ne: null },
    diastolic: { $ne: null },
  })
    .select('_id systolic diastolic')
    .lean();

  const vitals = [];
  for (const row of vitalsRows) {
    const band = bloodPressureBand(row.systolic, row.diastolic);
    if (band) vitals.push({ id: row._id, band });
  }

  const sugarRows = await GlucoseReading.find(UNBANDED).select('_id patient valueMgDl context').lean();
  const targets = new Map();
  const glucose = [];
  for (const row of sugarRows) {
    const key = String(row.patient);
    if (!targets.has(key)) targets.set(key, await glucoseTargetsFor(row.patient));
    const band = classifyGlucose(row.valueMgDl, row.context ?? 'random', targets.get(key))?.flag;
    if (band) glucose.push({ id: row._id, band });
  }

  // Blood pressure rows with only one half of a reading, or other vitals with
  // no pressure at all, have nothing to band.
  const unbandedVitals = await VitalRecord.countDocuments(UNBANDED);
  return { vitals, glucose, skipped: unbandedVitals - vitals.length };
}

/**
 * Write the bands. The "still unbanded" condition is repeated in each update,
 * so a reading banded by the live path between the dry run and this is kept.
 */
export async function applyReadingBands(plan) {
  let changed = 0;
  for (const { id, band } of plan.vitals) {
    const r = await VitalRecord.updateOne({ _id: id, ...UNBANDED }, { $set: { flag: band } });
    changed += r.modifiedCount ?? 0;
  }
  for (const { id, band } of plan.glucose) {
    const r = await GlucoseReading.updateOne({ _id: id, ...UNBANDED }, { $set: { flag: band } });
    changed += r.modifiedCount ?? 0;
  }
  return changed;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  await connectDb();
  try {
    const plan = await planReadingBands();
    const total = plan.vitals.length + plan.glucose.length;
    if (total === 0) {
      console.log('Nothing to do: every whole reading already carries its band.');
      return;
    }

    const count = (rows) =>
      rows.reduce((acc, r) => ({ ...acc, [r.band]: (acc[r.band] ?? 0) + 1 }), {});
    console.log(`${plan.vitals.length} blood pressure reading(s) to band:`, count(plan.vitals));
    console.log(`${plan.glucose.length} sugar reading(s) to band:`, count(plan.glucose));
    if (plan.skipped > 0) {
      console.log(`${plan.skipped} vitals record(s) have no whole blood pressure and are left as they are.`);
    }
    console.log('No alerts are raised for any of these — they are history.');

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }
    console.log(`\nWritten: ${await applyReadingBands(plan)} reading(s).`);
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
