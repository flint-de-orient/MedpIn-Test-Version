import { User, ROLES } from '../models/User.js';
import { Patient, RELATIONSHIP } from '../models/Patient.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { requestOtp, verifyOtp } from './otp.js';
import { toE164 } from '../utils/phone.js';
import { conflict, badRequest, notFound } from '../middleware/errors.js';
import { Practice } from '../models/Practice.js';
import { billingBlocks } from './billing/lapse.js';
import { noticeUsage } from './billing/usageNotice.js';
import { activePatientCount } from './practiceUsage.js';
import { ConsentEvent, CONSENT_ACTION, CONSENT_METHOD } from '../models/ConsentEvent.js';
import { autoAssignDietician } from './dieticianAssignment.js';
import { wasActiveBefore } from './enrollments.js';
import { askHistoryQuestion } from './sharing.js';
import { logger } from '../config/logger.js';

/**
 * The consent text currently shown at the desk. Bump when the wording changes.
 *
 * v2: every account that already exists is asked, not only one another
 * practice holds, and the desk is shown nothing about the account until its
 * owner answers.
 */
export const CONSENT_WORDING = 'desk-v2';

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
 * A code is sent whenever the number already has an account, and never when
 * the desk is making the account.
 *
 * A desk registering somebody who has never used MedPin is not gaining access
 * to anybody's history — there is none yet, and the record about to exist is
 * the one they are writing. Asking that patient to approve the clinic they are
 * standing in adds a step and protects nothing.
 *
 * A desk typing a number that already has an account is doing something else
 * entirely: asking to be linked to a person who has a record, whether another
 * practice holds it or they built it themselves in the app. That needs the
 * person's own handset to answer, or a typo at the counter silently attaches a
 * practice to a stranger.
 *
 * It used to ask only when another practice held an enrolment, so a person who
 * had signed themselves up — readings, medicines, a name and a date of birth —
 * was joined to whichever desk typed their number, with no code at all.
 *
 * ---- And what the desk is shown before the answer ------------------------
 *
 * Nothing about the account. Not its name, not its id, not the other numbers
 * it signs in with. The route hands back what the desk typed; the waiting list
 * is built from what the desk typed; the account's own details arrive with the
 * consent that entitles the practice to them.
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

  // A clinician's or a desk's own number. Registering it would hang a patient
  // record off a staff account that no clinical route will ever open as a
  // patient. Refused in words that do not say whose number it is.
  if (login && login.role !== ROLES.PATIENT) {
    throw badRequest('That number cannot be registered as a patient. Use the patient’s own mobile number.');
  }

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

  // What the desk typed, kept on the request. See `requestedName` on
  // ConsentEvent: the waiting list is built from this, never from the account.
  const asked = { requestedName: name ?? null, requestedPhone: e164 };

  const already = await Enrollment.findOne({ patient: patient._id, practice: practiceId });
  if (already) {
    // Returning after a revocation reactivates this row rather than making a
    // second, so the original enrolledOn and the consent history stay attached.
    // `enrolledOn` is deliberately not touched here or at the confirmation —
    // see `confirmEnrolment`.
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
        ...asked,
      });
      return { login, patient, enrollment: already, consentRequired: true, isNewLogin };
    }
    /*
     * Still waiting on the patient, and the desk has asked again.
     *
     * This used to return `consentRequired: true` and send nothing, so the
     * counter was told "we have texted them a code — ask them to read it out"
     * about a code sent hours ago and long expired. The desk's only way to
     * chase a pending enrolment is to register the person again, so that is
     * the moment a fresh code has to go out.
     *
     * A cooldown refusal is not a failure here. It means a code went out in
     * the last minute and is still live, which is the same instruction to the
     * person at the counter — so it is swallowed rather than turned into an
     * error on a registration that otherwise succeeded.
     */
    if (already.status === ENROLLMENT_STATUS.PENDING) {
      let sent = false;
      try {
        await requestOtp({ phone: e164, purpose: ENROL_PURPOSE });
        sent = true;
      } catch (err) {
        if (err?.status !== 429) throw err;
      }
      // A fresh code is a fresh request, and the number it went to is the one
      // the confirmation has to check. Inside the cooldown nothing new went
      // out, so the earlier request still stands as written.
      if (sent) {
        await ConsentEvent.record({
          enrollment: already._id,
          action: CONSENT_ACTION.REQUESTED,
          actor: enrolledBy,
          method: CONSENT_METHOD.OTP_DESK,
          wording: CONSENT_WORDING,
          note: 'Code sent again',
          ...asked,
        });
      }
    }

    return {
      login,
      patient,
      enrollment: already,
      consentRequired: already.status === ENROLLMENT_STATUS.PENDING,
      isNewLogin,
    };
  }

  // An account that existed before this desk typed its number is somebody's
  // record, whether another practice holds it or they built it themselves.
  // See the note above: reaching needs consent, starting does not.
  const consentRequired = !isNewLogin;

  const enrollment = await Enrollment.create({
    patient: patient._id,
    practice: practiceId,
    status: consentRequired ? ENROLLMENT_STATUS.PENDING : ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: new Date(),
    enrolledBy,
    primaryDoctor,
  });

  // A practice with exactly one dietician looks after everybody's nutrition,
  // and now says so on the record rather than leaving it to a read scope that
  // widened by default. Only on an active enrolment: a pending one has not
  // been consented to yet, and it is assigned when the code comes back.
  if (enrollment.status === ENROLLMENT_STATUS.ACTIVE) {
    await autoAssignDietician(patient._id, practiceId);
  }

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
    note: consentRequired ? null : 'A new account made at this desk — there was no record to reach',
    ...(consentRequired ? asked : {}),
  });

  /*
   * After the add, never before.
   *
   * A notice alongside a refusal would be a second message about something the
   * person is already reading. This fires on the way past 80, 90 and 100 per
   * cent, once each — see billing/usageNotice.js.
   *
   * Deliberately not awaited. A push that is slow, or a provider that is down,
   * must not hold up the response to somebody registering a patient with them
   * standing at the desk.
   */
  noticeUsage(practiceId, 'patients', await activePatientCount(practiceId)).catch(() => {});

  return { login, patient, enrollment, consentRequired, isNewLogin };
}

/**
 * Turn a pending enrollment active, once the patient reads back their code.
 *
 * The code is checked against a number on the *login* — the one the latest
 * request texted, which is always a number that account signs in with — and
 * never against a number supplied with the confirmation. Taking a number and a
 * code together and trusting them to match would let a desk verify one number
 * and enrol another.
 *
 * It was checked against the account's primary number whatever had been
 * texted, so a desk that typed the patient's second line sent a code to that
 * line and could never spend it.
 *
 * `practiceId` is the confirming desk's practice. A code proves the patient is
 * at *a* counter; it is the enrolment that says which practice asked, and one
 * practice confirming another's would be handed a patient who consented to
 * somebody else.
 */
export async function confirmEnrolment({ enrollmentId, code, confirmedBy = null, practiceId = undefined }) {
  const enrollment = await Enrollment.findById(enrollmentId);
  if (!enrollment) throw notFound('That enrolment was not found');
  if (practiceId !== undefined && String(enrollment.practice) !== String(practiceId)) {
    throw notFound('That enrolment was not found');
  }

  if (enrollment.status === ENROLLMENT_STATUS.ACTIVE) return enrollment;
  if (enrollment.status === ENROLLMENT_STATUS.REVOKED) {
    throw conflict('That enrolment was withdrawn. Start a new one.');
  }

  const patient = await Patient.findById(enrollment.patient).select('login').lean();
  const login = await User.findById(patient?.login).select('phone altPhones').lean();
  if (!login?.phone) throw notFound('No phone number to verify against');

  const lastRequest = await ConsentEvent.findOne({
    enrollment: enrollment._id,
    action: CONSENT_ACTION.REQUESTED,
  })
    .sort({ at: -1, _id: -1 })
    .select('requestedPhone')
    .lean();
  const signsInWith = [login.phone, ...(login.altPhones ?? [])];
  const sentTo = signsInWith.includes(lastRequest?.requestedPhone) ? lastRequest.requestedPhone : login.phone;

  await verifyOtp({ phone: sentTo, purpose: ENROL_PURPOSE, code });

  /*
   * Dated at consent, unless this is a return.
   *
   * A first consent opens the practice's window when the patient says so,
   * which is the moment access actually begins. A patient coming back to a
   * practice they had withdrawn from keeps the original date: the practice
   * goes on reading its own history with them rather than losing it for the
   * gap. See `wasActiveBefore`.
   */
  const set = { status: ENROLLMENT_STATUS.ACTIVE, enrolledBy: enrollment.enrolledBy ?? confirmedBy };
  if (!(await wasActiveBefore(enrollment._id))) set.enrolledOn = new Date();

  // Conditional on still pending, so two desks spending one code at the same
  // moment make one consent rather than two.
  const confirmed = await Enrollment.findOneAndUpdate(
    { _id: enrollment._id, status: ENROLLMENT_STATUS.PENDING },
    { $set: set },
    { new: true },
  );
  if (!confirmed) return Enrollment.findById(enrollment._id);

  // Consent is the moment this practice's care of them starts, so it is also
  // the moment its only dietician takes them on.
  await autoAssignDietician(confirmed.patient, confirmed.practice);

  await ConsentEvent.record({
    enrollment: confirmed._id,
    action: CONSENT_ACTION.GRANTED,
    actor: confirmedBy,
    method: CONSENT_METHOD.OTP_DESK,
    wording: CONSENT_WORDING,
  });

  // The practice now reads from `enrolledOn`. Whether it may read further back
  // is the patient's question to answer, in their own app — asked once, here.
  askHistoryQuestion(confirmed).catch((err) => logger.warn({ err }, 'history question push failed'));

  return confirmed;
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

  // Growth is what a lapse withholds. Clinical work is not, so this sits beside
  // the cap rather than anywhere a record is read or written — a receptionist
  // registering somebody new is stopped; nobody already enrolled notices.
  const lapsed = await billingBlocks(practiceId, 'ENROL_PATIENT');
  if (lapsed) {
    throw badRequest(
      'New registrations are paused while the subscription payment is outstanding. ' +
        'Everyone already registered is unaffected.',
    );
  }

  const over = practice.overLimit('patients', await activePatientCount(practiceId));
  if (!over) return;

  throw badRequest(
    `This practice is at its limit of ${over.cap} patients. ` +
      'Ask your administrator to raise it before registering anyone else.',
  );
}
