import { Payment, PAYMENT_STATUS } from '../../models/Payment.js';
import { Invoice, INVOICE_STATUS } from '../../models/Invoice.js';
import { logger } from '../../config/logger.js';

/**
 * Writing down what the provider charged.
 *
 * ---- Upsert, never insert -----------------------------------------------
 *
 * Razorpay delivers at least once, so the same payment arrives twice in normal
 * operation. An insert would put two charges into a practice's history for one
 * debit on their statement, which is the single worst thing a billing history
 * can say — worse than showing nothing, because the practice cannot tell which
 * of the two was real.
 *
 * So every write here is keyed on the provider's id and is safe to repeat.
 *
 * ---- And it never throws into the webhook -------------------------------
 *
 * The webhook's job is to keep the subscription correct. A failure to file a
 * receipt must not turn a delivery into a 500, because Razorpay retries a 500
 * and the retry would re-apply the subscription change. Losing a history row is
 * recoverable from their dashboard; a retry storm on a live server is not.
 */

/** Their payment status to ours. Unknown maps to null and the row is skipped. */
function paymentStatus(raw) {
  switch (raw) {
    case 'captured':
      return PAYMENT_STATUS.CAPTURED;
    case 'authorized':
      return PAYMENT_STATUS.AUTHORIZED;
    case 'failed':
      return PAYMENT_STATUS.FAILED;
    case 'refunded':
      return PAYMENT_STATUS.REFUNDED;
    default:
      return null;
  }
}

function invoiceStatus(raw) {
  switch (raw) {
    case 'paid':
      return INVOICE_STATUS.PAID;
    case 'issued':
    case 'partially_paid':
      return INVOICE_STATUS.ISSUED;
    case 'expired':
      return INVOICE_STATUS.EXPIRED;
    case 'cancelled':
      return INVOICE_STATUS.CANCELLED;
    default:
      return null;
  }
}

/** Razorpay sends seconds; everything here is a Date. */
function at(seconds) {
  return typeof seconds === 'number' ? new Date(seconds * 1000) : null;
}

/**
 * File one payment from a webhook payload.
 *
 * Returns the row, or null when there was nothing usable to file — a payload
 * with no id, or a status this app has not been taught. Skipping an unknown
 * status is deliberate: inventing one would put a word on a practice's billing
 * history that means nothing to anybody.
 */
export async function recordPayment({ entity, practiceId, subscriptionId }) {
  if (!entity?.id || !practiceId) return null;

  const status = paymentStatus(entity.status);
  if (!status) {
    logger.warn({ payment: entity.id, status: entity.status }, 'unknown payment status');
    return null;
  }

  try {
    return await Payment.findOneAndUpdate(
      { providerPaymentId: entity.id },
      {
        $set: {
          practice: practiceId,
          subscription: subscriptionId ?? null,
          providerInvoiceId: entity.invoice_id ?? null,
          amount: entity.amount ?? 0,
          currency: entity.currency ?? 'INR',
          status,
          method: entity.method ?? null,
          // Their words, not ours. "Your card was declined" and "your bank is
          // down" need different actions from the practice.
          failureReason: entity.error_description ?? null,
          at: at(entity.created_at) ?? new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    logger.error({ err, payment: entity.id }, 'could not file a payment');
    return null;
  }
}

/** File one invoice. Same rules: upsert, never throw, skip what we cannot read. */
export async function recordInvoice({ entity, practiceId, subscriptionId }) {
  if (!entity?.id || !practiceId) return null;

  const status = invoiceStatus(entity.status);
  if (!status) {
    logger.warn({ invoice: entity.id, status: entity.status }, 'unknown invoice status');
    return null;
  }

  try {
    return await Invoice.findOneAndUpdate(
      { providerInvoiceId: entity.id },
      {
        $set: {
          practice: practiceId,
          subscription: subscriptionId ?? null,
          number: entity.invoice_number ?? null,
          // Their breakdown, never re-derived. A GST figure on a clinic's books
          // must not depend on a percentage somebody typed into this codebase.
          amount: entity.amount ?? 0,
          tax: entity.tax_amount ?? 0,
          total: entity.gross_amount ?? entity.amount ?? 0,
          currency: entity.currency ?? 'INR',
          status,
          periodStart: at(entity.billing_start),
          periodEnd: at(entity.billing_end),
          // The document itself. A link rather than a stored PDF: their copy
          // stays correct if a detail is amended.
          shortUrl: entity.short_url ?? null,
          issuedAt: at(entity.issued_at) ?? at(entity.created_at),
          paidAt: at(entity.paid_at),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (err) {
    logger.error({ err, invoice: entity.id }, 'could not file an invoice');
    return null;
  }
}
