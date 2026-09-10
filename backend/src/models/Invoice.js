import mongoose from 'mongoose';

/**
 * One bill, as the provider issued it.
 *
 * ---- Why nothing here renders a document --------------------------------
 *
 * Razorpay issues the invoice, numbers it, applies the tax and hosts the PDF.
 * Generating a second document from these fields would produce a paper that
 * disagrees with the one the customer's accountant already has — different
 * number, possibly different tax, certainly different rounding — and the
 * disagreement would surface at an audit rather than here.
 *
 * So `shortUrl` is the invoice. This row is an index over the provider's
 * documents: enough to list a practice's billing history, show what each one
 * was for, and link to the real thing.
 *
 * ---- Tax is stored and never computed -----------------------------------
 *
 * `tax` comes from the provider's figure. Deriving it — total minus amount, or
 * a percentage this codebase believes in — would make a GST number on a
 * clinic's books depend on a constant somebody typed here, and it would be
 * wrong the first time a rate changes or a customer is exempt.
 */

export const INVOICE_STATUS = Object.freeze({
  /// Raised and not settled.
  ISSUED: 'issued',
  PAID: 'paid',
  /// Razorpay gave up collecting.
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
});

const invoiceSchema = new mongoose.Schema(
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

    /// `inv_XXXXXXXX`. Unique, so a redelivery updates rather than duplicates.
    providerInvoiceId: { type: String, required: true, unique: true },

    /// The provider's human-facing number, which is what appears on the PDF and
    /// what an accountant will quote back. Not ours to invent.
    number: { type: String, default: null },

    /// All paise. `total` is what was actually asked for; `amount` and `tax`
    /// are the provider's breakdown of it and are not re-derived here.
    amount: { type: Number, required: true, min: 0 },
    tax: { type: Number, default: 0, min: 0 },
    total: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: Object.values(INVOICE_STATUS),
      required: true,
      index: true,
    },

    /// What period this bill covers. Null where the provider did not say —
    /// better than a guess on a document somebody files for tax.
    periodStart: { type: Date, default: null },
    periodEnd: { type: Date, default: null },

    /**
     * Razorpay's hosted invoice. This IS the document.
     *
     * A link rather than a stored PDF: their copy stays correct if a detail is
     * amended, needs no storage on a clinic's server, and cannot drift from
     * what their accountant was sent.
     */
    shortUrl: { type: String, default: null },

    issuedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

invoiceSchema.index({ practice: 1, issuedAt: -1 });

invoiceSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    providerInvoiceId: this.providerInvoiceId,
    number: this.number,
    amount: this.amount,
    tax: this.tax,
    total: this.total,
    currency: this.currency,
    status: this.status,
    periodStart: this.periodStart,
    periodEnd: this.periodEnd,
    // Null when the provider gave us none. The screen then shows the row
    // without a link rather than a link that goes nowhere.
    url: this.shortUrl,
    issuedAt: this.issuedAt,
    paidAt: this.paidAt,
  };
};

export const Invoice = mongoose.model('Invoice', invoiceSchema);
