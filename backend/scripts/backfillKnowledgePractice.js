#!/usr/bin/env node
/**
 * Give a practice back the knowledge passages it wrote.
 *
 *   node scripts/backfillKnowledgePractice.js --practice <practiceId>           # dry run
 *   node scripts/backfillKnowledgePractice.js --practice <practiceId> --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * Until this release `POST /doctor/knowledge` never set `practice` on the
 * passage it created, and a null practice means *shared*: the retrieval layer
 * serves it to every practice's assistant. So every passage written through
 * the app — a clinic's own opening hours and phone number included — is cited
 * to every practice's patients.
 *
 * The same release makes shared passages read-only from the app, because
 * letting any doctor edit what every practice's assistant cites was the hole.
 * Without this backfill, the passages a practice wrote become read-only to it
 * as well. The assistant keeps using them either way; only editing stops.
 *
 * ---- Which rows it touches ----------------------------------------------
 *
 * `practice: null` and a `docId` that is not in `KNOWLEDGE_SEED`.
 *
 * The seed upserts on `docId` from a fixed list in this repository, so that
 * set is exactly the platform's own clinical content — hypoglycaemia, DKA,
 * foot care — and it stays shared. Everything else with no practice was
 * written through the app.
 *
 * It cannot tell *which* practice wrote a row. Passages record no author, and
 * `approvedBy` is the seed doctor on seeded rows too, so it is no evidence. The
 * operator names the practice. Where only one practice has ever written
 * knowledge that is unambiguous; where two have, read the dry run and do not
 * apply it blind.
 *
 * Dry run by default, and idempotent: an adopted row has a practice and is
 * never selected again.
 *
 * ---- Importable without running -----------------------------------------
 *
 * The planner and the write are exported so a test can prove what this
 * touches against a real database. `main` runs only when this file is the
 * process entry point — unlike `seedDepartments.js`, which connects on import
 * and is therefore tested by reading its source.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { Practice } from '../src/models/Practice.js';
import { KNOWLEDGE_SEED } from '../src/knowledge/seedContent.js';

/** The platform's own passages, by the key the seed upserts on. */
export const SEED_DOC_IDS = Object.freeze([...new Set(KNOWLEDGE_SEED.map((e) => e.docId))]);

/** The rows this adopts, as a filter — so a test and the write cannot disagree. */
export function backfillFilter() {
  return { practice: null, docId: { $nin: SEED_DOC_IDS } };
}

/** What a run would do, without doing it. */
export async function planBackfill() {
  const [adopt, stayShared] = await Promise.all([
    KnowledgeChunk.find(backfillFilter()).select('docId title category status').sort({ docId: 1 }).lean(),
    KnowledgeChunk.countDocuments({ practice: null, docId: { $in: SEED_DOC_IDS } }),
  ]);
  return { adopt, stayShared };
}

/** Stamp the app-written shared passages with a practice. Returns how many. */
export async function applyBackfill(practiceId) {
  const res = await KnowledgeChunk.updateMany(backfillFilter(), { $set: { practice: practiceId } });
  return res.modifiedCount ?? 0;
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

async function main() {
  const practiceId = arg('--practice');
  const apply = process.argv.includes('--apply');

  if (!practiceId || !mongoose.isValidObjectId(practiceId)) {
    console.error('usage: node scripts/backfillKnowledgePractice.js --practice <practiceId> [--apply]');
    process.exit(2);
  }

  await connectDb();
  try {
    const practice = await Practice.findById(practiceId).select('name').lean();
    if (!practice) {
      console.error(`No practice ${practiceId}. Nothing written.`);
      process.exitCode = 2;
      return;
    }

    const { adopt, stayShared } = await planBackfill();

    console.log(`\n  ${adopt.length} passage(s) written through the app, to be given to ${practice.name}:`);
    for (const c of adopt) {
      console.log(`    [${c.status}] ${String(c.category).padEnd(16)} ${c.docId} — ${c.title}`);
    }
    console.log(`\n  ${stayShared} seeded passage(s) stay shared with every practice.\n`);

    if (!apply) {
      console.log('  Dry run. Nothing written. Re-run with --apply to adopt them.\n');
      return;
    }

    const written = await applyBackfill(practice._id);
    console.log(`  Adopted ${written}.\n`);
  } finally {
    await disconnectDb();
  }
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
