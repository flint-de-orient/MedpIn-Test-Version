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
 *   ai_draft       drafted by an AI from cited public guidance, and seeded
 *                  approved so the specialty's assistant can answer from it.
 *                  The origin stays on the row, so the knowledge screen shows
 *                  which passages a machine wrote; a practice can edit or retire
 *                  its copy there.
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
 * One practice's sign-off on one version of a shared scope — from an approval
 * step that no longer exists. Kept so rows written then still load; nothing
 * reads it. See scopeReviewFor.
 */
export const scopeApprovalSchema = new mongoose.Schema(
  {
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', required: true },
    version: { type: Number, required: true },
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
 * Whether a department's assistant scope is in use.
 *
 * ---- No approval step ---------------------------------------------------------
 *
 * A scope is live when it is written and not retired, for every practice. There
 * is no per-practice sign-off: whether the assistant answers a given patient is
 * decided by the conversation's own switch — the assistant toggle a clinician
 * has on the chat screen, on by default — and by the department having enough
 * approved guidance to answer from (services/ai/assistantAvailability.js).
 *
 * `approvals` on a scope, and scopeApprovalSchema above, are records of an
 * earlier per-practice approval step. They are kept so existing rows still load,
 * and nothing reads them.
 *
 *   none      no scope written. No assistant.
 *   retired   withdrawn from the platform. No assistant anywhere.
 *   live      in use.
 *
 * Pure, so a model's `toPublic` can call it without a query. The second
 * argument is accepted and ignored, so older callers need not change.
 *
 * @returns {{state: string, live: boolean, version: ?number, approval: null}}
 */
// eslint-disable-next-line no-unused-vars
export function scopeReviewFor(scope, _practiceId = null) {
  if (!scope?.role) return { state: 'none', live: false, version: null, approval: null };
  const version = scopeVersionOf(scope);
  if (scope.status === 'retired') return { state: 'retired', live: false, version, approval: null };
  return { state: 'live', live: true, version, approval: null };
}

/** A scope's version: its own, or 1 for one that has none. */
export function scopeVersionOf(scope) {
  return scope?.version ?? 1;
}
