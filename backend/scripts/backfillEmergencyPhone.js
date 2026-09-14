#!/usr/bin/env node
/**
 * Give a practice the emergency number the whole deployment used to share.
 *
 *   node scripts/backfillEmergencyPhone.js --practice <practiceId>           # dry run
 *   node scripts/backfillEmergencyPhone.js --practice <practiceId> --apply   # write
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * The number a patient is told to ring was `CLINIC_EMERGENCY_PHONE`, one value
 * for the process. It is now each practice's own `emergencyPhone`, and the
 * configured value belongs to nobody: a practice that has not set a number
 * gives its patients its only location's, or none.
 *
 * So the live clinic's number has to move from the environment onto its
 * practice when this release deploys. Until it does, that practice's emergency
 * cards show no "Call clinic" button unless it has exactly one location with a
 * phone, and the assistant's emergency advice names no number.
 *
 * ---- Which practice -----------------------------------------------------
 *
 * The one named with --practice, and only that one. Not `isFounding`, not the
 * first practice: which practice a number belongs to is a fact the operator
 * states, exactly as in backfillKnowledgePractice.js.
 *
 * Dry run by default. It never overwrites a number the practice already has,
 * so running it twice is harmless.
 *
 * ---- Importable without running -----------------------------------------
 *
 * The planner and the write are exported so a test can prove what this touches
 * against a real database; `main` runs only when this file is the entry point.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { env } from '../src/config/env.js';
import { Practice } from '../src/models/Practice.js';
import { callablePhone } from '../src/services/clinicContact.js';

/**
 * What applying would do, without doing it.
 *
 * @returns {Promise<{ok: boolean, reason?: string, practice?: object, phone?: string, change?: boolean}>}
 */
export async function planEmergencyPhone(practiceId, configured = env.CLINIC_EMERGENCY_PHONE) {
  if (!mongoose.isValidObjectId(practiceId)) {
    return { ok: false, reason: 'That is not a practice id.' };
  }

  const practice = await Practice.findById(practiceId).select('name emergencyPhone').lean();
  if (!practice) return { ok: false, reason: 'No practice has that id.' };

  const phone = callablePhone(configured);
  if (!phone) {
    return {
      ok: false,
      reason: 'CLINIC_EMERGENCY_PHONE is not a number anybody could ring, so there is nothing to copy.',
    };
  }

  if (practice.emergencyPhone) {
    return {
      ok: true,
      practice,
      phone,
      change: false,
      reason: `${practice.name} already has ${practice.emergencyPhone}; it is kept.`,
    };
  }

  return { ok: true, practice, phone, change: true };
}

/**
 * Write it, only where the practice still has no number.
 *
 * The condition is in the update itself rather than trusted from the plan, so a
 * number somebody saves from the app between the dry run and this is never
 * overwritten. Returns how many rows changed.
 */
export async function applyEmergencyPhone(practiceId, phone) {
  const result = await Practice.updateOne(
    { _id: practiceId, $or: [{ emergencyPhone: null }, { emergencyPhone: '' }] },
    { $set: { emergencyPhone: phone } },
  );
  return result.modifiedCount ?? 0;
}

function argValue(argv, name) {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
}

async function main(argv) {
  const practiceId = argValue(argv, '--practice');
  const apply = argv.includes('--apply');

  if (!practiceId) {
    console.error('usage: node scripts/backfillEmergencyPhone.js --practice <practiceId> [--apply]');
    process.exitCode = 1;
    return;
  }

  await connectDb();
  try {
    const plan = await planEmergencyPhone(practiceId);
    if (!plan.ok) {
      console.error(plan.reason);
      process.exitCode = 1;
      return;
    }
    if (!plan.change) {
      console.log(plan.reason);
      return;
    }

    console.log(`${plan.practice.name}: emergencyPhone will be set to ${plan.phone}`);
    if (!apply) {
      console.log('Dry run — nothing written. Run again with --apply to write it.');
      return;
    }

    const changed = await applyEmergencyPhone(practiceId, plan.phone);
    console.log(changed ? 'Written.' : 'Nothing written: the practice gained a number while this ran.');
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
