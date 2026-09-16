import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { Clinic } from '../models/Clinic.js';
import { ROLES, CLINICIAN_ROLES } from '../models/User.js';
import { AppError, forbidden } from './errors.js';
import { recordDenial } from './recordDenial.js';
import { suspendedAmong, practiceSuspended } from './practiceStatus.js';

/**
 * Keeping one practice's clinicians out of another practice's records.
 *
 * ---- The rule, and how it changed ---------------------------------------
 *
 * Unknown is nobody. A caller whose practice cannot be read, a list with no
 * practice to bound it and a patient with no enrolment all resolve to an empty
 * set — never to `{}`, which in a Mongo filter means everything.
 *
 * It was the opposite for as long as the migrations were running, and the
 * reasoning was sound then: before any membership or enrolment row existed, a
 * guard that denied on missing data would have locked the working clinic out
 * of its own records the hour it deployed. So every helper here permitted on
 * unknown, and started protecting the moment rows existed.
 *
 * The migrations have run, desk registration writes an enrolment, and the
 * deploy is gated on every active patient having one. What reaches these
 * helpers with nothing to go on now is an account that genuinely has no
 * practice — and the permissive answer handed it the platform.
 *
 * One escape remains, deliberately: `membershipsExist`, for a database with no
 * membership rows at all. That is a fresh install with no staff to protect
 * from each other, and it is asked only where "no rows" could otherwise not be
 * told apart from "a practice with no colleagues".
 *
 * ---- Which practice, when somebody works at two --------------------------
 *
 * `practiceOf` answers once per request and never guesses: one membership is
 * that practice; several need the caller to name one in `x-medpin-practice`,
 * and are refused with PRACTICE_REQUIRED until they do.
 *
 * ---- How a patient has a practice at all --------------------------------
 *
 * Patients have no membership; they are not staff. Their practices are the
 * ones they are enrolled at, which is a fact rather than a proxy.
 * `practiceOfPatient` still answers through the assigned doctor for the few
 * callers that want one conservative answer; the tenant guard does not use it.
 */

/**
 * The header a caller who works at more than one practice says which with.
 *
 * A header rather than a query parameter or a body field: it applies to every
 * request the app makes, including the ones with no body, and it does not have
 * to be threaded through forty call sites that each build their own URL.
 */
export const PRACTICE_HEADER = 'x-medpin-practice';

/**
 * Every practice this caller currently works at.
 *
 * The plural is the honest shape. One person may consult at a polyclinic on
 * Tuesdays and run their own evening clinic, which is the case `Membership`
 * exists for; a function that can only answer with one of those is a function
 * that has to choose, and choosing is not its job.
 */
export async function practicesOf(req) {
  if (req._practiceIds !== undefined) return req._practiceIds;

  const rows = await Membership.find(Membership.currentFilter(req.user?._id))
    .select('practice')
    .lean();
  const all = rows.map((r) => String(r.practice));

  // A practice the platform has suspended is not somewhere anybody currently
  // works. Kept apart rather than dropped, so `practiceOf` can say "suspended"
  // instead of "no practice". See middleware/practiceStatus.js.
  req._suspendedPracticeIds = await suspendedAmong(all);
  req._practiceIds = all.filter((id) => !req._suspendedPracticeIds.includes(id));
  return req._practiceIds;
}

/**
 * The practice this request is about, or null.
 *
 * ---- One answer per request, and never a guess ---------------------------
 *
 * This used to be `findOne`, which takes whichever membership the database
 * returns first. With one practice per person that is correct every time, and
 * it stays correct right up to the first person who works at two — and then it
 * silently picks one. Not an error, not a log line: their patients, their
 * diary and their colleagues would simply be somebody else's, on whichever
 * request the index happened to order differently.
 *
 * So:
 *
 *   none    → null, and the guards above this refuse (see unplacedStaff)
 *   one     → that one, without anybody being asked anything
 *   several → the caller says which, in the `x-medpin-practice` header, and
 *             is refused with PRACTICE_REQUIRED until they do
 *
 * The refusal is deliberate and it is not a fallback: there is no safe default
 * between two practices, and defaulting is how one clinic's work lands in
 * another's records. A named practice the caller does not currently work at is
 * refused for the same reason.
 *
 * Cached on the request: several guards ask on one call, and this is a
 * database round trip on an app that polls.
 */
export async function practiceOf(req) {
  if (req._practiceId !== undefined) return req._practiceId;

  const mine = await practicesOf(req);
  const named = req.get?.(PRACTICE_HEADER)?.trim();

  // Suspended, and said so: when the caller names the suspended practice, or
  // it is the only one they work at. Never cached — a reinstatement takes
  // effect on the next request.
  const suspended = req._suspendedPracticeIds ?? [];
  if ((named && suspended.includes(named)) || (mine.length === 0 && suspended.length)) {
    recordDenial(req, { reason: 'practice_suspended', practiceId: named || suspended[0] });
    throw practiceSuspended();
  }

  if (mine.length === 0) {
    req._practiceId = null;
    return null;
  }

  if (mine.length === 1) {
    req._practiceId = mine[0];
    return req._practiceId;
  }

  if (named && mine.includes(named)) {
    req._practiceId = named;
    return req._practiceId;
  }

  recordDenial(req, { reason: named ? 'practice_not_yours' : 'practice_ambiguous' });
  throw new AppError(
    409,
    'PRACTICE_REQUIRED',
    'You work at more than one practice. Choose which one this request is for.',
  );
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
 * practices.
 *
 * ---- Asked of the enrolment, not of the assigned doctor ------------------
 *
 * This compared `practiceOf(req)` with `practiceOfPatient`, which answers
 * through `assignedDoctor` — a single field naming one doctor at one practice.
 * For a patient properly enrolled at two, it returned the first practice and
 * refused the second: a clinician at a clinic the patient had consented to,
 * told that patient belongs to somebody else. The desk enrolment path assigns
 * no doctor at all, so those patients answered null and this permitted
 * everybody instead.
 *
 * Enrolment is the fact. A patient is at a practice because they were enrolled
 * there, and that is what this asks.
 *
 * ---- Why any enrolment counts, including a pending one -------------------
 *
 * A patient the desk registered this morning has a pending enrolment until
 * they answer the code. They are at that practice — that is precisely what
 * pending means — and refusing here would answer with the wrong sentence.
 * `enrollmentGate` runs immediately after and says "has not yet consented",
 * which is the true one.
 *
 * A patient with no enrolment anywhere is left to the gate too, for the same
 * reason: "not connected to any practice yet" tells a clinician what to do,
 * and "belongs to a different practice" does not.
 */
export async function assertSamePractice(req, patientId) {
  const mine = await practiceOf(req);
  // No practice on the caller is the pre-membership state; unplacedStaff has
  // already refused anybody it should refuse. See the note at the top.
  if (!mine) return;

  const [here, anywhere] = await Promise.all([
    Enrollment.exists({ patient: patientId, practice: mine }),
    Enrollment.exists({ patient: patientId }),
  ]);

  if (here || !anywhere) return;

  // Recorded before it is thrown. A refusal that leaves no trace is the one
  // entry an audit trail most needs and the one it usually lacks, because
  // the request never reached the handler that would have logged it.
  recordDenial(req, { reason: 'cross_practice', patientId, practiceId: mine });
  throw forbidden('That patient belongs to a different practice');
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
  return { [field]: { $in: await practicePatientIds(req) } };
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

  /*
   * No practice is nobody, not everybody.
   *
   * This returned null — read by every caller as "unknown, so unrestricted" —
   * both for a caller with no practice and for a database with no enrolments
   * at all. Both were the migration's escape hatch, and both expand access by
   * default: a list built for a practice became the platform's register for
   * anybody whose practice could not be read. The migration has run; what
   * reaches here with no practice is an account that has none, and its answer
   * is an empty list.
   */
  const practiceId = await practiceOf(req);
  if (!practiceId) {
    req._practicePatientIds = [];
    return req._practicePatientIds;
  }

  req._practicePatientIds = await Enrollment.distinct('patient', {
    practice: practiceId,
    status: ENROLLMENT_STATUS.ACTIVE,
  });
  return req._practicePatientIds;
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
  // Unknown is an empty set of colleagues rather than the platform's staff.
  // See practicePatientIds for why the permissive answer had to go.
  const ids = await memberIdsOf(await practiceOf(req), roles);
  return { [field]: { $in: ids ?? [] } };
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
  // A caller with no practice has no buildings. `{}` here was every location
  // on the platform — names, addresses and phone numbers — for whoever asked.
  const practiceId = await practiceOf(req);
  if (!practiceId) return { [field]: { $in: [] } };
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
  // The locations of the practices they are enrolled at, and none beyond. It
  // answered `{}` — every location on the platform — while no location had
  // been linked to a practice; every location has been since practices existed.
  const ids = await patientPracticeIds(patientId);
  return { [field]: { $in: ids ?? [] } };
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
