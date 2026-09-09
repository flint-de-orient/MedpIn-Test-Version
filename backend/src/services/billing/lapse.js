import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../../models/Subscription.js';

/**
 * What happens to a practice when the money stops.
 *
 * ---- The decision this encodes, and who made it -------------------------
 *
 * A lapse policy is a product decision with a clinical price, so it was put to
 * the operator five times before this file existed. What is written here is the
 * default that was proposed and not corrected:
 *
 *     active -> past due -> grace -> restricted
 *
 * `past due` is Razorpay retrying a failed charge. Nothing happens: cards
 * expire, banks decline, and most of these resolve on the second attempt.
 *
 * `grace` begins when the retries are exhausted. For BILLING_GRACE_DAYS the
 * practice is untouched and somebody is told.
 *
 * `restricted` blocks *growth*, and only growth. New patients, new people, new
 * locations, and the analytics and exports that are the paid extras.
 *
 * ---- What a lapse must never do ----------------------------------------
 *
 * Nothing clinical. Not reading a record, not writing one, not prescribing, not
 * a patient reaching their clinic. A doctor who cannot open a chart with a
 * patient in front of them because a card expired is a patient-safety incident
 * that happens to have a billing cause, and no amount of unpaid invoice makes
 * that a reasonable trade.
 *
 * The assistant is deliberately NOT restricted either, though it is the one
 * real marginal cost here. A patient asking whether their symptom matters is
 * not party to their clinic's billing arrangement, and silence is the one reply
 * that could hurt them. If that has to change, `RESTRICTED` below is where —
 * and note that emergency triage escalates before any model call, so the alert
 * to staff survives regardless.
 *
 * ---- Off until switched on ---------------------------------------------
 *
 * `BILLING_GRACE_DAYS` is 0 by default, which means no practice is ever
 * restricted. Deploying this changes nothing anywhere until somebody sets it,
 * which is the right default for a rule nobody has signed off — the same
 * "absence permits" this codebase runs on, applied to money.
 */

/**
 * What a restricted practice may no longer do. Everything else is untouched.
 *
 * ---- Getting your own data out is not a premium feature -----------------
 *
 * `REPORT_EXPORT` was on this list and has been taken off. The export is not a
 * report — it is named patients, their phone numbers and their readings: a copy
 * of the clinic's own record. Withholding it over an unpaid invoice holds
 * medical records hostage, and it does so to precisely the practice that needs
 * them most, because a customer who has stopped paying is usually one who is
 * leaving.
 *
 * `ADVANCED_ANALYTICS` and `ADVANCED_REPORTS` stay, and the line between them
 * and export is the one worth holding: those withhold *insight* into data the
 * practice can still take with it in full. Withholding *access* to the data
 * itself is a different act with a different name.
 */
export const RESTRICTED = Object.freeze([
  'ENROL_PATIENT',
  'ADD_MEMBER',
  'ADD_LOCATION',
  'ADVANCED_ANALYTICS',
  'ADVANCED_REPORTS',
  'DEPARTMENT_ANALYTICS',
  'STAFF_ANALYTICS',
  // Automated delivery, not access. A lapsed practice stops getting a report
  // emailed to it and can still produce every one of them by hand.
  'SCHEDULED_REPORTS',
]);

/** Where a practice is in the lapse, as a word rather than a set of dates. */
export const BILLING_STATE = Object.freeze({
  /// No subscription, or one that is paying. Every practice today.
  OK: 'ok',
  /// A charge failed and the provider is retrying. Nothing is withheld.
  PAST_DUE: 'past_due',
  /// Retries exhausted, still inside the grace window.
  GRACE: 'grace',
  /// Grace expired. Growth is blocked; care is not.
  RESTRICTED: 'restricted',
});

/** Days between the retries being exhausted and anything being withheld. */
export function graceDays() {
  const n = Number(env.BILLING_GRACE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Whether this deployment restricts anybody at all. */
export function lapseConfigured() {
  return graceDays() > 0;
}

/**
 * Where a practice stands, from its newest subscription.
 *
 * Returns `{ state, since, until, blocks }`. `blocks` is empty except in
 * `restricted`, so a caller can ask one question instead of two.
 */
export async function billingStateOf(practiceId, at = new Date()) {
  const none = { state: BILLING_STATE.OK, since: null, until: null, blocks: [] };
  if (!practiceId) return none;

  try {
    const sub = await Subscription.findOne({ practice: practiceId })
      .sort({ createdAt: -1 })
      .select('status confirmedAt graceEndsAt')
      .lean();

    // No subscription is not a lapse. It is every practice on the platform
    // today, the founding clinic included, and treating it as unpaid would
    // restrict the only real customer on the deploy that added this.
    if (!sub) return none;

    if (sub.status === SUBSCRIPTION_STATUS.PENDING) {
      return { state: BILLING_STATE.PAST_DUE, since: sub.confirmedAt ?? null, until: null, blocks: [] };
    }

    if (sub.status !== SUBSCRIPTION_STATUS.HALTED) return none;

    // Halted, but this deployment has not been told to restrict anybody.
    if (!lapseConfigured()) {
      return { state: BILLING_STATE.GRACE, since: sub.confirmedAt ?? null, until: null, blocks: [] };
    }

    const until = sub.graceEndsAt ?? null;
    if (!until || at < new Date(until)) {
      return { state: BILLING_STATE.GRACE, since: sub.confirmedAt ?? null, until, blocks: [] };
    }

    return {
      state: BILLING_STATE.RESTRICTED,
      since: sub.confirmedAt ?? null,
      until,
      blocks: [...RESTRICTED],
    };
  } catch (err) {
    /*
     * Fails open, like every other check in this codebase that can fail.
     *
     * A database hiccup must not become "this clinic has not paid". The cost of
     * being wrong in this direction is one unbilled week; in the other it is a
     * working clinic told it cannot register a patient.
     */
    logger.warn({ err, practice: String(practiceId) }, 'could not read a billing state');
    return none;
  }
}

/**
 * Is this action withheld right now?
 *
 * Returns null to permit — the shape `overLimit` already uses, so the callers
 * that enforce caps enforce this the same way and in the same place.
 */
export async function billingBlocks(practiceId, action) {
  const state = await billingStateOf(practiceId);
  if (!state.blocks.includes(action)) return null;
  return { action, state: state.state, since: state.since, until: state.until };
}

/** When the grace window should end, given a halt now. Null when unconfigured. */
export function graceEndsFrom(at = new Date()) {
  const days = graceDays();
  if (days <= 0) return null;
  return new Date(at.getTime() + days * 86_400_000);
}
