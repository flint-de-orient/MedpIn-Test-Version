import { PatientProfile } from '../models/PatientProfile.js';
import { ROLES } from '../models/User.js';
import { memberIdsOf } from '../middleware/practiceScope.js';

/**
 * Who looks after this patient's nutrition, decided by how many people could.
 *
 * ---- What this replaces --------------------------------------------------
 *
 * The dietician's caseload was "every patient at the practice, unless somebody
 * has been explicitly assigned to me — then only those". Assignment as a
 * restriction rather than a grant, and it was a fair reading of a clinic with
 * one dietician and hundreds of patients: requiring an assignment per patient
 * would have made the default "nutrition care from nobody".
 *
 * But a default that widens access is the wrong shape for the thing it is
 * defaulting. A second dietician, or a locum, or a dietician who has finished
 * with a patient, all inherit the whole practice until somebody remembers to
 * restrict them — and nothing in the record says who was supposed to be
 * looking after whom.
 *
 * So the restriction becomes the grant, and the default moves to where it can
 * be recorded: at the moment a patient joins a practice, the practice's only
 * dietician is assigned to them. The caseload is then exactly what the
 * assignments say, and "who is looking after this patient" has an answer that
 * can be read, changed and audited.
 *
 * ---- Why only when there is exactly one ---------------------------------
 *
 * With none there is nobody to assign. With two or more, picking one is a
 * clinical allocation decision and the first row the database returns is not
 * an answer to it — the doctor chooses, on the patient's profile.
 *
 * Never overwrites an assignment that exists: a patient the doctor has already
 * placed with somebody stays there.
 *
 * @returns {Promise<import('mongoose').Types.ObjectId|null>} who was assigned, if anybody
 */
export async function autoAssignDietician(patientId, practiceId) {
  if (!patientId || !practiceId) return null;

  const dieticians = await memberIdsOf(practiceId, ROLES.DIETICIAN);
  // `null` is a deployment with no memberships at all; one dietician is the
  // case this exists for, and anything else is a decision rather than a
  // default.
  if (!dieticians || dieticians.length !== 1) return null;

  const result = await PatientProfile.updateOne(
    {
      user: patientId,
      $or: [{ assignedDietician: null }, { assignedDietician: { $exists: false } }],
    },
    { $set: { assignedDietician: dieticians[0] } },
  );

  return result.modifiedCount ? dieticians[0] : null;
}
