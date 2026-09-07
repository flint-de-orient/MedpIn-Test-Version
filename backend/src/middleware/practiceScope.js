import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { Clinic } from '../models/Clinic.js';
import { forbidden } from './errors.js';
import { recordDenial } from './recordDenial.js';

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

  const row = await Membership.findOne(Membership.currentFilter(req.user?._id))
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

  const row = await Membership.findOne(Membership.currentFilter(profile.assignedDoctor))
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
    // Recorded before it is thrown. A refusal that leaves no trace is the one
    // entry an audit trail most needs and the one it usually lacks, because
    // the request never reached the handler that would have logged it.
    recordDenial(req, { reason: 'cross_practice', patientId, practiceId: mine });
    throw forbidden('That patient belongs to a different practice');
  }
}

/**
 * A filter fragment restricting a query to this practice's patients.
 *
 * ---- Why the lists need their own answer --------------------------------
 *
 * `assertSamePractice` guards a patient named in the URL. It cannot guard a
 * list, because a list names nobody — and `/doctor/patients` was building
 * `{ role: PATIENT, isActive: true }`, which is every patient on the platform.
 * With one practice that read correctly. With two it hands a doctor the other
 * clinic's register, by name, with risk bands against it.
 *
 * ---- Permissive on unknown, twice ---------------------------------------
 *
 * No practice on the caller means the membership backfill has not reached
 * them, and restricting would empty the list of a clinic seeing patients right
 * now. And an Enrollment collection with nothing in it means that backfill has
 * not run either — in which case an empty `$in` would be indistinguishable
 * from a clinic with no patients, and would look exactly like data loss.
 *
 * A practice that is known, in a database where enrolments exist, gets its own
 * patients and only those — including none, which is the correct answer for a
 * second practice on its first day.
 */
export async function practicePatients(req, field = '_id') {
  const ids = await practicePatientIds(req);
  return ids ? { [field]: { $in: ids } } : {};
}

/**
 * The ids themselves, or `null` meaning "do not restrict".
 *
 * Cached on the request. The overview screen alone queries eleven collections,
 * and each wants the same list under a different field name — `patient` on a
 * reading, `user` on a profile, `_id` on the account. One `distinct` per
 * request rather than eleven.
 *
 * `null` rather than an empty array for the permissive case, because the two
 * mean opposite things and an empty array is the answer for a practice with no
 * patients yet. Conflating them is how a guard turns into an outage.
 */
export async function practicePatientIds(req) {
  if (req._practicePatientIds !== undefined) return req._practicePatientIds;

  const practiceId = await practiceOf(req);
  if (!practiceId || !(await enrolmentsExist())) {
    req._practicePatientIds = null;
    return null;
  }

  req._practicePatientIds = await Enrollment.distinct('patient', {
    practice: practiceId,
    status: ENROLLMENT_STATUS.ACTIVE,
  });
  return req._practicePatientIds;
}

/**
 * Has the enrolment backfill run at all?
 *
 * Cached once true, because a collection that has rows does not go back to
 * having none, and this is asked on every list request. Not cached while
 * false: the migration is followed by a restart, but a developer running it
 * against a live process should not have to guess why nothing changed.
 */
let _enrolmentsExist = false;
async function enrolmentsExist() {
  if (_enrolmentsExist) return true;
  _enrolmentsExist = (await Enrollment.estimatedDocumentCount()) > 0;
  return _enrolmentsExist;
}

/** The same question about memberships, cached the same way and for the same reason. */
let _membershipsExist = false;
async function membershipsExist() {
  if (_membershipsExist) return true;
  _membershipsExist = (await Membership.estimatedDocumentCount()) > 0;
  return _membershipsExist;
}

/** And about locations: has anything been linked to a practice yet? */
let _clinicsLinked = false;
async function clinicsAreLinked() {
  if (_clinicsLinked) return true;
  _clinicsLinked = (await Clinic.countDocuments({ practice: { $ne: null } })) > 0;
  return _clinicsLinked;
}

/* ------------------------------------------------------------- the staff */

/**
 * The user ids holding a current membership of a practice.
 *
 * ---- Patients are not the only thing that leaks ------------------------
 *
 * `practicePatients` was written for the patient register and it is only half
 * the problem. A practice is also its people and its buildings, and both were
 * read with no filter at all: `/doctor/dieticians` returned every dietician on
 * the platform and `/clinics` returned every location. A doctor who signed in
 * to a practice created ten minutes earlier saw another clinic's dietician by
 * name and phone number, and both of its addresses.
 *
 * That is worse than the patient list it sits beside, because it needs no
 * patient data to be wrong — a brand new practice with nobody in it and no
 * records at all still showed somebody else's staff.
 *
 * ---- Permissive on unknown, the same as everything else -----------------
 *
 * `null` means do not restrict. A caller with no membership is one the backfill
 * has not reached; a database with no memberships at all has not been migrated.
 * Restricting in either case empties the screen of a clinic running right now.
 */
export async function memberIdsOf(practiceId, roles = null) {
  if (!practiceId) return null;

  const rows = await Membership.find({
    practice: practiceId,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
    ...(roles ? { role: { $in: [].concat(roles) } } : {}),
  })
    .select('user')
    .lean();

  // No rows can mean "this practice has no dietician", which is a real answer
  // and must restrict to nothing. It can also mean the backfill has not run,
  // which must not. The collection being empty is what tells them apart.
  if (!rows.length && !(await membershipsExist())) return null;

  return rows.map((r) => r.user);
}

/**
 * A filter fragment restricting a query to the caller's own colleagues.
 *
 * `roles` is one role or several. Omit it for everybody in the practice.
 */
export async function practiceMembers(req, roles = null, field = '_id') {
  const ids = await memberIdsOf(await practiceOf(req), roles);
  return ids ? { [field]: { $in: ids } } : {};
}

/* ---------------------------------------------------------- the buildings */

/**
 * A filter fragment restricting a query to the caller's own locations.
 *
 * Strict once the backfill has linked anything, and that is deliberate. A
 * `Clinic` with no practice is not "unknown, therefore allowed" the way a
 * missing membership is — `POST /clinics` has stamped the practice on every
 * location created since practices existed, so an unlinked row today is one
 * that predates them. Showing those to a practice that did not open them is
 * exactly the leak this closes.
 *
 * When nothing anywhere is linked the backfill has not run, and this gets out
 * of the way rather than emptying the screen.
 */
export async function practiceClinics(req, field = 'practice') {
  const practiceId = await practiceOf(req);
  if (!practiceId || !(await clinicsAreLinked())) return {};
  return { [field]: practiceId };
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
