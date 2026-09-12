import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Feedback } from '../models/Feedback.js';
import { ROLES } from '../models/User.js';
import { paged, pageParams } from '../utils/pagination.js';
import { practicePatients } from '../middleware/practiceScope.js';

const router = Router();

/**
 * A patient sends feedback about the app or the clinic.
 *
 * Deliberately not routed into the clinical alert queue: "the app is slow" and
 * "I have chest pain" must never sit in the same list, or the clinic learns to
 * skim the list that matters.
 */
router.post(
  '/',
  requireAuth,
  validate({
    body: z
      .object({
        about: z.enum(['app', 'clinic']),
        rating: z.coerce.number().int().min(1).max(5).optional(),
        message: z.string().trim().max(2000).optional().default(''),
      })
      // A bare rating is still a signal, and a complaint with no star is the
      // most useful feedback there is — but an empty form is neither.
      .refine((b) => b.rating != null || b.message.trim().length > 0, {
        message: 'Add a rating or tell us what happened',
        path: ['message'],
      }),
  }),
  audit('create', 'Feedback'),
  asyncHandler(async (req, res) => {
    if (req.user.role !== ROLES.PATIENT) throw badRequest('Only patients can send feedback');

    const entry = await Feedback.create({
      patient: req.user._id,
      about: req.body.about,
      rating: req.body.rating,
      message: req.body.message,
    });

    res.status(201).json({ id: entry._id, createdAt: entry.createdAt });
  }),
);

/** What this patient has sent before, so the app can show it was received. */
router.get(
  '/mine',
  requireAuth,
  validate({ query: pageParams }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.user._id };
    const [items, total] = await Promise.all([
      Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Feedback.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialise), { page, limit, total }));
  }),
);

/** The clinic's view. Newest first, with who said it — feedback is attributable. */
router.get(
  '/',
  requireAuth,
  requireClinician,
  validate({ query: pageParams }),
  audit('read', 'Feedback'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);

    // The clinic's view is this clinic's view. `Feedback.find()` with no filter
    // returned every patient's words on the platform, with their name, phone
    // and photograph attached — feedback is attributable by design, which is
    // what makes an unscoped read of it worse than an unscoped count.
    const scope = await practicePatients(req, 'patient');

    const [items, total] = await Promise.all([
      Feedback.find(scope)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('patient', 'name phone avatarAssetId')
        .lean(),
      Feedback.countDocuments(scope),
    ]);

    res.json(
      paged(
        items.map((f) => ({
          ...serialise(f),
          patientName: f.patient?.name ?? null,
          // So the doctor sees who wrote it, not just their name in grey.
          patientAvatarUrl: f.patient?.avatarAssetId
            ? `/api/v1/uploads/${f.patient.avatarAssetId}/raw`
            : null,
          patientPhone: f.patient?.phone ?? null,
        })),
        { page, limit, total },
      ),
    );
  }),
);

router.post(
  '/:id/reviewed',
  requireAuth,
  requireClinician,
  audit('update', 'Feedback'),
  asyncHandler(async (req, res) => {
    /*
     * This practice's feedback, which the read above already knew and this did
     * not.
     *
     * The GET one route up carries a comment explaining exactly why an
     * unscoped query here is bad — "every patient's words on the platform,
     * with their name, phone and photograph attached". The fix was applied
     * where somebody was looking and not to its neighbour, so a clinician at
     * any practice could mark anybody's feedback reviewed and take it off the
     * list of the clinic it was actually about.
     *
     * `$and` rather than a spread, though here a spread would work: this
     * filter keys on `_id` and the scope keys on `patient`, so they do not
     * collide. In records.js both halves key on `_id` and the spread silently
     * replaced the requested id with the caller's own patient list — the guard
     * then found somebody else's row and acted on it.
     *
     * Written this way because the safety of a spread depends on two key names
     * staying different, which is not a property anybody checks when adding a
     * field. `$and` does not depend on it.
     */
    const scoped = await Feedback.findOne({
      $and: [{ _id: req.params.id }, await practicePatients(req, 'patient')],
    })
      .select('_id')
      .lean();
    if (!scoped) throw notFound('Feedback not found');

    await Feedback.findByIdAndUpdate(scoped._id, {
      reviewedAt: new Date(),
      reviewedBy: req.user._id,
    });
    res.status(204).end();
  }),
);

function serialise(f) {
  return {
    id: f._id,
    about: f.about,
    rating: f.rating ?? null,
    message: f.message ?? '',
    reviewed: Boolean(f.reviewedAt),
    createdAt: f.createdAt,
  };
}

export default router;
