import { verifyAccessToken } from '../services/tokens.js';
import { User, ROLES, CLINICIAN_ROLES } from '../models/User.js';
import { unauthorized, forbidden, asyncHandler } from './errors.js';
import { assertSamePractice, unplacedStaff, noPractice } from './practiceScope.js';
import { enrollmentGate } from './authorise.js';
import { loginMayAccess } from '../services/patientsForLogin.js';
import { recordDenial } from './recordDenial.js';

/** Populates req.user from the bearer token. */
export const requireAuth = asyncHandler(async (req, res, next) => {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) throw unauthorized();

  const payload = verifyAccessToken(token);
  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) throw unauthorized('Account is inactive');

  req.user = user;
  next();
});

/**
 * The routes an account with no current practice may still reach.
 *
 * Each only describes the caller's own placement and answers "no practice" when
 * there is none, which is a true sentence the app shows and a refusal would
 * replace with an error. Every other staff route reads or writes a practice's
 * data, and without a practice there is no answer that is not somebody else's.
 */
const UNPLACED_MAY_ASK = Object.freeze([
  { method: 'GET', path: '/practices/mine' },
  { method: 'GET', path: '/billing' },
]);

function unplacedMayAsk(req) {
  const path = `${req.baseUrl ?? ''}${req.path ?? ''}`.replace(/\/+$/, '');
  return UNPLACED_MAY_ASK.some((r) => r.method === req.method && path.endsWith(r.path));
}

export const requireRole =
  (...roles) =>
  async (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('This action requires a different role'));
    }
    try {
      // The role says what somebody does; a current membership says where. A
      // member of staff with no practice has nowhere their role applies. See
      // unplacedStaff.
      if (!unplacedMayAsk(req) && (await unplacedStaff(req))) {
        recordDenial(req, { reason: 'no_current_practice' });
        return next(noPractice());
      }
    } catch (err) {
      return next(err);
    }
    next();
  };

/**
 * Anybody who works at a practice, as opposed to a patient.
 *
 * ---- What this was, and why that was wrong ------------------------------
 *
 * `requireRole(DOCTOR, STAFF)` — which did not even admit a dietician, and
 * would have refused every role added since from the forty routes it guards.
 * A lab technician would have signed in successfully and then been told "this
 * action requires a different role" by the entire application.
 *
 * It is not an authorisation decision in its own right. It means "is a member
 * of staff here", and what somebody may then *do* is decided by the permission
 * and capability guards on the individual route. Written as the full list so
 * that adding a role cannot silently exclude it — `CLINICIAN_ROLES` is the one
 * place that list lives.
 *
 * ---- And this is why the narrower guards matter -------------------------
 *
 * Widening this widens nothing on its own, but only because the routes behind
 * it check further. `resolvePatientScope` below decides who may open a record
 * that is not their own, and it is an allow-list rather than a negation for
 * exactly this reason: "not a patient" is not the same question as "may read
 * this patient".
 */
export const requireClinician = requireRole(...CLINICIAN_ROLES);
export const requireDietician = requireRole(ROLES.DIETICIAN);

/**
 * The roles that may open a patient record directly, by id.
 *
 * ---- An allow-list, and every absence is deliberate ---------------------
 *
 * This was `role !== DOCTOR && role !== STAFF → forbidden`, written that way
 * after treating "not a patient" as "clinician" turned out to hand every
 * dietician blanket access to every clinical record. The list is the fix, and
 * it only works while somebody keeps deciding what goes in it.
 *
 * **In**, because attaching work to a person's record is the job:
 *   doctor, staff, doctor's assistant — they work the record itself
 *   lab manager, lab technician — a result belongs to a patient, and there is
 *     nowhere else to put it
 *
 * **Out**, and each for its own reason:
 *   dietician — reaches their assigned patients through /dietician/*, which
 *     enforces the assignment. Blanket access here would be the hole again.
 *   practice manager — rosters, departments and billing. Their preset
 *     withholds VIEW_PATIENT, and this is the guard that makes that mean
 *     something rather than merely hiding a tab.
 *   patient — handled above; their own record and their household's.
 */
export const DIRECT_PATIENT_ACCESS = Object.freeze([
  ROLES.DOCTOR,
  ROLES.STAFF,
  ROLES.DOCTOR_ASSISTANT,
  ROLES.LAB_MANAGER,
  ROLES.LAB_TECHNICIAN,
]);

/**
 * Who may set up the practice itself — its locations and its letterhead.
 *
 * ---- Why this exists, and why it is not MANAGE_STAFF --------------------
 *
 * A handful of routes were guarded by `requireClinician` alone, which used to
 * mean "doctor or desk" and now means "works here". Widening that guard
 * without this would have handed a lab technician the ability to delete a
 * clinic location.
 *
 * The obvious fix is `requirePermission(MANAGE_STAFF)`, and it is wrong: the
 * front desk does not hold it, and the front desk is who sets up the first
 * clinic — the Profile screen offers exactly that when a practice has no
 * location yet. Gating on the permission would break the first-run path for a
 * practice whose receptionist does the setup, which is most of them.
 *
 * So this restores the surface these routes already had and adds the one role
 * whose job it plainly is. Whether the desk *should* keep it is a real
 * product question and a separate change; it is not one to make by accident
 * while adding roles.
 */
export const PRACTICE_SETUP = Object.freeze([
  ROLES.DOCTOR,
  ROLES.STAFF,
  ROLES.PRACTICE_MANAGER,
]);

/**
 * Who may edit the shared medicine dictionary.
 *
 * The names and strengths that autocomplete on every prescription in the
 * practice. Same reasoning as above: this was doctor-or-desk, and a lab
 * technician editing the list a doctor prescribes from is not a thing the
 * widening should have quietly allowed.
 *
 * A doctor's assistant is added because typing up the dictionary is precisely
 * the kind of work they do. A practice manager is not: they administer the
 * practice and do not touch clinical reference data.
 */
export const MEDICINE_DICTIONARY = Object.freeze([
  ROLES.DOCTOR,
  ROLES.STAFF,
  ROLES.DOCTOR_ASSISTANT,
]);

/**
 * The doctor alone — for anything that is a clinical decision.
 *
 * `requireClinician` admits STAFF, which is right for registration, the
 * appointment queue and the care inbox: that is what a front desk does. It is
 * not right for prescribing, for changing what a patient takes, or for
 * declaring a clinical alert resolved.
 *
 * Prescribing was the sharp end. The create route recorded `doctor:
 * req.user._id`, so a prescription written by a receptionist stored *them* as
 * the prescribing doctor and printed their name in that role on the PDF. That
 * is not a permission slip, it is a false medical record.
 *
 * Resolving an alert is the same kind of act in a quieter way: "this patient no
 * longer needs a doctor" is a judgement only a doctor can make.
 */
export const requireDoctor = requireRole(ROLES.DOCTOR);

/**
 * Resolves which patient a request is operating on and enforces access.
 *
 * Patients may only ever touch their own record. Clinicians may act on any
 * patient in the clinic. Every clinical route funnels through here rather than
 * comparing ids inline — one place to audit means one place to get right.
 *
 * Reads `:patientId` from the path, falling back to the caller's own id.
 */
export const resolvePatientScope = asyncHandler(async (req, res, next) => {
  const requested = req.params.patientId ?? req.query.patientId ?? null;

  if (req.user.role === ROLES.PATIENT) {
    const own = !requested || requested === 'me' || requested === req.user._id.toString();

    if (own) {
      req.patientId = req.user._id;
      return next();
    }

    // A login may also act for the people it looks after — a child, a parent,
    // a grandmother who has never touched a phone. Their records live under
    // this number because there is no other number to reach them on.
    //
    // Checked against the Patient table rather than assumed from the request:
    // without this, a patient could name any id and be served that record, and
    // the household feature would be a hole rather than a feature.
    if (await loginMayAccess(req.user._id, requested)) {
      req.patientId = requested;
      return next();
    }

    // Recorded. A patient reaching for a record that is not theirs is worth
    // knowing about whichever way it happened.
    recordDenial(req, { reason: 'not_in_household', patientId: requested });
    throw forbidden('You can only access your own health record');
  }

  /*
   * Clinician path, against an allow-list — see DIRECT_PATIENT_ACCESS above
   * for who is on it and why each absence is deliberate.
   *
   * It was two inequalities, which was the same list written as a negation.
   * The difference matters now that roles are added regularly: a negation
   * admits everything it has not been taught to refuse, and the one it lets
   * through is the one nobody thought about. Treating "not a patient" as
   * "clinician" was exactly that hole, and it is how a dietician came to have
   * blanket access to every clinical record.
   */
  if (!DIRECT_PATIENT_ACCESS.includes(req.user.role)) {
    recordDenial(req, { reason: 'role_has_no_patient_access', patientId: requested });
    throw forbidden('You do not have access to this patient');
  }
  // Before the patient is looked up, so the refusal says nothing about them:
  // an account with no practice is refused whoever it names.
  if (await unplacedStaff(req)) {
    recordDenial(req, { reason: 'no_current_practice', patientId: requested });
    throw noPractice();
  }
  if (!requested || requested === 'me') {
    throw forbidden('A patient must be specified for clinician access');
  }
  const patient = await User.findOne({ _id: requested, role: ROLES.PATIENT });
  if (!patient) throw forbidden('Unknown patient');

  // "Any patient in the clinic" was true while there was one clinic. With two,
  // a clinician at one could open records at the other, and every clinical
  // route funnels through here — so this is where that closes.
  //
  // It refuses only on a proven mismatch and permits whenever either side's
  // practice is unknown, which is every request until the backfill runs. A
  // check that denied on missing data would lock the working clinic out of its
  // own records the day it deployed.
  await assertSamePractice(req, patient._id);

  // Question 4. Same-practice says the caller and the patient belong to one
  // practice; this says the patient actually granted that practice access, and
  // has not withdrawn it. The two are different facts and a clinician can pass
  // the first while failing the second.
  await enrollmentGate(req, patient._id);

  req.patientId = patient._id;
  req.patientUser = patient;
  next();
});
