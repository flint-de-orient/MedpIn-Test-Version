import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';

/**
 * How much of a practice there is, as numbers only.
 *
 * ---- Why this exists rather than a query in the route --------------------
 *
 * `admin.test.js` forbids the admin routes from importing a clinical model,
 * and `Enrollment` is one: it names a patient. A route holding that model can
 * write `Enrollment.find({ practice })` and get a list of who, which is the one
 * thing the platform surface must never be able to do — the whole argument for
 * keeping it separate from the clinic app.
 *
 * Counting is still legitimate. How many patients a practice has is a number
 * the platform needs for support, for limits and for knowing whether an
 * activated practice ever got used. So the boundary is drawn here instead of
 * being argued about per query: this module returns integers, and there is no
 * function on it that can return an identity.
 *
 * That is a real wall rather than indirection around one. Adding a function
 * here that returned patients would be as visible as adding the import to the
 * route, and this file exists to make that obvious.
 */

/** Patients currently enrolled at a practice. */
export async function activePatientCount(practiceId) {
  return Enrollment.countDocuments({
    practice: practiceId,
    status: ENROLLMENT_STATUS.ACTIVE,
  });
}

/** Every patient a practice has ever enrolled, revoked ones included. */
export async function everPatientCount(practiceId) {
  return Enrollment.countDocuments({ practice: practiceId });
}

/** Active enrolments across the whole platform. */
export async function platformPatientCount() {
  return Enrollment.countDocuments({ status: ENROLLMENT_STATUS.ACTIVE });
}
