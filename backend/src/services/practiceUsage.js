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

/**
 * New enrolments in two adjacent windows, for a trend.
 *
 * Counts only. Same boundary as the rest of this module: there is no function
 * here that can return who.
 */
export async function enrolmentMovement(from, previousFrom) {
  const [current, previous] = await Promise.all([
    Enrollment.countDocuments({ createdAt: { $gte: from } }),
    Enrollment.countDocuments({ createdAt: { $gte: previousFrom, $lt: from } }),
  ]);
  return { current, previous };
}

/**
 * How many enrolments existed at the end of each month.
 *
 * Takes the boundaries rather than deciding them, so the caller keeps its own
 * calendar and this module keeps its rule: it hands back counts, never rows.
 *
 * An earlier version returned a closure to defer the bucketing. That was one
 * cleverness too many — a function arriving through a destructured `Promise.all`
 * reads as a value until it is called, and the helper checker was right not to
 * recognise it.
 */
export async function enrolmentCumulative(starts, end) {
  const rows = await Enrollment.find({ createdAt: { $gte: starts[0] } })
    .select('createdAt')
    .lean();
  const before = await Enrollment.countDocuments({ createdAt: { $lt: starts[0] } });

  return starts.map((_, i) => {
    const boundary = starts[i + 1] ?? end;
    return before + rows.filter((r) => new Date(r.createdAt) < boundary).length;
  });
}
