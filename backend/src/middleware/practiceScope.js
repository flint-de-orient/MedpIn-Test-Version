import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { forbidden } from './errors.js';

/**
 * Keeping one practice's clinicians out of another practice's records.
 *
 * ---- The rule that makes this safe to ship ------------------------------
 *
 * It denies only on positive evidence of a mismatch. Never on missing data.
 *
 * That is not caution for its own sake, it is the difference between a guard
 * and an outage. Today there are no membership rows at all — the backfill has
 * not run — so a check written the obvious way ("the caller must belong to the
 * patient's practice") would refuse every request the moment it deployed, and
 * the clinic that is seeing patients right now would be locked out of its own
 * records on a Monday morning.
 *
 * So: if either side's practice is unknown, this permits and gets out of the
 * way. It starts protecting the instant memberships exist, without a flag day,
 * and it cannot protect anything before then — which is honest, because before
 * then there is only one practice and nothing to protect it from.
 *
 * ---- How a patient has a practice at all --------------------------------
 *
 * Patients have no membership; they are not staff. Their practice is inferred
 * from the doctor they are assigned to. That is a proxy rather than a fact, and
 * it is the right proxy until Enrollment exists — a patient with no assigned
 * doctor is one nobody has taken on yet, and this permits rather than guessing.
 */

/**
 * The practice this caller belongs to, or null.
 *
 * Cached on the request: several guards may ask on one call, and this is a
 * database round trip on a chat app that polls.
 */
export async function practiceOf(req) {
  if (req._practiceId !== undefined) return req._practiceId;

  const row = await Membership.findOne({
    user: req.user?._id,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  })
    .select('practice')
    .lean();

  req._practiceId = row?.practice ? String(row.practice) : null;
  return req._practiceId;
}

/**
 * The practice a patient sits in, via the doctor they are assigned to.
 *
 * Null when they have no assigned doctor, or that doctor has no membership.
 * Both are ordinary today and both mean "unknown", which permits.
 */
export async function practiceOfPatient(patientId) {
  const profile = await PatientProfile.findOne({ user: patientId })
    .select('assignedDoctor')
    .lean();
  if (!profile?.assignedDoctor) return null;

  const row = await Membership.findOne({
    user: profile.assignedDoctor,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  })
    .select('practice')
    .lean();

  return row?.practice ? String(row.practice) : null;
}

/**
 * Refuse when the caller and the patient are demonstrably in different
 * practices. Permit in every other case, including every case where either
 * answer is unknown — see the note at the top.
 */
export async function assertSamePractice(req, patientId) {
  const [mine, theirs] = await Promise.all([practiceOf(req), practiceOfPatient(patientId)]);

  // Unknown on either side is not a mismatch. This is the whole safety
  // argument and it should stay the first thing this function says.
  if (!mine || !theirs) return;

  if (mine !== theirs) {
    throw forbidden('That patient belongs to a different practice');
  }
}

/**
 * Route guard for anything scoped to a practice but not to one patient.
 *
 * Attaches `req.practiceId` and lets the request through either way, so a route
 * can filter by it where a filter is what is wanted, rather than being refused
 * outright.
 */
export async function attachPractice(req, res, next) {
  try {
    req.practiceId = await practiceOf(req);
    next();
  } catch (err) {
    next(err);
  }
}
