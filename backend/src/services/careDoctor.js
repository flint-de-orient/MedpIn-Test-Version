import mongoose from 'mongoose';

import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { Membership } from '../models/Membership.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { User, ROLES } from '../models/User.js';

/**
 * The patient's doctor: the one person MedPin names to a patient as theirs.
 *
 * ---- One answer, everywhere ----------------------------------------------
 *
 * The chat header, the assistant's prompt, its emergency and urgent advice,
 * its fallback replies and the photo readers all name the patient's doctor.
 * They used to work it out separately. The header named the doctor on the
 * patient's enrolment; the assistant named the practice's display name or head
 * doctor. So a patient of Dr. Rahman at Dr. Dey's practice read "Dr. Rahman"
 * at the top of the chat and was told by the assistant to contact Dr. Dey.
 * Everything that names the patient's doctor now asks here.
 *
 * ---- Who it is -------------------------------------------------------------
 *
 * The doctor on the patient's active enrolment at this practice, while that
 * doctor still works there and their account is active. The same enrolment
 * rule decides which practice's doctors are paged about the patient
 * (practicesOfPatient), so "your doctor has been alerted" is only said about
 * somebody the alert reaches.
 *
 * ---- Patients from before enrolments named a doctor ------------------------
 *
 * scripts/backfillEnrollments.js enrolled every existing patient at the
 * founding practice without a `primaryDoctor`. Their doctor is on the older
 * `PatientProfile.assignedDoctor`, which careResponsibility.js already reads.
 * So when an enrolment names nobody, that doctor is used, under a stricter
 * rule than a named one ([legacyDoctorsFor]): a doctor account, active, and a
 * current doctor member of this same practice. scripts/backfillPrimaryDoctor.js
 * writes the same answer onto the enrolment, using the same function, so the
 * two cannot disagree. An enrolment that names a doctor who has since left
 * does not fall back: that is a patient whose doctor left, not a legacy row.
 *
 * ---- Who it never is -------------------------------------------------------
 *
 * Nobody else. Not the practice's head doctor or display name, not the first
 * clinic's doctor, not a doctor at another practice the patient also attends,
 * and not a name from configuration. With no answer, the caller says "your
 * doctor" or "your healthcare team". Not cached: a reassigned patient hears
 * their new doctor's name on the next message.
 */

const oid = (v) => {
  const id = v?._id ?? v;
  return id && mongoose.isValidObjectId(id) ? String(id) : null;
};

/**
 * "Dr. Rahman", as a patient reads it.
 *
 * A doctor saved as "Rahman Ali" is shown as "Dr. Rahman Ali", and one saved
 * as "Dr. Rahman Ali" is left alone rather than becoming "Dr. Dr. Rahman Ali".
 * Somebody on the enrolment who is not a doctor keeps their name as saved.
 */
export function displayNameOf(name, role) {
  const bare = String(name ?? '').trim();
  if (!bare) return null;
  if (role !== ROLES.DOCTOR || /^dr(\.|\s)/i.test(bare)) return bare;
  return `Dr. ${bare}`;
}

/**
 * The patient's current doctor at [practiceId], or null.
 *
 * [enrollmentId] is the conversation's own enrolment, when the caller has one.
 * It must be this patient's (when [patientId] is given), at this practice, and
 * active; an enrolment at another practice answers nothing.
 *
 * @returns {Promise<{ id: string, name: string, displayName: string,
 *   avatarAssetId: string|null, role: string, department: string|null } | null>}
 */
export async function currentDoctorOf({ patientId = null, practiceId = null, enrollmentId = null } = {}) {
  const practice = oid(practiceId);
  if (!practice || (!oid(enrollmentId) && !oid(patientId))) return null;

  const enrollment = await Enrollment.findOne({
    practice,
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
    ...(oid(enrollmentId) ? { _id: oid(enrollmentId) } : {}),
    ...(oid(patientId) ? { patient: oid(patientId) } : {}),
  })
    .select('primaryDoctor practice patient')
    .lean();
  if (!enrollment) return null;

  const found = await currentDoctorsOf([
    { id: 'one', practice, primaryDoctor: enrollment.primaryDoctor, patient: enrollment.patient },
  ]);
  return found.get('one') ?? null;
}

/**
 * The current doctor of each enrolment, keyed by enrolment id.
 *
 * For a list of the patient's active enrolments (practicesFor), answered in a
 * handful of queries rather than a few per row. Same rule as
 * [currentDoctorOf]. [patientId] is whose enrolments these are, for rows that
 * do not carry `patient` themselves.
 */
export async function currentDoctorsOf(enrollments, { patientId = null } = {}) {
  const rows = (enrollments ?? [])
    .filter((e) => oid(e.practice))
    .map((e) => ({
      key: String(e.id ?? e._id),
      practice: oid(e.practice),
      doctor: oid(e.primaryDoctor),
      patient: oid(e.patient) ?? oid(patientId),
    }));

  // An enrolment that names nobody: the patient's doctor from before
  // enrolments named one, if [legacyDoctorsFor] says it is safe here.
  const unnamed = rows.filter((r) => !r.doctor && r.patient);
  if (unnamed.length) {
    const legacy = await legacyDoctorsFor(unnamed);
    for (const r of unnamed) {
      const found = legacy.get(r.key);
      if (found?.verdict === LEGACY_VERDICT.SAFE) r.doctor = found.doctor;
    }
  }
  return doctorsFor(rows.filter((r) => r.doctor));
}

/** Whether an enrolment's legacy doctor may be the patient's doctor there, and if not, why. */
export const LEGACY_VERDICT = Object.freeze({
  SAFE: 'safe',
  NO_LEGACY_DOCTOR: 'no_legacy_doctor',
  DOCTOR_ACCOUNT_MISSING: 'doctor_account_missing',
  DOCTOR_ACCOUNT_INACTIVE: 'doctor_account_inactive',
  NOT_A_DOCTOR: 'not_a_doctor',
  NOT_A_CURRENT_MEMBER_HERE: 'not_a_current_member_of_this_practice',
});

/**
 * The legacy doctor (`PatientProfile.assignedDoctor`) for each row, and
 * whether they are safe to name as the patient's doctor at that row's practice.
 *
 * Safe only when every one of these holds: the patient has a legacy doctor;
 * that account exists and is active; it is a doctor's account; and it has a
 * current membership, as a doctor, at this same practice. A doctor at another
 * practice, one who has left, or one whose account is switched off is never
 * used. This is the one rule for the fallback above and for
 * scripts/backfillPrimaryDoctor.js.
 *
 * @param {{ key: string, practice: string, patient: string }[]} rows
 * @returns {Promise<Map<string, { verdict: string, doctor: string|null, doctorName: string|null }>>}
 */
export async function legacyDoctorsFor(rows) {
  const out = new Map();
  if (!rows?.length) return out;

  const profiles = await PatientProfile.find({ user: { $in: [...new Set(rows.map((r) => oid(r.patient)).filter(Boolean))] } })
    .select('user assignedDoctor')
    .lean();
  const legacyOf = new Map(profiles.map((p) => [String(p.user), oid(p.assignedDoctor)]));
  const withDoctor = rows.map((r) => ({ ...r, legacy: legacyOf.get(oid(r.patient)) ?? null }));

  const doctorIds = [...new Set(withDoctor.map((r) => r.legacy).filter(Boolean))];
  const [users, memberships] = await Promise.all([
    doctorIds.length ? User.find({ _id: { $in: doctorIds } }).select('name role isActive').lean() : [],
    withDoctor.some((r) => r.legacy)
      ? Membership.find({
          $or: withDoctor.filter((r) => r.legacy).map((r) => Membership.currentFilter(r.legacy, oid(r.practice))),
        })
          .select('user practice role')
          .lean()
      : [],
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const membershipOf = new Map(memberships.map((m) => [`${m.user}:${m.practice}`, m]));

  for (const r of withDoctor) {
    const user = r.legacy ? userById.get(r.legacy) : null;
    const membership = r.legacy ? membershipOf.get(`${r.legacy}:${oid(r.practice)}`) : null;
    let verdict = LEGACY_VERDICT.SAFE;
    if (!r.legacy) verdict = LEGACY_VERDICT.NO_LEGACY_DOCTOR;
    else if (!user) verdict = LEGACY_VERDICT.DOCTOR_ACCOUNT_MISSING;
    else if (user.isActive === false) verdict = LEGACY_VERDICT.DOCTOR_ACCOUNT_INACTIVE;
    else if (user.role !== ROLES.DOCTOR) verdict = LEGACY_VERDICT.NOT_A_DOCTOR;
    else if (!membership) verdict = LEGACY_VERDICT.NOT_A_CURRENT_MEMBER_HERE;
    else if (membership.role !== ROLES.DOCTOR) verdict = LEGACY_VERDICT.NOT_A_DOCTOR;
    out.set(r.key, {
      verdict,
      doctor: verdict === LEGACY_VERDICT.SAFE ? r.legacy : null,
      doctorName: user ? displayNameOf(user.name, membership?.role ?? user.role) : null,
      legacyDoctor: r.legacy,
    });
  }
  return out;
}

async function doctorsFor(rows) {
  const out = new Map();
  if (!rows.length) return out;

  const [users, memberships] = await Promise.all([
    User.find({ _id: { $in: [...new Set(rows.map((r) => r.doctor))] }, isActive: true })
      .select('name avatarAssetId')
      .lean(),
    // Still working at that practice. The same rule the practice's own screens
    // use for who is current.
    Membership.find({ $or: rows.map((r) => Membership.currentFilter(r.doctor, r.practice)) })
      .select('user practice role department')
      .lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const membershipOf = new Map(memberships.map((m) => [`${m.user}:${m.practice}`, m]));

  for (const r of rows) {
    const user = userById.get(r.doctor);
    const membership = membershipOf.get(`${r.doctor}:${r.practice}`);
    const displayName = displayNameOf(user?.name, membership?.role);
    if (!user || !membership || !displayName) continue;
    out.set(r.key, {
      id: r.doctor,
      name: user.name,
      displayName,
      avatarAssetId: user.avatarAssetId ? String(user.avatarAssetId) : null,
      role: membership.role,
      department: membership.department ? String(membership.department) : null,
    });
  }
  return out;
}
