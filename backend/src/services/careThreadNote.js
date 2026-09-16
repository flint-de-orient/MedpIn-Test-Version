import { ChatSession } from '../models/ChatSession.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { nextMessageSeq } from './chatSequence.js';
import { logger } from '../config/logger.js';

/**
 * Write a line into the patient's care thread on the clinic's behalf.
 *
 * Made for the appointment confirmation, and kept general because the same
 * need keeps arriving: something happens elsewhere in the app that the patient
 * asked about *here*, and the answer has nowhere to land.
 *
 * A patient asks for an appointment in the care thread. The desk gives them a
 * time from a screen the patient never sees, and a push notification goes out —
 * which is dismissed, or arrives while the phone is face-down at work, and then
 * the only record of the answer is a card on Home showing a date with no
 * account of where it came from. The thread they asked in stays silent, so the
 * conversation reads as a question nobody answered.
 *
 * Written as `clinician` with the staff member as sender, so it renders as
 * "Priya · Clinic staff" rather than as the assistant or as an anonymous
 * clinic voice. That is what actually happened: a person at the desk gave them
 * a time.
 *
 * Best-effort by design. A thread that cannot be written to must never fail the
 * confirmation — the appointment is the real thing, the note is the courtesy.
 */
export async function postCareThreadNote({ patientId, author, text }) {
  try {
    // The thread they are already reading. Never a new one: a note in a fresh
    // session is a note in a conversation the patient has to go and find.
    const session = await ChatSession.findOne({
      patient: patientId,
      kind: { $ne: 'nutrition' },
      isArchived: false,
    }).sort({ lastMessageAt: -1 });

    // No thread means the patient has never written to the clinic and cannot
    // have asked for this here. The push and the Home card carry it instead.
    if (!session) return null;

    const message = await ChatMessage.create({
      session: session._id,
      patient: patientId,
      // Drawn from the conversation's counter. Reading the tail and adding one
      // collided with any other message written in the same moment — and a
      // note like this one is written precisely when the desk is busy.
      seq: await nextMessageSeq(session._id),
      role: 'clinician',
      sender: author?._id,
      content: text,
      language: session.language,
    });

    await ChatSession.updateOne(
      { _id: session._id },
      {
        lastMessageAt: message.createdAt,
        $inc: { messageCount: 1 },
        // Deliberately NOT clearing flaggedForReview. A desk confirming a time
        // has not answered whatever clinical question got the thread flagged,
        // and clearing it here would drop that patient off the doctor's list
        // on the strength of an administrative note.
      },
    );

    return message;
  } catch (err) {
    logger.warn({ err: err?.message, patientId }, 'could not write the care-thread note');
    return null;
  }
}
