import { PLAN } from '../../models/Practice.js';
import { SUBSCRIPTION_STATUS } from '../../models/Subscription.js';

/**
 * Moving between plans, and when the move lands.
 *
 * ---- The policy, decided by the operator on 2026-09-10 ------------------
 *
 *   An upgrade takes effect immediately, with no proration.
 *   A downgrade takes effect at the end of the paid period.
 *
 * Both directions were chosen so that money never moves backwards, and that is
 * the property worth protecting rather than the dates:
 *
 *   Upgrading gives away the remainder of a cheaper period. Somebody who has
 *   asked to pay us more should not be made to wait for it, and the cost of
 *   being generous is bounded by one billing cycle.
 *
 *   Downgrading gives away nothing. They have already paid for the larger plan
 *   and keep it until it expires, so there is no refund and no credit.
 *
 * A prorated alternative needs a refund path, a reconciler, and an explanation
 * for anybody reading their bank statement — three things to maintain for an
 * amount that is at most one month of the difference between two tiers.
 *
 * ---- Why the rank is explicit ------------------------------------------
 *
 * Not the enum's declaration order, and not price. Declaration order is an
 * accident of editing; price comes from Razorpay and would make "which
 * direction is this" depend on a network call that can fail. A change whose
 * direction cannot be determined must not silently pick one.
 */

/** Ascending. A higher rank is more product, whatever it costs this week. */
const RANK = Object.freeze({
  [PLAN.TRIAL]: 0,
  [PLAN.ESSENTIAL]: 1,
  [PLAN.PROFESSIONAL]: 2,
  [PLAN.ENTERPRISE]: 3,
});

export const CHANGE = Object.freeze({
  UPGRADE: 'upgrade',
  DOWNGRADE: 'downgrade',
  SAME: 'same',
});

/** When a change of this direction should land, in Razorpay's vocabulary. */
export const SCHEDULE = Object.freeze({
  [CHANGE.UPGRADE]: 'now',
  [CHANGE.DOWNGRADE]: 'cycle_end',
});

/**
 * Which way this change goes, or null when it cannot be told.
 *
 * Null for a plan nobody has ranked. The caller refuses rather than guessing —
 * guessing `upgrade` bills somebody immediately for a tier we do not understand,
 * and guessing `downgrade` gives it to them for a month for nothing.
 */
export function directionOf(from, to) {
  const a = RANK[from];
  const b = RANK[to];
  if (a === undefined || b === undefined) return null;
  if (a === b) return CHANGE.SAME;
  return b > a ? CHANGE.UPGRADE : CHANGE.DOWNGRADE;
}

/** Plain English for the confirmation, and for the audit entry. */
export function describeChange(from, to) {
  const direction = directionOf(from, to);
  if (direction === null) return null;
  if (direction === CHANGE.SAME) return { direction, at: null, effect: 'No change.' };

  const at = SCHEDULE[direction];
  return {
    direction,
    at,
    effect:
      direction === CHANGE.UPGRADE
        ? 'Takes effect now. Your next payment is the new amount; nothing extra is charged today.'
        : 'Takes effect when the period you have paid for ends. Nothing changes until then.',
  };
}

/**
 * Whether a subscription is in a state where a plan change makes sense.
 *
 * A cancelled or completed arrangement has nothing left to reschedule, and a
 * halted one has money outstanding — moving it to a dearer plan would stack a
 * second failing charge on the first.
 */
export function mayChangePlan(status) {
  return status === SUBSCRIPTION_STATUS.ACTIVE || status === SUBSCRIPTION_STATUS.AUTHENTICATED;
}

/** Pausing is for an arrangement that is actually running. */
export function mayPause(status) {
  return status === SUBSCRIPTION_STATUS.ACTIVE;
}

export function mayResume(status) {
  return status === SUBSCRIPTION_STATUS.PAUSED;
}
