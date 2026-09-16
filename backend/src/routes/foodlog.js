import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { FoodLog, MEAL_TYPES } from '../models/FoodLog.js';
import { recordWindow, requireRecordAccess } from '../middleware/authorise.js';
import { attachableAssetId } from '../services/mediaAccess.js';

/**
 * The patient's food log — meals they record (a photo and/or a note) for their
 * dietician to review. Mounted at /patients/:patientId/food-log; the patient
 * uses `me`, a clinician a real id.
 */
const router = Router({ mergeParams: true });
// Whose patient this is, then what this person may do with them: the food log.
// `resolvePatientScope` answers the first and was, until now, the only thing
// asked — so EDIT_RECORD was granted by every preset and enforced by nothing.
router.use(requireAuth, resolvePatientScope, requireRecordAccess());

export function serialiseFoodLog(f) {
  // f.photo may arrive populated ({_id, mimeType}) or as a raw id (on create).
  const photoId = f.photo?._id ?? f.photo;
  return {
    id: String(f._id),
    mealType: f.mealType,
    note: f.note ?? '',
    photoUrl: photoId ? `/api/v1/uploads/${photoId}/raw` : null,
    createdAt: f.createdAt,
  };
}

/** Drops food logs whose "photo" is not an image — a voice note or document
 * mis-filed as a meal by the old nutrition-voice bug, which would render as a
 * broken image. A log with no photo (a text note) is kept. */
export function keepRealMealPhotos(logs) {
  return logs.filter((f) => !f.photo || (f.photo?.mimeType ?? '').startsWith('image/'));
}

router.get(
  '/',
  audit('read', 'FoodLog'),
  asyncHandler(async (req, res) => {
    const items = await FoodLog.find({ patient: req.patientId, ...recordWindow(req, 'createdAt') })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('photo', 'mimeType')
      .lean();
    res.json({ items: keepRealMealPhotos(items).map(serialiseFoodLog) });
  }),
);

router.post(
  '/',
  validate({
    body: z
      .object({
        mealType: z.enum(MEAL_TYPES).default('other'),
        note: z.string().trim().max(1000).optional().default(''),
        photo: z.string().optional(),
      })
      .refine((b) => b.note.trim().length > 0 || b.photo, { message: 'Add a note or a photo', path: ['note'] }),
  }),
  audit('create', 'FoodLog'),
  asyncHandler(async (req, res) => {
    // The patient's own photograph. The dietician opens whatever is filed here.
    const photo = await attachableAssetId(req.body.photo || undefined, {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const entry = await FoodLog.create({
      patient: req.patientId,
      mealType: req.body.mealType,
      note: req.body.note,
      photo: photo || undefined,
    });
    res.status(201).json({ entry: serialiseFoodLog(entry) });
  }),
);

/**
 * Removes a meal the patient logged.
 *
 * A hard delete, not a soft one: a photo of the wrong plate is a mistake, not
 * history, and leaving it visible to the dietician would have them planning
 * around a meal that never happened. Scoped to the owner, so one patient can
 * never delete another's.
 */
router.delete(
  '/:id',
  audit('delete', 'FoodLog'),
  asyncHandler(async (req, res) => {
    const removed = await FoodLog.findOneAndDelete({ _id: req.params.id, patient: req.patientId });
    if (!removed) throw notFound('Meal not found');
    res.status(204).end();
  }),
);

export default router;
