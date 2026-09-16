import { Router } from 'express';
import { z } from 'zod';

import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { idempotencyKey } from '../middleware/idempotency.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { Feedback, FEEDBACK_ABOUT, FEEDBACK_ROUTE, FEEDBACK_STATE } from '../models/Feedback.js';
import { paged, pageParams } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import { addReply, notifyPatientOfFeedbackReply } from '../services/feedback.js';

/**
 * The feedback no practice reads: about the app, and about "the clinic" from
 * somebody no practice has taken on.
 *
 * Nested inside admin.js, after `requireAdmin`, for the reason billing and the
 * application queue are: a sibling mount in routes/index.js would not inherit
 * the guard.
 *
 * ---- Without the patient ---------------------------------------------------
 *
 * The admin namespace holds no clinical data and no patient identity, and this
 * does not change that. An operator reads what was said, the rating, when, and
 * a short reference — not the name, the number, the photograph or the account
 * id. A reply reaches the patient through the row itself, so answering needs
 * none of them.
 */
const router = Router();

/** A handle an operator can say out loud, that names nobody. */
function reference(id) {
  return String(id).slice(-6).toUpperCase();
}

router.get(
  '/',
  validate({
    query: pageParams.and(
      z.object({
        state: z.enum(Object.values(FEEDBACK_STATE)).optional(),
        about: z.enum(Object.values(FEEDBACK_ABOUT)).optional(),
      }),
    ),
  }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, state, about } = q(req);
    const filter = {
      route: FEEDBACK_ROUTE.PLATFORM,
      ...(state ? { state } : {}),
      ...(about ? { about } : {}),
    };
    const me = String(req.admin._id);

    const [items, total, unread] = await Promise.all([
      Feedback.find(filter)
        // Only what an operator needs. The patient, the author and the
        // enrolment are never selected, so they cannot leak by accident.
        .select('about rating message state createdAt platformReadBy replies')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Feedback.countDocuments(filter),
      Feedback.countDocuments({ route: FEEDBACK_ROUTE.PLATFORM, 'platformReadBy.admin': { $ne: req.admin._id } }),
    ]);

    const adminIds = [...new Set(items.flatMap((f) => (f.replies ?? []).map((r) => String(r.by))))];
    const admins = new Map(
      (await PlatformAdmin.find({ _id: { $in: adminIds } }).select('name').lean()).map((a) => [String(a._id), a.name]),
    );

    await AdminAuditLog.record({ admin: req.admin, action: 'admin.feedback.list', resource: 'Feedback', req });

    res.json({
      ...paged(
        items.map((f) => ({
          id: String(f._id),
          reference: reference(f._id),
          about: f.about,
          // "The clinic" from somebody with no clinic: worth telling apart from
          // app feedback, because the answer is usually "ask your clinic to
          // register you" rather than a bug.
          fromUnconnectedPatient: f.about === FEEDBACK_ABOUT.CLINIC,
          rating: f.rating ?? null,
          message: f.message ?? '',
          state: f.state ?? FEEDBACK_STATE.OPEN,
          createdAt: f.createdAt,
          read: (f.platformReadBy ?? []).some((r) => String(r.admin) === me),
          replies: (f.replies ?? []).map((r) => ({ body: r.body, at: r.at, byName: admins.get(String(r.by)) ?? null })),
        })),
        { page, limit, total },
      ),
      unread,
    });
  }),
);

/** This operator has read it. Nobody else's count moves. */
router.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const row = await Feedback.findOne({ _id: req.params.id, route: FEEDBACK_ROUTE.PLATFORM }).select('_id').lean();
    if (!row) throw notFound('Feedback not found');

    await Feedback.updateOne(
      { _id: row._id, 'platformReadBy.admin': { $ne: req.admin._id } },
      { $push: { platformReadBy: { admin: req.admin._id, at: new Date() } } },
    );
    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.feedback.read',
      resource: 'Feedback',
      resourceId: row._id,
      req,
    });
    res.status(204).end();
  }),
);

/** Answer it, as MedPin. The patient reads it under "Your feedback" and is told. */
router.post(
  '/:id/reply',
  idempotencyKey(),
  validate({ body: z.object({ message: z.string().trim().min(1).max(2000) }) }),
  asyncHandler(async (req, res) => {
    const row = await Feedback.findOne({ _id: req.params.id, route: FEEDBACK_ROUTE.PLATFORM })
      .select('_id patient createdBy')
      .lean();
    if (!row) throw notFound('Feedback not found');

    const outcome = await addReply(
      row._id,
      { body: req.body.message, from: FEEDBACK_ROUTE.PLATFORM, by: req.admin._id },
      req.idempotency,
    );
    await Feedback.updateOne(
      { _id: row._id, 'platformReadBy.admin': { $ne: req.admin._id } },
      { $push: { platformReadBy: { admin: req.admin._id, at: new Date() } } },
    );
    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.feedback.reply',
      resource: 'Feedback',
      resourceId: row._id,
      req,
    });

    if (outcome === 'added') {
      notifyPatientOfFeedbackReply(row, 'MedPin').catch((err) => logger.warn({ err }, 'feedback reply push failed'));
    }
    res.status(outcome === 'added' ? 201 : 200).json({ ok: true, replayed: outcome === 'replayed' });
  }),
);

export default router;
