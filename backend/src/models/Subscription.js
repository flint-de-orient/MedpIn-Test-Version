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
  /// Charging stopped at the customer's request, mandate still authorised.
  /// Distinct from `cancelled`: resuming needs no second trip through checkout,
  /// which is the entire reason to offer it rather than cancel-and-resubscribe.
  PAUSED: 'paused',
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

    /**
     * The provider's references, kept so a dispute can be traced without a
     * shell.
     *
     * ---- What is deliberately NOT here -------------------------------------
     *
     * A card number, an expiry, a CVV, a name on the card, a bank account. None
     * of it is ever sent to this server: the card is typed into Razorpay's own
     * checkout and this system only ever sees ids that point at their record.
     * That is what keeps a clinic's server out of PCI scope, and it is a
     * property to preserve rather than a gap to fill in.
     *
     * `cus_` is the payer, `pay_` the last successful charge, `inv_` the last
     * invoice raised. Latest-wins rather than a list: the history that matters
     * is in `events`, and a subscription with a year of charges should not grow
     * a field per month.
     */
    providerCustomerId: { type: String, default: null },
    providerPaymentId: { type: String, default: null },
    providerInvoiceId: { type: String, default: null },

    /**
     * When the app's checkout callback was verified against Razorpay's
     * signature — not when the app said it had succeeded.
     *
     * Separate from `confirmedAt`, which is the webhook's word. Both exist
     * because they answer different questions: this one says a human completed
     * a checkout on a device, the other says the provider has since confirmed
     * money moved. A subscription can have the first and not the second, and
     * that gap is where a failed mandate lives.
     */
    checkoutVerifiedAt: { type: Date, default: null },

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
     * A downgrade that has been asked for and has not landed.
     *
     * Kept apart from `plan` on purpose. A downgrade takes effect at the end of
     * the period the practice has already paid for, so writing it into `plan`
     * would tell them they had lost the larger tier weeks before they do — and
     * every capability check reads `Practice.plan`, so it would take it away
     * too.
     *
     * This is what the console and the app read to say "changing to Essential
     * on 9 October". Cleared when the change lands, or when it is superseded.
     */
    pendingPlan: { type: String, default: null },

    /**
     * When a halted subscription stops being merely late.
     *
     * Written once, when the retries are exhausted, rather than computed on
     * read — so changing `BILLING_GRACE_DAYS` cannot retroactively restrict a
     * practice that was already inside its window. Somebody who was told they
     * had until Friday has until Friday.
     *
     * Null where the deployment restricts nobody, which is the default.
     */
    graceEndsAt: { type: Date, default: null },

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
