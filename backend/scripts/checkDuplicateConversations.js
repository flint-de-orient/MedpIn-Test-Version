#!/usr/bin/env node
/**
 * Find patients whose conversation with a practice has been split in two.
 *
 *   node scripts/checkDuplicateConversations.js
 *
 * Read-only. Exits 1 when it finds any, so a deploy can gate on it.
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * A patient has one conversation per practice they are enrolled at, per
 * department, per kind — enforced, the model says, by a unique index. That
 * index was declared with options MongoDB refuses to combine, so it was never
 * built anywhere, and two replies arriving together could each create the
 * conversation. The thread split: some messages in one, some in the other, and
 * whichever the app opened showed only part of what was said.
 *
 * The declaration is fixed, and this release builds the index at startup. But
 * a unique index cannot be built over data that already breaks it: where a
 * split conversation exists, the build fails — logged, not fatal — and the rule
 * stays unenforced exactly as before. This says whether that will happen.
 *
 * ---- What it does not do --------------------------------------------------
 *
 * Merge them. Two halves of a conversation each number their messages from
 * zero, and joining them means renumbering one or both — rewriting the order
 * of a clinical record. That is its own step, with its own dry run, and it is
 * not taken on the strength of a check.
 */
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';

/**
 * Every group of conversations sharing one enrolment, department and kind.
 *
 * @returns {Promise<{enrollment: string, department: string|null, kind: string, sessions: object[]}[]>}
 */
export async function findSplitConversations() {
  const groups = await ChatSession.aggregate([
    { $match: { enrollment: { $type: 'objectId' } } },
    {
      $group: {
        _id: { enrollment: '$enrollment', department: '$department', kind: '$kind' },
        sessions: { $push: { id: '$_id', createdAt: '$createdAt', lastMessageAt: '$lastMessageAt' } },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  const out = [];
  for (const g of groups) {
    const sessions = [];
    for (const s of g.sessions) {
      sessions.push({
        id: String(s.id),
        createdAt: s.createdAt ?? null,
        lastMessageAt: s.lastMessageAt ?? null,
        messages: await ChatMessage.countDocuments({ session: s.id }),
      });
    }
    sessions.sort((a, b) => new Date(a.createdAt ?? 0) - new Date(b.createdAt ?? 0));
    out.push({
      enrollment: String(g._id.enrollment),
      department: g._id.department ? String(g._id.department) : null,
      kind: g._id.kind ?? null,
      sessions,
    });
  }
  return out;
}

async function main() {
  await connectDb();
  try {
    const split = await findSplitConversations();

    if (split.length === 0) {
      console.log('No split conversations. The one-conversation-per-enrolment index can build.');
      return;
    }

    console.log(`${split.length} conversation(s) are split across more than one session:\n`);
    for (const g of split) {
      console.log(`  enrolment ${g.enrollment}  kind ${g.kind}${g.department ? `  department ${g.department}` : ''}`);
      for (const s of g.sessions) {
        console.log(
          `    session ${s.id}  ${s.messages} message(s)  started ${s.createdAt?.toISOString?.() ?? '—'}  last ${s.lastMessageAt?.toISOString?.() ?? '—'}`,
        );
      }
    }
    console.log(
      '\nThe unique index will not build while these exist; the app keeps working as it does today.' +
        '\nJoining them rewrites message order in a clinical record and is a separate, reviewed step.',
    );
    process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
