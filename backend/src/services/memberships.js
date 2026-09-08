import { Membership, MEMBERSHIP_STATUS, PRESETS, presetFor } from '../models/Membership.js';
import { Practice } from '../models/Practice.js';
import { User, ROLES } from '../models/User.js';
import { badRequest, conflict, notFound } from '../middleware/errors.js';
import { logger } from '../config/logger.js';

/**
 * Joining a person to a practice, and parting them from it.
 *
 * ---- Why this is one file --------------------------------------------
 *
 * Until now nothing created a membership at all. The two in the codebase were
 * a migration and a test harness, so every guard permitted on missing data and
 * the whole tenant model was a description of a shape rather than a thing that
 * happened. It worked because there was one clinic and nothing to be wrong
 * about.
 *
 * Doing it in four route handlers instead would put four copies of the rules
 * below in four places, and they are exactly the rules that are wrong quietly:
 * a duplicate membership that shadows the real one, an owner removed leaving a
 * practice nobody can manage, a doctor added to a practice they never agreed
 * to join.
 *
 * ---- A person is not their membership ---------------------------------
 *
 * Dr. Dey is one `User` whether he heads one practice or works at three. Being
 * head of a practice is a property of the relationship, not of him — which is
 * why there is no "head doctor" account type and never should be. A second
 * account for the same person is a second set of patients, a second login and
 * a second thing to keep in step.
 */

/** What a practice's head can do. Named here so the routes do not spell it out. */
export const HEAD_PRESET = PRESETS.head;

/**
 * Put somebody in a practice.
 *
 * Idempotent by relationship rather than by row: a person already in this
 * practice is reactivated and re-granted, not duplicated. Two membership rows
 * for one pair is the failure that hurts later — `currentFilter` finds one of
 * them, and which one is whichever Mongo returns first.
 */
export async function joinPractice({
  user,
  practice,
  role,
  isOwner = false,
  permissions = null,
  addedBy = null,
  // Which part of the practice and which building. Both optional and both
  // stay optional — a solo clinic has neither to choose from.
  department = null,
  location = null,
}) {
  if (!user || !practice) throw badRequest('A membership needs a person and a practice');

  const existing = await Membership.findOne({ user, practice });

  const grant = permissions ?? presetFor({ role, isOwner });

  if (existing) {
    // Rejoining. The old row is reused so the history — when they first
    // started, who added them — survives somebody leaving and coming back.
    existing.role = role;
    existing.isOwner = isOwner;
    existing.permissions = grant;
    existing.status = MEMBERSHIP_STATUS.ACTIVE;
    existing.endedOn = null;
    // Only when supplied. Rejoining without naming a department should not
    // silently clear the one they had.
    if (department !== null) existing.department = department;
    if (location !== null) existing.location = location;
    await existing.save();
    return existing;
  }

  return Membership.create({
    user,
    practice,
    role,
    isOwner,
    permissions: grant,
    department,
    location,
    status: MEMBERSHIP_STATUS.ACTIVE,
    startedOn: new Date(),
    endedOn: null,
    addedBy,
  });
}

/**
 * Take somebody out of it.
 *
 * ---- The last owner cannot leave --------------------------------------
 *
 * A practice with no active owner is one nobody can add staff to, add a
 * location to, or hand over — and the only way back is the operator console or
 * a shell. Refusing here is a worse afternoon than allowing it and a far better
 * month.
 *
 * The check is on *active* owners, so a practice with two heads can lose one.
 */
export async function leavePractice(membershipId, { practice }) {
  const membership = await Membership.findOne({ _id: membershipId, practice });
  if (!membership) throw notFound('Membership not found');

  if (membership.isOwner) {
    const owners = await Membership.countDocuments({
      practice,
      isOwner: true,
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
    });
    if (owners <= 1) {
      throw conflict(
        'This is the practice’s only owner. Make somebody else an owner first, ' +
          'or the practice is left with nobody who can manage it.',
      );
    }
  }

  membership.status = MEMBERSHIP_STATUS.SUSPENDED;
  // What `currentFilter` actually reads. Setting only the status would change
  // the label and nothing else.
  membership.endedOn = new Date();
  await membership.save();
  return membership;
}

/**
 * Find or make the `User` behind a verified phone number, then join them.
 *
 * ---- The number must have been answered --------------------------------
 *
 * Not validated, answered. A regex tests the shape of a phone number and
 * nothing about who holds it, and for a doctor being made head of a practice
 * one mistyped digit hands a clinic to a stranger. The caller passes a token
 * from the OTP flow, which is proof the handset replied.
 *
 * ---- An existing account is reused ------------------------------------
 *
 * Dr. Dey working at a second practice is a second membership, not a second
 * Dr. Dey. If the number already belongs to somebody, that person is joined —
 * and if they are not a clinician, that is refused rather than quietly
 * promoting a patient.
 */
export async function joinByPhone({
  phone,
  name,
  practice,
  role = ROLES.DOCTOR,
  isOwner = false,
  addedBy = null,
  qualifications = null,
  registrationNo = null,
}) {
  const found = await Practice.findById(practice).select('_id name').lean();
  if (!found) throw notFound('Practice not found');

  let user = await User.findByLoginPhone(phone);
  let created = false;

  if (!user) {
    user = await User.create({
      name,
      phone,
      role,
      isActive: true,
      ...(qualifications ? { qualifications } : {}),
      ...(registrationNo ? { registrationNo } : {}),
      // No password. Clinicians sign in with a texted code like everybody else;
      // nobody sets a password on somebody else's behalf.
    });
    created = true;
  } else if (user.role === ROLES.PATIENT) {
    throw conflict(
      'That number already belongs to a patient account. A person cannot be ' +
        'both, and turning a patient into a clinician here would give their own ' +
        'record to whoever manages this practice.',
    );
  } else if (user.role !== role) {
    // A dietician being added as a doctor, or the reverse. Refused rather than
    // rewritten: their role decides what they see in every other practice too.
    throw conflict(
      `That number belongs to a ${user.role.toLowerCase()} account. ` +
        'Add them in that role, or use a different number.',
    );
  }

  const membership = await joinPractice({
    user: user._id,
    practice: found._id,
    role,
    isOwner,
    addedBy,
  });

  logger.info(
    { practice: String(found._id), user: String(user._id), role, isOwner, created },
    'membership created',
  );

  return { user, membership, createdUser: created };
}

/** Everyone currently in a practice, with the person attached. */
export async function membersOf(practice) {
  return Membership.find({ practice })
    .sort({ isOwner: -1, startedOn: 1 })
    .populate('user', 'name phone role isActive qualifications registrationNo')
    .lean();
}

/** Whether this person may manage this practice at all. */
export async function isOwnerOf(userId, practice) {
  const m = await Membership.findOne({
    user: userId,
    practice,
    isOwner: true,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  }).lean();
  return Boolean(m);
}
