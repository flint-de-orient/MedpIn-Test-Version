#!/usr/bin/env node
/**
 * Take the founding doctor's name out of the platform's shared passages.
 *
 *   node scripts/neutraliseKnowledgeIdentity.js            # dry run
 *   node scripts/neutraliseKnowledgeIdentity.js --apply    # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * The seeded knowledge base was written for one clinic and names its doctor
 * throughout: "Only Dr. Dey can tell you to change an insulin dose", "See
 * Dr. Dey promptly for any new cut". Seeded passages are shared — `practice:
 * null` — so the assistant grounds every practice's answers in them, and a
 * second practice's patient could be told to ring a doctor they have never met.
 *
 * The seed in the repository now says "your doctor". This brings the rows
 * already in a database into line with it.
 *
 * ---- Which rows, and which words ---------------------------------------
 *
 * Shared rows only (`practice: null`) whose `docId` is one the seed writes.
 * A practice's own passages are its own voice, and a passage the founding
 * practice wrote naming its own doctor is exactly right — it is never touched.
 *
 * Inside those rows, only the phrases in REWORDINGS, each replaced with the
 * words the seed now uses. Not a whole-content overwrite: a passage somebody
 * corrected keeps the correction, and a phrase that is not there is not
 * invented. The clinical content is unchanged, so the approval on the row
 * stands; `version` goes up by one so the change is visible.
 *
 * Embeddings are left as they are. The rewording changes a name to "your
 * doctor" and nothing a retrieval query is about; re-embedding is a later
 * `npm run seed:knowledge` away if anybody wants it.
 *
 * Idempotent: a reworded phrase is no longer there to be found, so a second run
 * reports nothing.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { SEED_DOC_IDS } from './backfillKnowledgePractice.js';

/**
 * Every phrase the seed used to name the founding doctor with, and what it says
 * now. The seed files were rewritten with exactly these pairs, and a test holds
 * the two to each other.
 */
export const REWORDINGS = Object.freeze([
  // ---- seedContent.js, English
  ['unless Dr. Dey has given you a written plan to do so.', 'unless your doctor has given you a written plan to do so.'],
  ['contact Dr. Dey\'s clinic the same day.', 'contact your clinic the same day.'],
  ['Only Dr. Dey can tell you to change an insulin dose.', 'Only your doctor can tell you to change an insulin dose.'],
  ['Show your injection sites to Dr. Dey at your next visit', 'Show your injection sites to your doctor at your next visit'],
  ['See Dr. Dey promptly for any new cut', 'See your doctor promptly for any new cut'],
  ['reported to Dr. Dey rather than ignored.', 'reported to your doctor rather than ignored.'],
  ['speak to Dr. Dey beforehand', 'speak to your doctor beforehand'],
  ['ask Dr. Dey which activities are suitable', 'ask your doctor which activities are suitable'],
  ['Ask Dr. Dey — do not decide this yourself.', 'Ask your doctor — do not decide this yourself.'],
  ['Dr. Dey may set a higher target', 'Your doctor may set a higher target'],
  ['Discuss your result with Dr. Dey rather than judging it alone.', 'Discuss your result with your doctor rather than judging it alone.'],
  ['and Dr. Dey may set a lower target', 'and your doctor may set a lower target'],
  [
    'Dr. Amit Kumar Dey is a Consultant Physician and Diabetologist. This app helps you manage your diabetes between visits.',
    'This app helps you manage your diabetes between visits to your doctor.',
  ],
  ['answer general health questions using guidance Dr. Dey has approved.', 'answer general health questions using clinically reviewed guidance.'],
  ['Only Dr. Dey can do those things.', 'Only your doctor can do those things.'],
  // ---- seedContent.js, Bengali and Hindi
  ['আগেই ডাঃ দে-র সঙ্গে কথা বলুন', 'আগেই আপনার চিকিৎসকের সঙ্গে কথা বলুন'],
  ['जब तक डॉ. दे ने लिखित योजना न दी हो', 'जब तक आपके डॉक्टर ने लिखित योजना न दी हो'],
  ['तुरंत डॉ. दे को दिखाएँ', 'तुरंत अपने डॉक्टर को दिखाएँ'],
  // ---- seedContentEndocrine.js
  ['Dr. Dey will interpret it alongside your symptoms', 'Your doctor will interpret it alongside your symptoms'],
  ['Dr. Dey looks at the pattern.', 'Your doctor looks at the pattern.'],
  ['tells Dr. Dey far more than any single reading.', 'tells your doctor far more than any single reading.'],
  ['and Dr. Dey has heard them many times before.', 'and your doctor will have heard them many times before.'],
  [
    'This assistant shares guidance that Dr. Dey has reviewed and approved.',
    'This assistant shares guidance that has been clinically reviewed and approved.',
  ],
  ['including insulin — only Dr. Dey can do that', 'including insulin — only your doctor can do that'],
  [
    'Interpret a scan or report that Dr. Dey has not yet discussed with you',
    'Interpret a scan or report that your doctor has not yet discussed with you',
  ],
]);

/** The citation the seed printed under one passage, and what it prints now. */
export const CITATION_REWORDINGS = Object.freeze([['Clinic protocol — Dr. A. K. Dey', 'Clinic protocol']]);

/** The same words applied to one piece of text. Returns the text unchanged when none is present. */
export function reword(text, pairs = REWORDINGS) {
  let out = text ?? '';
  for (const [from, to] of pairs) out = out.split(from).join(to);
  return out;
}

/** The rows this may touch, as a filter — so the plan, the write and a test cannot disagree. */
export function neutraliseFilter() {
  return { practice: null, docId: { $in: SEED_DOC_IDS } };
}

/** What a run would change, without changing it. */
export async function planNeutralise() {
  const rows = await KnowledgeChunk.find(neutraliseFilter())
    .select('docId title content sourceCitation version')
    .sort({ docId: 1 })
    .lean();

  return rows
    .map((row) => {
      const content = reword(row.content);
      const sourceCitation = row.sourceCitation ? reword(row.sourceCitation, CITATION_REWORDINGS) : row.sourceCitation;
      const changes = [...REWORDINGS, ...CITATION_REWORDINGS]
        .filter(([from]) => (row.content ?? '').includes(from) || (row.sourceCitation ?? '').includes(from))
        .map(([from, to]) => ({ from, to }));
      return { _id: row._id, docId: row.docId, title: row.title, content, sourceCitation, changes };
    })
    .filter((r) => r.changes.length);
}

/**
 * Write the plan. Each row is updated only if its content is still what the
 * plan read, so a passage edited between the dry run and the write is left for
 * the next run to read again rather than overwritten.
 */
export async function applyNeutralise(plan) {
  let written = 0;
  for (const row of plan) {
    const current = await KnowledgeChunk.findOne({ _id: row._id, ...neutraliseFilter() })
      .select('content sourceCitation')
      .lean();
    if (!current) continue;
    if (reword(current.content) !== row.content) continue;

    const res = await KnowledgeChunk.updateOne(
      { _id: row._id, content: current.content },
      { $set: { content: row.content, sourceCitation: row.sourceCitation }, $inc: { version: 1 } },
    );
    written += res.modifiedCount ?? 0;
  }
  return written;
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDb();
  try {
    const plan = await planNeutralise();

    console.log(`\n  ${plan.length} shared passage(s) still name the founding doctor:`);
    for (const row of plan) {
      console.log(`    ${row.docId} — ${row.title}`);
      for (const c of row.changes) console.log(`        "${c.from}"\n     -> "${c.to}"`);
    }

    if (!apply) {
      console.log('\n  Dry run. Nothing written. Re-run with --apply to reword them.\n');
      return;
    }

    const written = await applyNeutralise(plan);
    console.log(`\n  Reworded ${written}.\n`);
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
