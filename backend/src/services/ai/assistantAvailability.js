import mongoose from 'mongoose';

import { Department } from '../../models/Department.js';
import { Practice } from '../../models/Practice.js';
import { KnowledgeChunk } from '../../models/KnowledgeChunk.js';
import { scopeReviewFor } from '../../models/guidanceReview.js';
import { searchLanguagesFor } from './rag.js';
import { ENDOCRINE } from './prompts.js';

/**
 * Is the assistant on for this department, here, in this language — and why.
 *
 * ---- One answer, asked everywhere ------------------------------------------
 *
 * The assistant, the patient's thread list, the department list, the knowledge
 * screen and the operator console all need the same yes or no, and each of them
 * used to work it out for itself from `Boolean(assistantScope.role)` — one of
 * them from `Boolean(assistantScope)`, which is true for every department there
 * is. A scope and a switch were the same field, so drafting a scope and putting
 * it in front of patients were the same act. This file is the only place the
 * answer is computed; everything else asks it.
 *
 * ---- The rule ----------------------------------------------------------------
 *
 * A department's assistant answers a patient only when all of these hold:
 *
 *   1. the department exists and is active;
 *   2. its scope is live for the patient's practice — the legacy diabetology
 *      remit, or a draft a clinician of that specialty at this practice approved
 *      in the version the prompt now carries (see guidanceReview.js);
 *   3. at least MIN_APPROVED_DOCUMENTS approved passages for that department
 *      are retrievable for this practice in the conversation's grounding
 *      languages — the ones retrieval will actually read;
 *   4. at least one of them is the department's approved red-flag guidance
 *      (category `emergency`).
 *
 * Anything short of that is no assistant, and the thread says so.
 *
 * ---- Why ten, and why a red flag -------------------------------------------
 *
 * The prompt already tells the model to decline anything the approved
 * knowledge does not cover, so a thin corpus fails towards refusal rather than
 * invention. The floor is not what makes it safe; it is what makes switching it
 * on a decision rather than an accident. With two or three approved passages
 * the six retrieved for every question are the same two or three whatever was
 * asked, nearly everything in scope is refused, and the likeliest way to get
 * there is a clinician approving the scope and one passage to see what happens.
 * Ten is small beside the drafts this platform ships (thirty-odd a specialty)
 * and beside the diabetes corpus the only assistant anybody has used runs on,
 * and large enough that reaching it means somebody has read a real body of the
 * guidance. It is a floor, not a coverage check: the status lists the approved
 * categories so a reviewer can see the gaps.
 *
 * The red flag is the one passage a specialty cannot do without. Emergencies
 * are escalated by the platform triage whatever the knowledge says, but the
 * assistant's own words about when to go to hospital should be ones a
 * clinician of that specialty approved, not ones the model supplied.
 *
 * ---- Languages ---------------------------------------------------------------
 *
 * Retrieval grounds a Bengali or Hindi conversation on passages in that
 * language and in English together, and the prompt makes the model answer in
 * the patient's language. That is the existing design and the diabetology
 * assistant has always worked that way — most of its Bengali answers are
 * grounded on English passages. So "approved knowledge in the conversation's
 * language" is counted over exactly those grounding languages: an English-first
 * corpus switches a Bengali thread on, and the count per language is reported
 * so nobody mistakes that for Bengali content existing.
 *
 * ---- The one deliberate exception --------------------------------------------
 *
 * A practice's general thread with no specialty on the practice keeps the
 * assistant it has always had, unchanged. That is every conversation on the
 * founding clinic today, and it is pinned by assistantSpecialty.test.js; the
 * status reports it as `legacy_default_scope` so an operator can see which
 * practices are still relying on it and set their specialty.
 */

/** The fewest approved passages a department's assistant may answer from. See above. */
export const MIN_APPROVED_DOCUMENTS = 10;

/** The category a department's own "go to hospital now" guidance is filed under. */
export const RED_FLAG_CATEGORY = 'emergency';

/** The department whose scope predates review, and which the no-specialty thread uses. */
export const LEGACY_DEPARTMENT_KEY = 'diabetology';

const LANGUAGES = Object.freeze(['en', 'bn', 'hi']);

/** Why an assistant is off. The first failing reason is `reason`; all are in `reasons`. */
export const OFF_REASONS = Object.freeze({
  NO_DEPARTMENT: 'no_department',
  DEPARTMENT_INACTIVE: 'department_inactive',
  NO_SCOPE: 'no_scope',
  SCOPE_NOT_APPROVED: 'scope_not_approved',
  SCOPE_APPROVAL_OUTDATED: 'scope_approval_outdated',
  SCOPE_RETIRED: 'scope_retired',
  TOO_LITTLE_APPROVED_KNOWLEDGE: 'too_little_approved_knowledge',
  NO_APPROVED_RED_FLAG_GUIDANCE: 'no_approved_red_flag_guidance',
  SPECIALTY_HAS_NO_DEPARTMENT: 'specialty_has_no_department',
});

export const ON_REASONS = Object.freeze({
  ENABLED: 'enabled',
  LEGACY_DEFAULT_SCOPE: 'legacy_default_scope',
});

const oid = (value) => {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = value?._id ?? value;
  return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null;
};

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** Rows a status needs, and nothing that would be heavy to load for every message. */
const KNOWLEDGE_FIELDS =
  'department practice status language category docId origin adoptedFrom adoptedVersion version sources.url sourceCitation';

/**
 * The practice filter for knowledge a practice may be answered from: the
 * platform's shared passages and its own, never another practice's. With no
 * practice in view, shared passages only.
 */
function practiceClause(practiceId) {
  const id = oid(practiceId);
  return id ? { $in: [null, id] } : null;
}

const emptyByLanguage = () => Object.fromEntries(LANGUAGES.map((l) => [l, 0]));

/**
 * Counts for one department, from rows already loaded.
 *
 * A shared draft this practice has taken a copy of is counted once, as the
 * copy — otherwise a department whose every draft has been approved here would
 * still show them all as waiting.
 */
function summariseKnowledge(docs, { practiceId, language }) {
  const grounding = searchLanguagesFor(language);
  const copied = new Set(
    docs
      .filter((d) => practiceId && same(d.practice, practiceId) && d.adoptedFrom)
      .map((d) => String(d.adoptedFrom)),
  );

  const approved = { total: 0, forLanguage: 0, byLanguage: emptyByLanguage() };
  const pending = { total: 0, aiDrafts: 0, byLanguage: emptyByLanguage() };
  let retired = 0;
  let redFlagGuidanceApproved = false;
  const categoriesApproved = new Set();
  const approvedSources = new Set();
  const citedSources = new Set();

  for (const d of docs) {
    const keys = (d.sources ?? []).map((s) => s.url).filter(Boolean);
    const cite = keys.length ? keys : d.sourceCitation ? [d.sourceCitation] : [];
    cite.forEach((k) => citedSources.add(k));

    if (d.status === 'approved') {
      approved.total += 1;
      if (d.language in approved.byLanguage) approved.byLanguage[d.language] += 1;
      categoriesApproved.add(d.category);
      cite.forEach((k) => approvedSources.add(k));
      if (grounding.includes(d.language)) {
        approved.forLanguage += 1;
        if (d.category === RED_FLAG_CATEGORY) redFlagGuidanceApproved = true;
      }
    } else if (d.status === 'pending_review' || d.status === 'draft') {
      if (d.practice == null && copied.has(String(d._id))) continue;
      pending.total += 1;
      if (d.origin === 'ai_draft') pending.aiDrafts += 1;
      if (d.language in pending.byLanguage) pending.byLanguage[d.language] += 1;
    } else if (d.status === 'retired') {
      retired += 1;
    }
  }

  return {
    minimum: MIN_APPROVED_DOCUMENTS,
    groundingLanguages: grounding,
    approved,
    pending,
    retired,
    redFlagGuidanceApproved,
    categoriesApproved: [...categoriesApproved].sort(),
    sources: { approved: approvedSources.size, cited: citedSources.size },
  };
}

/**
 * The status of one department, from its row and its knowledge rows.
 *
 * Pure: every query happens before this is called, so the rule can be read in
 * one place and tested without a database.
 */
export function statusFrom(department, docs, { practiceId = null, language = 'en' } = {}) {
  const scopeReview = scopeReviewFor(department.assistantScope, practiceId);
  const knowledge = summariseKnowledge(docs, { practiceId, language });
  knowledge.includesCrossSpecialty = scopeReview.state === 'legacy';

  const reasons = [];
  if (department.isActive === false) reasons.push(OFF_REASONS.DEPARTMENT_INACTIVE);

  if (scopeReview.state === 'none') reasons.push(OFF_REASONS.NO_SCOPE);
  else if (scopeReview.state === 'retired') reasons.push(OFF_REASONS.SCOPE_RETIRED);
  else if (scopeReview.state === 'approval_outdated') reasons.push(OFF_REASONS.SCOPE_APPROVAL_OUTDATED);
  else if (!scopeReview.live) reasons.push(OFF_REASONS.SCOPE_NOT_APPROVED);

  if (knowledge.approved.forLanguage < MIN_APPROVED_DOCUMENTS) {
    reasons.push(OFF_REASONS.TOO_LITTLE_APPROVED_KNOWLEDGE);
  }
  if (!knowledge.redFlagGuidanceApproved) reasons.push(OFF_REASONS.NO_APPROVED_RED_FLAG_GUIDANCE);

  const scope = department.assistantScope ?? {};
  const currentApprovals = (scope.approvals ?? []).filter((a) => a.version === scope.version);

  return {
    department: {
      id: String(department._id),
      key: department.key,
      name: department.names?.[language] || department.names?.en || department.key,
      isShared: department.practice == null,
    },
    practiceId: practiceId ? String(practiceId) : null,
    language,
    enabled: reasons.length === 0,
    reason: reasons[0] ?? ON_REASONS.ENABLED,
    reasons,
    scope: {
      state: scopeReview.state,
      live: scopeReview.live,
      reviewStatus: scope.status ?? null,
      origin: scope.origin ?? null,
      version: scopeReview.version,
      approvedAt: scopeReview.approval?.approvedAt ?? null,
      approvedBy: scopeReview.approval?.approvedBy ? String(scopeReview.approval.approvedBy) : null,
      // Across the platform, how many practices have signed off the current
      // wording. The console's answer to "is anybody using this draft".
      practicesApproved: currentApprovals.length,
      sources: (scope.sources ?? []).length,
    },
    knowledge,
  };
}

/**
 * Knowledge rows for these departments that this practice may be answered from.
 *
 * `withCrossSpecialty` adds the passages filed under no department, which count
 * towards a legacy scope only: the diabetes corpus was seeded with no
 * department, and until the knowledge seed files it under diabetology those
 * passages are the diabetology assistant's knowledge. A reviewed scope counts
 * its own department's passages and nothing else — otherwise a clinic's
 * opening hours would help switch a cardiology assistant on.
 */
async function knowledgeRows(departmentIds, { practiceId, withCrossSpecialty }) {
  const ids = departmentIds.map(oid).filter(Boolean);
  return KnowledgeChunk.find({
    department: { $in: withCrossSpecialty ? [...ids, null] : ids },
    practice: practiceClause(practiceId),
  })
    .select(KNOWLEDGE_FIELDS)
    .lean();
}

function rowsFor(department, rows, practiceId) {
  const legacy = scopeReviewFor(department.assistantScope, practiceId).state === 'legacy';
  return rows.filter((r) => same(r.department, department._id) || (legacy && r.department == null));
}

function noDepartment(practiceId, language) {
  return {
    department: null,
    practiceId: practiceId ? String(practiceId) : null,
    language,
    enabled: false,
    reason: OFF_REASONS.NO_DEPARTMENT,
    reasons: [OFF_REASONS.NO_DEPARTMENT],
    scope: { state: 'none', live: false },
    knowledge: null,
  };
}

/**
 * Is the assistant on for this department, for this practice, in this language.
 *
 * `department` may be a lean row already loaded, or give `departmentId`. A
 * practice's own department answers only that practice; asked about another
 * practice's, this says there is no such department rather than describing it.
 */
export async function assistantStatus({ department = null, departmentId = null, practiceId = null, language = 'en' } = {}) {
  const row =
    department ?? (oid(departmentId) ? await Department.findById(oid(departmentId)).lean() : null);
  if (!row) return noDepartment(practiceId, language);
  if (row.practice != null && practiceId && !same(row.practice, practiceId)) {
    return noDepartment(practiceId, language);
  }

  const effectivePractice = practiceId ?? row.practice ?? null;
  const legacy = scopeReviewFor(row.assistantScope, effectivePractice).state === 'legacy';
  const rows = await knowledgeRows([row._id], { practiceId: effectivePractice, withCrossSpecialty: legacy });
  return statusFrom(row, rowsFor(row, rows, effectivePractice), { practiceId: effectivePractice, language });
}

/**
 * Every department a practice can see — the shared ones and its own — with
 * the answer for each, in display order. Two queries however many departments.
 *
 * With no practice this is the platform's view: shared departments, shared
 * knowledge, and how many practices have approved each draft scope.
 */
export async function assistantStatusForPractice({ practiceId = null, language = 'en', departments = null } = {}) {
  const rows =
    departments ??
    (await Department.find({
      isActive: true,
      $or: [{ practice: null }, ...(oid(practiceId) ? [{ practice: oid(practiceId) }] : [])],
    })
      .sort({ sortIndex: 1, 'names.en': 1 })
      .lean());

  const visible = rows.filter((d) => d.practice == null || !practiceId || same(d.practice, practiceId));
  const withCrossSpecialty = visible.some(
    (d) => scopeReviewFor(d.assistantScope, practiceId).state === 'legacy',
  );
  const knowledge = visible.length
    ? await knowledgeRows(visible.map((d) => d._id), { practiceId, withCrossSpecialty })
    : [];

  return visible.map((d) => statusFrom(d, rowsFor(d, knowledge, practiceId), { practiceId, language }));
}

/**
 * The department a practice's `specialty` names, if any.
 *
 * `specialty` is free text that matches a department key where one fits. Tried
 * in order: the key itself (the practice's own department first, then the
 * shared one), then a department's name in any language, then — because the
 * endocrine spellings are the ones already in use — the shared diabetology row
 * for anything the prompt's own endocrine test recognises.
 */
export async function departmentForSpecialty(specialty, practiceId = null) {
  const text = String(specialty ?? '').trim();
  if (!text) return null;

  const candidates = await Department.find({
    isActive: true,
    $or: [{ practice: null }, ...(oid(practiceId) ? [{ practice: oid(practiceId) }] : [])],
  }).lean();

  const wanted = text.toLowerCase();
  const own = (d) => (d.practice != null ? 1 : 0);
  const byKey = candidates.filter((d) => d.key === wanted).sort((a, b) => own(b) - own(a))[0];
  if (byKey) return byKey;

  const byName = candidates.find((d) =>
    [d.names?.en, d.names?.bn, d.names?.hi].some((n) => n && n.trim().toLowerCase() === wanted),
  );
  if (byName) return byName;

  if (ENDOCRINE.test(text)) {
    return candidates.find((d) => d.key === LEGACY_DEPARTMENT_KEY && d.practice == null) ?? null;
  }
  return null;
}

/**
 * Whether a conversation may be answered, and as which department.
 *
 * ---- Which department a conversation is ------------------------------------
 *
 *   thread               the session names a department
 *   practice_specialty   a general thread at a practice whose specialty names one
 *   legacy_default       a general thread at a practice with no specialty — the
 *                        founding clinic's case — which keeps its assistant and
 *                        its prompt exactly as they were
 *
 * A specialty that names no department gets no assistant: there is no approved
 * scope to answer from, and the thin remit the prompt used to improvise for it
 * is the fluency this module exists to refuse.
 *
 * @returns {Promise<{enabled: boolean, reason: string, via: string,
 *   department: ?object, retrievalDepartment: ?object, useDepartmentBlock: boolean,
 *   status: ?object}>}
 *   `retrievalDepartment` narrows retrieval to that department's passages plus
 *   cross-specialty ones. `useDepartmentBlock` says whether the prompt's scope
 *   comes from the department row or stays the practice default: a legacy
 *   scope keeps the prompt the general thread has always had.
 */
export async function conversationAssistant({ session, practiceId = null, language = 'en' } = {}) {
  if (session?.department) {
    const department = oid(session.department) ? await Department.findById(oid(session.department)).lean() : null;
    const status = department
      ? await assistantStatus({ department, practiceId, language })
      : noDepartment(practiceId, language);
    return {
      enabled: status.enabled,
      reason: status.reason,
      via: 'thread',
      department,
      retrievalDepartment: department?._id ?? oid(session.department),
      useDepartmentBlock: true,
      status,
    };
  }

  const practice = oid(practiceId) ? await Practice.findById(oid(practiceId)).select('specialty').lean() : null;
  const specialty = practice?.specialty?.trim() || null;

  if (!specialty) {
    const legacy = await Department.findOne({ practice: null, key: LEGACY_DEPARTMENT_KEY }).select('_id').lean();
    return {
      enabled: true,
      reason: ON_REASONS.LEGACY_DEFAULT_SCOPE,
      via: 'legacy_default',
      department: null,
      retrievalDepartment: legacy?._id ?? null,
      useDepartmentBlock: false,
      status: null,
    };
  }

  const department = await departmentForSpecialty(specialty, practiceId);
  if (!department) {
    return {
      enabled: false,
      reason: OFF_REASONS.SPECIALTY_HAS_NO_DEPARTMENT,
      via: 'practice_specialty',
      department: null,
      retrievalDepartment: null,
      useDepartmentBlock: false,
      status: null,
    };
  }

  const status = await assistantStatus({ department, practiceId, language });
  return {
    enabled: status.enabled,
    reason: status.reason,
    via: 'practice_specialty',
    department,
    retrievalDepartment: department._id,
    useDepartmentBlock: status.scope.state !== 'legacy',
    status,
  };
}
