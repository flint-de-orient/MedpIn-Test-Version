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
import { badRequest, conflict } from '../middleware/errors.js';
import { Department } from '../models/Department.js';
import { logger } from '../config/logger.js';
import { BY_TYPE, CAPABILITIES } from './capabilities.js';
import { callablePhone } from './clinicContact.js';
import { prefixAvailability, PREFIX_REFUSAL } from './prescriptionPrefix.js';
import { toE164 } from '../utils/phone.js';
import { TIME_RE } from '../utils/clinicTime.js';

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
 * So the sequence lives here and both callers use it — and both now get the
 * same complete practice: the owner, the departments it runs, the owner's
 * department, the number its patients ring, and a first location with its
 * phone and hours. The console path used to stop at the owner, and a practice
 * made there had no location and so could not take a booking.
 *
 * ---- Everything that can be refused is refused before anything is written --
 *
 * A licence already registered, a number that belongs to a patient or to an
 * account in another role, a prefix somebody else holds, an emergency number
 * nobody can ring, opening hours that end before they start. Each used to be
 * found — where it was found at all — after the practice row existed, and the
 * practice was then deleted again. A tenant that exists for one request is a
 * tenant something can read in that request, and a delete is a write that can
 * fail. None of it happens now until every answer is known.
 *
 * ---- The compensation that remains is explicit --------------------------
 *
 * Mongo has no transaction here without a replica set. What can still fail
 * after the checks is the unexpected — the database refusing a write — and if
 * attaching the owner fails for such a reason, the practice row is removed and
 * the caller is told, rather than left behind for somebody to find later.
 *
 * The same goes for what attaching the owner made on the way: the membership,
 * and the account when this call created it. This used to remove only the
 * practice, so a membership that failed left a login belonging to nothing —
 * which the next attempt then found as "an existing account" and joined.
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
   * Department.js on why the two scopes live in one table. Kept only where the
   * practice's type can have departments at all, by the same table the
   * capability resolver reads: a clinic has none on any plan.
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
  /**
   * The practice's first location: `{ name, addressLine, city, phone,
   * slotMinutes, weeklyHours }`, every part optional.
   *
   * Always made. Without one a practice cannot take a booking, and the name
   * defaults to the practice's own. Its phone is the one patients are told to
   * ring at that address — never the owner's mobile, which is how they sign in.
   */
  location = null,
  /// The number this practice's patients ring, on the practice itself.
  emergencyPhone = null,
  /// `{ name, registrationNo, department }` of a doctor who is not the owner.
  namedDoctor = null,
}) {
  const ownerIsDoctor = ownerRole === ROLES.DOCTOR;
  const naming = namedDoctor && Object.values(namedDoctor).some(Boolean) ? namedDoctor : null;

  // ---- Pre-flight: every refusal, before any write ----------------------

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

  /*
   * Can this number own the practice?
   *
   * The same two refusals joinByPhone makes, asked first. An account has one
   * role everywhere: a patient's number made into a practice's owner would hand
   * their own record to whoever manages the practice, and an account in another
   * role would change what it sees in every other practice too. Both were found
   * by joinByPhone after the practice row had been written, and the row was
   * deleted again. joinByPhone still asks, for anything that arrives between
   * here and there.
   */
  const existingOwner = await User.findByLoginPhone(headDoctorPhone).select('role').lean();
  if (existingOwner?.role === ROLES.PATIENT) {
    throw conflict(
      'That number already belongs to a patient account. A person cannot be both, ' +
        'and turning a patient into the owner of a practice would give their own ' +
        'record to whoever manages it.',
    );
  }
  if (existingOwner && existingOwner.role !== ownerRole) {
    throw conflict(
      `That number belongs to a ${String(existingOwner.role).toLowerCase()} account. ` +
        'Use the number of the person who will own the practice in that role.',
    );
  }

  if (brand.prescriptionPrefix) {
    // A new practice has no id yet, so nothing can already be its own: any
    // practice holding the prefix, or any reference issued with it, refuses.
    const verdict = await prefixAvailability(brand.prescriptionPrefix, null);
    if (!verdict.ok) {
      throw verdict.reason === 'taken' || verdict.reason === 'issued'
        ? conflict(PREFIX_REFUSAL[verdict.reason])
        : badRequest(PREFIX_REFUSAL[verdict.reason]);
    }
  }

  const patientCallNumber = normalisedCallable(emergencyPhone, 'the patient call number');
  const locationPhone = normalisedCallable(location?.phone, 'the location’s phone');
  const weeklyHours = checkedHours(location?.weeklyHours);

  const wanted = [...new Set((departments ?? []).filter(Boolean))];
  const departmental = BY_TYPE[brand.practiceType]?.includes(CAPABILITIES.DEPARTMENT) ?? false;
  const shared =
    wanted.length && departmental
      ? await Department.find({ practice: null, isActive: true, key: { $in: wanted } })
          .select('key names')
          .lean()
      : [];
  const departmentKeys = shared.map((d) => d.key);
  const ownerDepartmentKey =
    ownerIsDoctor && ownerDepartment && departmentKeys.includes(ownerDepartment) ? ownerDepartment : null;

  // ---- The practice and its owner ----------------------------------------

  const practice = await Practice.create({
    ...brand,
    ...(patientCallNumber ? { emergencyPhone: patientCallNumber } : {}),
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

  /*
   * The department the owning doctor runs, on their membership.
   *
   * Only one the practice now actually has — its own copy, never the shared
   * row, which belongs to every practice at once. Never fatal, for the same
   * reason as the departments: this is a label on a membership that exists.
   */
  let department = null;
  if (ownerDepartmentKey) {
    try {
      department = await Department.findOne({ practice: practice._id, key: ownerDepartmentKey })
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
   * The first location.
   *
   * A practice with none cannot take a booking. Named after the practice unless
   * the operator gave it a name, with the address, the phone patients ring at
   * that address, and the hours the slot engine turns into bookable times — all
   * checked above, so this write has nothing left to refuse.
   *
   * Never fatal: the practice and its owner are written and correct, and a
   * location is something the practice can add from its own settings. The
   * caller reports `location: null` so the operator knows to.
   */
  let clinic = null;
  try {
    clinic = await Clinic.create({
      name: location?.name?.trim() || practice.name,
      ...(location?.addressLine ? { addressLine: location.addressLine } : {}),
      ...(location?.city ? { city: location.city } : {}),
      ...(locationPhone ? { phone: locationPhone } : {}),
      ...(location?.slotMinutes ? { slotMinutes: location.slotMinutes } : {}),
      weeklyHours,
      practice: practice._id,
      // Whose schedule it is. Nobody's yet when the owner does not see patients.
      ...(ownerIsDoctor ? { doctor: head.user._id } : {}),
    });
  } catch (err) {
    logger.error({ err, practice: practice._id }, 'could not create the first location');
  }

  return { practice, head, location: clinic, department, departments: departmentKeys };
}

/**
 * A number somebody can ring, in E.164, or null when none was given.
 *
 * Refused rather than dropped when one was given and is not callable: this is a
 * number printed on an emergency card, and quietly storing nothing would leave
 * an operator believing they had set it.
 */
function normalisedCallable(value, what) {
  if (value == null || !String(value).trim()) return null;
  const phone = callablePhone(toE164(String(value).trim()));
  if (!phone) {
    throw badRequest(`Enter ${what} as a number patients can ring, with the area or country code.`);
  }
  return phone;
}

/**
 * Weekly opening hours the slot engine can use, or a refusal naming the bad one.
 *
 * The same shape Clinic stores — `{ dayOfWeek, start, end }`, 0 is Sunday — and
 * a window that ends before it starts is refused here rather than turning into
 * a day with no slots and no explanation.
 */
function checkedHours(windows) {
  if (!windows?.length) return [];
  return windows.map((w, i) => {
    const day = Number(w?.dayOfWeek);
    if (!Number.isInteger(day) || day < 0 || day > 6 || !TIME_RE.test(w?.start ?? '') || !TIME_RE.test(w?.end ?? '')) {
      throw badRequest(`Opening hours ${i + 1} are not a day and two times (HH:mm).`);
    }
    if (w.start >= w.end) {
      throw badRequest(`Opening hours ${i + 1} end at ${w.end}, before they start at ${w.start}.`);
    }
    return { dayOfWeek: day, start: w.start, end: w.end };
  });
}
