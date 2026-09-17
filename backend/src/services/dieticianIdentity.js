import { User } from '../models/User.js';
import { logger } from '../config/logger.js';
import { activeDieticianOf } from './dieticianAssignment.js';

/**
 * Who a patient should be shown as their dietician, or null.
 *
 * Lives here rather than inside `routes/chat.js`, where it was written, for two
 * reasons that turned out to be the same reason. It could not be tested from
 * there — nothing exported it — and it shipped using `PatientProfile` without
 * importing it, which is a ReferenceError thrown only when the route is hit. So
 * every newly registered patient opened their dietician tab and got "Could not
 * load the conversation", and nothing in the pipeline said a word.
 *
 * ---- One answer now ---------------------------------------------------------
 *
 * The dietician assigned on the enrolment at the practice this conversation is
 * with, while they still work there. Otherwise null, and the screen says
 * plainly that nobody has been assigned yet.
 *
 * There used to be a second answer, "whoever has been replying", from when an
 * unassigned patient was on every dietician's list and the one answering was
 * their dietician in every sense the patient experienced. The caseload is the
 * assignments now, so whoever last replied is either the assigned dietician —
 * named above — or somebody who no longer holds the patient: one who left, was
 * suspended, or was replaced by the doctor. Naming them would tell the patient
 * a person is looking after them who is not.
 *
 * Without a practice there is no relationship to read, and no guess is made
 * between two.
 *
 * [deps] exists so the failure modes can be tested. Production never passes it.
 */
export async function dieticianFacingPatient(
  patientId,
  { practiceId = null } = {},
  deps = { activeDieticianOf, User },
) {
  try {
    if (!practiceId) return null;

    const dieticianId = await deps.activeDieticianOf({ practiceId, patientId });
    if (!dieticianId) return null;

    const person = await deps.User.findOne({ _id: dieticianId, isActive: true })
      .select('name avatarAssetId')
      .lean();
    if (!person) return null;

    return {
      id: String(person._id),
      name: person.name,
      avatarUrl: person.avatarAssetId ? `/api/v1/uploads/${person.avatarAssetId}/raw` : null,
      // Kept for the app, which says "your dietician" for an assignment. It is
      // the only kind of answer there is now.
      assigned: true,
    };
  } catch (err) {
    // Never fatal. This names the face at the top of a conversation; the
    // conversation itself is the thing the patient came for, and losing every
    // message because a header lookup failed is a far worse outcome than a
    // header that says nobody is assigned yet.
    //
    // That is not hypothetical — it is exactly what this function did on the
    // day it shipped, and the patient saw a Retry button where their messages
    // should have been.
    logger.warn(
      { err: err?.message, patientId: String(patientId) },
      'could not resolve the patient-facing dietician',
    );
    return null;
  }
}
