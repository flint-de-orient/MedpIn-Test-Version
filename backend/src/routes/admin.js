import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, unauthorized, notFound, badRequest } from '../middleware/errors.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../models/Practice.js';
import { Clinic } from '../models/Clinic.js';
import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { signAdminToken, secretsAreSeparate } from '../services/adminTokens.js';

/**
 * The platform's own surface: create a practice, verify it, activate, suspend.
 *
 * ---- What is deliberately absent -----------------------------------------
 *
 * Every clinical route. There is no patient here, no prescription, no chat, no
 * enrollment. An administrator can bring a practice into existence and take it
 * out again; they cannot read what happens inside one.
 *
 * That is the whole point of the separation. Verifying a registration number is
 * a statement that a doctor is who they say they are. It is not, and must never
 * become, a key to their patients' records.
 *
 * ---- Suspension stops the practice, not the patient ---------------------
 *
 * A suspended practice's staff cannot log in. Its patients keep their records,
 * their prescriptions and their dose reminders — a suspension that silenced a
 * diabetic's insulin alarm would punish the person who did nothing wrong.
 */
const router = Router();

/** The one unauthenticated route here, and the one worth brute-forcing. */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again shortly.' } },
});

router.post(
  '/auth/login',
  loginLimiter,
  validate({
    body: z.object({
      email: z.string().trim().toLowerCase().email(),
      password: z.string().min(8).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!process.env.ADMIN_JWT_SECRET) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    if (!secretsAreSeparate()) {
      throw badRequest('The admin panel is misconfigured. See ADMIN_JWT_SECRET.');
    }

    const admin = await PlatformAdmin.findOne({ email: req.body.email, isActive: true }).select(
      '+passwordHash',
    );

    // One message for both cases. Saying "no such account" tells whoever is
    // guessing which half of the pair to keep trying.
    const ok = admin && (await admin.checkPassword(req.body.password));
    if (!ok) throw unauthorized('Those details do not match an account.');

    admin.lastLoginAt = new Date();
    await admin.save();

    await AdminAuditLog.record({ admin, action: 'admin.login', req });

    res.json({ token: signAdminToken(admin), admin: admin.toPublic() });
  }),
);

// Everything below needs an admin session.
router.use(requireAdmin);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ admin: PlatformAdmin.hydrate(req.admin).toPublic() });
  }),
);

/**
 * Every practice on the platform.
 *
 * Logged, including this read. An administrator listing every practice is doing
 * something worth a record — "who looked" is the half of an audit trail usually
 * missing.
 */
router.get(
  '/practices',
  validate({
    query: z.object({
      status: z.enum(Object.values(PRACTICE_STATUS)).optional(),
      verification: z.enum(Object.values(VERIFICATION)).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { status, verification } = q(req);
    const filter = {
      ...(status ? { status } : {}),
      ...(verification ? { verification } : {}),
    };

    const practices = await Practice.find(filter).sort({ createdAt: -1 }).lean();
    const ids = practices.map((p) => p._id);

    // Counts, never contents. How many patients a practice has is a number the
    // platform needs for billing and support; who they are is not.
    const [locations, members] = await Promise.all([
      Clinic.aggregate([
        { $match: { practice: { $in: ids } } },
        { $group: { _id: '$practice', count: { $sum: 1 } } },
      ]),
      Membership.aggregate([
        { $match: { practice: { $in: ids }, status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null } },
        { $group: { _id: '$practice', count: { $sum: 1 } } },
      ]),
    ]);
    const countOf = (rows, id) => rows.find((r) => String(r._id) === String(id))?.count ?? 0;

    await AdminAuditLog.record({ admin: req.admin, action: 'admin.practices.list', req });

    res.json({
      items: practices.map((p) => ({
        ...Practice.hydrate(p).toPublic(),
        locations: countOf(locations, p._id),
        staff: countOf(members, p._id),
      })),
    });
  }),
);

/**
 * Bring a practice into existence.
 *
 * Onboarding phase one: you create it by hand, which is correct while the
 * number is small. It arrives PENDING and unverified — creating a practice is
 * not vouching for it.
 */
router.post(
  '/practices',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160),
      registrationNo: z.string().trim().max(60).optional(),
      doctorDisplayName: z.string().trim().max(160).optional(),
      tagline: z.string().trim().max(160).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.create({
      ...req.body,
      status: PRACTICE_STATUS.ONBOARDING,
      verification: VERIFICATION.UNVERIFIED,
    });

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.practice.create',
      resource: 'Practice',
      resourceId: practice._id,
      practice: practice._id,
      req,
    });

    res.status(201).json({ practice: practice.toPublic() });
  }),
);

/**
 * Record that the registration has been checked, or refused.
 *
 * Verification and access stay separate fields, and this route only touches the
 * first. A verified practice has been checked; it has not been handed anybody's
 * records, and the day those two collapse into one flag is the day checking
 * papers starts granting access to patients.
 */
router.post(
  '/practices/:id/verification',
  validate({
    body: z.object({
      verification: z.enum([VERIFICATION.VERIFIED, VERIFICATION.PENDING, VERIFICATION.REJECTED]),
      reason: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    // A rejection has to say why. "Rejected" with no reason is a decision
    // nobody can review and the applicant cannot answer.
    if (req.body.verification === VERIFICATION.REJECTED && !req.body.reason) {
      throw badRequest('A rejection needs a reason.');
    }

    practice.verification = req.body.verification;
    practice.verifiedAt = req.body.verification === VERIFICATION.VERIFIED ? new Date() : null;
    await practice.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: `admin.practice.${req.body.verification}`,
      resource: 'Practice',
      resourceId: practice._id,
      practice: practice._id,
      reason: req.body.reason ?? null,
      req,
    });

    res.json({ practice: practice.toPublic() });
  }),
);

/**
 * Let a practice work, or stop it.
 *
 * Separate from verification on purpose — see the note above. A practice can be
 * active and unverified, which is the honest state of one that is working while
 * its papers are read.
 */
router.post(
  '/practices/:id/status',
  validate({
    body: z.object({
      status: z.enum(Object.values(PRACTICE_STATUS)),
      reason: z.string().trim().max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    // Suspending a practice stops people working. It should not be possible to
    // do silently, and the reason is what a review reads six months later.
    if (req.body.status === PRACTICE_STATUS.SUSPENDED && !req.body.reason) {
      throw badRequest('A suspension needs a reason.');
    }

    practice.status = req.body.status;
    await practice.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: `admin.practice.status.${req.body.status}`,
      resource: 'Practice',
      resourceId: practice._id,
      practice: practice._id,
      reason: req.body.reason ?? null,
      req,
    });

    res.json({ practice: practice.toPublic() });
  }),
);

/** Everything done to one practice, or by everyone, newest first. */
router.get(
  '/audit',
  validate({
    query: z.object({
      practice: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { practice, limit } = q(req);
    const rows = await AdminAuditLog.find(practice ? { practice } : {})
      .sort({ at: -1 })
      .limit(limit)
      .lean();

    res.json({
      items: rows.map((r) => ({
        id: String(r._id),
        admin: r.adminEmail,
        action: r.action,
        practice: r.practice ? String(r.practice) : null,
        reason: r.reason ?? null,
        at: r.at,
      })),
    });
  }),
);

export default router;
