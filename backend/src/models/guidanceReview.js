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
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    approvedAt: { type: Date, required: true },
  },
  { _id: false },
);

/**
 * Where a department's assistant scope stands for one practice.
 *
 * ---- The states ------------------------------------------------------------
 *
 *   none               no scope written. No assistant.
 *   legacy             a role and no review status: the diabetology remit, lifted
 *                      verbatim from the prompt that clinic already used before
 *                      scopes existed. Live, exactly as it has been.
 *   approved           approved in place (a practice's own department), or this
 *                      practice approved the current version of a shared draft.
 *   approval_outdated  this practice approved an earlier version. Not live: the
 *                      words changed after they were read.
 *   draft, pending_review, retired
 *                      not live.
 *
 * Pure, so a model's `toPublic` can call it without a query.
 *
 * @returns {{state: string, live: boolean, version: ?number, approval: ?object}}
 */
export function scopeReviewFor(scope, practiceId = null) {
  if (!scope?.role) return { state: 'none', live: false, version: null, approval: null };

  const version = scope.version ?? null;
  if (scope.status == null) return { state: 'legacy', live: true, version, approval: null };
  if (scope.status === 'retired') return { state: 'retired', live: false, version, approval: null };
  if (scope.status === 'approved') return { state: 'approved', live: true, version, approval: null };

  const approval = practiceId
    ? (scope.approvals ?? []).find((a) => String(a.practice) === String(practiceId)) ?? null
    : null;
  if (approval && approval.version === version) {
    return { state: 'approved', live: true, version, approval };
  }
  if (approval) return { state: 'approval_outdated', live: false, version, approval };
  return { state: scope.status, live: false, version, approval: null };
}
