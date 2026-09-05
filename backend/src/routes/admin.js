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
import { generateSecret, verifyTotp, otpauthUri } from '../services/totp.js';
import { completeReset } from '../services/adminReset.js';

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
      // Absent on the first leg. A caller with 2FA enabled is told to send one
      // rather than being refused as though the password were wrong.
      totp: z.string().trim().regex(/^\d{6}$/).optional(),
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
      '+passwordHash +totpSecret',
    );

    // The account-level wall, checked before the password so a locked account
    // costs an attacker a request and tells them nothing. The IP limiter above
    // is the first line and is defeated by rotating addresses, which is cheap;
    // this one spends their budget whatever address they arrive from.
    if (admin?.isLocked()) {
      await AdminAuditLog.record({ admin, action: 'admin.login.locked', req });
      throw unauthorized('Too many attempts. Try again in a few minutes.');
    }

    // One message for every failure. Saying "no such account", or "wrong code"
    // rather than "wrong password", tells whoever is guessing which half of the
    // pair to keep working on.
    const REFUSED = 'Those details do not match an account.';

    const passwordOk = admin && (await admin.checkPassword(req.body.password));
    if (!passwordOk) {
      // Counted only when the account exists. Incrementing on a guessed email
      // would let anybody lock out an administrator they could name.
      if (admin) {
        await admin.noteFailure();
        await AdminAuditLog.record({ admin, action: 'admin.login.failed', req });
      }
      throw unauthorized(REFUSED);
    }

    if (admin.totpEnabled) {
      if (!req.body.totp) {
        // Not a failure — the password was right. Told apart so the panel can
        // ask for the code instead of clearing the form and starting over.
        return res.status(401).json({
          error: { code: 'TOTP_REQUIRED', message: 'Enter the code from your authenticator app.' },
        });
      }
      if (!verifyTotp(admin.totpSecret, req.body.totp)) {
        await admin.noteFailure();
        await AdminAuditLog.record({ admin, action: 'admin.login.failed_totp', req });
        throw unauthorized(REFUSED);
      }
    }

    await admin.noteSuccess();
    await AdminAuditLog.record({ admin, action: 'admin.login', req });

    res.json({
      token: signAdminToken(admin),
      admin: admin.toPublic(),
      // Surfaced so the panel can nag. An administrator without a second factor
      // on the account that can suspend every practice should be reminded every
      // time they sign in.
      totpEnabled: admin.totpEnabled,
    });
  }),
);

/**
 * Spend a reset token and choose a new password.
 *
 * Unauthenticated by necessity — the whole point is that the caller cannot sign
 * in. Rate-limited like the login for the same reason, and the token is
 * compared in constant time.
 *
 * Two-factor still applies. A reset that skipped it would make the second
 * factor decorative: anyone holding a leaked token would be past it.
 */
router.post(
  '/auth/reset',
  loginLimiter,
  validate({
    body: z.object({
      email: z.string().trim().toLowerCase().email(),
      token: z.string().min(20).max(200),
      newPassword: z.string().min(12).max(200),
      totp: z.string().trim().regex(/^\d{6}$/).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!process.env.ADMIN_JWT_SECRET) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }

    await completeReset({ ...req.body, verifyTotp });

    // Deliberately no token in the response. Choosing a new password is not
    // signing in, and handing back a session would let a stolen reset skip the
    // login it just re-enabled.
    res.json({ ok: true });
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
 * Begin enrolling a second factor.
 *
 * Returns a secret and stores it, but does not switch the factor on. Enrolment
 * completes only once a code from the app has been verified — a secret written
 * to the account without that step locks an operator out of their own panel the
 * moment they mistype it into the authenticator.
 */
router.post(
  '/me/totp/setup',
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id);
    if (!admin) throw notFound('Account not found');

    if (admin.totpEnabled) {
      throw badRequest('Two-factor is already on. Turn it off before setting it up again.');
    }

    const secret = generateSecret();
    admin.totpSecret = secret;
    admin.totpEnabled = false;
    await admin.save();

    await AdminAuditLog.record({ admin: req.admin, action: 'admin.totp.setup_started', req });

    // The secret is returned exactly once, here, so it can be shown as a QR
    // code. It is never selected by a later read.
    res.json({ secret, otpauth: otpauthUri({ secret, email: admin.email }) });
  }),
);

/** Prove the app works, and switch the factor on. */
router.post(
  '/me/totp/enable',
  validate({ body: z.object({ totp: z.string().trim().regex(/^\d{6}$/) }) }),
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id).select('+totpSecret');
    if (!admin?.totpSecret) throw badRequest('Start the setup first.');

    if (!verifyTotp(admin.totpSecret, req.body.totp)) {
      throw badRequest('That code is not right. Check your app’s clock and try again.');
    }

    admin.totpEnabled = true;
    await admin.save();
    await AdminAuditLog.record({ admin: req.admin, action: 'admin.totp.enabled', req });

    res.json({ totpEnabled: true });
  }),
);

/**
 * Turn it off — which requires a current code, not just a session.
 *
 * A session alone would mean a stolen token can remove the factor protecting
 * the account, which is the same as not having one.
 */
router.post(
  '/me/totp/disable',
  validate({ body: z.object({ totp: z.string().trim().regex(/^\d{6}$/) }) }),
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id).select('+totpSecret');
    if (!admin?.totpEnabled) return res.json({ totpEnabled: false });

    if (!verifyTotp(admin.totpSecret, req.body.totp)) throw badRequest('That code is not right.');

    admin.totpEnabled = false;
    admin.totpSecret = null;
    await admin.save();
    await AdminAuditLog.record({ admin: req.admin, action: 'admin.totp.disabled', req });

    res.json({ totpEnabled: false });
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
      // Nothing existed before this. `null` rather than `{}`, so a reader can
      // tell "created" from "changed, but the diff was not recorded".
      before: null,
      after: {
        name: practice.name,
        status: practice.status,
        verification: practice.verification,
      },
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

    // Read before the write. Captured after, "changed to verified" is all the
    // log can say, and the question asked later is always what it used to be.
    const before = { verification: practice.verification };

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
      before,
      after: { verification: practice.verification },
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

    const before = { status: practice.status };

    practice.status = req.body.status;
    await practice.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: `admin.practice.status.${req.body.status}`,
      resource: 'Practice',
      resourceId: practice._id,
      practice: practice._id,
      reason: req.body.reason ?? null,
      before,
      after: { status: practice.status },
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
        before: r.before ?? null,
        after: r.after ?? null,
        at: r.at,
      })),
    });
  }),
);

export default router;
