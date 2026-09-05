import { verifyAccessToken } from '../services/tokens.js';
import { User, ROLES } from '../models/User.js';
import { unauthorized, forbidden, asyncHandler } from './errors.js';
import { assertSamePractice } from './practiceScope.js';
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

export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) {
      return next(forbidden('This action requires a different role'));
    }
    next();
  };

export const requireClinician = requireRole(ROLES.DOCTOR, ROLES.STAFF);
export const requireDietician = requireRole(ROLES.DIETICIAN);

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

  // Clinician path — DOCTOR or STAFF only. A dietician reaches their assigned
  // patients through /dietician/* (which enforces the assignment); they must
  // never get blanket access to every patient's clinical record here. Treating
  // "not a patient" as "clinician" was the hole the dietician role opened.
  if (req.user.role !== ROLES.DOCTOR && req.user.role !== ROLES.STAFF) {
    throw forbidden('You do not have access to this patient');
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
