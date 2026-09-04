import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { forbidden } from './errors.js';
import { practiceOf, assertSamePractice } from './practiceScope.js';

/**
 * The five questions, asked in one place.
 *
 * ---- Why a middleware and not a check per route -------------------------
 *
 * The app hiding a button is a courtesy. This is the control. Scattered across
 * routes, the questions get asked in four places out of five and the fifth is
 * the one that ships on a Friday. So every clinical request answers all of them
 * here, or it does not reach data.
 *
 *   1. Who is the user?                    — requireAuth, already upstream
 *   2. Which practice is this request about?
 *   3. Is their membership there ACTIVE?
 *   4. Is the patient's enrollment there ACTIVE, and the record after
 *      enrolledOn?
 *   5. Does their permission set allow this action?
 *
 * ---- Question 4 is not answered yet, and says so ------------------------
 *
 * `Enrollment` does not exist — it is step 9 of the build order and this is
 * step 5. Question 4 is therefore a named hole rather than a silent one:
 * [enrollmentGate] below is the seam it will fill, `authorisationIsComplete`
 * reports false, and a test asserts that it stays false until the model lands.
 *
 * Pretending four questions are five is how a system ends up believing it
 * checks something it does not. Until then, patient scoping is the narrower
 * same-practice check in [practiceScope.js].
 *
 * ---- The permissive rule, again -----------------------------------------
 *
 * Like `assertSamePractice`, this refuses only on positive evidence. A caller
 * with no membership row is not refused — there are no membership rows on a
 * deployment that has not migrated, and a guard that denied on absence would
 * lock the working clinic out the hour it shipped. It starts enforcing the
 * moment memberships exist.
 */

/** False until Enrollment lands. Read by the tests, and by nothing else. */
export const authorisationIsComplete = false;

/**
 * The caller's membership at the practice this request concerns.
 *
 * Cached on the request: several guards may ask on one call.
 */
export async function membershipOf(req) {
  if (req._membership !== undefined) return req._membership;

  const practiceId = await practiceOf(req);
  if (!practiceId) {
    req._membership = null;
    return null;
  }

  req._membership = await Membership.findOne({
    user: req.user?._id,
    practice: practiceId,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  });
  return req._membership;
}

/**
 * Question 4's seam. Answers "yes" today because there is nothing to ask.
 *
 * When `Enrollment` exists this checks that the patient is enrolled at this
 * practice, that the enrollment is ACTIVE, and that the record being read was
 * created after `enrolledOn` — because access is not retroactive, and linking
 * today must not open four years of another doctor's notes.
 */
export async function enrollmentGate(/* req, patientId */) {
  return true;
}

/**
 * Require a permission for this route.
 *
 *   router.post('/prescriptions', requirePermission(PERMISSIONS.PRESCRIBE), ...)
 *
 * A caller with no membership passes — see the note above on why absence is
 * not evidence. A caller *with* one that lacks the permission is refused, which
 * is the case this exists for.
 */
export const requirePermission = (permission) => async (req, res, next) => {
  try {
    const membership = await membershipOf(req);

    // No membership is no evidence, not a denial. This is the line that keeps
    // the guard shippable before the migration.
    if (!membership) return next();

    if (!membership.can(permission)) {
      return next(forbidden('Your role at this practice does not allow that'));
    }
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * The whole set of questions for a request that names a patient.
 *
 * Used where a route already knows its patient — `resolvePatientScope` calls
 * the same parts in the same order for the routes that go through it.
 */
export async function authorise(req, { permission, patientId } = {}) {
  const membership = await membershipOf(req);

  if (membership && permission && !membership.can(permission)) {
    throw forbidden('Your role at this practice does not allow that');
  }

  if (patientId) {
    await assertSamePractice(req, patientId);
    await enrollmentGate(req, patientId);
  }

  return membership;
}
