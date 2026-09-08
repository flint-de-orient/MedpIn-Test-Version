import mongoose from 'mongoose';

/**
 * What a practice is paying for, and what the provider last told us about it.
 *
 * ---- Why this is not fields on Practice ---------------------------------
 *
 * `Practice.plan` is what the software should let them do. This is the
 * commercial arrangement behind it, and the two go out of step constantly and
 * legitimately: a card fails on the 3rd and is retried on the 5th, and the
 * clinic keeps working throughout. Collapsing them makes every payment hiccup a
 * capability change, and a doctor cannot open a record because a bank timed
 * out.
 *
 * So the plan stays on the practice and is changed deliberately. This row is
 * the evidence for changing it.
 *
 * ---- The provider is the source of truth -------------------------------
 *
 * Razorpay decides whether a subscription is active; this is a cache of their
 * answer, stamped with when it was last confirmed. Anything derived from it
 * that matters — suspending a practice, say — should ask how old the answer is
 * rather than trusting it, because a webhook that never arrived leaves this row
 * looking healthy forever.
 */
export const SUBSCRIPTION_STATUS = Object.freeze({
  /// Created but not yet paid. A checkout that was opened and abandoned lands
  /// here and stays; it is not a customer and not a failure.
  CREATED: 'created',
  AUTHENTICATED: 'authenticated',
  ACTIVE: 'active',
  /// A charge failed and the provider is retrying. The clinic keeps working —
  /// see the note above.
  PENDING: 'pending',
  /// Retries exhausted. The decision point, and deliberately a separate state
  /// from `cancelled`: nobody chose this.
  HALTED: 'halted',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  EXPIRED: 'expired',
});

const subscriptionSchema = new mongoose.Schema(
  {
    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    /// Which provider this belongs to. One field now and one value, because a
    /// second gateway is a migration rather than a surprise, and a row that
    /// cannot say where it came from is one nobody can reconcile.
    provider: { type: String, default: 'razorpay' },

    /// `sub_XXXXXXXX`. Unique, because two rows for one provider subscription
    /// is how a webhook comes to update the wrong one.
    providerSubscriptionId: { type: String, required: true, unique: true },

    /// `plan_XXXXXXXX` — the provider's plan, not ours. Kept so a row can be
    /// reconciled against their dashboard without a lookup table.
    providerPlanId: { type: String },

    /// The plan this subscription is *for*, in our vocabulary. What the
    /// practice gets is still `Practice.plan`; this is what was bought.
    plan: { type: String, required: true },

    status: {
      type: String,
      enum: Object.values(SUBSCRIPTION_STATUS),
      default: SUBSCRIPTION_STATUS.CREATED,
      index: true,
    },

    /// When the provider last told us something about this. Not `updatedAt`:
    /// that moves when anything on the row changes, including a note somebody
    /// typed, and the question this answers is "how stale is the status".
    confirmedAt: { type: Date, default: null },

    /// Paid up to. Null until the first successful charge.
    currentPeriodEnd: { type: Date, default: null },

    /**
     * Every event the provider sent, in order.
     *
     * Kept rather than collapsed into the status, because "the card failed
     * twice and then went through" is the answer to most billing questions and
     * a status field cannot hold it. Capped in the writer rather than the
     * schema so the cap is visible where the append happens.
     */
    events: [
      {
        _id: false,
        event: String,
        at: { type: Date, default: Date.now },
        /// The provider's own id for the event, so a redelivery can be
        /// recognised rather than appended twice.
        providerEventId: String,
      },
    ],
  },
  { timestamps: true },
);

/// One live subscription per practice is the intent, but not a constraint: a
/// practice that upgrades has a cancelled row and an active one, and a unique
/// index on `practice` alone would refuse the second before the first is gone.
subscriptionSchema.index({ practice: 1, status: 1 });

export const Subscription = mongoose.model('Subscription', subscriptionSchema);
