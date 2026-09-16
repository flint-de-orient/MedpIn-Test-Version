import { Practice, NEUTRAL_PRESCRIPTION_PREFIX, PRESCRIPTION_PREFIX_RE } from '../models/Practice.js';
import { Prescription } from '../models/Prescription.js';

/**
 * Whether a practice may take a prescription reference prefix.
 *
 * ---- Why this is a service ----------------------------------------------
 *
 * The operator console sets the prefix, and the admin namespace holds no
 * clinical model on purpose — verifying a practice is not a key to its
 * patients. One of the questions needs prescriptions, though: has anybody
 * already issued references with this prefix? So it is asked here, and what
 * comes back is a yes or a no with a reason. No prescription, no patient and no
 * number leaves this file.
 *
 * ---- The rules ------------------------------------------------------------
 *
 *   format    two to eight capitals and digits, starting with a letter
 *   reserved  RX is the series every practice without a prefix shares
 *   taken     another practice holds it now
 *   issued    references starting with it were issued by another practice, or
 *             before prescriptions recorded their practice
 *
 * The last is what stops a practice picking up a series somebody else's
 * patients are already holding — the founding clinic's `AKD` above all. A
 * practice may take a prefix it issued under itself; it may not take one whose
 * references it cannot show were its own.
 */
export async function prefixAvailability(prefix, practiceId) {
  if (!PRESCRIPTION_PREFIX_RE.test(prefix ?? '')) return { ok: false, reason: 'format' };
  if (prefix === NEUTRAL_PRESCRIPTION_PREFIX) return { ok: false, reason: 'reserved' };

  const holder = await Practice.findOne({ prescriptionPrefix: prefix, _id: { $ne: practiceId } })
    .select('name')
    .lean();
  if (holder) return { ok: false, reason: 'taken', holder: holder.name };

  // Anchored on the prefix and its dash, so the unique index on referenceNo
  // answers it rather than a scan — and "AK" never matches "AKD-…".
  const issued = await Prescription.exists({
    referenceNo: new RegExp(`^${prefix}-`),
    practice: { $ne: practiceId },
  });
  if (issued) return { ok: false, reason: 'issued' };

  return { ok: true };
}

/** What each refusal says to the operator. */
export const PREFIX_REFUSAL = Object.freeze({
  format: 'A prefix is two to eight capital letters or digits, starting with a letter.',
  reserved: `${NEUTRAL_PRESCRIPTION_PREFIX} is the prefix every practice without its own shares.`,
  taken: 'That prefix belongs to another practice.',
  issued:
    'Prescriptions with that prefix were already issued by another practice, or before ' +
    'prescriptions recorded their practice. Choose a different one.',
});
