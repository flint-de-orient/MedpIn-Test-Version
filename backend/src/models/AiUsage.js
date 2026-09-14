import mongoose from 'mongoose';

/**
 * How much the assistant has answered for a practice this month.
 *
 * ---- Why a counter and not a query over the messages ---------------------
 *
 * The messages are already stored, so the count could be derived — and would
 * be, once per patient turn, over a collection that grows forever. One upsert
 * and one read beats a scan of every conversation a clinic has ever had, and
 * the number is only ever used as a comparison against a limit.
 *
 * ---- One row per practice per month --------------------------------------
 *
 * `period` is `YYYY-MM` in the clinic's own timezone rather than the server's,
 * because a plan's month is a month where the clinic is. A row appears the
 * first time the assistant answers and is never deleted: last month's number
 * is what somebody asks about when this month's runs out.
 */
const aiUsageSchema = new mongoose.Schema(
  {
    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    /// `2026-09`. A string rather than a date because it is a bucket, not an
    /// instant, and comparing buckets by equality is the only thing done here.
    period: { type: String, required: true },

    /// Replies the assistant produced. Incremented after a reply is generated,
    /// not before: a request that fails on the model's side has cost the
    /// practice nothing and should not count against them.
    replies: { type: Number, default: 0 },

    /// Times it stood down because the allowance was gone. Counted separately
    /// so "we hit the limit twice" and "we hit it four hundred times" are
    /// different answers — the first is a busy week, the second is the wrong
    /// plan.
    refused: { type: Number, default: 0 },

    /**
     * What the model actually processed, which is what Google bills for.
     *
     * ---- Why counting replies is not counting cost --------------------
     *
     * The allowance compares `replies` against a plan limit — 1,000 on
     * Essential, 5,000 on Professional — and a reply is not a unit of
     * anything. A long conversation carrying a patient's clinical record and
     * several retrieved knowledge chunks can cost several thousand prompt
     * tokens; a one-line answer costs a few hundred. Both decrement the
     * allowance by one.
     *
     * So a practice on Essential can spend its thousand replies at 4,400
     * prompt tokens each — 4.4 million tokens — or at 800, and nothing in the
     * product could tell the two apart. The meter measured the wrong thing.
     *
     * ---- Recorded, and deliberately not yet enforced -------------------
     *
     * These count. They are not compared against a limit, because switching
     * the allowance from replies to tokens would change what every existing
     * practice is allowed on the deploy that shipped it — and a clinic whose
     * assistant stops answering mid-morning because the unit changed
     * underneath them is an outage, not a pricing decision.
     *
     * What this buys is the number to make that decision with. Enforcement is
     * a separate, deliberate change, on a month of real figures.
     */
    promptTokens: { type: Number, default: 0 },
    responseTokens: { type: Number, default: 0 },

    /**
     * Calls per kind of AI work, including the ones the allowance ignores.
     *
     * ---- The blind spot this makes visible -----------------------------
     *
     * `countReply` was called from the patient assistant and nowhere else.
     * The nutrition assistant, the foot and eye readers, prescription and lab
     * extraction, and voice transcription all call Gemini and none of them
     * reached the meter — so they cost real money and appeared in no counter
     * at all, not even as calls.
     *
     * Written out as named fields rather than a free-form map, for the same
     * reason the role table is: a new AI path has to be added here
     * deliberately, with a test diff attached. `aiCallsAreMetered.test.js`
     * fails when a Gemini call site exists that no field accounts for.
     *
     * Only `assistant` feeds the allowance. The rest are recorded so that the
     * question "what are we actually spending" has an answer, and so that a
     * later decision to meter them is made on evidence.
     */
    calls: {
      assistant: { type: Number, default: 0 },
      nutrition: { type: Number, default: 0 },
      vision: { type: Number, default: 0 },
      labReport: { type: Number, default: 0 },
      prescription: { type: Number, default: 0 },
      transcribe: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);

/// One row per practice per month, and the upsert relies on it.
aiUsageSchema.index({ practice: 1, period: 1 }, { unique: true });

export const AiUsage = mongoose.model('AiUsage', aiUsageSchema);
