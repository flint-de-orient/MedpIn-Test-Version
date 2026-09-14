import { ChatMessage } from '../models/ChatMessage.js';
import { ChatSession } from '../models/ChatSession.js';
import { Membership } from '../models/Membership.js';
import { relationshipSessions } from './conversationPractice.js';

/** How many recent doctor/dietician messages are carried into the prompt. */
const CARE_TEAM_NOTES = 6;

/** Each is trimmed to this, so one long note cannot crowd out the rest. */
const CARE_TEAM_NOTE_CHARS = 400;

/**
 * The care team's own messages to this patient, in one practice's conversations.
 *
 * ---- What was wrong ------------------------------------------------------
 *
 * These were loaded by patient: the last six clinician and dietician messages
 * from every conversation the patient had, at every practice. The prompt then
 * calls them "the real words of" this practice's doctor and tells the model to
 * treat them as settled instructions — so a cardiologist at one practice saying
 * "stop aspirin" was repeated by another practice's assistant as its own
 * doctor's instruction.
 *
 * ---- Now ----------------------------------------------------------------------
 *
 * Only the relationship's own conversations, care and nutrition both — care is
 * one continuous story within a practice — and only from people who have been
 * members of that practice. The second half matters for conversations written
 * before this was fixed, when a reply could land in another practice's session.
 * A member who has since left still counts: an instruction they gave while
 * they worked there still stands.
 *
 * `enrollment` null is a deployment with nothing to decide by, and reads as it
 * always did.
 */
export async function careTeamMessages({
  patientId,
  enrollment = null,
  roles = ['clinician', 'dietician'],
  kind = null,
  limit = CARE_TEAM_NOTES,
}) {
  const sessions = await ChatSession.find(await relationshipSessions({ patientId, enrollment, kind }))
    .select('_id')
    .lean();
  if (!sessions.length) return [];

  const authors = enrollment ? await Membership.distinct('user', { practice: enrollment.practice }) : null;

  return ChatMessage.find({
    patient: patientId,
    session: { $in: sessions.map((s) => s._id) },
    role: { $in: roles },
    content: { $nin: [null, ''] },
    // Words the author took back are not instructions.
    deletedForEveryoneAt: null,
    ...(authors ? { sender: { $in: authors } } : {}),
  })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate('sender', 'name')
    .lean();
}

/**
 * The same messages, as the block the assistant's prompt quotes.
 *
 * Deliberately NOT put into `contents` alongside the chat turns. Gemini only
 * accepts `user` and `model` roles, so a clinician's message would have to be
 * labelled as one or the other — and labelling it `model` lets the assistant
 * treat a doctor's instruction as its own earlier output, free to extend or
 * paraphrase. Carried as authoritative context in the system prompt instead,
 * the model can quote them but cannot speak as them.
 */
export async function careTeamNotesFor({ patientId, enrollment = null }) {
  const notes = await careTeamMessages({ patientId, enrollment });
  if (notes.length === 0) return '';

  return notes
    .reverse()
    .map((m) => {
      const who = m.role === 'dietician' ? 'Dietician' : 'Doctor';
      const name = m.sender?.name ? ` (${m.sender.name})` : '';
      const when = m.createdAt ? new Date(m.createdAt).toISOString().slice(0, 10) : '';
      const body =
        m.content.length > CARE_TEAM_NOTE_CHARS ? `${m.content.slice(0, CARE_TEAM_NOTE_CHARS)}…` : m.content;
      return `- ${when} ${who}${name}: ${body}`;
    })
    .join('\n');
}
