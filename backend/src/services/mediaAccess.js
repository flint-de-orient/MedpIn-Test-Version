import mongoose from 'mongoose';
import { MediaAsset } from '../models/MediaAsset.js';
import { notFound } from '../middleware/errors.js';
import { practiceOf, memberIdsOf } from '../middleware/practiceScope.js';

/**
 * Which files a request may put on a record.
 *
 * ---- Why this exists ----------------------------------------------------
 *
 * Every route that accepts a file id stored it as sent. A file id is not a
 * secret — it is in every URL the app renders — and the record a file lands on
 * decides who may read it afterwards:
 *
 *   - a chat attachment is readable by the patient whose thread it is in, so
 *     attaching another patient's lab report to your own message made it yours
 *     to open;
 *   - a clinic logo and a staff avatar are readable by everyone signed in, so
 *     pointing either at a patient's file published it;
 *   - the vision readers send whatever id they are given to the model, so a
 *     prescription scan or a foot assessment could read another patient's
 *     photographs and file the model's description on this one;
 *   - a voice-only message takes its words from the note's transcript, so
 *     another patient's note became this patient's message.
 *
 * So a file id is accepted only when the file is the patient's own, or was
 * uploaded by the person attaching it — the two ways a file legitimately
 * reaches a record. Anything else is not found: the same answer as a file that
 * does not exist, so the refusal says nothing about another practice's data.
 *
 * `ownerId` is the same test as `patientId` for a file that is not a patient's
 * — a clinician's own signature or picture. Named separately so a call site
 * says which of the two it means.
 */
export async function attachableAssetIds(ids, { patientId = null, ownerId = null, uploaderIds = [] } = {}) {
  const wanted = [...new Set([].concat(ids ?? []).filter(Boolean).map(String))];
  if (!wanted.length) return [];

  const owner = patientId ?? ownerId;
  const allowed = [
    ...(owner ? [{ owner }] : []),
    ...(uploaderIds.length ? [{ uploadedBy: { $in: uploaderIds } }] : []),
  ];
  // A call with nothing to check against is a mistake in the caller, not an
  // open door. Refused loudly, so it cannot ship as one.
  if (!allowed.length) {
    throw new Error('attachableAssetIds needs a patient, an owner or an uploader to check the files against');
  }
  if (wanted.some((id) => !mongoose.isValidObjectId(id))) throw notFound('File not found');

  const found = await MediaAsset.countDocuments({
    _id: { $in: wanted },
    deletedAt: null,
    $or: allowed,
  });
  if (found !== wanted.length) throw notFound('File not found');
  return wanted;
}

/** One optional id, by the same rule. Absent stays absent. */
export async function attachableAssetId(id, scope) {
  if (!id) return id;
  const [ok] = await attachableAssetIds([id], scope);
  return ok;
}

/**
 * A logo has to be this practice's own artwork.
 *
 * Readable by everyone once a location or practice references it, so setting
 * the reference is publishing the file. Uploaded by anybody at the practice —
 * the desk sets up a location as often as the doctor does — and by nobody
 * else.
 *
 * `practiceId` is the practice whose letterhead this is: the location's, or the
 * one named in the URL. Only when neither is known does it fall back to the
 * caller's own, because a clinician at two practices setting one's logo must be
 * checked against that practice's people rather than whichever membership was
 * read first.
 */
export async function assertLogoAssets(req, body, practiceId = null) {
  const members = (await memberIdsOf(practiceId ?? (await practiceOf(req)))) ?? [];
  const uploaderIds = [req.user._id, ...members];
  for (const field of ['logoLightAssetId', 'logoDarkAssetId']) {
    if (body[field]) body[field] = await attachableAssetId(body[field], { uploaderIds });
  }
}
