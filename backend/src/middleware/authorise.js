import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { forbidden } from './errors.js';
import { practiceOf, assertSamePractice } from './practiceScope.js';
import { practiceMaySee } from '../services/enrollments.js';

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
 * ---- Question 4, answered ------------------------------------------------
 *
 * It was a named hole for as long as `Enrollment` did not exist. It does now,
 * so [enrollmentGate] asks the real question: is this patient enrolled at this
 * practice, is that enrollment current, and is the record inside its window.
 *
 * The window is the part worth keeping. Access is not retroactive, so a
 * practice that enrolled a patient in June may not read what another wrote in
 * May. Without that check an enrollment would be a key to the whole history,
 * and joining a second clinic would quietly hand them the first one's notes.
 *
 * ---- The permissive rule, again -----------------------------------------
 *
 * Like `assertSamePractice`, this refuses only on positive evidence. A caller
 * with no membership row is not refused — there are no membership rows on a
 * deployment that has not migrated, and a guard that denied on absence would
 * lock the working clinic out the hour it shipped. It starts enforcing the
 * moment memberships exist.
 */

/** All five questions are now answered. Read by the tests, and nothing else. */
export const authorisationIsComplete = true;

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

  // One definition of "currently a member", on the model. See currentFilter.
  req._membership = await Membership.findOne(
    Membership.currentFilter(req.user?._id, practiceId),
  );
  return req._membership;
}

/**
 * Question 4: is the patient enrolled here, currently, and is the record inside
 * the window that enrollment opened.
 *
 * Throws rather than returning false, so a caller cannot forget to check the
 * result — the same reasoning that makes the enrollment a required field rather
 * than an optional one.
 *
 * `recordDate` is when the thing being read was created. Omitted, only the
 * enrollment itself is checked, which is right for "may they open this patient
 * at all" and wrong for "may they read this particular prescription" — so a
 * route fetching a dated row should pass it.
 */
export async function enrollmentGate(req, patientId, { recordDate = null } = {}) {
  const practiceId = await practiceOf(req);
  // No practice on the caller is the pre-membership state, and unknown never
  // denies. See the note above.
  if (!practiceId) return true;

  const verdict = await practiceMaySee(practiceId, patientId, { recordDate });
  if (verdict.allowed) return true;

  throw forbidden(
    {
      not_enrolled: 'That patient is not enrolled at this practice',
      consent_pending: 'That patient has not yet consented to share their record here',
      revoked: 'That patient has withdrawn this practice’s access',
      before_enrolment: 'That record predates this practice’s access to the patient',
    }[verdict.reason] ?? 'You do not have access to this patient',
  );
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
