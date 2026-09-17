#!/usr/bin/env node
/**
 * Which department assistants are on, and why not — read-only.
 *
 *   node scripts/assistantStatus.js                          # the platform: shared guidance
 *   node scripts/assistantStatus.js --practice <practiceId>  # one practice, with its approvals
 *   node scripts/assistantStatus.js --language bn            # for Bengali conversations
 *
 * The answer comes from services/ai/assistantAvailability.js — the function
 * the assistant itself asks before replying to a patient — so this cannot
 * describe a different world from the one patients are in.
 *
 * It also lists the practices with no specialty set. A general conversation
 * at such a practice keeps the assistant the founding clinic has always had,
 * which is the diabetology remit; every other practice should set its
 * specialty so its patients meet their own department's assistant, or none.
 *
 * Writes nothing.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { Practice } from '../src/models/Practice.js';
import { assistantStatusForPractice } from '../src/services/ai/assistantAvailability.js';

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : null;
}

/** One line per department, in the words an operator would use. */
export function formatStatus(status) {
  const k = status.knowledge;
  const byLanguage = `en ${k.approved.byLanguage.en}, bn ${k.approved.byLanguage.bn}, hi ${k.approved.byLanguage.hi}`;
  return [
    status.department.key.padEnd(20),
    (status.enabled ? 'Assistant ON' : 'No assistant').padEnd(13),
    `approved ${String(k.approved.total).padStart(3)} (${byLanguage})`,
    `pending ${String(k.pending.total).padStart(3)}`,
    `sources ${String(k.sources.cited).padStart(3)}`,
    `scope ${status.scope.state}`,
    status.enabled ? '' : `— ${status.reasons.join(', ')}`,
  ].join('  ');
}

async function main() {
  const practiceId = arg('--practice');
  const language = ['en', 'bn', 'hi'].includes(arg('--language')) ? arg('--language') : 'en';
  if (practiceId && !mongoose.isValidObjectId(practiceId)) {
    console.error('usage: node scripts/assistantStatus.js [--practice <practiceId>] [--language en|bn|hi]');
    process.exit(2);
  }

  await connectDb();
  try {
    const practice = practiceId ? await Practice.findById(practiceId).select('name specialty').lean() : null;
    if (practiceId && !practice) {
      console.error(`No practice ${practiceId}.`);
      process.exitCode = 2;
      return;
    }

    console.log(
      practice
        ? `\n${practice.name} (specialty: ${practice.specialty ?? 'not set'}), ${language} conversations:\n`
        : `\nThe platform (shared guidance only), ${language} conversations:\n`,
    );
    for (const status of await assistantStatusForPractice({ practiceId, language })) {
      console.log(`  ${formatStatus(status)}`);
    }

    const unset = await Practice.find({ $or: [{ specialty: null }, { specialty: '' }] }).select('name').lean();
    if (unset.length) {
      console.log(`\n  ${unset.length} practice(s) with no specialty — their general conversations use the legacy diabetology remit:`);
      for (const p of unset) console.log(`    ${p._id}  ${p.name}`);
    }
    console.log('');
  } finally {
    await disconnectDb();
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(async (err) => {
    console.error(err);
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });
}
