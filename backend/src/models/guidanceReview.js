import mongoose from 'mongoose';

/**
 * The review vocabulary shared by knowledge passages and assistant scopes.
 *
 * ---- Why this is its own file ----------------------------------------------
 *
 * A passage and a department's assistant scope are the same kind of thing: words
 * an AI will say to a patient, which a clinician has to have read first. They
 * were reviewed in two different vocabularies — a passage had `status`, a scope
 * had nothing at all, so writing one was the same act as switching it on. One
 * set of states, one source shape and one answer to "is this live for that
 * practice" keeps the two from drifting into different meanings of "approved".
 *
 * No model is imported here, so either model can import this without a cycle.
 */

/** Where a passage or a scope stands. Only `approved` ever reaches a patient. */
export const REVIEW_STATUSES = Object.freeze(['draft', 'pending_review', 'approved', 'retired']);

/**
 * Who wrote it.
 *
 *   clinician      typed into the knowledge screen by somebody at a practice
 *   platform_seed  the platform's original diabetes and endocrine corpus,
 *                  which the seed has always written as approved
 *   ai_draft       drafted by an AI from cited public guidance. Nothing in the
 *                  platform approves one: a clinician of the specialty does,
 *                  for their own practice, on the knowledge screen.
 */
export const CONTENT_ORIGINS = Object.freeze(['clinician', 'platform_seed', 'ai_draft']);

/**
 * One piece of guidance a statement was checked against.
 *
 * `accessed` is the day the wording was compared with the live page. Guidance
 * pages are revised; a citation with no date cannot say which revision it
 * agreed with, and a reviewer re-checking it next year needs to know.
 */
export const guidanceSourceSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    organisation: { type: String, required: true, trim: true, maxlength: 200 },
    /// Year the page was published or last reviewed. Null when the document
    /// carries no date, which is said rather than guessed.
    year: { type: Number, min: 1900, max: 2100, default: null },
    url: { type: String, required: true, trim: true, maxlength: 500 },
    accessed: { type: String, trim: true, maxlength: 10, default: null },
  },
  { _id: false },
);

/**
 * One practice's sign-off on one version of a shared scope.
 *
 * Per practice because a scope approved by a cardiologist at one clinic is a
 * decision about that clinic's patients; nothing about it entitles the clinic
 * across town to the same assistant. Per version because the draft can be
 * revised after somebody read it, and an approval of words that have since
 * changed is not an approval of the words now in the prompt.
 */
export const scopeApprovalSchema = new mongoose.Schema(
  {
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', required: true },
    version: { type: Number, required: true },
    /// The department's knowledge base as the doctor saw it — see
    /// knowledgeVersionFor in services/ai/assistantReview.js. Absent on
    /// approvals written before it was recorded.
    knowledgeVersion: { type: String, trim: true, maxlength: 64, default: null },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    /// The doctor's name when they approved, so the record still says who it
    /// was after an account is renamed or removed.
    approvedByName: { type: String, trim: true, maxlength: 200, default: null },
    approvedAt: { type: Date, required: true },
    /// Withdrawn rather than deleted: the practice sees who switched it off
    /// and when, and the approval it withdrew stays on the record.
    withdrawnAt: { type: Date, default: null },
    withdrawnBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    withdrawnByName: { type: String, trim: true, maxlength: 200, default: null },
  },
  { _id: false },
);

/**
 * Where a department's assistant scope stands for one practice.
 *
 * ---- One rule, for every specialty -----------------------------------------
 *
 * Live only where a doctor of the specialty at this practice approved the
 * version in use, and has not withdrawn it. Nothing else switches an assistant
 * on: not writing a scope, not a status set in the database, not a practice
 * somewhere else having approved it.
 *
 * The diabetology remit used to be the exception. It predates review, carried
 * no status, and was read as approved for every practice on the platform —
 * including ones whose diabetologist had never seen it. It is now reviewed like
 * the rest, at version 1 when it has no version of its own, and is off for a
 * practice until that practice's diabetologist approves it. `approved` in place
 * is read the same way: a status is not a doctor.
 *
 * ---- The states ------------------------------------------------------------
 *
 *   none               no scope written. No assistant.
 *   approved           this practice approved the current version. Live.
 *   withdrawn          this practice approved and then withdrew. Not live.
 *   approval_outdated  this practice approved an earlier version. Not live: the
 *                      words changed after they were read.
 *   pending_review     awaiting this practice's approval (also `draft`).
 *   retired            withdrawn from the platform. Not live anywhere.
 *
 * Pure, so a model's `toPublic` can call it without a query.
 *
 * @returns {{state: string, live: boolean, version: ?number, approval: ?object}}
 */
export function scopeReviewFor(scope, practiceId = null) {
  if (!scope?.role) return { state: 'none', live: false, version: null, approval: null };

  const version = scopeVersionOf(scope);
  if (scope.status === 'retired') return { state: 'retired', live: false, version, approval: null };

  const approval = practiceId
    ? (scope.approvals ?? []).find((a) => String(a.practice) === String(practiceId)) ?? null
    : null;
  if (approval?.withdrawnAt) return { state: 'withdrawn', live: false, version, approval };
  if (approval && approval.version === version) {
    return { state: 'approved', live: true, version, approval };
  }
  if (approval) return { state: 'approval_outdated', live: false, version, approval };
  return { state: scope.status === 'draft' ? 'draft' : 'pending_review', live: false, version, approval: null };
}

/** The version a doctor approves: the scope's own, or 1 for one that has none. */
export function scopeVersionOf(scope) {
  return scope?.version ?? 1;
}
