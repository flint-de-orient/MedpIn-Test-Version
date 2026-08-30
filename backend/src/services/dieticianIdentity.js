import { PatientProfile } from '../models/PatientProfile.js';
import { User } from '../models/User.js';
import { ChatSession } from '../models/ChatSession.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { logger } from '../config/logger.js';

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
 * Three answers, in the order they are true:
 *
 *   - the dietician a doctor explicitly assigned. A human decided; nothing else
 *     overrides that.
 *   - the one who has actually been answering this patient. With no assignment,
 *     whoever has been replying IS their dietician in every sense the patient
 *     experiences, and naming somebody else would be a worse lie than naming
 *     nobody.
 *   - null, when neither is true. Deliberately not "pick one" — an allocation
 *     made by a shuffle is worse than one made late, and the screen can say
 *     plainly that nobody has been assigned yet.
 *
 * [deps] exists so the failure modes can be tested. Production never passes it.
 */
export async function dieticianFacingPatient(
  patientId,
  deps = { PatientProfile, User, ChatSession, ChatMessage },
) {
  try {
    const profile = await deps.PatientProfile.findOne({ user: patientId })
      .select('assignedDietician')
      .lean();

    const shape = (u) =>
      u
        ? {
            id: String(u._id),
            name: u.name,
            avatarUrl: u.avatarAssetId ? `/api/v1/uploads/${u.avatarAssetId}/raw` : null,
            assigned: Boolean(profile?.assignedDietician),
          }
        : null;

    if (profile?.assignedDietician) {
      const assigned = await deps.User.findOne({
        _id: profile.assignedDietician,
        isActive: true,
      })
        .select('name avatarAssetId')
        .lean();
      if (assigned) return shape(assigned);
    }

    // Nobody assigned: whoever last wrote here, if anyone has.
    const session = await deps.ChatSession.findOne({
      patient: patientId,
      kind: 'nutrition',
    })
      .select('_id')
      .lean();
    if (!session) return null;

    const lastReply = await deps.ChatMessage.findOne({
      session: session._id,
      role: 'dietician',
    })
      .sort({ seq: -1 })
      .select('sender')
      .lean();
    if (!lastReply?.sender) return null;

    const replier = await deps.User.findOne({
      _id: lastReply.sender,
      isActive: true,
    })
      .select('name avatarAssetId')
      .lean();
    return shape(replier);
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
