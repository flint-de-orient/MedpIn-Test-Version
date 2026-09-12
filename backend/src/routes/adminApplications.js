import { Router } from 'express';
import { z } from 'zod';

import { validate, q } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound, conflict } from '../middleware/errors.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { Practice } from '../models/Practice.js';
import {
  PracticeApplication,
  APPLICATION_STATUS,
  OPEN_STATUSES,
} from '../models/PracticeApplication.js';
import { provisionPractice } from '../services/provisionPractice.js';

/**
 * The queue of practices asking to exist.
 *
 * Mounted inside admin.js, behind `requireAdmin`, exactly as the billing
 * surface is — so there is one guard rather than one per file and no route
 * here can be reached without an operator session.
 *
 * ---- Approving is the only thing that creates anything ------------------
 *
 * Everything else moves a status and writes a note. Approve calls
 * [services/provisionPractice.js], which is the same path an operator uses to
 * create a practice by hand: the licence-clash check, the practice row, the
 * head doctor attached immediately, and the compensating delete if that fails.
 *
 * A second implementation here would be how one route forgets the head doctor.
 */
const router = Router();

/**
 * A reason, on every decision.
 *
 * Approve included. "Approved" with nothing beside it is a decision nobody can
 * review six months later, and the applicant reads the note on a rejection or
 * a request for more information — so it is the one field this surface refuses
 * to default.
 */
const decision = z.object({ note: z.string().trim().min(3).max(1000) });

/** Nothing here is ever deleted; the queue is filtered instead. */
router.get(
  '/applications',
  validate({
    query: z.object({
      status: z.enum(Object.values(APPLICATION_STATUS)).optional(),
      /// "Everything still open", which is what an operator actually wants and
      /// is three statuses rather than one.
      open: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { status, open, limit } = q(req);

    const filter = status
      ? { status }
      : open
        ? { status: { $in: OPEN_STATUSES } }
        : {};

    const [rows, byStatus] = await Promise.all([
      PracticeApplication.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      // Unfiltered, for the same reason the billing chips are: counting within
      // the current filter shows the selected one's total beside every other
      // reading zero, which looks like an answer.
      PracticeApplication.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

    const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    counts.all = byStatus.reduce((sum, r) => sum + r.n, 0);
    counts.open = OPEN_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

    res.json({
      counts,
      items: rows.map((r) => ({
        id: String(r._id),
        reference: r.reference,
        status: r.status,
        practiceName: r.practiceName,
        practiceType: r.practiceType,
        specialty: r.specialty,
        city: r.city,
        state: r.state,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        // Whether the decision this review produces will actually arrive.
        contactEmailVerified: Boolean(r.contactEmailVerifiedAt),
        contactPhone: r.contactPhone,
        reviewer: r.reviewerEmail,
        submittedOn: r.createdAt,
        practice: r.practice ? String(r.practice) : null,
      })),
    });
  }),
);

router.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const a = await PracticeApplication.findById(req.params.id).lean();
    if (!a) throw notFound('Application not found');

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.read',
      resource: 'PracticeApplication',
      resourceId: a._id,
      req,
    });

    res.json({ application: full(a) });
  }),
);

/**
 * "I am looking at this one."
 *
 * Advisory, not a lock. It stops two operators reviewing the same application
 * at the same time and does not stop a third from deciding — a hard lock on a
 * queue this size would mostly be a thing somebody has to release after going
 * home.
 */
router.post(
  '/applications/:id/claim',
  asyncHandler(async (req, res) => {
    const a = await PracticeApplication.findById(req.params.id);
    if (!a) throw notFound('Application not found');
    if (!OPEN_STATUSES.includes(a.status)) {
      throw conflict('That application has already been decided.');
    }

    a.reviewer = req.admin._id;
    a.reviewerEmail = req.admin.email;
    if (a.status === APPLICATION_STATUS.SUBMITTED) {
      a.status = APPLICATION_STATUS.UNDER_REVIEW;
    }
    a.history.push({
      action: 'opened',
      admin: req.admin._id,
      adminEmail: req.admin.email,
      note: null,
    });
    await a.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.claim',
      resource: 'PracticeApplication',
      resourceId: a._id,
      req,
    });

    res.json({ application: full(a.toObject()) });
  }),
);

/**
 * Send it back with a question.
 *
 * The note reaches the applicant — it is the only thing that does — so the
 * validator requires it and the copy on the console says who reads it.
 */
router.post(
  '/applications/:id/request-info',
  validate({ body: decision }),
  asyncHandler(async (req, res) => {
    const a = await open(req.params.id);

    a.status = APPLICATION_STATUS.MORE_INFO;
    a.history.push({
      action: 'more_info',
      admin: req.admin._id,
      adminEmail: req.admin.email,
      note: req.body.note,
    });
    await a.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.more_info',
      resource: 'PracticeApplication',
      resourceId: a._id,
      reason: req.body.note,
      req,
    });

    res.json({ application: full(a.toObject()) });
  }),
);

router.post(
  '/applications/:id/reject',
  validate({ body: decision }),
  asyncHandler(async (req, res) => {
    const a = await open(req.params.id);

    a.status = APPLICATION_STATUS.REJECTED;
    a.history.push({
      action: 'rejected',
      admin: req.admin._id,
      adminEmail: req.admin.email,
      note: req.body.note,
    });
    await a.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.reject',
      resource: 'PracticeApplication',
      resourceId: a._id,
      reason: req.body.note,
      req,
    });

    res.json({ application: full(a.toObject()) });
  }),
);

/**
 * Approve, and the practice exists.
 *
 * ---- Why approval provisions in the same request ------------------------
 *
 * The alternative is an "approved" application an operator then has to go and
 * turn into a practice, which is the same shape as "I will add the doctor
 * next" — a second step that does not reliably happen, leaving an applicant
 * told they were approved and a platform with nothing to show for it.
 *
 * The head doctor's phone is the one the applicant proved when they submitted.
 * It has been theirs since before the application existed, and taking a fresh
 * number here would be accepting an unverified one at the moment it matters
 * most.
 */
router.post(
  '/applications/:id/approve',
  validate({
    body: z.object({
      note: z.string().trim().min(3).max(1000),
      /**
       * The name to put on the letterhead, if the applicant's differs.
       *
       * An operator reading papers often has the doctor's name in a fuller
       * form than a web form collected. Optional; the application's own is
       * used otherwise.
       */
      headDoctorName: z.string().trim().min(2).max(120).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const a = await open(req.params.id);

    const headDoctorName = req.body.headDoctorName ?? a.doctorName ?? a.contactName;

    const { practice } = await provisionPractice({
      brand: {
        name: a.practiceName,
        practiceType: a.practiceType ?? undefined,
        specialty: a.specialty ?? undefined,
        registrationNo: a.registrationNo ?? undefined,
      },
      headDoctorName,
      headDoctorPhone: a.contactPhone,
      headDoctorRegistrationNo: a.doctorRegistrationNo ?? null,
      // What they said they run. Already filtered to the shared catalogue and
      // to types that can have them, on the way in.
      departments: a.departments ?? [],
    });

    a.status = APPLICATION_STATUS.APPROVED;
    a.practice = practice._id;
    a.history.push({
      action: 'approved',
      admin: req.admin._id,
      adminEmail: req.admin.email,
      note: req.body.note,
    });
    await a.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.approve',
      resource: 'PracticeApplication',
      resourceId: a._id,
      // Both rows, so the trail reads from either end: the application that
      // was approved, and the practice that resulted.
      practice: practice._id,
      reason: req.body.note,
      before: null,
      after: { practice: String(practice._id), name: practice.name },
      req,
    });

    res.json({
      application: full(a.toObject()),
      practice: practice.toPublic(),
    });
  }),
);

/** The row, if it can still be acted on. */
async function open(id) {
  const a = await PracticeApplication.findById(id);
  if (!a) throw notFound('Application not found');
  if (!OPEN_STATUSES.includes(a.status)) {
    throw badRequest('That application has already been decided.');
  }
  return a;
}

/**
 * Everything an operator may see, which is everything the applicant sent.
 *
 * No clinical data exists on an application by construction — it is a form
 * about an organisation, filled in before any patient could be attached to it.
 */
function full(a) {
  return {
    id: String(a._id),
    reference: a.reference,
    status: a.status,

    practiceName: a.practiceName,
    practiceType: a.practiceType,
    specialty: a.specialty,
    addressLine: a.addressLine,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,

    contactName: a.contactName,
    contactEmail: a.contactEmail,
    contactEmailVerified: Boolean(a.contactEmailVerifiedAt),
    // What they say they run, and which of it the named doctor does. Empty on
    // a clinic, which cannot have departments on any plan.
    departments: a.departments ?? [],
    doctorDepartment: a.doctorDepartment ?? null,
    contactPhone: a.contactPhone,
    phoneVerifiedAt: a.phoneVerifiedAt,

    registrationNo: a.registrationNo,
    doctorName: a.doctorName,
    doctorRegistrationNo: a.doctorRegistrationNo,
    notes: a.notes,

    reviewer: a.reviewerEmail,
    practice: a.practice ? String(a.practice) : null,
    submittedOn: a.createdAt,
    history: (a.history ?? []).map((h) => ({
      action: h.action,
      by: h.adminEmail,
      note: h.note,
      at: h.at,
    })),
  };
}

export default router;
