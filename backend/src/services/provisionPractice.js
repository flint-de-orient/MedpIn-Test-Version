import { Practice, PRACTICE_STATUS, VERIFICATION } from '../models/Practice.js';
import { ROLES } from '../models/User.js';
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
 * happen. So if the head cannot be attached — the number belongs to a patient,
 * say — the practice row is removed and the caller is told, rather than left
 * behind for somebody to find later and wonder about.
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

  const practice = await Practice.create({
    ...brand,
    status: PRACTICE_STATUS.ONBOARDING,
    verification: VERIFICATION.UNVERIFIED,
  });

  let head;
  try {
    head = await joinByPhone({
      phone: headDoctorPhone,
      name: headDoctorName,
      practice: practice._id,
      role: ROLES.DOCTOR,
      isOwner: true,
      qualifications: headDoctorQualifications,
      registrationNo: headDoctorRegistrationNo,
    });
  } catch (err) {
    await Practice.deleteOne({ _id: practice._id });
    throw err;
  }

  // The doctor's own number is the practice's letterhead unless one was typed.
  // A solo practice has exactly one, and asking twice is how the two drift.
  if (!practice.registrationNo && headDoctorRegistrationNo) {
    practice.registrationNo = headDoctorRegistrationNo;
  }
  if (!practice.doctorDisplayName) practice.doctorDisplayName = headDoctorName;
  practice.headDoctor = head.user._id;
  await practice.save();

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

  return { practice, head };
}
