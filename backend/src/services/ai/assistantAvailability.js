import mongoose from 'mongoose';

import { Department } from '../../models/Department.js';
import { DoctorDepartment } from '../../models/DoctorDepartment.js';
import { Practice } from '../../models/Practice.js';
import { KnowledgeChunk } from '../../models/KnowledgeChunk.js';
import { scopeReviewFor } from '../../models/guidanceReview.js';
import { searchLanguagesFor } from './rag.js';
import { ENDOCRINE } from './prompts.js';
import { currentDoctorOf } from '../careDoctor.js';

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
 *   2. it has a scope — what the assistant covers, refuses and escalates —
 *      that is not retired (see guidanceReview.js);
 *   3. at least MIN_APPROVED_DOCUMENTS approved passages for that department
 *      are retrievable for this practice in the conversation's grounding
 *      languages — the ones retrieval will actually read;
 *   4. at least one of them is the department's approved red-flag guidance
 *      (category `emergency`).
 *
 * Anything short of that is no assistant, and the thread says so.
 *
 * There is no approval step. Past these, whether the assistant answers one
 * patient's conversation is the clinicians' switch on that conversation — the
 * assistant toggle on the chat screen, on by default (see assistantShouldReply
 * in assistant.js).
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
 * ---- Which specialty answers ------------------------------------------------
 *
 * The patient's own doctor's: a cardiologist's patient is answered by the
 * cardiology assistant and a general physician's by the general-medicine one,
 * so a practice with both is answered in both. A patient with no assigned
 * doctor has no doctor's chat, and no assistant. A doctor placed in no
 * department is taken to practise the practice's specialty, and at a practice
 * with none — the founding diabetes clinic's case — the diabetology assistant
 * answers with the prompt it has always had (`via: 'legacy_default'`). See
 * conversationAssistant.
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
  SCOPE_RETIRED: 'scope_retired',
  TOO_LITTLE_APPROVED_KNOWLEDGE: 'too_little_approved_knowledge',
  NO_APPROVED_RED_FLAG_GUIDANCE: 'no_approved_red_flag_guidance',
  SPECIALTY_HAS_NO_DEPARTMENT: 'specialty_has_no_department',
  NO_ASSIGNED_DOCTOR: 'no_assigned_doctor',
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

    // A shared passage this practice has its own copy of is counted once, as
    // the copy, whether the shared one is live or still waiting.
    if (d.practice == null && copied.has(String(d._id))) continue;

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
  // The diabetes corpus predates departments and may still be filed under
  // none; it is the diabetology assistant's knowledge, and nobody else's.
  knowledge.includesCrossSpecialty = department.key === LEGACY_DEPARTMENT_KEY;

  const reasons = [];
  if (department.isActive === false) reasons.push(OFF_REASONS.DEPARTMENT_INACTIVE);

  if (scopeReview.state === 'none') reasons.push(OFF_REASONS.NO_SCOPE);
  else if (scopeReview.state === 'retired') reasons.push(OFF_REASONS.SCOPE_RETIRED);

  if (knowledge.approved.forLanguage < MIN_APPROVED_DOCUMENTS) {
    reasons.push(OFF_REASONS.TOO_LITTLE_APPROVED_KNOWLEDGE);
  }
  if (!knowledge.redFlagGuidanceApproved) reasons.push(OFF_REASONS.NO_APPROVED_RED_FLAG_GUIDANCE);

  const scope = department.assistantScope ?? {};

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

function rowsFor(department, rows) {
  const legacy = department.key === LEGACY_DEPARTMENT_KEY;
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
  const legacy = row.key === LEGACY_DEPARTMENT_KEY;
  const rows = await knowledgeRows([row._id], { practiceId: effectivePractice, withCrossSpecialty: legacy });
  return statusFrom(row, rowsFor(row, rows), { practiceId: effectivePractice, language });
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
  const withCrossSpecialty = visible.some((d) => d.key === LEGACY_DEPARTMENT_KEY);
  const knowledge = visible.length
    ? await knowledgeRows(visible.map((d) => d._id), { practiceId, withCrossSpecialty })
    : [];

  return visible.map((d) => statusFrom(d, rowsFor(d, knowledge), { practiceId, language }));
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
 * The specialty of the patient's own doctor at this practice.
 *
 * The doctor the enrolment names, while they still work here: the department
 * their membership names, then their department rows here, primary first. Of
 * those, the first with an assistant. `doctor` is null when the patient has no
 * assigned doctor here, or theirs has left. `hasDepartment` says the doctor is
 * placed in a specialty at all — a dermatologist's patient must not be handed
 * the diabetes assistant just because dermatology has none.
 */
async function doctorSpecialty({ enrollmentId = null, patientId = null, practiceId = null }) {
  const practice = oid(practiceId);
  if (!practice) return { doctor: null, department: null, hasDepartment: false };
  // The doctor this patient is told is theirs (careDoctor.js), so the specialty
  // that answers and the doctor the answer names are always the same person.
  const mine = await currentDoctorOf({ patientId, practiceId: practice, enrollmentId });
  // No assigned doctor, or theirs has left: nobody decides the specialty.
  if (!mine) return { doctor: null, department: null, hasDepartment: false };
  const doctor = oid(mine.id);

  const rows = await DoctorDepartment.find({ doctor, practice, endedOn: null }).select('department isPrimary').lean();

  const ids = [
    ...new Set(
      [
        mine.department,
        ...rows.filter((r) => r.isPrimary).map((r) => r.department),
        ...rows.filter((r) => !r.isPrimary).map((r) => r.department),
      ]
        .filter(Boolean)
        .map(String),
    ),
  ];
  if (!ids.length) return { doctor, department: null, hasDepartment: false };

  const departments = await Department.find({
    _id: { $in: ids },
    isActive: true,
    'assistantScope.role': { $nin: [null, ''] },
    $or: [{ practice: null }, { practice }],
  }).lean();
  const byId = new Map(departments.map((d) => [String(d._id), d]));
  const department = ids.map((id) => byId.get(id)).find(Boolean) ?? null;
  return { doctor, department, hasDepartment: true };
}

/**
 * Whether a conversation may be answered, and as which department.
 *
 * ---- Which department a conversation is ------------------------------------
 *
 *   thread               the session names a department
 *   no_doctor            the patient has no assigned doctor here (or theirs has
 *                        left): no doctor's chat, so no assistant
 *   doctor               the patient's own doctor here is placed in a
 *                        specialty: that specialty's assistant, or none if the
 *                        specialty has none
 *   practice_specialty   their doctor is placed in no department, and the
 *                        practice's specialty names one
 *   legacy_default       their doctor is placed in no department at a practice
 *                        with no specialty — the founding clinic's case —
 *                        answered by the diabetology assistant with its
 *                        original prompt
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
export async function conversationAssistant({
  session,
  practiceId = null,
  language = 'en',
  enrollmentId = null,
  patientId = null,
} = {}) {
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

  // The patient's own doctor's specialty, so a practice with a cardiologist and a
  // general physician answers each one's patients as that specialty.
  const mine = await doctorSpecialty({
    enrollmentId: session?.enrollment ?? enrollmentId,
    patientId: session?.patient ?? patientId,
    practiceId,
  });
  if (!mine.doctor) {
    return {
      enabled: false,
      reason: OFF_REASONS.NO_ASSIGNED_DOCTOR,
      via: 'no_doctor',
      department: null,
      retrievalDepartment: null,
      useDepartmentBlock: false,
      status: null,
    };
  }
  if (mine.hasDepartment) {
    const status = mine.department
      ? await assistantStatus({ department: mine.department, practiceId, language })
      : { ...noDepartment(practiceId, language), reason: OFF_REASONS.NO_SCOPE, reasons: [OFF_REASONS.NO_SCOPE] };
    return {
      enabled: status.enabled,
      reason: status.reason,
      via: 'doctor',
      department: mine.department,
      retrievalDepartment: mine.department?._id ?? null,
      useDepartmentBlock: mine.department ? mine.department.key !== LEGACY_DEPARTMENT_KEY : false,
      status,
    };
  }

  const practice = oid(practiceId) ? await Practice.findById(oid(practiceId)).select('specialty').lean() : null;
  const specialty = practice?.specialty?.trim() || null;

  if (!specialty) {
    // The diabetology assistant, with the prompt this thread has always had.
    const legacy = await Department.findOne({ practice: null, key: LEGACY_DEPARTMENT_KEY }).lean();
    const status = legacy
      ? await assistantStatus({ department: legacy, practiceId, language })
      : noDepartment(practiceId, language);
    return {
      enabled: status.enabled,
      reason: status.enabled ? ON_REASONS.LEGACY_DEFAULT_SCOPE : status.reason,
      via: 'legacy_default',
      department: legacy,
      retrievalDepartment: legacy?._id ?? null,
      useDepartmentBlock: false,
      status,
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
    // The endocrine practice keeps the prompt it has always had; approval
    // decides whether it answers, not what it says.
    useDepartmentBlock: department.key !== LEGACY_DEPARTMENT_KEY,
    status,
  };
}
