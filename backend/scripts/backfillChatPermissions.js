/**
 * Gives existing members the chat grants their role was given on 16 September.
 *
 * ---- The outage this repairs ------------------------------------------------
 *
 * Reading a patient's conversation and replying in it became grants of their
 * own that day, CHAT_READ and CHAT_REPLY, added to the doctor, desk, assistant,
 * dietician and owner presets. Nothing added them to the members who already
 * existed. A membership stores its grant as a list, and `Membership.can()`
 * falls back to the role's preset only when that list is empty — so every
 * member whose list was written before that day kept a list without either
 * grant, and was refused the conversation: "Could not load the conversation"
 * on opening a patient's thread, and "Could not send" on replying. The patient
 * list kept working, because it asks for VIEW_PATIENT.
 *
 * ---- What it changes, and what it leaves ------------------------------------
 *
 * A list is changed only when it is exactly what the member's role was given
 * before the chat grants existed — a list written by the platform and never
 * touched since. The two grants are added to it; nothing else.
 *
 * An operator can set a member's grants by hand in the console, and a list set
 * by hand is a decision this script has no way to second-guess. Those rows are
 * listed, with their practice and role, and left for the operator.
 *
 * Also left alone: an empty list (it already reads as the role's preset, chat
 * included), a list that already has either chat grant, and a role that does
 * not read conversations — the laboratory and the practice manager.
 *
 *   node scripts/backfillChatPermissions.js          # report
 *   node scripts/backfillChatPermissions.js --apply  # write
 *
 * Each write is conditional on the list still being what the report read, so a
 * change made in the console between the two is kept. A second run changes
 * nothing.
 */
import { pathToFileURL } from 'node:url';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Membership, PERMISSIONS, presetFor } from '../src/models/Membership.js';

export const CHAT_GRANTS = Object.freeze([PERMISSIONS.CHAT_READ, PERMISSIONS.CHAT_REPLY]);

/**
 * What the backfill does with one membership: `add`, `skip` or `review`.
 *
 * Pure, so the rule can be read — and tested — without a database.
 */
export function planFor({ role, isOwner = false, permissions }) {
  const granted = permissions ?? [];
  if (!granted.length) return { action: 'skip', why: 'empty — already reads as the role preset' };
  if (CHAT_GRANTS.some((p) => granted.includes(p))) return { action: 'skip', why: 'already has a chat grant' };

  let preset;
  try {
    preset = presetFor({ role, isOwner });
  } catch {
    return { action: 'review', why: `role "${role}" has no preset` };
  }
  if (!CHAT_GRANTS.every((p) => preset.includes(p))) {
    return { action: 'skip', why: 'role does not read conversations' };
  }

  // The role's grant before the chat grants existed.
  const before = preset.filter((p) => !CHAT_GRANTS.includes(p));
  const untouched = before.length === granted.length && before.every((p) => granted.includes(p));
  if (!untouched) return { action: 'review', why: 'grants were set by hand — decide in the console' };

  return { action: 'add', permissions: [...granted, ...CHAT_GRANTS] };
}

export async function planChatPermissions() {
  const rows = await Membership.find({ 'permissions.0': { $exists: true } })
    .select('_id user practice role isOwner status permissions')
    .lean();
  return rows.map((row) => ({ row, ...planFor(row) }));
}

export async function applyChatPermissions(plans) {
  let written = 0;
  for (const plan of plans.filter((p) => p.action === 'add')) {
    const read = plan.row.permissions;
    // eslint-disable-next-line no-await-in-loop
    const res = await Membership.updateOne(
      // Still exactly the list the report read, or nothing is written.
      { _id: plan.row._id, permissions: { $size: read.length, $all: read } },
      { $addToSet: { permissions: { $each: CHAT_GRANTS } } },
    );
    written += res.modifiedCount ?? 0;
  }
  return written;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  await connectDb();
  try {
    const plans = await planChatPermissions();
    const of = (action) => plans.filter((p) => p.action === action);

    console.log(`Members to be given CHAT_READ and CHAT_REPLY: ${of('add').length}`);
    for (const p of of('add')) {
      console.log(`  ${p.row._id}  practice ${p.row.practice}  ${p.row.isOwner ? 'owner' : p.row.role}  (${p.row.status})`);
    }
    console.log(`Left for an operator — grants set by hand: ${of('review').length}`);
    for (const p of of('review')) {
      console.log(`  ${p.row._id}  practice ${p.row.practice}  ${p.row.role}: ${(p.row.permissions ?? []).join(', ')} — ${p.why}`);
    }
    console.log(`Nothing to do: ${of('skip').length}`);

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }
    console.log('\nWritten:', await applyChatPermissions(plans));
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
