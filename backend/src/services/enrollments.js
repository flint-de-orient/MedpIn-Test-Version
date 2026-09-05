import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';

/**
 * Which practices a patient belongs to, and what each may see.
 *
 * ---- Always the list -----------------------------------------------------
 *
 * `practicesFor` returns an array even when it holds one item, for the same
 * reason the patient switcher does: only the screen counts. A caller that
 * branched on "has exactly one practice" would be rewritten the day a patient
 * sees a second doctor, and the branch that was missed would show them one
 * clinic's chat with another clinic's name on it.
 *
 * ---- The permissive rule, one last time ----------------------------------
 *
 * A patient with no enrollment rows is one the migration has not reached, not
 * one with no practices. Every reader here treats an absent enrollment as
 * "unknown", never as "denied", so the app behaves exactly as it did until the
 * backfill has run — and starts enforcing the moment it has.
 *
 * That rule stops applying at exactly one point, and it is written down in
 * [middleware/authorise.js]: once a patient has any enrollment at all, the
 * absence of one *for a particular practice* is meaningful and does deny.
 */

/** Every practice this patient is currently enrolled at, earliest first. */
export async function practicesFor(patientId) {
  const rows = await Enrollment.find({
    patient: patientId,
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
  })
    .sort({ enrolledOn: 1 })
    .lean();

  return rows.map((e) => ({
    id: String(e._id),
    practice: String(e.practice),
    enrolledOn: e.enrolledOn,
    primaryDoctor: e.primaryDoctor ? String(e.primaryDoctor) : null,
  }));
}

/**
 * The enrollment joining one patient to one practice, current or not.
 *
 * Returns the document rather than a plain object so callers can ask it
 * `isCurrent()` and `covers(date)` instead of re-implementing either.
 */
export function enrollmentFor(patientId, practiceId) {
  return Enrollment.findOne({ patient: patientId, practice: practiceId });
}

/**
 * Whether this patient has been enrolled anywhere at all.
 *
 * The switch that turns the permissive rule off for one patient. Before their
 * first enrollment exists, absence means "not migrated"; after it, absence
 * means "not this practice's patient" — and that is a denial.
 *
 * Scoped per patient rather than globally so the migration can run in batches
 * without a window where some patients are enforced and others silently are
 * not.
 */
export async function hasAnyEnrollment(patientId) {
  return Boolean(await Enrollment.exists({ patient: patientId }));
}

/**
 * May this practice see this patient's record, and this part of it?
 *
 * Answers question 4 of the authorisation middleware. Three outcomes, and the
 * middle one is the one that matters:
 *
 *   - no enrollments at all for this patient → unknown, permit (pre-migration)
 *   - enrollments exist but none here        → deny
 *   - enrolled here                          → permit, if the record is inside
 *                                              the window
 */
export async function practiceMaySee(practiceId, patientId, { recordDate = null } = {}) {
  if (!practiceId || !patientId) return { allowed: true, reason: 'unknown' };

  const enrollment = await enrollmentFor(patientId, practiceId);

  if (!enrollment) {
    // Absence is only evidence once this patient has been enrolled somewhere.
    const migrated = await hasAnyEnrollment(patientId);
    return migrated
      ? { allowed: false, reason: 'not_enrolled' }
      : { allowed: true, reason: 'unknown' };
  }

  if (!enrollment.isCurrent()) {
    return {
      allowed: false,
      reason: enrollment.status === ENROLLMENT_STATUS.PENDING ? 'consent_pending' : 'revoked',
    };
  }

  // Access is not retroactive. Linking today does not open four years of
  // another doctor's notes.
  if (recordDate && !enrollment.covers(recordDate)) {
    return { allowed: false, reason: 'before_enrolment' };
  }

  return { allowed: true, reason: 'enrolled', enrollment };
}
