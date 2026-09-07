import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { requireAdmin } from '../middleware/requireAdmin.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, unauthorized, notFound, badRequest } from '../middleware/errors.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { Practice, PRACTICE_STATUS, VERIFICATION, PLAN } from '../models/Practice.js';
import { Clinic } from '../models/Clinic.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../models/Membership.js';
import { Department } from '../models/Department.js';
import {
  activePatientCount,
  everPatientCount,
  platformPatientCount,
} from '../services/practiceUsage.js';
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
      action: z.string().trim().max(80).optional(),
      admin: z.string().trim().max(160).optional(),
      /// An ISO timestamp from the previous page's last row. A cursor rather
      /// than an offset because the log grows while it is being read, and
      /// `skip` would show the same row twice or miss one entirely.
      before: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { practice, action, admin, before, limit } = q(req);

    const filter = {
      ...(practice ? { practice } : {}),
      // A prefix, so "admin.practice" finds every practice action without the
      // operator having to know the full name of each one.
      ...(action ? { action: new RegExp('^' + action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) } : {}),
      ...(admin ? { adminEmail: admin } : {}),
      ...(before ? { at: { $lt: before } } : {}),
    };

    // One more than asked for: whether a next page exists is a fact about the
    // data, and computing it from a count would be a second query racing the
    // first.
    const rows = await AdminAuditLog.find(filter)
      .sort({ at: -1 })
      .limit(limit + 1)
      .lean();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    res.json({
      hasMore,
      nextBefore: hasMore ? page[page.length - 1].at : null,
      items: page.map((r) => ({
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

/**
 * Which actions actually appear in the log, for the filter to offer.
 *
 * Read from the data rather than hard-coded. A list typed out by hand goes
 * stale the first time somebody adds a route, and a filter offering an action
 * that never happens is worse than no filter.
 */
router.get(
  '/audit/actions',
  asyncHandler(async (req, res) => {
    const [actions, admins] = await Promise.all([
      AdminAuditLog.distinct('action'),
      AdminAuditLog.distinct('adminEmail'),
    ]);
    res.json({ actions: actions.sort(), admins: admins.filter(Boolean).sort() });
  }),
);

// ---------------------------------------------------------------------------
// One practice, in full
// ---------------------------------------------------------------------------

/**
 * Everything about a practice except what happens inside it.
 *
 * Locations, departments and staff by name and role; patients only ever as a
 * number. That line is the whole reason this panel is separate from the clinic
 * app, and it is easiest to cross here — the detail screen is exactly where
 * "just show me the patient list" feels reasonable.
 */
router.get(
  '/practices/:id',
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    const [locations, departments, memberships, patients, activePatients] = await Promise.all([
      Clinic.find({ practice: practice._id }).select('name city addressLine phone').lean(),
      Department.find({ practice: practice._id }).select('key names isActive assistantScope').lean(),
      Membership.find({ practice: practice._id })
        .sort({ isOwner: -1, startedOn: 1 })
        .populate('user', 'name phone role isActive')
        .lean(),
      // Through a service that can only return integers. This route must not
      // hold a model that names a patient — see practiceUsage.js.
      everPatientCount(practice._id),
      activePatientCount(practice._id),
    ]);

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.practice.read',
      practice: practice._id,
      req,
    });

    res.json({
      practice: practice.toPublic(),
      isFounding: Boolean(practice.isFounding),
      notes: practice.notes ?? '',
      usage: {
        patients: activePatients,
        patientsEver: patients,
        staff: memberships.filter((m) => m.status === MEMBERSHIP_STATUS.ACTIVE && !m.endedOn).length,
        locations: locations.length,
        departments: departments.filter((d) => d.isActive).length,
      },
      locations: locations.map((c) => ({
        id: String(c._id),
        name: c.name,
        city: c.city ?? null,
        addressLine: c.addressLine ?? null,
        phone: c.phone ?? null,
      })),
      departments: departments.map((d) => ({
        id: String(d._id),
        key: d.key,
        name: d.names?.en ?? d.key,
        isActive: d.isActive,
        // Whether this department has its own assistant, which is a question
        // the operator gets asked and currently cannot answer.
        hasAssistant: Boolean(d.assistantScope),
      })),
      members: memberships.map((m) => ({
        id: String(m._id),
        name: m.user?.name ?? 'Unknown',
        phone: m.user?.phone ?? null,
        role: m.role,
        isOwner: Boolean(m.isOwner),
        status: m.status,
        endedOn: m.endedOn ?? null,
        loginActive: m.user?.isActive !== false,
        permissions: m.permissions?.length ? m.permissions : presetFor({ role: m.role, isOwner: m.isOwner }),
        // Said out loud, because an empty grant falling back to the preset is
        // the single most surprising thing about this model.
        usingPreset: !m.permissions?.length,
        startedOn: m.startedOn,
      })),
    });
  }),
);

/** Correct the details on the letterhead. */
router.patch(
  '/practices/:id',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160).optional(),
      tagline: z.string().trim().max(160).optional(),
      doctorDisplayName: z.string().trim().max(160).optional(),
      registrationNo: z.string().trim().max(60).optional(),
      notes: z.string().trim().max(2000).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    const fields = ['name', 'tagline', 'doctorDisplayName', 'registrationNo', 'notes'];
    const before = {};
    const after = {};
    for (const f of fields) {
      if (req.body[f] === undefined || req.body[f] === practice[f]) continue;
      before[f] = practice[f] ?? null;
      after[f] = req.body[f];
      practice[f] = req.body[f];
    }
    if (!Object.keys(after).length) return res.json({ practice: practice.toPublic() });

    await practice.save();
    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.practice.edit',
      practice: practice._id,
      before,
      after,
      req,
    });

    res.json({ practice: practice.toPublic() });
  }),
);

/**
 * The commercial arrangement.
 *
 * A limit of `null` is unlimited, and that is what every practice has until
 * somebody types a number. The founding clinic in particular must stay that
 * way: it predates the idea of plans and has never agreed to one.
 */
router.patch(
  '/practices/:id/plan',
  validate({
    body: z.object({
      plan: z.enum(Object.values(PLAN)).optional(),
      limits: z
        .object({
          patients: z.number().int().min(0).nullable().optional(),
          staff: z.number().int().min(0).nullable().optional(),
          locations: z.number().int().min(0).nullable().optional(),
        })
        .optional(),
      planRenewsOn: z.coerce.date().nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    const before = {
      plan: practice.plan,
      patients: practice.limits?.patients ?? null,
      staff: practice.limits?.staff ?? null,
      locations: practice.limits?.locations ?? null,
      planRenewsOn: practice.planRenewsOn ?? null,
    };

    if (req.body.plan) practice.plan = req.body.plan;
    if (req.body.planRenewsOn !== undefined) practice.planRenewsOn = req.body.planRenewsOn;
    for (const k of ['patients', 'staff', 'locations']) {
      if (req.body.limits?.[k] !== undefined) practice.limits[k] = req.body.limits[k];
    }

    // A limit below what the practice already has is not refused. They are over
    // it as of now, the panel says so, and nothing retroactively deletes a
    // patient — a cap is a brake on growth, not a shredder.
    await practice.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.practice.plan',
      practice: practice._id,
      before,
      after: {
        plan: practice.plan,
        patients: practice.limits?.patients ?? null,
        staff: practice.limits?.staff ?? null,
        locations: practice.limits?.locations ?? null,
        planRenewsOn: practice.planRenewsOn ?? null,
      },
      reason: req.body.reason,
      req,
    });

    res.json({ practice: practice.toPublic() });
  }),
);

/**
 * Change what one member of staff may do, or end their membership.
 *
 * Not creating one: a person joins a practice through the clinic's own invite
 * flow, where the phone number is verified and somebody at the practice
 * vouches for them. An administrator conjuring staff into a clinic they do not
 * work at is a different and much worse power than adjusting the permissions of
 * somebody already there.
 */
router.patch(
  '/practices/:id/members/:membershipId',
  validate({
    body: z.object({
      permissions: z.array(z.enum(Object.values(PERMISSIONS))).max(20).optional(),
      status: z.enum(Object.values(MEMBERSHIP_STATUS)).optional(),
      reason: z.string().trim().min(3).max(500).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const membership = await Membership.findOne({
      _id: req.params.membershipId,
      practice: req.params.id,
    });
    if (!membership) throw notFound('Membership not found');

    const before = { permissions: membership.permissions ?? [], status: membership.status };

    if (req.body.permissions) membership.permissions = req.body.permissions;

    if (req.body.status && req.body.status !== membership.status) {
      if (!req.body.reason) {
        throw badRequest('Ending or restoring a membership needs a reason.');
      }
      membership.status = req.body.status;
      // `endedOn` is what `currentFilter` actually reads, so leaving it unset
      // would change the label and nothing else.
      membership.endedOn = req.body.status === MEMBERSHIP_STATUS.ACTIVE ? null : new Date();
    }

    await membership.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.member.update',
      practice: membership.practice,
      before,
      after: { permissions: membership.permissions, status: membership.status },
      reason: req.body.reason,
      req,
    });

    res.json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// The platform as a whole
// ---------------------------------------------------------------------------

/**
 * What the operator sees on opening the panel: how much is waiting, and how
 * much exists.
 *
 * Counts across every practice. This is the one place aggregate patient numbers
 * appear, and they are totals — never a list, never a name.
 */
router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const weekAgo = new Date(Date.now() - 7 * 86_400_000);

    const [byStatus, byVerification, byPlan, patients, newPractices, staff, admins] =
      await Promise.all([
        Practice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
        Practice.aggregate([{ $group: { _id: '$verification', count: { $sum: 1 } } }]),
        Practice.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]),
        platformPatientCount(),
        Practice.countDocuments({ createdAt: { $gte: weekAgo } }),
        Membership.countDocuments({ status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null }),
        PlatformAdmin.countDocuments({ isActive: true }),
      ]);

    const tally = (rows) => Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.count]));

    res.json({
      practices: tally(byStatus),
      verification: tally(byVerification),
      plans: tally(byPlan),
      activeEnrolments: patients,
      staff,
      admins,
      newPracticesThisWeek: newPractices,
    });
  }),
);

// ---------------------------------------------------------------------------
// Other administrators
// ---------------------------------------------------------------------------

/**
 * Who else can do all this.
 *
 * A short list that nobody looks at until something has gone wrong, at which
 * point it is the first question. It shows whether each account has a second
 * factor, because "who can suspend a practice with a password alone" is the
 * useful form of the question.
 */
router.get(
  '/admins',
  asyncHandler(async (req, res) => {
    const rows = await PlatformAdmin.find({}).sort({ createdAt: 1 }).lean();
    res.json({
      items: rows.map((a) => ({
        ...PlatformAdmin.hydrate(a).toPublic(),
        isSelf: String(a._id) === String(req.admin._id),
        createdAt: a.createdAt,
      })),
    });
  }),
);

router.post(
  '/admins',
  validate({
    body: z.object({
      email: z.string().trim().toLowerCase().email(),
      name: z.string().trim().min(2).max(120),
      password: z.string().min(12).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    const existing = await PlatformAdmin.findOne({ email: req.body.email });
    if (existing) throw badRequest('An administrator with that email already exists.');

    const created = await PlatformAdmin.create({
      email: req.body.email,
      name: req.body.name,
      passwordHash: await PlatformAdmin.hashPassword(req.body.password),
      isActive: true,
    });

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.admin.create',
      after: { email: created.email, name: created.name },
      req,
    });

    // The new account has no second factor yet, and the panel says so rather
    // than leaving it to be discovered.
    res.status(201).json({ admin: created.toPublic() });
  }),
);

/**
 * Deactivate or restore another administrator.
 *
 * Not your own account, ever. An operator who deactivates themselves has locked
 * the last door from the inside, and the way back is a shell on the server —
 * which is exactly the situation the reset flow exists to avoid needing.
 */
router.patch(
  '/admins/:id',
  validate({
    body: z.object({
      isActive: z.boolean(),
      reason: z.string().trim().min(3).max(500),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (String(req.params.id) === String(req.admin._id)) {
      throw badRequest('You cannot deactivate your own account.');
    }

    const target = await PlatformAdmin.findById(req.params.id);
    if (!target) throw notFound('Administrator not found');

    const before = { isActive: target.isActive };
    target.isActive = req.body.isActive;
    // A deactivated account keeps its second factor. Restoring it should not
    // quietly hand back an account protected by a password alone.
    await target.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.admin.update',
      before,
      after: { isActive: target.isActive, email: target.email },
      reason: req.body.reason,
      req,
    });

    res.json({ admin: target.toPublic() });
  }),
);

export default router;
