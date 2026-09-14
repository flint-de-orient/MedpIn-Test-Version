import {
  Practice,
  PLAN,
  PRACTICE_STATUS,
  VERIFICATION,
  defaultLimitsFor,
} from '../models/Practice.js';
import { User, ROLES } from '../models/User.js';
import { Membership, presetFor } from '../models/Membership.js';
import { Clinic } from '../models/Clinic.js';
import { joinByPhone } from './memberships.js';
import { badRequest } from '../middleware/errors.js';
import { Department } from '../models/Department.js';
import { logger } from '../config/logger.js';

/**
 * A practice, with somebody in it, in one call.
 *
 * ---- Why this is a service and not a route body -------------------------
 *
 * There are two ways a practice comes into existence now: an operator creates
 * one from the console, and an operator approves a self-registration. They
 * produce the same thing and they had better produce it the same way — a
 * second implementation is how one path forgets to set the head doctor, or
 * leaves the letterhead blank, or skips the duplicate check on a licence
 * number, and nobody notices until a prescription prints wrong.
 *
 * So the sequence lives here and both callers use it.
 *
 * ---- The compensation is explicit --------------------------------------
 *
 * Mongo has no transaction here without a replica set. A practice that exists
 * for even one request with nobody in it is a practice somebody can navigate
 * to and find empty, and "I will add the doctor next" is a step that does not
 * happen. So if the owner cannot be attached — the number belongs to a patient,
 * say — the practice row is removed and the caller is told, rather than left
 * behind for somebody to find later and wonder about.
 *
 * The same goes for what attaching the owner made on the way: the membership,
 * and the account when this call created it. This used to remove only the
 * practice, so a membership that failed left a login belonging to nothing —
 * which the next attempt then found as "an existing account" and joined.
 *
 * ---- What an approval knows that the wizard does not -------------------
 *
 * An application arrives with an address, a department, an email, a number it
 * already proved and an answer to "are you the doctor". The operator's wizard
 * has none of them. Each is optional here, and each does what the application
 * said or nothing at all — an approval that dropped them left the practice to
 * type in again everything it had already told MedPin.
 */
export async function provisionPractice({
  brand,
  headDoctorName,
  headDoctorPhone,
  headDoctorQualifications = null,
  headDoctorRegistrationNo = null,
  /**
   * Shared-catalogue keys the practice says it runs.
   *
   * Copied from the shared rows rather than referenced, because a practice
   * renaming its own Cardiology must not rename everybody's — see
   * Department.js on why the two scopes live in one table. An empty list is the
   * ordinary case: a clinic has no departments and never will.
   */
  departments = [],
  /**
   * What the owner is. A doctor, unless the applicant said they are not one.
   *
   * The `headDoctor*` names above then describe whoever owns the practice. They
   * predate owners who are not doctors, and renaming them would change the
   * wizard's call for no change in what it does.
   */
  ownerRole = ROLES.DOCTOR,
  /// Written onto an account made here. See joinByPhone.
  ownerEmail = null,
  phoneVerifiedAt = null,
  /// A shared-catalogue key: the department the owning doctor belongs to.
  ownerDepartment = null,
  /// `{ name, addressLine, city }` for the practice's first location.
  location = null,
  /// `{ name, registrationNo, department }` of a doctor who is not the owner.
  namedDoctor = null,
}) {
  /*
   * Is this licence already here?
   *
   * A registration number is a claim about a specific licence, and two
   * practices holding one is either a duplicate or a mistake. Refused.
   *
   * A name is not refused: "City Clinic" is a real name in every city in the
   * country, and declining the second one would be this platform deciding a
   * customer may not exist because somebody earlier chose the same two words.
   */
  if (brand.registrationNo) {
    const clash = await Practice.findOne({ registrationNo: brand.registrationNo })
      .select('name')
      .lean();
    if (clash) {
      throw badRequest(
        `Registration number ${brand.registrationNo} already belongs to ${clash.name}.`,
      );
    }
  }

  const ownerIsDoctor = ownerRole === ROLES.DOCTOR;
  const naming = namedDoctor && Object.values(namedDoctor).some(Boolean) ? namedDoctor : null;

  const practice = await Practice.create({
    ...brand,
    /*
     * The plan's limits, written in when the plan is first assigned.
     *
     * Every practice starts on TRIAL, and its limits used to start null —
     * unlimited — until an operator changed the plan, which is the one place
     * the tier's numbers were written. A practice nobody had moved off its
     * trial was the only unlimited one on the platform. This is the same
     * helper the plan change uses, at the moment the plan is set.
     */
    limits: defaultLimitsFor(brand.plan ?? PLAN.TRIAL),
    ...(naming ? { namedDoctor: naming } : {}),
    status: PRACTICE_STATUS.ONBOARDING,
    verification: VERIFICATION.UNVERIFIED,
  });

  let head = null;
  try {
    head = await joinByPhone({
      phone: headDoctorPhone,
      name: headDoctorName,
      practice: practice._id,
      role: ownerRole,
      isOwner: true,
      /*
       * The head preset for a doctor, as it always was. A manager who owns the
       * practice gets the manager's grant: owning a practice is what lets them
       * run it, and nothing about owning one makes somebody able to prescribe.
       * The preset comes from the one table that defines them.
       */
      permissions: ownerIsDoctor ? null : presetFor({ role: ownerRole }),
      // A council number and qualifications belong to a doctor. The ones on an
      // application whose contact is not the doctor are the doctor's, not theirs.
      qualifications: ownerIsDoctor ? headDoctorQualifications : null,
      registrationNo: ownerIsDoctor ? headDoctorRegistrationNo : null,
      email: ownerEmail,
      phoneVerifiedAt,
    });

    if (ownerIsDoctor) {
      // The doctor's own number is the practice's letterhead unless one was
      // typed. A solo practice has exactly one, and asking twice is how the two
      // drift.
      if (!practice.registrationNo && headDoctorRegistrationNo) {
        practice.registrationNo = headDoctorRegistrationNo;
      }
      if (!practice.doctorDisplayName) practice.doctorDisplayName = headDoctorName;
      // Only a doctor. A manager in `headDoctor` would be the practice's doctor
      // to everything that asks who that is.
      practice.headDoctor = head.user._id;
    }
    await practice.save();
  } catch (err) {
    if (head) {
      await Membership.deleteOne({ _id: head.membership._id }).catch(() => {});
      if (head.createdUser) await User.deleteOne({ _id: head.user._id }).catch(() => {});
    }
    await Practice.deleteOne({ _id: practice._id });
    throw err;
  }

  /*
   * The departments, after the practice exists and the head is in it.
   *
   * Last on purpose. A department belongs to a practice, so it cannot be
   * written first; and if it fails the practice is still a practice with a
   * doctor in it, which is a recoverable state an operator can finish by hand.
   * Reversing that — departments written, head doctor failing — would leave
   * rows pointing at a practice the compensation above then deletes.
   *
   * `insertMany` with `ordered: false` so one duplicate key does not abandon
   * the rest: a practice asking for a department it somehow already has is not
   * a reason to drop the other five.
   */
  if (departments.length) {
    const shared = await Department.find({ practice: null, key: { $in: departments } })
      .select('key names')
      .lean();

    if (shared.length) {
      await Department.insertMany(
        shared.map((d) => ({
          practice: practice._id,
          key: d.key,
          names: d.names,
          isActive: true,
        })),
        { ordered: false },
      ).catch((err) => {
        // Never fatal to the provisioning. The practice and its head doctor are
        // written and correct; a missing department is a row an operator adds.
        logger.error({ err, practice: practice._id }, 'could not seed departments');
      });
    }
  }

  /*
   * The department the owning doctor runs, on their membership.
   *
   * Only one the practice now actually has — its own copy, never the shared
   * row, which belongs to every practice at once. Never fatal, for the same
   * reason as the departments: this is a label on a membership that exists.
   */
  let department = null;
  if (ownerIsDoctor && ownerDepartment) {
    try {
      department = await Department.findOne({ practice: practice._id, key: ownerDepartment })
        .select('_id key')
        .lean();
      if (department) {
        await Membership.updateOne(
          { _id: head.membership._id },
          { $set: { department: department._id } },
        );
      }
    } catch (err) {
      department = null;
      logger.error({ err, practice: practice._id }, 'could not place the owner in their department');
    }
  }

  /*
   * The first location, from the address the practice gave.
   *
   * A practice with none cannot take a booking, and the application already
   * holds an address somebody reviewed. Not its phone: the number on an
   * application is the applicant's own mobile, and a location's phone is the
   * one patients are told to ring.
   *
   * Never fatal either. The practice and its owner are written and correct, and
   * a location is something the practice adds from its own settings.
   */
  let clinic = null;
  if (location?.name) {
    try {
      clinic = await Clinic.create({
        name: location.name,
        ...(location.addressLine ? { addressLine: location.addressLine } : {}),
        ...(location.city ? { city: location.city } : {}),
        practice: practice._id,
        // Whose schedule it is. Nobody's yet when the owner does not see patients.
        ...(ownerIsDoctor ? { doctor: head.user._id } : {}),
      });
    } catch (err) {
      logger.error({ err, practice: practice._id }, 'could not create the first location');
    }
  }

  return { practice, head, location: clinic, department };
}
