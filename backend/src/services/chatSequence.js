import { ChatMessage } from '../models/ChatMessage.js';
import { nextInSequence } from './sequence.js';

/**
 * The position of the next message in a conversation.
 *
 * ---- Eight copies of one race --------------------------------------------
 *
 * Every writer into a thread worked out its message's `seq` for itself: the
 * patient's message, the clinician's reply, the dietician's, the doctor's from
 * chat review, the care-thread note an appointment leaves, and the assistant's
 * answer — each as "the highest `seq` so far, plus one", or for the assistant,
 * "the patient's message, plus one". `(session, seq)` is unique, so whenever
 * two of them wrote into one conversation at the same moment the second was
 * refused with a duplicate key and its message was never written.
 *
 * The assistant made that ordinary rather than rare. Its reply is written after
 * a model call that takes seconds, and it claimed `seq + 1` of the patient's
 * message — so a doctor answering while the assistant was still thinking took
 * that number first, and the assistant's reply was lost.
 *
 * One allocator now, drawing from a per-conversation counter the database
 * increments atomically.
 *
 * ---- The ninth copy, and why the counter is checked every time ------------
 *
 * The patient's own message was left out of that change: it still took
 * `session.messageCount + 1`, and after each reply `messageCount` was set to
 * the reply's number plus one. The counter never saw the patient's numbers,
 * so about three messages into any conversation it drew a number a patient
 * message already had. The assistant's reply was refused as a duplicate after
 * the model had answered, and the patient saw "Something went wrong". Then
 * `messageCount` was never updated, so every later patient message asked for
 * the same taken number and was refused before it was saved, emergencies
 * included.
 *
 * So every writer draws from here, and the counter is first raised to the
 * highest `seq` actually written (`floor`, not a one-off seed). A counter that
 * fell behind, like the ones those conversations were left with, catches up
 * on its next use, and those conversations work again without a migration.
 * The cost is one read of the last message, on the (session, seq) index.
 *
 * @param {import('mongoose').Types.ObjectId|string} sessionId
 * @returns {Promise<number>}
 */
export function nextMessageSeq(sessionId) {
  return nextInSequence(`chat:${sessionId}`, {
    floor: async () => {
      const last = await ChatMessage.findOne({ session: sessionId })
        .sort({ seq: -1 })
        .select('seq')
        .lean();
      // A conversation's first message is 0, so an empty one starts at -1.
      return last?.seq ?? -1;
    },
  });
}
