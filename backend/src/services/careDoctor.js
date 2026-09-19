import mongoose from 'mongoose';

import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { Membership } from '../models/Membership.js';
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
    .select('primaryDoctor practice')
    .lean();
  if (!oid(enrollment?.primaryDoctor)) return null;

  const found = await doctorsFor([{ key: 'one', practice, doctor: oid(enrollment.primaryDoctor) }]);
  return found.get('one') ?? null;
}

/**
 * The current doctor of each enrolment, keyed by enrolment id.
 *
 * For a list of the patient's active enrolments (practicesFor), answered in
 * two queries rather than two per row. Same rule as [currentDoctorOf].
 */
export async function currentDoctorsOf(enrollments) {
  const rows = (enrollments ?? [])
    .filter((e) => oid(e.primaryDoctor) && oid(e.practice))
    .map((e) => ({ key: String(e.id ?? e._id), practice: oid(e.practice), doctor: oid(e.primaryDoctor) }));
  return doctorsFor(rows);
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
