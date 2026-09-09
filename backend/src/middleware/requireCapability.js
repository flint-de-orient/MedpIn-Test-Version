import { Practice } from '../models/Practice.js';
import { Membership } from '../models/Membership.js';
import { practiceOf, practiceOfPatient } from './practiceScope.js';
import { ROLES } from '../models/User.js';
import { effectiveCapabilities, describeCapabilities } from '../services/capabilities.js';
import { forbidden } from './errors.js';
import { recordDenial } from './recordDenial.js';
import { billingBlocks } from '../services/billing/lapse.js';

/**
 * The server half of a capability check.
 *
 * ---- Why hiding the button is not the feature ---------------------------
 *
 * A capability-driven UI hides what a practice has not got, and that is a
 * courtesy, not a control. The route is still there, still mounted, and still
 * answers anybody who types the URL — which on a platform where the difference
 * between plans is what the software will do makes the paywall a suggestion.
 *
 * So every capability that gates a screen gates its routes too, and this is the
 * thing that does it. The client's copy of the answer is for arranging the
 * furniture; this one decides.
 *
 * ---- Permissive on unknown, again ---------------------------------------
 *
 * `effectiveCapabilities` already returns everything for a practice with no
 * type and no plan, and for a caller with no membership. This adds one more:
 * a caller belonging to no practice at all is not refused here either. Refusing
 * would lock out every account the backfill has not reached, which is the same
 * outage the tenant guards are written to avoid.
 */

/** The practice and membership for this request, cached on it. */
export async function capabilityContext(req) {
  if (req._capabilityContext) return req._capabilityContext;

  /**
   * Which practice's capabilities apply, and there are two ways to be in one.
   *
   * `practiceOf` reads the caller's *membership*, which a patient does not
   * have — they are enrolled, not employed. So every patient-facing route was
   * getting a null practice, which the guard reads as "unknown, permit", and
   * the whole layer was inert for exactly the half of the app that has the most
   * users.
   *
   * That is a quiet failure of the kind this codebase keeps finding: the guard
   * was mounted, correct, and answering a question about somebody who could
   * never be the subject of it.
   */
  const practiceId =
    req.user?.role === ROLES.PATIENT
      ? await practiceOfPatient(req.user._id)
      : await practiceOf(req);

  const [practice, membership] = await Promise.all([
    practiceId ? Practice.findById(practiceId).lean() : null,
    // Still the membership, and still null for a patient — which is the right
    // answer. `effectiveCapabilities` reads a null membership as "do not
    // narrow", so a patient gets what their practice has rather than what a
    // role preset would allow.
    practiceId && req.user?._id
      ? Membership.findOne(Membership.currentFilter(req.user._id, practiceId)).lean()
      : null,
  ]);

  req._capabilityContext = { practice, membership, role: req.user?.role ?? null };
  return req._capabilityContext;
}

/** Does this request carry the capability? Never throws. */
export async function requestCan(req, capability) {
  const ctx = await capabilityContext(req);
  // No practice means nothing to check against, and the caller predates the
  // model rather than being an intruder.
  if (!ctx.practice) return true;
  return effectiveCapabilities(ctx).has(capability);
}

/**
 * Route guard. `requireCapability(CAPABILITIES.PRESCRIPTION)`.
 *
 * The refusal says which capability and why it is missing, because the two
 * reasons need different answers from whoever hits it: a plan that does not
 * include it is a sale, and a practice type that cannot have it is not.
 */
export function requireCapability(capability) {
  return async function capabilityGuard(req, res, next) {
    try {
      const ctx = await capabilityContext(req);
      if (!ctx.practice) return next();

      if (effectiveCapabilities(ctx).has(capability)) {
        /*
         * Held, but possibly withheld.
         *
         * A lapsed practice keeps every clinical capability and loses the paid
         * extras — analytics, reports, exports, scheduled reports. Checked
         * after the capability rather than before it so the refusal names the
         * real reason: "your plan does not include this" and "your payment
         * failed" send somebody to two different places.
         */
        const blocked = await billingBlocks(ctx.practice._id, capability);
        if (!blocked) return next();

        recordDenial(req, {
          reason: 'billing',
          capability,
          practiceId: String(ctx.practice._id),
        });
        return next(
          forbidden(
            'This is paused while the subscription payment is outstanding. ' +
              'Patient records, prescribing and messaging are unaffected.',
          ),
        );
      }

      const detail = describeCapabilities(ctx);
      const practiceHasIt = detail.practice.includes(capability);

      recordDenial(req, {
        reason: 'capability',
        capability,
        practiceId: String(ctx.practice._id),
      });

      // Two different sentences on purpose. "Your plan does not include this"
      // sent to somebody whose role is the reason sends them to buy something
      // that will not help.
      return next(
        forbidden(
          practiceHasIt
            ? 'Your account does not have access to this.'
            : 'This practice does not have that feature.',
        ),
      );
    } catch (err) {
      return next(err);
    }
  };
}
