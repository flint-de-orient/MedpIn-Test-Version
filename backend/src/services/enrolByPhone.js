import { User, ROLES } from '../models/User.js';
import { Patient, RELATIONSHIP } from '../models/Patient.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { requestOtp, verifyOtp } from './otp.js';
import { toE164 } from '../utils/phone.js';
import { conflict, badRequest, notFound } from '../middleware/errors.js';
import { Practice } from '../models/Practice.js';
import { activePatientCount } from './practiceUsage.js';
import { ConsentEvent, CONSENT_ACTION, CONSENT_METHOD } from '../models/ConsentEvent.js';

/** The consent text currently shown at the desk. Bump when the wording changes. */
export const CONSENT_WORDING = 'desk-v1';

/**
 * Enrolling a patient by their phone number — the join, working.
 *
 * ---- What this replaces --------------------------------------------------
 *
 * The desk route answered a number it had seen before with
 * `conflict('An account with this phone number already exists')`. That is the
 * correct answer for a system where a patient belongs to one clinic and the
 * wrong one for a platform: Priya at Dr. Dey's desk and Amit at Dr. Sen's, both
 * typing Rahul's number, are not a collision. They are two practices who each
 * need a link to one person.
 *
 * So a number that exists adds an enrollment instead of erroring. One person
 * stays one account, and the patient who has never installed anything finds
 * both doctors waiting when they eventually log in.
 *
 * ---- When consent is asked for, and when it is not ----------------------
 *
 * A code is sent when a practice is reaching for a record it did not create,
 * and not when it is starting one.
 *
 * That distinction is the whole safety argument and it is not a shortcut. A
 * desk registering somebody who has never used the app is not gaining access to
 * anybody's history — there is none yet, and the record about to exist is the
 * one they are writing. Asking that patient to approve the clinic they are
 * standing in adds a step and protects nothing.
 *
 * A desk typing a number that already belongs to somebody is doing something
 * else entirely: asking to be linked to a person whose record another practice
 * may hold. That needs the person's own handset to answer, or a typo at the
 * counter silently attaches a practice to a stranger.
 *
 * So: first practice, immediate. Every practice after it, consented.
 */

/** The OTP purpose for a desk-initiated enrollment. Distinct from register/login. */
export const ENROL_PURPOSE = 'enrol';

/**
 * Find the login for a phone number, or make one, and enrol them here.
 *
 * Never throws on an existing number — that is the entire point.
 *
 * @returns {Promise<{login, patient, enrollment, consentRequired: boolean, isNewLogin: boolean}>}
 */
export async function enrolByPhone({
  phone,
  name,
  practiceId,
  enrolledBy = null,
  primaryDoctor = null,
  language = 'en',
  dateOfBirth = null,
  gender = 'undisclosed',
}) {
  if (!practiceId) throw badRequest('A practice is required to enrol a patient');

  await assertRoomForOnePatient(practiceId);

  const e164 = toE164(phone);
  let login = await User.findByLoginPhone(e164);
  const isNewLogin = !login;

  if (!login) {
    login = await User.create({
      name,
      phone: e164,
      role: ROLES.PATIENT,
      language,
      dateOfBirth,
      gender,
      // No password. This account is reached by OTP, like every patient
      // account, and the desk never sets one on somebody else's behalf.
    });
  }

  // The body. Reuses the login's id for a self-patient, which is what keeps
  // every clinical collection pointing at the right value — see Patient.js.
  let patient = await Patient.findOne({
    login: login._id,
    relationship: RELATIONSHIP.SELF,
    isActive: true,
  });

  if (!patient) {
    patient = await Patient.create({
      _id: login._id,
      login: login._id,
      name: name || login.name,
      dateOfBirth: dateOfBirth ?? login.dateOfBirth ?? null,
      gender: gender ?? login.gender ?? 'undisclosed',
      relationship: RELATIONSHIP.SELF,
    });
  }

  const already = await Enrollment.findOne({ patient: patient._id, practice: practiceId });
  if (already) {
    // Returning after a revocation reactivates this row rather than making a
    // second, so the original enrolledOn and the consent history stay attached.
    if (already.status === ENROLLMENT_STATUS.REVOKED) {
      await requestOtp({ phone: e164, purpose: ENROL_PURPOSE });
      already.status = ENROLLMENT_STATUS.PENDING;
      already.revokedAt = null;
      already.revokedBy = null;
      await already.save();
      await ConsentEvent.record({
        enrollment: already._id,
        action: CONSENT_ACTION.REQUESTED,
        actor: enrolledBy,
        method: CONSENT_METHOD.OTP_DESK,
        wording: CONSENT_WORDING,
        note: 'Re-requested after a previous withdrawal',
      });
      return { login, patient, enrollment: already, consentRequired: true, isNewLogin };
    }
    return {
      login,
      patient,
      enrollment: already,
      consentRequired: already.status === ENROLLMENT_STATUS.PENDING,
      isNewLogin,
    };
  }

  // Whether anybody else already holds a record for this person. See the note
  // above: reaching needs consent, starting does not.
  const elsewhere = await Enrollment.countDocuments({ patient: patient._id });
  const consentRequired = !isNewLogin && elsewhere > 0;

  const enrollment = await Enrollment.create({
    patient: patient._id,
    practice: practiceId,
    status: consentRequired ? ENROLLMENT_STATUS.PENDING : ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: new Date(),
    enrolledBy,
    primaryDoctor,
  });

  if (consentRequired) {
    // The patient's own handset, not the one at the counter. A typo produces no
    // code rather than silently attaching a practice to a stranger's record.
    await requestOtp({ phone: e164, purpose: ENROL_PURPOSE });
  }

  // Logged either way. A first-practice enrollment is still a grant, and one
  // that left no trace because it needed no code would be the one case nobody
  // could account for later.
  await ConsentEvent.record({
    enrollment: enrollment._id,
    action: consentRequired ? CONSENT_ACTION.REQUESTED : CONSENT_ACTION.GRANTED,
    actor: enrolledBy,
    method: CONSENT_METHOD.OTP_DESK,
    wording: CONSENT_WORDING,
    note: consentRequired ? null : 'First practice — no other record existed to reach',
  });

  return { login, patient, enrollment, consentRequired, isNewLogin };
}

/**
 * Turn a pending enrollment active, once the patient reads back their code.
 *
 * The code is checked against the phone on the *login*, never against a number
 * supplied with the request — taking both and trusting them to match would let
 * a desk verify one number and enrol another.
 */
export async function confirmEnrolment({ enrollmentId, code, confirmedBy = null }) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw notFound('That enrolment was not found');

  if (enrollment.status === ENROLLMENT_STATUS.ACTIVE) return enrollment;
  if (enrollment.status === ENROLLMENT_STATUS.REVOKED) {
    throw conflict('That enrolment was withdrawn. Start a new one.');
  }

  const patient = await Patient.findById(enrollment.patient).select('login').lean();
  const login = await User.findById(patient?.login).select('phone').lean();
  if (!login?.phone) throw notFound('No phone number to verify against');

  await verifyOtp({ phone: login.phone, purpose: ENROL_PURPOSE, code });

  enrollment.status = ENROLLMENT_STATUS.ACTIVE;
  // Dated at consent, not at creation. The practice's window opens when the
  // patient says so, which is the moment access actually begins.
  enrollment.enrolledOn = new Date();
  enrollment.enrolledBy = enrollment.enrolledBy ?? confirmedBy;
  await enrollment.save();

  await ConsentEvent.record({
    enrollment: enrollment._id,
    action: CONSENT_ACTION.GRANTED,
    actor: confirmedBy,
    method: CONSENT_METHOD.OTP_DESK,
    wording: CONSENT_WORDING,
  });

  return enrollment;
}

/**
 * Refuse a new patient when the practice is at its cap.
 *
 * ---- Permissive, like every other guard here -----------------------------
 *
 * A practice with no `limits.patients` has no cap, and that is every practice
 * today including the founding clinic. `overLimit` returns null in that case
 * and this returns immediately, so a limit nobody typed in cannot refuse
 * anybody. A missing practice row is the pre-migration state, and unknown never
 * denies.
 *
 * ---- Why here ------------------------------------------------------------
 *
 * This is the one place a practice gains a patient. Reading the plan and
 * deciding what it entitles them to at each call site would be four copies of
 * one table, drifting.
 *
 * A cap is a brake on growth, not a shredder: lowering a limit below the
 * current count stops the next registration and touches nothing that exists.
 *
 * The message names the number, because "upgrade your plan" tells a
 * receptionist nothing they can act on with the patient in front of them.
 */
async function assertRoomForOnePatient(practiceId) {
  const practice = await Practice.findById(practiceId).select('limits');
  if (!practice) return;

  const over = practice.overLimit('patients', await activePatientCount(practiceId));
  if (!over) return;

  throw badRequest(
    `This practice is at its limit of ${over.cap} patients. ` +
      'Ask your administrator to raise it before registering anyone else.',
  );
}
