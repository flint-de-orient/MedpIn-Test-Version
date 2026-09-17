#!/usr/bin/env node
/**
 * Seeds the knowledge base and the draft assistant scopes, and embeds what changed.
 *
 *   node scripts/seedKnowledge.js --dry        # report only: writes nothing, calls nothing
 *   node scripts/seedKnowledge.js              # write, embedding new or changed passages
 *   node scripts/seedKnowledge.js --no-embed   # write without calling the embedding API
 *
 *   npm run seed:knowledge -- --dry            # the same, through npm
 *
 * ---- Two kinds of entry, never confused ---------------------------------------
 *
 * The platform corpus — diabetes and endocrinology, the passages this seed has
 * always written — is written approved, exactly as before, and filed under the
 * diabetology department it was written for. It had no department, which made
 * it cross-specialty: once a cardiology assistant existed it would have been
 * grounded on insulin advice.
 *
 * The AI drafts — cardiology and general medicine, from src/knowledge/aiDrafts.js
 * — are written `pending_review` with origin `ai_draft`, and so are their
 * assistant scopes. Nothing in this script approves either, and nothing it does
 * can switch an assistant on: a clinician of the specialty approves them for
 * their own practice on the knowledge screen. A shared draft somebody approved
 * in place, outside that flow, is put back to review and reported.
 *
 * ---- What a second run does -----------------------------------------------------
 *
 * Nothing, when nothing changed. Rows are matched on docId among the shared
 * rows only — a practice's approved copy of a draft carries the same docId and
 * is never touched. A draft whose wording changed gets the new wording, a new
 * version, and goes back to (or stays in) review; practices that approved the
 * earlier version keep their own copy until they review the new one. A scope
 * whose wording changed gets a new version, which makes every practice's
 * approval of the old wording lapse — deliberately, since that approval was of
 * different words. A scope that is live (the legacy diabetology remit, or one
 * approved in place) is never overwritten. A retired draft is left retired.
 *
 * ---- Importable without running --------------------------------------------------
 *
 * The planner and the writer are exported, so a test proves against a real
 * database what a run writes. `main` runs only when this file is the entry point.
 */
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';

import { connectDb, disconnectDb } from '../src/config/db.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { Department } from '../src/models/Department.js';
import { User, ROLES } from '../src/models/User.js';
import { KNOWLEDGE_SEED } from '../src/knowledge/seedContent.js';
import { AI_DRAFT_SCOPES, DRAFT_ORIGIN, DRAFT_STATUS } from '../src/knowledge/aiDrafts.js';
import {
  LEGACY_DEPARTMENT_KEY,
  assistantStatusForPractice,
} from '../src/services/ai/assistantAvailability.js';
import { embed } from '../src/services/ai/gemini.js';
import { env } from '../src/config/env.js';
import { logger } from '../src/config/logger.js';

const CONTENT_FIELDS = ['title', 'section', 'content', 'category', 'language', 'tags', 'sourceCitation', 'sources'];
const SCOPE_FIELDS = ['role', 'covers', 'refuses', 'redFlags', 'sources'];

/** A value in a form two runs can compare: no undefined, no Mongoose wrappers, sources field by field. */
function comparable(field, value) {
  if (value === undefined || value === null) {
    return ['tags', 'sources', 'covers', 'refuses', 'redFlags'].includes(field) ? [] : null;
  }
  if (field === 'sources') {
    return value.map((s) => ({
      title: s.title,
      organisation: s.organisation,
      year: s.year ?? null,
      url: s.url,
      accessed: s.accessed ?? null,
    }));
  }
  if (Array.isArray(value)) return value.map(String);
  return value;
}

const differs = (fields, row, entry) =>
  fields.filter((f) => JSON.stringify(comparable(f, row?.[f])) !== JSON.stringify(comparable(f, entry[f])));

const isDraft = (entry) => entry.origin === DRAFT_ORIGIN;

/**
 * What a run would write, without writing it.
 *
 * @returns {Promise<{chunks: Array, scopes: Array, errors: string[], warnings: string[]}>}
 *   Each chunk and scope has an `action`: create, update, unchanged, or a
 *   reason it was left alone.
 */
export async function planKnowledgeSeed({ entries = KNOWLEDGE_SEED, scopes = AI_DRAFT_SCOPES } = {}) {
  const keys = [
    ...new Set([
      LEGACY_DEPARTMENT_KEY,
      ...entries.filter(isDraft).map((e) => e.departmentKey),
      ...scopes.map((s) => s.departmentKey),
    ]),
  ];
  const departments = await Department.find({ practice: null, key: { $in: keys } }).lean();
  const byKey = new Map(departments.map((d) => [d.key, d]));

  const plan = { chunks: [], scopes: [], errors: [], warnings: [] };
  const missing = new Set();

  const legacyDepartment = byKey.get(LEGACY_DEPARTMENT_KEY) ?? null;
  if (!legacyDepartment) {
    plan.warnings.push(
      `No shared "${LEGACY_DEPARTMENT_KEY}" department: the platform corpus is written with no department, as before. ` +
        'Run scripts/seedDepartments.js --apply to file it under diabetology.',
    );
  }

  const rows = await KnowledgeChunk.find({ practice: null, docId: { $in: entries.map((e) => e.docId) } })
    .select('docId title section content category language tags sourceCitation sources department status origin version embeddedAt')
    .lean();
  const byDoc = new Map(rows.map((r) => [r.docId, r]));

  for (const entry of entries) {
    const row = byDoc.get(entry.docId) ?? null;

    if (isDraft(entry)) {
      const department = byKey.get(entry.departmentKey);
      if (!department) {
        missing.add(entry.departmentKey);
        plan.chunks.push({ docId: entry.docId, kind: 'draft', action: 'skipped_no_department' });
        continue;
      }
      if (!row) {
        plan.chunks.push({ docId: entry.docId, kind: 'draft', action: 'create', department: department._id, entry });
        continue;
      }
      if (row.status === 'retired') {
        plan.chunks.push({ docId: entry.docId, kind: 'draft', action: 'left_retired', rowId: row._id });
        continue;
      }
      const changed = differs(CONTENT_FIELDS, row, entry);
      const approvedInPlace = row.status === 'approved';
      if (approvedInPlace) {
        plan.warnings.push(
          `Shared draft "${entry.docId}" was approved in place, which applies it to every practice. ` +
            'It is put back to review; practices approve their own copies.',
        );
      }
      const needs =
        changed.length > 0 ||
        approvedInPlace ||
        row.status !== DRAFT_STATUS ||
        row.origin !== DRAFT_ORIGIN ||
        String(row.department ?? '') !== String(department._id);
      plan.chunks.push({
        docId: entry.docId,
        kind: 'draft',
        action: needs ? 'update' : 'unchanged',
        rowId: row._id,
        changed,
        contentChanged: changed.includes('content') || changed.includes('title') || changed.includes('section'),
        version: row.version ?? 1,
        department: department._id,
        entry,
        needsEmbedding: !row.embeddedAt,
      });
      continue;
    }

    // The platform corpus: approved, as it has always been seeded.
    const department = legacyDepartment?._id ?? row?.department ?? null;
    if (!row) {
      plan.chunks.push({ docId: entry.docId, kind: 'platform', action: 'create', department, entry });
      continue;
    }
    const changed = differs(CONTENT_FIELDS.filter((f) => f !== 'sources'), row, entry);
    const needs =
      changed.length > 0 ||
      row.status !== 'approved' ||
      row.origin !== 'platform_seed' ||
      (department != null && String(row.department ?? '') !== String(department));
    plan.chunks.push({
      docId: entry.docId,
      kind: 'platform',
      action: needs ? 'update' : 'unchanged',
      rowId: row._id,
      changed,
      contentChanged: changed.includes('content') || changed.includes('title') || changed.includes('section'),
      reapprove: changed.length > 0 || row.status !== 'approved',
      department,
      entry,
      needsEmbedding: !row.embeddedAt,
    });
  }

  for (const scope of scopes) {
    const department = byKey.get(scope.departmentKey);
    if (!department) {
      missing.add(scope.departmentKey);
      plan.scopes.push({ departmentKey: scope.departmentKey, action: 'skipped_no_department' });
      continue;
    }
    const current = department.assistantScope ?? {};
    if (current.role && (current.status == null || current.status === 'approved')) {
      plan.scopes.push({ departmentKey: scope.departmentKey, action: 'left_live_scope', departmentId: department._id });
      continue;
    }
    if (current.role && current.status === 'retired') {
      plan.scopes.push({ departmentKey: scope.departmentKey, action: 'left_retired', departmentId: department._id });
      continue;
    }
    if (!current.role) {
      plan.scopes.push({ departmentKey: scope.departmentKey, action: 'create', departmentId: department._id, scope });
      continue;
    }
    const changed = differs(SCOPE_FIELDS, current, scope);
    plan.scopes.push({
      departmentKey: scope.departmentKey,
      action: changed.length ? 'update' : 'unchanged',
      departmentId: department._id,
      scope,
      changed,
      version: current.version ?? 1,
      approvalsLapsing: changed.length ? (current.approvals ?? []).filter((a) => a.version === current.version).length : 0,
    });
  }

  for (const key of missing) {
    plan.errors.push(`No shared "${key}" department. Run scripts/seedDepartments.js --apply first; its drafts were not written.`);
  }
  return plan;
}

/**
 * Write a plan. Returns counts.
 *
 * `embedder` is the embedding call, or null to write without embeddings (the
 * text-search fallback still finds them, and approving a passage embeds it).
 * `approver` is the user the platform corpus is attributed to, as it always
 * was; drafts are attributed to nobody, because nobody approved them.
 */
export async function applyKnowledgeSeed(plan, { embedder = null, approver = null } = {}) {
  const counts = {
    created: 0,
    updated: 0,
    unchanged: 0,
    left: 0,
    scopesCreated: 0,
    scopesUpdated: 0,
    embedded: 0,
    embedFailed: 0,
  };
  const now = new Date();

  for (const item of plan.chunks) {
    if (item.action === 'unchanged') {
      counts.unchanged += 1;
      continue;
    }
    if (item.action !== 'create' && item.action !== 'update') {
      counts.left += 1;
      continue;
    }

    const { entry } = item;
    const fields = {
      docId: entry.docId,
      title: entry.title,
      section: entry.section,
      content: entry.content,
      category: entry.category,
      language: entry.language ?? 'en',
      tags: entry.tags ?? [],
      sourceCitation: entry.sourceCitation,
      department: item.department ?? null,
    };

    let id;
    if (item.kind === 'draft') {
      const set = { ...fields, sources: entry.sources ?? [], origin: DRAFT_ORIGIN, status: DRAFT_STATUS };
      if (item.action === 'create') {
        const created = await KnowledgeChunk.create({ ...set, practice: null, version: 1 });
        id = created._id;
        counts.created += 1;
      } else {
        await KnowledgeChunk.updateOne(
          { _id: item.rowId, practice: null },
          {
            $set: { ...set, ...(item.changed.length ? { version: item.version + 1 } : {}) },
            $unset: { approvedBy: '', approvedAt: '' },
          },
        );
        id = item.rowId;
        counts.updated += 1;
      }
    } else {
      const set = {
        ...fields,
        origin: 'platform_seed',
        status: 'approved',
        ...(item.action === 'create' || item.reapprove ? { approvedBy: approver ?? undefined, approvedAt: now } : {}),
      };
      if (item.action === 'create') {
        const created = await KnowledgeChunk.create({ ...set, practice: null });
        id = created._id;
        counts.created += 1;
      } else {
        await KnowledgeChunk.updateOne({ _id: item.rowId, practice: null }, { $set: set });
        id = item.rowId;
        counts.updated += 1;
      }
    }

    // Only spend an embedding call when the text is new or changed, or was never embedded.
    if (embedder && (item.action === 'create' || item.contentChanged || item.needsEmbedding)) {
      try {
        const vector = await embedder(`${entry.title}\n${entry.section ?? ''}\n${entry.content}`, {
          taskType: 'RETRIEVAL_DOCUMENT',
          title: entry.title,
        });
        await KnowledgeChunk.updateOne(
          { _id: id },
          { $set: { embedding: vector, embeddingModel: env.GEMINI_EMBED_MODEL, embeddedAt: new Date() } },
        );
        counts.embedded += 1;
      } catch (err) {
        counts.embedFailed += 1;
        logger.error({ docId: entry.docId, err: err?.message }, 'embedding failed');
      }
    }
  }

  for (const item of plan.scopes) {
    if (item.action === 'create') {
      await Department.updateOne(
        { _id: item.departmentId, 'assistantScope.role': { $in: [null, ''] } },
        {
          $set: {
            'assistantScope.role': item.scope.role,
            'assistantScope.covers': item.scope.covers,
            'assistantScope.refuses': item.scope.refuses,
            'assistantScope.redFlags': item.scope.redFlags ?? [],
            'assistantScope.sources': item.scope.sources ?? [],
            'assistantScope.status': DRAFT_STATUS,
            'assistantScope.origin': DRAFT_ORIGIN,
            'assistantScope.version': 1,
          },
        },
      );
      counts.scopesCreated += 1;
    } else if (item.action === 'update') {
      // Conditioned on the version read, so a scope revised or approved in
      // between is not overwritten; approvals are left alone and lapse with the
      // old version.
      await Department.updateOne(
        {
          _id: item.departmentId,
          'assistantScope.version': item.version,
          'assistantScope.status': { $in: ['draft', 'pending_review'] },
        },
        {
          $set: {
            'assistantScope.role': item.scope.role,
            'assistantScope.covers': item.scope.covers,
            'assistantScope.refuses': item.scope.refuses,
            'assistantScope.redFlags': item.scope.redFlags ?? [],
            'assistantScope.sources': item.scope.sources ?? [],
            'assistantScope.status': DRAFT_STATUS,
            'assistantScope.origin': DRAFT_ORIGIN,
            'assistantScope.version': item.version + 1,
          },
        },
      );
      counts.scopesUpdated += 1;
    }
  }

  return counts;
}

function report(plan) {
  const tally = (list) =>
    list.reduce((acc, i) => {
      const key = `${i.kind ?? 'scope'}:${i.action}`;
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

  console.log('\nPassages:');
  for (const [key, n] of Object.entries(tally(plan.chunks)).sort()) console.log(`  ${String(n).padStart(4)}  ${key}`);
  console.log('\nAssistant scopes:');
  for (const s of plan.scopes) {
    const lapsing = s.approvalsLapsing ? ` (${s.approvalsLapsing} practice approval(s) of the old wording will lapse)` : '';
    console.log(`  ${s.departmentKey.padEnd(20)} ${s.action}${lapsing}`);
  }
  for (const w of plan.warnings) console.log(`\n  warning: ${w}`);
  for (const e of plan.errors) console.log(`\n  ERROR: ${e}`);
}

async function main() {
  const dryRun = process.argv.includes('--dry');
  const skipEmbeddings = process.argv.includes('--no-embed');

  await connectDb();
  try {
    const plan = await planKnowledgeSeed();
    console.log(`\n${dryRun ? 'DRY RUN — nothing will be written and no API is called' : 'WRITING'}`);
    report(plan);

    if (dryRun) {
      console.log('\nRe-run without --dry to write.\n');
      return;
    }

    // The platform corpus has always been attributed to a doctor account.
    const approver = await User.findOne({ role: ROLES.DOCTOR }).select('_id').lean();
    if (!approver) logger.warn('no doctor account found — the platform corpus is written with no approver');

    const counts = await applyKnowledgeSeed(plan, {
      embedder: skipEmbeddings ? null : embed,
      approver: approver?._id ?? null,
    });
    logger.info(counts, 'knowledge seed complete');
    if (counts.embedFailed > 0) {
      logger.warn(
        'Some passages have no embedding. Vector search will not find them until they are embedded ' +
          '(the text-search fallback still does, and approving a passage embeds it). Re-run once the API key or quota is sorted.',
      );
    }

    console.log('\nAssistant status across the platform (shared guidance only; each practice also needs its own approvals):');
    for (const s of await assistantStatusForPractice({ practiceId: null, language: 'en' })) {
      const k = s.knowledge;
      console.log(
        `  ${s.department.key.padEnd(20)} ${s.enabled ? 'ON ' : 'off'}  ${s.reason.padEnd(32)} ` +
          `approved ${k.approved.total} (en ${k.approved.byLanguage.en}, bn ${k.approved.byLanguage.bn}, hi ${k.approved.byLanguage.hi})  ` +
          `pending ${k.pending.total}  sources ${k.sources.cited}  scope ${s.scope.state}`,
      );
    }
    console.log('');
    if (plan.errors.length) process.exitCode = 1;
  } finally {
    await disconnectDb();
  }
}

const invokedDirectly = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  main().catch(async (err) => {
    logger.fatal({ err }, 'knowledge seed failed');
    await mongoose.connection.close().catch(() => {});
    process.exit(1);
  });
}
