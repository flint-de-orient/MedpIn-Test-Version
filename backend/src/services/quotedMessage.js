import mongoose from 'mongoose';
import { ChatMessage } from '../models/ChatMessage.js';
import { ChatSession } from '../models/ChatSession.js';
import { notFound } from '../middleware/errors.js';

/**
 * The message a reply quotes, if it is in the conversation being replied in.
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * A reply carries the id of the message it answers, and every send response
 * populates that id and returns the first 160 characters with its author's
 * role, so the quote renders before the thread reloads. Nothing asked whose
 * message the id was. Quoting was therefore a way to read any message on the
 * platform, one id at a time — any patient's, at any practice — and to store a
 * permanent pointer to it in somebody else's thread.
 *
 * ---- The rule -----------------------------------------------------------
 *
 * The quoted message must belong to the same patient, and to the same kind of
 * conversation: the care thread quotes the care thread, the dietician's thread
 * quotes the dietician's. The composer only ever offers messages from the
 * thread it is in, so nothing the app does is refused; what is refused is a
 * dietician's thread carrying a doctor's words as a quote.
 *
 * Refused as not found, the same answer as an id that does not exist.
 *
 * @param {string|undefined} id  the `replyTo` from the request body
 * @param {{patientId: *, kind?: 'care'|'nutrition'}} scope
 * @returns the id when it may be quoted, `undefined` when none was given
 */
export async function quotableMessageId(id, { patientId, kind = 'care' } = {}) {
  if (!id) return undefined;
  // A call that cannot say whose conversation this is would permit anything.
  if (!patientId) throw new Error('quotableMessageId needs the patient whose conversation this is');
  if (!mongoose.isValidObjectId(id)) throw notFound('Message not found');

  const message = await ChatMessage.findOne({ _id: id, patient: patientId }).select('session').lean();
  if (!message) throw notFound('Message not found');

  const inNutrition = Boolean(await ChatSession.exists({ _id: message.session, kind: 'nutrition' }));
  if (inNutrition !== (kind === 'nutrition')) throw notFound('Message not found');

  return String(id);
}

/**
 * The fields a quote is rendered from.
 *
 * `patient` and the deletion stamp are not shown. They are what lets
 * [quotePreview] decide whether anything may be — so every populate of
 * `replyTo` asks for them, and a populate that forgot would show no quotes
 * rather than the wrong ones.
 */
export const QUOTE_FIELDS = 'content role patient deletedForEveryoneAt';

/**
 * What of a quoted message may be shown under a reply, or null.
 *
 * The send path now refuses a quote from another conversation, and that is not
 * the whole of it. A pointer stored before the check — by any client that sent
 * one — is populated again on every read of the thread. And a message its
 * author deleted for everyone has its words withheld where it sits, yet came
 * back in full as the quote under whatever replied to it.
 *
 * So the preview is decided where it is rendered: none for a quote from another
 * patient's conversation, none for one that was taken back.
 */
export function quotePreview(message) {
  const quoted = message?.replyTo;
  if (!quoted || typeof quoted !== 'object' || quoted.content == null) return null;
  if (quoted.deletedForEveryoneAt) return null;
  if (String(quoted.patient) !== String(message.patient?._id ?? message.patient)) return null;
  return { content: String(quoted.content).slice(0, 160), role: quoted.role ?? null };
}
