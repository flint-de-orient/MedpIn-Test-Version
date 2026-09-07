import { User, ROLES } from '../models/User.js';
import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { Clinic } from '../models/Clinic.js';
import { conflict } from '../middleware/errors.js';
import { memberIdsOf } from '../middleware/practiceScope.js';

/**
 * Which doctor a thing belongs to.
 *
 * ---- What this replaces --------------------------------------------------
 *
 * Six routes asked `User.findOne({ role: ROLES.DOCTOR })` with no other filter
 * — an appointment, a prescription, a clinic's owner, a new patient's assigned
 * doctor. Each took whichever row the database happened to return first.
 *
 * With one doctor that is correct every time, and the comments beside those
 * lines say so honestly ("single-doctor clinic today"). With two it is a coin
 * flip, and the coin is flipped over a prescription's attribution — the field
 * that says who is answerable for it. Nothing errors, nothing logs, and the
 * wrong doctor's name is on a legal document.
 *
 * ---- Three questions, not one -------------------------------------------
 *
 * Those six calls looked identical and were not. They were asking:
 *
 *   - who signs this prescription / holds this appointment  (must be right)
 *   - which doctor owns this clinic                         (must be right)
 *   - who should this new patient be assigned to            (may be nobody)
 *
 * The last one tolerates an unknown answer; `assignedDoctor` is optional and a
 * patient with none is a patient the desk assigns later. The first two do not,
 * and for them an error is better than a guess.
 *
 * So context goes in rather than being inferred, and `required` says which kind
 * of question is being asked.
 */

/**
 * Resolve the doctor for a piece of work.
 *
 * Tried in order, most specific first:
 *
 *   1. `explicitId`   — the caller named one; nothing else should override it
 *   2. `actingUser`   — a doctor creating a clinic owns it, and a doctor filing
 *                       a prescription signs it. This is the case the old code
 *                       missed most often: it went hunting for "the doctor"
 *                       while one was making the request
 *   3. `clinicId`     — the clinic already records its doctor
 *   4. the practice's owner — the head doctor, from their membership
 *   5. the only active doctor — today's answer, and still correct while it is
 *                       the only one
 *
 * With none of those and more than one doctor, the answer is genuinely unknown.
 * `required: true` throws; otherwise it returns null and the caller leaves the
 * field unset.
 */
export async function resolveDoctor({
  explicitId = null,
  actingUser = null,
  clinicId = null,
  practiceId = null,
  required = false,
} = {}) {
  // 1. Named outright.
  if (explicitId) {
    const named = await User.findOne({ _id: explicitId, role: ROLES.DOCTOR })
      .select('_id name')
      .lean();
    // A named doctor that does not exist is a caller error, not a reason to
    // fall through and quietly substitute somebody else.
    if (!named && required) throw conflict('That doctor was not found.');
    if (named) return named;
    return null;
  }

  // 2. The doctor making the request.
  if (actingUser?.role === ROLES.DOCTOR && actingUser?._id) {
    return { _id: actingUser._id, name: actingUser.name ?? null };
  }

  // 3. The clinic's own doctor.
  if (clinicId) {
    const clinic = await Clinic.findById(clinicId).select('doctor practice').lean();
    if (clinic?.doctor) {
      const owner = await User.findOne({ _id: clinic.doctor, role: ROLES.DOCTOR })
        .select('_id name')
        .lean();
      if (owner) return owner;
    }
    // Borrow the practice from the clinic when the caller did not give one.
    if (!practiceId && clinic?.practice) practiceId = clinic.practice;
  }

  // The acting user's own practice, when the caller did not name one. `User`
  // carries no practice field — the membership is where that lives — so this is
  // the only way a receptionist's request knows which practice it is in.
  if (!practiceId && actingUser?._id) {
    const own = await Membership.findOne({
      user: actingUser._id,
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
    })
      .select('practice')
      .lean();
    if (own?.practice) practiceId = own.practice;
  }

  // 4. The practice's head doctor.
  if (practiceId) {
    const ownerRow = await Membership.findOne({
      practice: practiceId,
      role: ROLES.DOCTOR,
      isOwner: true,
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
    })
      .select('user')
      .lean();

    if (ownerRow?.user) {
      const owner = await User.findOne({ _id: ownerRow.user, role: ROLES.DOCTOR })
        .select('_id name')
        .lean();
      if (owner) return owner;
    }
  }

  // 5. The only one there is — in this practice.
  //
  // Unscoped, this asked whether the *platform* had exactly one doctor, and
  // answered no as soon as a second practice existed. Every solo practice then
  // got "More than one doctor could be meant here" for a question with one
  // possible answer, and the one before that it could have picked a stranger.
  //
  // Capped at two: this exists to tell "exactly one" from "more than one", and
  // reading every doctor to count them gets slower with each practice.
  const mine = await memberIdsOf(practiceId, ROLES.DOCTOR);
  const doctors = await User.find({
    role: ROLES.DOCTOR,
    isActive: true,
    ...(mine ? { _id: { $in: mine } } : {}),
  })
    .select('_id name')
    .limit(2)
    .lean();

  if (doctors.length === 1) return doctors[0];

  if (required) {
    throw conflict(
      doctors.length === 0
        ? 'No doctor account is available.'
        : 'More than one doctor could be meant here. Say which one.',
    );
  }
  return null;
}
