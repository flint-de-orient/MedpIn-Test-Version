import mongoose from 'mongoose';

/**
 * One charge, as the provider recorded it.
 *
 * ---- Why this exists when Razorpay already has it -----------------------
 *
 * Because "why was I charged this" is a question a practice asks us, not them.
 * A support conversation that begins with "log in to Razorpay and look" is one
 * where the clinic has to hold an account with our payment provider, which they
 * do not and should not.
 *
 * So this is a copy of the facts a customer can be shown or a dispute traced
 * with: how much, when, by what method, and the provider's id for the row. It
 * is deliberately not a ledger — Razorpay's is authoritative, and reconciling
 * two ledgers is a job nobody has been given.
 *
 * ---- What is deliberately absent ----------------------------------------
 *
 * No card number, no expiry, no CVV, no name on the card, no bank account, no
 * token that could stand in for any of them. `method` is the word 'card' or
 * 'upi', and `last4` is not here either — it is the kind of field that looks
 * harmless, invites a "just show the last four" feature, and drags a clinical
 * server towards PCI scope for a cosmetic gain.
 *
 * The card is typed into Razorpay's own sheet and this server never sees it.
 * That is a property to keep rather than a gap to fill in.
 */

export const PAYMENT_STATUS = Object.freeze({
  /// Money taken. The only status that means a practice has paid.
  CAPTURED: 'captured',
  /// Authorised and not yet captured. Rare on subscriptions and not an error.
  AUTHORIZED: 'authorized',
  FAILED: 'failed',
  REFUNDED: 'refunded',
});

const paymentSchema = new mongoose.Schema(
  {
    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    subscription: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Subscription',
      default: null,
      index: true,
    },

    /// `pay_XXXXXXXX`. Unique, because a redelivered webhook must update this
    /// row rather than write a second charge into a practice's history.
    providerPaymentId: { type: String, required: true, unique: true },

    /// `inv_XXXXXXXX` — which bill this settled, where there is one.
    providerInvoiceId: { type: String, default: null, index: true },

    /// Paise, as the provider stores it. Converted once, on the screen that
    /// shows it: a rupee value passed between layers is a rounding bug waiting
    /// for a plan that is not a whole number of rupees.
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS),
      required: true,
      index: true,
    },

    /// 'card', 'upi', 'netbanking', 'wallet', 'emandate'. The word only.
    method: { type: String, default: null },

    /// Why it did not go through, in the provider's words.
    ///
    /// Kept because "your card was declined" and "your bank is down" need
    /// different actions from the practice, and a single "payment failed" sends
    /// them to re-enter a card that was never the problem.
    failureReason: { type: String, default: null },

    /// When the provider says it happened, not when we heard about it. A
    /// webhook delayed four hours must not date a charge four hours late.
    at: { type: Date, required: true },
  },
  { timestamps: true },
);

/// The history query: this practice's charges, newest first.
paymentSchema.index({ practice: 1, at: -1 });

paymentSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    providerPaymentId: this.providerPaymentId,
    providerInvoiceId: this.providerInvoiceId,
    amount: this.amount,
    currency: this.currency,
    status: this.status,
    method: this.method,
    failureReason: this.failureReason,
    at: this.at,
  };
};

export const Payment = mongoose.model('Payment', paymentSchema);
