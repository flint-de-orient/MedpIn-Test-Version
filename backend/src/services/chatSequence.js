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
 * increments atomically, seeded from the highest `seq` already written so the
 * conversations that exist carry on where they are.
 *
 * @param {import('mongoose').Types.ObjectId|string} sessionId
 * @returns {Promise<number>}
 */
export function nextMessageSeq(sessionId) {
  return nextInSequence(`chat:${sessionId}`, {
    seed: async () => {
      const last = await ChatMessage.findOne({ session: sessionId })
        .sort({ seq: -1 })
        .select('seq')
        .lean();
      // A conversation's first message is 0, so an empty one seeds at -1.
      return last?.seq ?? -1;
    },
  });
}
