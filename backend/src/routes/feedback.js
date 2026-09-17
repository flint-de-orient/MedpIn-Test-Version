import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireRole, DIRECT_PATIENT_ACCESS } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { idempotencyKey, isReplayOf, isKeyCollision } from '../middleware/idempotency.js';
import { practiceOf, practicePatients } from '../middleware/practiceScope.js';
import {
  Feedback,
  FEEDBACK_ABOUT,
  FEEDBACK_ORIGIN,
  FEEDBACK_ROUTE,
  FEEDBACK_STATE,
} from '../models/Feedback.js';
import { PERMISSIONS } from '../models/Membership.js';
import { Practice } from '../models/Practice.js';
import { ROLES } from '../models/User.js';
import { paged, pageParams } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import {
  routeFeedback,
  feedbackPractices,
  notifyPracticeOfFeedback,
  notifyPatientOfFeedbackReply,
  addReply,
  feedbackNames,
} from '../services/feedback.js';

const router = Router();

/**
 * The rows this reader may see, as a filter.
 *
 * Their practice's feedback — the rows that went there — from patients the
 * practice still has. `practicePatients` is the second half: a patient who has
 * withdrawn the practice's access is not a patient that practice reads about,
 * feedback included, and an unknown practice is an empty set.
 */
async function practiceInbox(req) {
  const practice = await practiceOf(req);
  return {
    $and: [{ route: FEEDBACK_ROUTE.PRACTICE, practice }, await practicePatients(req, 'patient')],
  };
}

/* ------------------------------------------------------ the patient's side */

/** The practices the patient may send feedback about, with who in the household is there. */
router.get(
  '/practices',
  requireAuth,
  requireRole(ROLES.PATIENT),
  asyncHandler(async (req, res) => {
    res.json({ items: await feedbackPractices(req.user._id) });
  }),
);

/**
 * A patient sends feedback about the app or a clinic.
 *
 * Deliberately not routed into the clinical alert queue: "the app is slow" and
 * "I have chest pain" must never sit in the same list, or the clinic learns to
 * skim the list that matters.
 */
router.post(
  '/',
  requireAuth,
  idempotencyKey(),
  validate({
    body: z
      .object({
        about: z.enum(Object.values(FEEDBACK_ABOUT)),
        rating: z.coerce.number().int().min(1).max(5).optional(),
        message: z.string().trim().max(2000).optional().default(''),
        // Which practice "the clinic" is. Older builds send none; see routeFeedback.
        practiceId: z.string().optional(),
        // Somebody in the household the feedback is about, when not the holder.
        patientId: z.string().optional(),
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

    const replay = async () => {
      if (!req.idempotency) return null;
      const existing = await Feedback.findOne({ createdBy: req.user._id, idempotencyKey: req.idempotency.key });
      return isReplayOf(req, existing) ? existing : null;
    };
    const again = await replay();
    if (again) return res.status(201).json(await receipt(again));

    const where = await routeFeedback({
      login: req.user,
      about: req.body.about,
      practiceId: req.body.practiceId ?? null,
      patientId: req.body.patientId ?? null,
    });

    let entry;
    try {
      entry = await Feedback.create({
        patient: where.patient,
        about: req.body.about,
        rating: req.body.rating,
        message: req.body.message,
        route: where.route,
        practice: where.practice,
        enrollment: where.enrollment,
        origin: FEEDBACK_ORIGIN.PATIENT_APP,
        createdBy: req.user._id,
        createdByRole: req.user.role,
        state: FEEDBACK_STATE.OPEN,
        idempotencyKey: req.idempotency?.key ?? null,
        idempotencyHash: req.idempotency?.hash ?? null,
      });
    } catch (err) {
      if (req.idempotency && isKeyCollision(err)) {
        const raced = await replay();
        if (raced) return res.status(201).json(await receipt(raced));
      }
      throw err;
    }
    req.auditResourceId = entry._id;
    req.patientId = where.patient;

    if (entry.route === FEEDBACK_ROUTE.PRACTICE) {
      notifyPracticeOfFeedback(entry).catch((err) => logger.warn({ err }, 'feedback push failed'));
    }

    res.status(201).json(await receipt(entry));
  }),
);

/** Where a new piece of feedback went, in words the patient can be shown. */
async function receipt(entry) {
  const practice = entry.practice ? await Practice.findById(entry.practice).select('name').lean() : null;
  return {
    id: String(entry._id),
    createdAt: entry.createdAt,
    routedTo: entry.route,
    practice: practice ? { id: String(practice._id), name: practice.name } : null,
  };
}

/**
 * What this patient has sent, where it went, whether it has been seen, and any
 * reply — the other half of "someone will reply", which had no screen.
 */
router.get(
  '/mine',
  requireAuth,
  validate({ query: pageParams }),
  audit('read', 'Feedback'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    // Written by this login — and the rows from before authorship was recorded,
    // when the only thing stored was the login that sent it.
    const filter = {
      $or: [{ createdBy: req.user._id }, { createdBy: { $exists: false }, patient: req.user._id }],
    };
    const [items, total] = await Promise.all([
      Feedback.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Feedback.countDocuments(filter),
    ]);
    const names = await feedbackNames(items);

    res.json(
      paged(
        items.map((f) => ({
          ...serialise(f),
          // `private` for the rows from before feedback said where it went:
          // nobody else can read them now, and the patient is told so.
          routedTo: f.route && f.route !== FEEDBACK_ROUTE.NONE ? f.route : 'private',
          practice: f.practice ? { id: String(f.practice), name: names.practice.get(String(f.practice)) ?? null } : null,
          // Whether anybody it went to has opened it. An old row the clinic
          // marked reviewed was seen, and says so.
          seen:
            f.route === FEEDBACK_ROUTE.PLATFORM
              ? (f.platformReadBy ?? []).length > 0
              : (f.readBy ?? []).length > 0 || Boolean(f.reviewedAt),
          replies: (f.replies ?? []).map((r) => ({
            body: r.body,
            at: r.at,
            from: r.from,
            // The practice's name, and who there answered. MedPin's operators
            // are MedPin to a patient: which one answered is not theirs to know.
            fromName:
              r.from === FEEDBACK_ROUTE.PLATFORM
                ? 'MedPin'
                : names.practice.get(String(f.practice)) ?? 'Your clinic',
            byName: r.from === FEEDBACK_ROUTE.PRACTICE ? names.user.get(String(r.by)) ?? null : null,
          })),
        })),
        { page, limit, total },
      ),
    );
  }),
);

/* ----------------------------------------------------- the practice's side */

/** The practice's inbox. Newest first, with who said it — feedback is attributable. */
router.get(
  '/',
  requireAuth,
  // The people who read a practice's patient feedback: a role that opens
  // patient records directly, holding VIEW_PATIENT there. See services/feedback.js.
  requireRole(...DIRECT_PATIENT_ACCESS),
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  validate({ query: pageParams }),
  audit('read', 'Feedback'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);

    // The clinic's view is this clinic's view. `Feedback.find()` with no filter
    // returned every patient's words on the platform, with their name, phone
    // and photograph attached — feedback is attributable by design, which is
    // what makes an unscoped read of it worse than an unscoped count.
    const scope = await practiceInbox(req);
    const me = String(req.user._id);

    const [items, total, unread] = await Promise.all([
      Feedback.find(scope)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('patient', 'name phone avatarAssetId')
        .lean(),
      Feedback.countDocuments(scope),
      Feedback.countDocuments({ $and: [scope, { 'readBy.user': { $ne: req.user._id } }] }),
    ]);
    const names = await feedbackNames(items);

    res.json({
      ...paged(
        items.map((f) => ({
          ...serialise(f),
          // This reader's own answer. See `readBy` on the model.
          reviewed: (f.readBy ?? []).some((r) => String(r.user) === me),
          reviewedBy: (f.readBy ?? []).map((r) => ({ name: names.user.get(String(r.user)) ?? null, at: r.at })),
          replies: (f.replies ?? []).map((r) => ({
            body: r.body,
            at: r.at,
            byName: names.user.get(String(r.by)) ?? null,
          })),
          patientName: f.patient?.name ?? null,
          // So the doctor sees who wrote it, not just their name in grey.
          patientAvatarUrl: f.patient?.avatarAssetId ? `/api/v1/uploads/${f.patient.avatarAssetId}/raw` : null,
          patientPhone: f.patient?.phone ?? null,
        })),
        { page, limit, total },
      ),
      unread,
    });
  }),
);

/**
 * How many this reader has not read — the badge.
 *
 * The same filter as the inbox, so the number on the badge is the number of
 * unread rows the screen it opens will show this person.
 */
router.get(
  '/unread-count',
  requireAuth,
  // The people who read a practice's patient feedback: a role that opens
  // patient records directly, holding VIEW_PATIENT there. See services/feedback.js.
  requireRole(...DIRECT_PATIENT_ACCESS),
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  asyncHandler(async (req, res) => {
    const scope = await practiceInbox(req);
    res.json({ unread: await Feedback.countDocuments({ $and: [scope, { 'readBy.user': { $ne: req.user._id } }] }) });
  }),
);

/**
 * This reader has read it. Nobody else's badge moves.
 *
 * The path is the old one, which marked the row reviewed for the whole
 * practice, so builds that call it keep working and now mean the person
 * pressing the button.
 */
router.post(
  '/:id/reviewed',
  requireAuth,
  // The people who read a practice's patient feedback: a role that opens
  // patient records directly, holding VIEW_PATIENT there. See services/feedback.js.
  requireRole(...DIRECT_PATIENT_ACCESS),
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  audit('update', 'Feedback'),
  asyncHandler(async (req, res) => {
    /*
     * `$and` rather than a spread, though here a spread would work: this filter
     * keys on `_id` and the scope does not. In records.js both halves key on
     * `_id` and the spread silently replaced the requested id with the caller's
     * own patient list — the guard then found somebody else's row and acted on
     * it. The safety of a spread depends on two key names staying different,
     * which is not a property anybody checks when adding a field.
     */
    const scoped = await Feedback.findOne({ $and: [{ _id: req.params.id }, await practiceInbox(req)] })
      .select('_id patient')
      .lean();
    if (!scoped) throw notFound('Feedback not found');
    req.auditResourceId = scoped._id;
    req.patientId = scoped.patient;

    // Conditional on not already being there, so two taps at once add one.
    await Feedback.updateOne(
      { _id: scoped._id, 'readBy.user': { $ne: req.user._id } },
      { $push: { readBy: { user: req.user._id, at: new Date() } } },
    );
    res.status(204).end();
  }),
);

/**
 * Answer it. The patient reads the reply under "Your feedback", and is told.
 *
 * CHAT_REPLY beside VIEW_PATIENT: a reply speaks to the patient as the clinic,
 * and whoever may not answer a patient's messages may not answer this either.
 */
router.post(
  '/:id/reply',
  requireAuth,
  // The people who read a practice's patient feedback: a role that opens
  // patient records directly, holding VIEW_PATIENT there. See services/feedback.js.
  requireRole(...DIRECT_PATIENT_ACCESS),
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  requirePermission(PERMISSIONS.CHAT_REPLY),
  idempotencyKey(),
  validate({ body: z.object({ message: z.string().trim().min(1).max(2000) }) }),
  audit('update', 'Feedback'),
  asyncHandler(async (req, res) => {
    const scoped = await Feedback.findOne({ $and: [{ _id: req.params.id }, await practiceInbox(req)] })
      .select('_id patient practice createdBy')
      .lean();
    if (!scoped) throw notFound('Feedback not found');
    req.auditResourceId = scoped._id;
    req.patientId = scoped.patient;

    const outcome = await addReply(
      scoped._id,
      { body: req.body.message, from: FEEDBACK_ROUTE.PRACTICE, by: req.user._id },
      req.idempotency,
    );
    // Answering it is reading it.
    await Feedback.updateOne(
      { _id: scoped._id, 'readBy.user': { $ne: req.user._id } },
      { $push: { readBy: { user: req.user._id, at: new Date() } } },
    );

    if (outcome === 'added') {
      const practice = await Practice.findById(scoped.practice).select('name').lean();
      notifyPatientOfFeedbackReply(scoped, practice?.name ?? 'Your clinic').catch((err) =>
        logger.warn({ err }, 'feedback reply push failed'),
      );
    }
    res.status(outcome === 'added' ? 201 : 200).json({ ok: true, replayed: outcome === 'replayed' });
  }),
);

function serialise(f) {
  return {
    id: String(f._id),
    about: f.about,
    rating: f.rating ?? null,
    message: f.message ?? '',
    state: f.state ?? FEEDBACK_STATE.OPEN,
    createdAt: f.createdAt,
  };
}

export default router;
