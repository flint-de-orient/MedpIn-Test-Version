import { verifyAccessToken } from '../services/tokens.js';
import { User, ROLES } from '../models/User.js';
import { unauthorized, forbidden, asyncHandler } from './errors.js';

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
    if (requested && requested !== req.user._id.toString() && requested !== 'me') {
      throw forbidden('You can only access your own health record');
    }
    req.patientId = req.user._id;
    return next();
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

  req.patientId = patient._id;
  req.patientUser = patient;
  next();
});
