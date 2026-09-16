import { Membership, MEMBERSHIP_STATUS, PERMISSIONS } from '../models/Membership.js';
import { forbidden } from './errors.js';
import { practiceOf, assertSamePractice, unplacedStaff, noPractice } from './practiceScope.js';
import { practiceMaySee } from '../services/enrollments.js';
import { grantsForRead, sharedHistoryCovers } from '../services/sharing.js';
import { recordDenial } from './recordDenial.js';

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
  if (verdict.allowed) {
    // Kept for the reads that follow. The gate alone answers "may they open
    // this patient"; a list still has to answer "which of these rows", and
    // without the enrolment in hand every route would look it up again.
    req.enrollment = verdict.enrollment ?? null;
    // What the patient has chosen to share with this practice beyond that
    // window, for `recordWindow` to consult. Loaded only here — after the
    // enrolment has been found current — so a grant can widen what an
    // enrolled practice reads and can never stand in for the enrolment.
    req.shareGrants = await grantsForRead(req, patientId, practiceId);
    return true;
  }

  // Which of the four it was, so the log can tell a fumbled link from an
  // expired consent from somebody reaching where they should not.
  recordDenial(req, { reason: verdict.reason, patientId, practiceId });

  throw forbidden(
    {
      not_enrolled: 'That patient is not enrolled at this practice',
      // Distinct from the one above on purpose. "Not enrolled here" tells a
      // clinician somebody else has this patient; this one says nobody has
      // them yet, and the answer is to enrol them rather than to ask around.
      not_connected: 'That patient is not connected to any practice yet. Add them to enrol them.',
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

    // No membership is no evidence, not a denial — on a platform that has not
    // been migrated. On one that has, a member of staff with no current
    // practice is refused; see unplacedStaff. A patient is never unplaced.
    if (!membership) {
      if (await unplacedStaff(req)) return next(noPractice());
      return next();
    }

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
  if (await unplacedStaff(req)) throw noPractice();
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

/**
 * The date filter a clinical list must apply, given who is asking.
 *
 * ---- The half of "not retroactive" that was missing ----------------------
 *
 * `enrollmentGate` answers whether a practice may open a patient at all. It
 * cannot answer which of that patient's rows they may see, because it does not
 * know what is about to be queried — and until this existed, no list asked.
 *
 * So the rule was enforced on the door and not on the shelves: a practice that
 * enrolled Rahul in September could open him and read a prescription written in
 * May by somebody else. That is the exact thing the enrolment date exists to
 * prevent, and it was one `$gte` away the whole time.
 *
 *   const filter = { patient: req.patientId, ...recordWindow(req, 'issuedOn') };
 *
 * Returns `{}` when there is no enrolment to bound by — a patient reading their
 * own record, or a caller with no practice (whom the gate has already refused
 * any patient that is not theirs).
 *
 * ---- And the one thing that lifts it -------------------------------------
 *
 * The patient. A current share grant for this practice (or for the doctor
 * asking), covering the category this read belongs to, removes the lower bound
 * for this read — and only for a read, and only where services/sharing.js can
 * say which category the read is. Every read it lifts is written to the audit
 * log with the grant's id. See `sharedHistoryCovers`.
 *
 * Spread it on its own, or inside `$and` beside another condition on the same
 * field. `{ ...recordWindow(req, 'measuredAt'), measuredAt: {...} }` replaces
 * the bound with whatever follows it, which is the same as not having one.
 */
export function recordWindow(req, field = 'createdAt') {
  const from = req.enrollment?.enrolledOn;
  if (!from) return {};
  if (sharedHistoryCovers(req, field)) return {};
  return { [field]: { $gte: new Date(from) } };
}

/**
 * The grant a patient-scoped clinical route needs, decided by what it does.
 *
 * ---- The gap this closes -------------------------------------------------
 *
 * `EDIT_RECORD` was granted by every preset that touches a patient and checked
 * by nothing. It appeared in the presets, in the capability payload the app
 * reads, and in the console's permission list — so a practice could see it
 * ticked beside somebody's name, untick it, and change nothing at all.
 *
 * `VIEW_PATIENT` was barely better: a handful of routes asked for it while the
 * clinical routers — readings, medicines, food logs, lab results, foot and eye
 * records — asked only `resolvePatientScope`, which answers "whose patient is
 * this" and not "what may this person do with them".
 *
 * ---- Why one middleware rather than forty ---------------------------------
 *
 * Because the alternative decays. Forty-one routes across six routers, each
 * needing the right one of two grants, is forty-one chances to forget — and
 * the one that gets forgotten is the one added next Friday. Mounted on the
 * router, a new route inherits the rule by existing.
 *
 * The method is the question: a GET asks to see the record, anything else
 * writes to it. Routes that need more than this say so themselves — medicine
 * changes add PRESCRIBE beside it, because changing somebody's regimen is not
 * the same act as noting their weight.
 *
 * A patient calling about their own record has no membership and passes, which
 * is `requirePermission`'s existing rule and the right one here: permissions
 * describe what a practice's staff may do, and a patient is not staff.
 */
export const requireRecordAccess = () => {
  const read = requirePermission(PERMISSIONS.VIEW_PATIENT);
  const write = requirePermission(PERMISSIONS.EDIT_RECORD);
  return (req, res, next) =>
    (req.method === 'GET' || req.method === 'HEAD' ? read : write)(req, res, next);
};
