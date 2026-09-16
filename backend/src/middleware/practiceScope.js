import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { Clinic } from '../models/Clinic.js';
import { ROLES, CLINICIAN_ROLES } from '../models/User.js';
import { AppError, forbidden } from './errors.js';
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
 * The practice a staff member belongs to, by user id — `practiceOf` for where
 * there is no request, such as the doctor named on a prescription or an
 * appointment.
 */
export async function practiceOfMember(userId) {
  if (!userId) return null;
  const row = await Membership.findOne(Membership.currentFilter(userId)).select('practice').lean();
  return row?.practice ? String(row.practice) : null;
}

/**
 * Every practice actively caring for a patient, the one to answer first at
 * the front.
 *
 * ---- Why not `practiceOfPatient` ----------------------------------------
 *
 * That answers through the assigned doctor, which the note at the top of this
 * file calls the right proxy "until Enrollment exists". Enrollment exists, and
 * the path that brings a patient into a second practice — the desk enrolling
 * them by phone — writes the enrolment and assigns no doctor. For exactly those
 * patients it answered null, and every caller read null as everybody: their
 * alerts woke every clinician on the platform, their visit reminders named them
 * to every doctor on it, and the assistant introduced the first clinic.
 *
 * It stays as it is for the tenant guards and the allowance, which want its
 * single conservative answer. This is for "who looks after this patient".
 *
 * ---- The order ------------------------------------------------------------
 *
 * Active enrolments, earliest first — with the assigned doctor's practice at the
 * front when the patient is actively enrolled there, since that is where a
 * doctor deliberately took them on. With no active enrolment, the assigned
 * doctor's practice as before; with neither, none, and each caller keeps what
 * it did for an unknown patient.
 */
export async function practicesOfPatient(patientId) {
  if (!patientId) return [];
  const [rows, viaDoctor] = await Promise.all([
    Enrollment.find({ patient: patientId, status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null })
      .sort({ enrolledOn: 1, _id: 1 })
      .select('practice')
      .lean(),
    practiceOfPatient(patientId),
  ]);

  const enrolled = [...new Set(rows.map((r) => String(r.practice)))];
  if (!enrolled.length) return viaDoctor ? [viaDoctor] : [];
  return viaDoctor && enrolled.includes(viaDoctor)
    ? [viaDoctor, ...enrolled.filter((p) => p !== viaDoctor)]
    : enrolled;
}

/** The first of those: the practice whose name a patient should read. */
export async function practiceForPatient(patientId) {
  return (await practicesOfPatient(patientId))[0] ?? null;
}

/**
 * Whose day an appointment is: its doctor's practice, and the patient's only
 * when the doctor belongs to none. Appointments are scoped by their doctor
 * everywhere else, and a patient cared for by two practices is booked with one.
 */
export async function practiceOfAppointment(appointment) {
  const doctorId = appointment?.doctor?._id ?? appointment?.doctor ?? null;
  const patientId = appointment?.patient?._id ?? appointment?.patient ?? null;
  return (await practiceOfMember(doctorId)) ?? (await practiceForPatient(patientId));
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

/**
 * A member of staff with no current practice, on a platform that has practices.
 *
 * ---- Refused, not unrestricted ------------------------------------------
 *
 * Absence permitted while memberships did not exist, because refusing then
 * would have locked out the one clinic running. They exist now, and an account
 * whose membership ended, or was never made, is the case that rule was never
 * written for: every scope helper read "no practice" as "no restriction", so a
 * doctor who had left could list every patient on the platform. The guards ask
 * this first and refuse.
 *
 * A patient has no membership by design and is never unplaced. A platform with
 * no memberships at all has not been migrated, and keeps the old rule.
 */
export async function unplacedStaff(req) {
  if (!req.user || !CLINICIAN_ROLES.includes(req.user.role)) return false;
  if (!(await membershipsExist())) return false;
  return !(await practiceOf(req));
}

/** The refusal for a member of staff with no current practice. See unplacedStaff. */
export function noPractice() {
  return new AppError(
    403,
    'NO_PRACTICE',
    'This account is not part of a practice any more. Ask the practice to add you back.',
  );
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
 * The location this caller works at, or null for "wherever the practice is".
 *
 * ---- Why null is the common answer and stays fine ----------------------
 *
 * A solo practice has one building and nobody needs telling which. A doctor who
 * runs two clinics himself belongs to both. So the field is set only where
 * somebody deliberately said "this person sits at that branch", and null means
 * the whole practice — which is every membership the backfill created.
 *
 * ---- And what it is used for ------------------------------------------
 *
 * A default, not a wall. It decides which diary a doctor opens on, and it does
 * not decide which appointment they may touch: a doctor covering a colleague's
 * afternoon at the other branch needs to confirm and reschedule there, and a
 * system that refuses is one they will work around by ringing the desk.
 */

/** Which part of the practice this caller works in, or null for all of it. */
export async function memberDepartment(req) {
  if (req._memberDepartment !== undefined) return req._memberDepartment;

  const practiceId = await practiceOf(req);
  if (!practiceId || !req.user?._id) {
    req._memberDepartment = null;
    return null;
  }

  const row = await Membership.findOne(Membership.currentFilter(req.user._id, practiceId))
    .select('department')
    .lean();

  req._memberDepartment = row?.department ? String(row.department) : null;
  return req._memberDepartment;
}

/**
 * A filter narrowing threads to the ones this clinician is meant to answer.
 *
 * ---- Why it keeps the unassigned ones ----------------------------------
 *
 * A thread carries the department a patient wrote to, and anybody in that
 * department may answer — that is what the schema says and why the thread names
 * a department rather than a doctor.
 *
 * But most threads have no department at all: a solo practice has none to
 * choose from, and every message sent before departments existed carries null.
 * Narrowing to `department: mine` alone would empty the inbox of the clinic
 * running today, so an unassigned thread belongs to everybody and stays.
 *
 * `{}` when the caller has no department, which is every membership the
 * backfill created.
 */
export async function departmentThreads(req, field = 'department') {
  const mine = await memberDepartment(req);
  if (!mine) return {};
  return { $or: [{ [field]: mine }, { [field]: null }] };
}

export async function memberLocation(req) {
  if (req._memberLocation !== undefined) return req._memberLocation;

  const practiceId = await practiceOf(req);
  if (!practiceId || !req.user?._id) {
    req._memberLocation = null;
    return null;
  }

  const row = await Membership.findOne(Membership.currentFilter(req.user._id, practiceId))
    .select('location')
    .lean();

  req._memberLocation = row?.location ? String(row.location) : null;
  return req._memberLocation;
}


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
 * The practices a patient may use, or `null` meaning "do not restrict".
 *
 * ---- Why a patient needs their own answer --------------------------------
 *
 * `practiceClinics` asks the caller's membership, and a patient has none. So
 * for every patient it returned `{}`, and the list they book from held every
 * active location on the platform. The test pinning that list checked the call
 * was made, which it was.
 *
 * ---- Nowhere, not everywhere ---------------------------------------------
 *
 * A patient with no enrolment at all used to answer `null`, which every caller
 * reads as "unknown, so permit". It was the same migration-era rule as
 * `practiceMaySee`: before the backfill, no enrolment meant no data rather
 * than no clinic, and restricting those patients would have left the whole
 * deployment unable to book.
 *
 * What it produced was a booking screen listing every active location on the
 * platform — every other clinic's name, address and phone number — to somebody
 * no practice had taken on. That is the opposite of the answer: a patient with
 * no enrolment can book nowhere, because there is nowhere they belong.
 *
 * `null` now means only "no patient was named". An empty list is a real
 * answer, and it means nowhere: also the right answer for a patient whose only
 * enrolment was withdrawn.
 */
export async function patientPracticeIds(patientId) {
  if (!patientId) return null;
  return Enrollment.distinct('practice', {
    patient: patientId,
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
  });
}

/** `practiceClinics` for a patient: the locations of the practices they are enrolled at. */
export async function patientClinics(patientId, field = 'practice') {
  if (!(await clinicsAreLinked())) return {};
  const ids = await patientPracticeIds(patientId);
  return ids ? { [field]: { $in: ids } } : {};
}

/**
 * The locations this caller may use: their practice's, or a patient's
 * practices'. One question with two sources, so no route has to remember which
 * one a patient needs.
 */
export async function clinicsFor(req, field = 'practice') {
  return req.user?.role === ROLES.PATIENT
    ? patientClinics(req.user._id, field)
    : practiceClinics(req, field);
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
