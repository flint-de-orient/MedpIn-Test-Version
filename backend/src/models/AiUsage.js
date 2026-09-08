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
  },
  { timestamps: true },
);

/// One row per practice per month, and the upsert relies on it.
aiUsageSchema.index({ practice: 1, period: 1 }, { unique: true });

export const AiUsage = mongoose.model('AiUsage', aiUsageSchema);
