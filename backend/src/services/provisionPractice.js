import { Practice, PRACTICE_STATUS, VERIFICATION } from '../models/Practice.js';
import { ROLES } from '../models/User.js';
import { joinByPhone } from './memberships.js';
import { badRequest } from '../middleware/errors.js';

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

  return { practice, head };
}
