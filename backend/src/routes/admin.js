import { Router } from 'express';
import { readiness } from '../config/readiness.js';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { requireAdmin } from '../middleware/requireAdmin.js';
import adminBillingRoutes from './adminBilling.js';
import adminApplicationRoutes from './adminApplications.js';
import adminFeedbackRoutes from './adminFeedback.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, unauthorized, notFound, badRequest, conflict } from '../middleware/errors.js';
import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import {
  Practice,
  PRACTICE_STATUS,
  VERIFICATION,
  PLAN,
  PRACTICE_TYPE,
  PRACTICE_TYPE_ORDER,
  RESPONSIBLE_LABEL,
  defaultLimitsFor,
} from '../models/Practice.js';
import { Clinic } from '../models/Clinic.js';
import { PracticeApplication, APPLICATION_STATUS } from '../models/PracticeApplication.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../models/Subscription.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../models/Membership.js';
import { Department } from '../models/Department.js';
import { explainCapabilities, BY_TYPE, CAPABILITIES } from '../services/capabilities.js';
import {
  activePatientCount,
  everPatientCount,
  platformPatientCount,
  enrolmentMovement,
  enrolmentCumulative,
} from '../services/practiceUsage.js';
import { signAdminToken, verifyAdminToken, secretsAreSeparate } from '../services/adminTokens.js';
import {
  setSessionCookies,
  clearSessionCookies,
  newCsrfToken,
  cookiesFrom,
  COOKIE_NAMES,
} from '../services/adminSession.js';
import { generateSecret, verifyTotp, otpauthUri } from '../services/totp.js';
import {
  completeReset,
  requestResetByEmail,
  sendEmailVerification,
  completeEmailVerification,
} from '../services/adminReset.js';
import { mailConfigured, sendMail, practiceReadyEmail } from '../services/mailer.js';
import { notifyOwnerOfNewPractice } from '../services/notifications.js';
import { logger } from '../config/logger.js';
import { joinByPhone, membersOf } from '../services/memberships.js';
import { provisionPractice } from '../services/provisionPractice.js';
import { prefixAvailability, PREFIX_REFUSAL } from '../services/prescriptionPrefix.js';
import { forgetClinicIdentity } from '../services/clinicIdentity.js';
import { requestOtp, verifyOtp, signPhoneToken, phoneFromToken } from '../services/otp.js';
import { toE164 } from '../utils/phone.js';
import { ROLES } from '../models/User.js';
import {
  registrationOptions,
  verifyRegistration,
  authenticationOptions,
  verifyAuthentication,
  CHALLENGE_MS,
} from '../services/passkeys.js';

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
 * A suspended practice's staff are refused every route in it with
 * PRACTICE_SUSPENDED (middleware/practiceStatus.js); they can sign in only to
 * see that it is suspended. Its patients keep their records, their
 * prescriptions and their dose reminders — a suspension that silenced a
 * diabetic's insulin alarm would punish the person who did nothing wrong.
 */
const router = Router();

/**
 * The one thing a refused sign-in ever says.
 *
 * Saying "no such account", or "wrong code" rather than "wrong password", tells
 * whoever is guessing which half of the pair to keep working on. Defined once
 * so a second way in cannot arrive with a second wording — which is exactly
 * what happened when the passkey route was added and declared its own copy.
 */
const REFUSED = 'Those details do not match an account.';

/**
 * Where the console lives, for the links in emails.
 *
 * Configured, never derived from the request. A link built from a forged Host
 * header points at somebody else's server, arrives looking exactly like the
 * real one, and collects the password it asks for.
 */
function consoleUrl() {
  const url = process.env.ADMIN_CONSOLE_URL;
  if (!url) {
    throw badRequest(
      'This server cannot send a reset link: ADMIN_CONSOLE_URL is not set. ' +
        'Use scripts/resetAdmin.js instead.',
    );
  }
  return url;
}

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

    /**
     * The second factor, whichever kind this account has.
     *
     * A passkey is offered first when one is registered, because it is both
     * easier and stronger: nothing to install, nothing to type, and the
     * signature is bound to the origin so a convincing fake login page cannot
     * obtain one. A code can be forwarded to the real site inside its thirty
     * seconds, which is the attack every TOTP deployment is exposed to.
     */
    if ((admin.passkeys ?? []).length > 0) {
      const options = await authenticationOptions(req, admin);
      admin.passkeyChallenge = options.challenge;
      admin.passkeyChallengeExpiresAt = new Date(Date.now() + CHALLENGE_MS);
      await admin.save();

      // 401 with a code, like TOTP_REQUIRED: the password was right and the
      // ceremony is the next step, not a failure to report.
      return res.status(401).json({
        error: {
          code: 'PASSKEY_REQUIRED',
          message: 'Confirm with your passkey.',
          options,
        },
      });
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

    /**
     * The session goes in an httpOnly cookie, and the CSRF value beside it.
     *
     * The token used to be handed to the page, which held it in a variable and
     * lost it on every reload. A cookie the page cannot read is stronger than
     * one it can — and it survives the reload, so an operator opening the
     * Account tab is not asked to sign in again.
     */
    const csrf = newCsrfToken();
    setSessionCookies(req, res, { token: signAdminToken(admin, { csrf }), csrf });

    res.json({
      /**
       * Still returned, for the callers that are not a browser: a shell script,
       * a probe, `curl` while debugging. A browser ignores it and uses the
       * cookie, which is why nothing in the console stores this any more.
       */
      token: signAdminToken(admin),
      csrf,
      admin: admin.toPublic(),
      // Surfaced so the panel can nag. An administrator without a second factor
      // on the account that can suspend every practice should be reminded every
      // time they sign in.
      totpEnabled: admin.totpEnabled,
    });
  }),
);

/**
 * Ask for a reset link.
 *
 * ---- The same answer whatever happens -----------------------------------
 *
 * Unknown address, known address, mail server refusing the message: all `ok`.
 * "No account with that email" is a free membership check for anybody deciding
 * which addresses are worth attacking, and this is the one endpoint that would
 * hand it over.
 *
 * Rate-limited with the login, because it is the same thing being probed.
 */
router.post(
  '/auth/forgot',
  loginLimiter,
  validate({ body: z.object({ email: z.string().trim().toLowerCase().email() }) }),
  asyncHandler(async (req, res) => {
    if (!process.env.ADMIN_JWT_SECRET) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }

    await requestResetByEmail(req.body.email, { consoleUrl: consoleUrl() });

    res.json({
      ok: true,
      // Whether a message could have been delivered at all is a fact about the
      // server, not about the address, so it is safe to return and saves an
      // operator waiting for mail from a box with no SMTP configured.
      mailConfigured: mailConfigured(),
    });
  }),
);

/**
 * Confirm an email address.
 *
 * Unauthenticated: the link is opened wherever the mail was read, which is
 * rarely the browser holding the session. It confirms an address the account
 * already had — it grants nothing and changes no credential.
 */
router.post(
  '/auth/email/verify',
  loginLimiter,
  validate({
    body: z.object({
      email: z.string().trim().toLowerCase().email(),
      token: z.string().min(20).max(200),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!process.env.ADMIN_JWT_SECRET) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }
    const admin = await completeEmailVerification(req.body);
    await AdminAuditLog.record({ admin, action: 'admin.email.verified', req });
    res.json({ ok: true });
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

/**
 * Finish a sign-in that a passkey was asked for.
 *
 * Unauthenticated, and safe to be: the only way to reach it usefully is to hold
 * a challenge that was issued after a correct password, and to produce a
 * signature over it from a private key that never left the authenticator. Both
 * factors are proved by the time this returns.
 *
 * The challenge is spent whatever happens. A failed attempt that left it usable
 * would give an attacker unlimited tries against one issued challenge.
 */
router.post(
  '/auth/passkey',
  loginLimiter,
  validate({
    body: z.object({
      email: z.string().trim().toLowerCase().email(),
      response: z.object({}).passthrough(),
    }),
  }),
  asyncHandler(async (req, res) => {
    if (!process.env.ADMIN_JWT_SECRET) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }

    const admin = await PlatformAdmin.findOne({
      email: req.body.email,
      isActive: true,
    }).select('+passkeyChallenge +passkeyChallengeExpiresAt');

    if (!admin) throw unauthorized(REFUSED);

    if (admin.isLocked()) {
      await AdminAuditLog.record({ admin, action: 'admin.login.locked', req });
      throw unauthorized('Too many attempts. Try again in a few minutes.');
    }

    let result;
    try {
      result = await verifyAuthentication(req, admin, req.body.response);
    } catch (err) {
      // Spent on failure too, then the error is re-thrown.
      admin.passkeyChallenge = null;
      admin.passkeyChallengeExpiresAt = null;
      await admin.save();
      await AdminAuditLog.record({ admin, action: 'admin.login.failed_passkey', req });
      throw err;
    }

    const used = admin.passkeys.find((p) => p.credentialId === result.credentialId);
    if (used) {
      used.counter = result.counter;
      used.lastUsedAt = new Date();
    }
    admin.passkeyChallenge = null;
    admin.passkeyChallengeExpiresAt = null;
    await admin.save();

    await admin.noteSuccess();
    await AdminAuditLog.record({ admin, action: 'admin.login', req, reason: 'passkey' });

    const csrf = newCsrfToken();
    setSessionCookies(req, res, { token: signAdminToken(admin, { csrf }), csrf });

    res.json({
      token: signAdminToken(admin),
      csrf,
      admin: admin.toPublic(),
      totpEnabled: admin.totpEnabled,
    });
  }),
);

/**
 * Sign out.
 *
 * Unauthenticated on purpose. Requiring a valid session to end one means an
 * operator whose session has already expired cannot clear the stale cookie,
 * and clearing a cookie for somebody who was not signed in does nothing.
 *
 * It ends the session in *this browser*. It does not revoke the token: nothing
 * here tracks issued ones, so a copy taken beforehand stays valid until it
 * expires. The Account screen says that in words rather than leaving a button
 * to imply more than it does.
 */
router.post(
  '/auth/logout',
  asyncHandler(async (req, res) => {
    if (!process.env.ADMIN_JWT_SECRET) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Not found' } });
    }

    /**
     * Recorded when we can tell who it was, which is nearly always.
     *
     * Best effort on purpose: an expired or malformed cookie must still clear.
     * A sign-out that failed because the audit write failed would leave the
     * operator holding the session they were trying to drop.
     */
    try {
      const token = cookiesFrom(req)[COOKIE_NAMES.SESSION];
      if (token) {
        const payload = verifyAdminToken(token);
        await AdminAuditLog.record({
          admin: { _id: payload.sub, email: payload.email },
          action: 'admin.logout',
          req,
        });
      }
    } catch {
      // An expired session signing out is the ordinary case, not an error.
    }

    clearSessionCookies(req, res);
    res.json({ ok: true });
  }),
);

// Everything below needs an admin session.
router.use(requireAdmin);

/*
 * Billing, mounted here rather than in routes/index.js on purpose.
 *
 * `requireAdmin` is applied to this router as a whole, and a sibling mount
 * would not inherit it — the console's billing surface would answer anybody who
 * typed the URL. Nesting it means the guard cannot be forgotten for a route
 * added to that file later.
 */
router.use('/billing', adminBillingRoutes);

// Feedback no practice reads — about the app, or from somebody no practice has
// taken on — nested for the same reason, and without the patient's identity.
router.use('/feedback', adminFeedbackRoutes);

/*
 * The self-registration queue, nested for exactly the same reason.
 *
 * These routes approve a practice into existence. A sibling mount in
 * routes/index.js would not inherit `requireAdmin`, and the one surface on
 * this platform that turns a web form into a tenant would answer anybody who
 * typed the URL.
 */
router.use('/', adminApplicationRoutes);

router.get(
  '/me',
  asyncHandler(async (req, res) => {
    res.json({ admin: PlatformAdmin.hydrate(req.admin).toPublic() });
  }),
);

/**
 * Verifying a phone number, from the console.
 *
 * ---- Why these live in the admin namespace ------------------------------
 *
 * The console can only reach `/api/v1/admin/` — that is what the Apache proxy
 * forwards, and it is deliberate: the clinic API behind it also serves
 * patients, prescriptions and chat, and proxying the lot would put a second
 * door to clinical data on the one host whose whole argument is that it holds
 * none.
 *
 * So rather than widening the proxy for two endpoints, the two endpoints live
 * here. They call the same OTP service the clinic app does; nothing is
 * duplicated but the route.
 *
 * ---- What they are for --------------------------------------------------
 *
 * Making somebody the head of a practice hands them every patient in it. A
 * regex tests the shape of a phone number and nothing about who holds it, so
 * the number is texted a code and has to answer. One mistyped digit otherwise
 * gives a clinic to whoever owns the number that was typed instead.
 */
router.post(
  '/phone/otp',
  validate({
    body: z.object({
      phone: z
        .string()
        .trim()
        .transform(toE164)
        .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number')),
    }),
  }),
  asyncHandler(async (req, res) => {
    const out = await requestOtp({ phone: req.body.phone, purpose: 'register' });

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.phone.otp_sent',
      after: { phone: req.body.phone },
      req,
    });

    res.json({
      expiresInSeconds: out.expiresInSeconds,
      resendAfterSeconds: out.resendAfterSeconds,
      // So an operator on a box with no MSG91 configured sees why no text
      // arrived rather than assuming the network ate it. The code is in the
      // server log there; in production the sender throws instead.
      simulated: out.simulated,
    });
  }),
);

/** Answer it, and get the token that proves the number replied. */
router.post(
  '/phone/verify',
  validate({
    body: z.object({
      phone: z
        .string()
        .trim()
        .transform(toE164)
        .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number')),
      code: z.string().trim().regex(/^\d{4,8}$/),
    }),
  }),
  asyncHandler(async (req, res) => {
    await verifyOtp({ phone: req.body.phone, purpose: 'register', code: req.body.code });

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.phone.verified',
      after: { phone: req.body.phone },
      req,
    });

    // The token names the number it was issued for, and every consumer checks
    // the two agree — otherwise somebody verifies one number and registers
    // another, which is the whole protection undone.
    res.json({ phoneToken: signPhoneToken(req.body.phone) });
  }),
);

/**
 * Send a confirmation to the address on this account.
 *
 * Authenticated, so an operator confirms their own address and nobody else's —
 * and so that a stranger cannot use this to post mail to an arbitrary inbox.
 */
router.post(
  '/me/email/verify/send',
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id);
    if (!admin) throw notFound('Account not found');
    if (admin.emailVerifiedAt) return res.json({ ok: true, alreadyVerified: true });

    const { expiresAt } = await sendEmailVerification(admin, { consoleUrl: consoleUrl() });
    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.email.verification_sent',
      req,
    });
    res.json({ ok: true, expiresAt, mailConfigured: mailConfigured() });
  }),
);

/**
 * Begin registering a passkey.
 *
 * The challenge goes on the account rather than in a session store: there is
 * one ceremony in flight per operator at a time, and a second collection to
 * expire and clean up would be more moving parts than the problem has.
 */
router.post(
  '/me/passkeys/options',
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id);
    if (!admin) throw notFound('Account not found');

    const options = await registrationOptions(req, admin);
    admin.passkeyChallenge = options.challenge;
    admin.passkeyChallengeExpiresAt = new Date(Date.now() + CHALLENGE_MS);
    await admin.save();

    await AdminAuditLog.record({ admin: req.admin, action: 'admin.passkey.setup_started', req });
    res.json({ options });
  }),
);

/** Verify what the authenticator produced, and keep the public half. */
router.post(
  '/me/passkeys',
  validate({
    body: z.object({
      name: z.string().trim().min(1).max(60).optional(),
      response: z.object({}).passthrough(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id).select(
      '+passkeyChallenge +passkeyChallengeExpiresAt',
    );
    if (!admin) throw notFound('Account not found');

    let credential;
    try {
      credential = await verifyRegistration(req, admin, req.body.response);
    } finally {
      // Spent either way. A challenge left usable after a failure is an
      // unlimited number of attempts against one issued value.
      admin.passkeyChallenge = null;
      admin.passkeyChallengeExpiresAt = null;
      await admin.save();
    }

    admin.passkeys.push({ ...credential, name: req.body.name || 'Passkey' });
    await admin.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.passkey.added',
      after: { name: req.body.name || 'Passkey' },
      req,
    });

    res.status(201).json({ admin: admin.toPublic() });
  }),
);

/**
 * Remove one.
 *
 * No code and no password, unlike turning TOTP off — removing a passkey needs a
 * session, and a session was obtained by using one. The account keeps whatever
 * other factors it has, and the console warns before removing the last.
 */
router.delete(
  '/me/passkeys/:credentialId',
  asyncHandler(async (req, res) => {
    const admin = await PlatformAdmin.findById(req.admin._id);
    if (!admin) throw notFound('Account not found');

    const before = admin.passkeys.length;
    admin.passkeys = admin.passkeys.filter((p) => p.credentialId !== req.params.credentialId);
    if (admin.passkeys.length === before) throw notFound('No such passkey');

    await admin.save();
    await AdminAuditLog.record({ admin: req.admin, action: 'admin.passkey.removed', req });

    res.json({ admin: admin.toPublic() });
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
      plan: z.enum(Object.values(PLAN)).optional(),
      /// Name, registration number or the doctor's display name.
      q: z.string().trim().max(120).optional(),
      sort: z.enum(['waiting', 'newest', 'name', 'staff']).default('waiting'),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { status, verification, plan, sort, page, limit } = q(req);
    const search = (req.query.q ?? '').trim();

    /*
     * ---- Why this moved off the client ---------------------------------
     *
     * This route used to return every practice on the platform, unbounded, and
     * the console filtered and sorted the result in the browser. That was a
     * deliberate trade and a correct one at two practices: a round trip per
     * keystroke is slower than filtering a list already in memory.
     *
     * It stops being correct somewhere well before five hundred, and it fails
     * in the least visible way — the console keeps working while the payload
     * and the table grow, until one day it does not. Moving it here bounds
     * both, and the console debounces its search box so the round trip the old
     * comment feared never happens per keystroke.
     */
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const filter = {
      ...(status ? { status } : {}),
      ...(verification ? { verification } : {}),
      ...(plan ? { plan } : {}),
      ...(escaped
        ? {
            $or: [
              { name: { $regex: escaped, $options: 'i' } },
              { registrationNo: { $regex: escaped, $options: 'i' } },
              { doctorDisplayName: { $regex: escaped, $options: 'i' } },
            ],
          }
        : {}),
    };

    /*
     * `waiting` first, because the console is opened to find out what needs
     * doing rather than to browse an alphabet. Computed here rather than
     * sorted on two columns, so "undecided" stays one idea in one place.
     */
    const SORTS = {
      waiting: { waiting: -1, createdAt: -1 },
      newest: { createdAt: -1 },
      name: { name: 1 },
      staff: { staff: -1 },
    };

    // One pipeline: filter, count the members and locations, sort on those
    // counts if asked, then page. Sorting by staff needs the count before the
    // page is chosen, which is the whole reason this is an aggregation rather
    // than a find().
    const [result] = await Practice.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: 'memberships',
          localField: '_id',
          foreignField: 'practice',
          as: 'm',
          pipeline: [
            { $match: { status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null } },
            { $project: { _id: 1 } },
          ],
        },
      },
      {
        $lookup: {
          from: 'clinics',
          localField: '_id',
          foreignField: 'practice',
          as: 'c',
          pipeline: [{ $project: { _id: 1 } }],
        },
      },
      {
        $addFields: {
          // Counts, never contents. How many people a practice has is a number
          // the platform needs for billing and support; who they are is not,
          // and the $project below drops the ids these were counted from.
          staff: { $size: '$m' },
          locations: { $size: '$c' },
          waiting: {
            $or: [
              { $eq: ['$verification', VERIFICATION.PENDING] },
              { $eq: ['$status', PRACTICE_STATUS.ONBOARDING] },
            ],
          },
        },
      },
      { $project: { m: 0, c: 0 } },
      { $sort: SORTS[sort] ?? SORTS.waiting },
      {
        $facet: {
          items: [{ $skip: (page - 1) * limit }, { $limit: limit }],
          total: [{ $count: 'n' }],
        },
      },
    ]);

    const rows = result?.items ?? [];
    const total = result?.total?.[0]?.n ?? 0;

    await AdminAuditLog.record({ admin: req.admin, action: 'admin.practices.list', req });

    res.json({
      items: rows.map((p) => ({
        ...Practice.hydrate(p).toPublic(),
        locations: p.locations,
        staff: p.staff,
      })),
      // So the console can say "25 of 312" rather than leaving somebody to
      // wonder whether a filter matched everything or the page simply ended.
      total,
      page,
      limit,
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
/**
 * What the onboarding wizard needs before it can draw its first step.
 *
 * ---- Why the server sends the list --------------------------------------
 *
 * The types are an enum and could be hardcoded in the console. The specialties
 * cannot: they are the shared [Department] rows, an operator can add one, and a
 * list baked into the client would be a rebuild every time somebody opens a
 * practice in a specialty nobody anticipated. Department.js already makes that
 * argument for the model; it applies to the picker for the same reason.
 *
 * So both come from here, and the wizard renders whatever it is given. The
 * responsible-person label travels with the type because it changes with it —
 * a hospital has a medical superintendent, not a head doctor, and the client
 * should not be holding a second copy of that mapping.
 */
router.get(
  '/practice-options',
  asyncHandler(async (req, res) => {
    // The shared rows only. A practice's own departments are its business and
    // are not a specialty anybody else can be opened in.
    const shared = await Department.find({ practice: null, isActive: true })
      .select('key names')
      .sort({ key: 1 })
      .lean();

    res.json({
      types: PRACTICE_TYPE_ORDER.map((key) => ({
        key,
        // Title-cased from the key rather than a second table to keep in step.
        label: key
          .split('_')
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(' '),
        responsibleLabel: RESPONSIBLE_LABEL[key],
        // Whether to offer departments at all — from the table that grants them.
        hasDepartments: BY_TYPE[key]?.includes(CAPABILITIES.DEPARTMENT) ?? false,
      })),
      specialties: shared.map((d) => ({
        key: d.key,
        label: d.names?.en ?? d.key,
      })),
    });
  }),
);

/**
 * A name, safe to put inside a regular expression.
 *
 * Without this a practice called "C++ (Salt Lake)" is a pattern rather than a
 * string: the parentheses become a group, the plus signs become quantifiers
 * with nothing to repeat, and the query throws instead of returning nothing.
 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Has this practice been created already?
 *
 * Called as the wizard's first step is filled in, so the answer arrives before
 * the operator has verified a phone number and reached a review screen — the
 * two expensive steps to have to repeat.
 *
 * The two answers are different strengths on purpose, and the route reports
 * both rather than deciding: a registration clash is a refusal at create time,
 * a name match is something a person should look at.
 */
router.get(
  '/practices/check',
  validate({
    query: z.object({
      name: z.string().trim().max(160).optional(),
      registrationNo: z.string().trim().max(60).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { name, registrationNo } = q(req);

    const [byName, byReg] = await Promise.all([
      name && name.length >= 2
        ? Practice.find({
            // Anchored and escaped. An unescaped name goes into the regex
            // engine as a pattern, so a practice called "C++ (Salt Lake)"
            // would throw rather than return nothing.
            name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
          })
            .select('name status createdAt')
            .limit(5)
            .lean()
        : [],
      registrationNo
        ? Practice.findOne({ registrationNo }).select('name').lean()
        : null,
    ]);

    res.json({
      sameName: byName.map((p) => ({
        id: String(p._id),
        name: p.name,
        status: p.status,
        createdAt: p.createdAt,
      })),
      registrationClash: byReg ? { id: String(byReg._id), name: byReg.name } : null,
    });
  }),
);

router.post(
  '/practices',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160),

      /**
       * What kind of organisation, and what it treats. Both optional.
       *
       * Optional because the model permits null and the resolver reads null as
       * "unclassified, therefore unrestricted" — see [services/capabilities.js].
       * Requiring them here would be a stricter rule than the one the rest of
       * the system enforces, and the operator creating a practice for a clinic
       * that has not decided yet would have to guess.
       */
      practiceType: z.enum(Object.values(PRACTICE_TYPE)).optional(),
      specialty: z.string().trim().max(80).optional(),

      registrationNo: z.string().trim().max(60).optional(),
      doctorDisplayName: z.string().trim().max(160).optional(),
      tagline: z.string().trim().max(160).optional(),

      /**
       * The doctor who will run it.
       *
       * ---- Why this is not optional -----------------------------------
       *
       * A practice with no member is a tenant nobody can sign into. Every
       * screen in the clinic app is reached through a membership, and nothing
       * else in the system creates one — so an operator making a practice
       * without a head made a row and a dead end, and would find out when the
       * doctor rang to ask why they could not log in.
       *
       * ---- The number has to have been answered ------------------------
       *
       * `headDoctorPhoneToken` comes from the OTP flow and is proof the handset
       * replied. A regex tests the shape of a phone number and nothing about
       * who holds it, and one mistyped digit here hands an entire practice —
       * its patients, its prescriptions — to whoever owns the number that was
       * typed instead.
       */
      headDoctorName: z.string().trim().min(2).max(120),
      headDoctorPhone: z
        .string()
        .trim()
        .transform(toE164)
        .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number')),
      headDoctorPhoneToken: z.string().min(20),
      headDoctorQualifications: z.string().trim().max(120).optional(),
      headDoctorRegistrationNo: z.string().trim().max(60).optional(),
      /// Where they are told the practice exists. Never a password: they sign in
      /// with a code texted to the number they just proved.
      headDoctorEmail: z.string().trim().toLowerCase().email().max(200).optional(),

      /**
       * Everything the application path already provisions, so a practice made
       * here is as complete as an approved one: the departments it runs (kept
       * only where its type can have any), the head doctor's department, the
       * number its patients ring, and its first location with that location's
       * phone and weekly hours. A practice made without a location could not
       * take a booking.
       */
      departments: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
      headDoctorDepartment: z.string().trim().max(80).optional(),
      emergencyPhone: z.string().trim().max(40).optional(),
      prescriptionPrefix: z.string().trim().toUpperCase().max(8).optional(),
      location: z
        .object({
          name: z.string().trim().max(160).optional(),
          addressLine: z.string().trim().max(400).optional(),
          city: z.string().trim().max(120).optional(),
          phone: z.string().trim().max(40).optional(),
          slotMinutes: z.number().int().min(5).max(120).optional(),
          weeklyHours: z
            .array(
              z.object({
                dayOfWeek: z.number().int().min(0).max(6),
                start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
              }),
            )
            .max(42)
            .optional(),
        })
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const {
      headDoctorName,
      headDoctorPhone,
      headDoctorPhoneToken,
      headDoctorQualifications,
      headDoctorRegistrationNo,
      headDoctorEmail,
      departments,
      headDoctorDepartment,
      emergencyPhone,
      location: locationInput,
      ...brand
    } = req.body;

    /**
     * The token and the number must agree.
     *
     * Taking both as independent fields would let somebody verify one number
     * and register another — which is the whole of the protection, undone by
     * trusting the field beside the proof.
     */
    if (phoneFromToken(headDoctorPhoneToken) !== headDoctorPhone) {
      throw badRequest(
        'That verification was for a different number. Verify this one again.',
      );
    }

    /*
     * One sequence, two callers.
     *
     * This used to be written out here: the licence-clash check, the practice
     * row, the head doctor, the letterhead fallbacks and the compensating
     * delete when the head cannot be attached. Approving a self-registration
     * has to produce exactly the same thing, and a second copy of nine steps
     * is how one path ends up without a head doctor.
     *
     * See [services/provisionPractice.js] for why each step is where it is —
     * including why every refusal it can make comes before anything is written.
     */
    const { practice, head, location, department, departments: seeded } = await provisionPractice({
      brand,
      headDoctorName,
      headDoctorPhone,
      headDoctorQualifications,
      headDoctorRegistrationNo,
      ownerEmail: headDoctorEmail ?? null,
      // Proved a moment ago, through /admin/phone/verify — the token says so.
      phoneVerifiedAt: new Date(),
      departments: departments ?? [],
      ownerDepartment: headDoctorDepartment ?? null,
      emergencyPhone: emergencyPhone ?? null,
      location: locationInput ?? null,
    });

    /*
     * The head doctor is told, through the ways MedPin has of reaching them:
     * the phones their account is already signed in on, and the email the
     * operator gave. Nothing else can reach somebody new — a text would need a
     * template approved for it — so the console is told which of these went,
     * and can say to ring them when neither did.
     */
    const pushed = await notifyOwnerOfNewPractice({
      userId: head.user._id,
      practiceName: practice.name,
      managesOnly: false,
    });
    const emailTo = headDoctorEmail ?? null;
    if (emailTo) {
      sendMail({
        to: emailTo,
        ...practiceReadyEmail({ practiceName: practice.name, ownerName: head.user.name, phone: headDoctorPhone }),
      }).catch((err) => logger.error({ err, practice: String(practice._id) }, 'could not email the head doctor'));
    }

    const outcome = {
      headDoctorAccount: head.createdUser ? 'created' : 'existing',
      signInPhone: headDoctorPhone,
      locationCreated: Boolean(location),
      departments: seeded,
      headDoctorDepartment: department?.key ?? null,
      notified: { devices: pushed.devices, emailTo, sms: 'not_available' },
      mailConfigured: mailConfigured(),
    };

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
        headDoctor: headDoctorName,
        headDoctorPhone,
        // Whether this created an account or attached one that already existed
        // is the difference between onboarding a new doctor and adding a
        // practice to somebody already on the platform.
        headDoctorAccount: outcome.headDoctorAccount,
        location: location ? String(location._id) : null,
        departments: seeded,
        emergencyPhone: practice.emergencyPhone ?? null,
        prescriptionPrefix: practice.prescriptionPrefix ?? null,
        notified: outcome.notified,
      },
      req,
    });

    res.status(201).json({
      practice: practice.toPublic(),
      location: location
        ? {
            id: String(location._id),
            name: location.name,
            phone: location.phone ?? null,
            weeklyHours: (location.weeklyHours ?? []).map((w) => ({
              dayOfWeek: w.dayOfWeek,
              start: w.start,
              end: w.end,
            })),
          }
        : null,
      outcome,
    });
  }),
);

/**
 * The registration number this practice would be verified against, if any.
 *
 * It can sit in three places and any one of them is enough: on the practice, on
 * one of its doctors (which is what a solo practice normally has — the person
 * is the practice), or on a location, which is the establishment licence rather
 * than a council registration but is still a number somebody can look up.
 *
 * Returns null when there is nothing on file anywhere. That is the case the
 * caller cares about, and it is not the same as "not yet checked".
 */
async function registrationOnFile(practice) {
  if (practice.registrationNo?.trim()) {
    return { number: practice.registrationNo.trim(), where: 'the practice' };
  }

  const members = await membersOf(practice._id);
  const doctor = members.find((m) => m.user?.registrationNo?.trim());
  if (doctor) {
    return {
      number: doctor.user.registrationNo.trim(),
      where: doctor.user.name ?? 'a doctor',
    };
  }

  const clinic = await Clinic.findOne({
    practice: practice._id,
    registrationNo: { $exists: true, $nin: [null, ''] },
  })
    .select('name registrationNo')
    .lean();
  if (clinic) {
    return { number: clinic.registrationNo.trim(), where: clinic.name ?? 'a location' };
  }

  return null;
}

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

    /*
     * Verified means somebody looked a number up on a council register and it
     * was real, current, and this doctor's. With no number on file anywhere
     * there was no lookup, so the audit line "admin.practice.verified" would be
     * recording a check that did not happen — and that line is what somebody
     * relies on later when asking who vouched for this practice.
     *
     * Only VERIFIED is refused. PENDING and REJECTED are both honest things to
     * say about a practice that has produced no paperwork.
     */
    if (req.body.verification === VERIFICATION.VERIFIED && !(await registrationOnFile(practice))) {
      throw badRequest(
        'No registration number on file for this practice, its doctors or its ' +
          'locations, so there is nothing to have checked. Add the number first.',
      );
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
 *
 * ---- What suspension does, now that something reads it -------------------
 *
 * Its staff are refused every practice route with PRACTICE_SUSPENDED from their
 * next request (middleware/practiceStatus.js). They can still sign in and see
 * that the practice is suspended. Its patients keep their own records,
 * prescriptions and reminders. Nothing is deleted, and reinstating restores
 * access at once.
 *
 * Both directions need a reason. Stopping a clinic working is the decision a
 * review reads six months later; letting it work again is the other half of
 * the same story, and "reinstated" with nothing beside it cannot say whether
 * whatever caused the suspension was resolved or simply forgotten.
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

    // Nothing to decide, and nothing to record as though something had been.
    if (practice.status === req.body.status) return res.json({ practice: practice.toPublic() });

    if (req.body.status === PRACTICE_STATUS.SUSPENDED && !req.body.reason) {
      throw badRequest('A suspension needs a reason.');
    }
    if (practice.status === PRACTICE_STATUS.SUSPENDED && !req.body.reason) {
      throw badRequest('Reinstating a suspended practice needs a reason.');
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

      /**
       * Free text, over the reason and the actor.
       *
       * The two dropdowns answer "which action" and "which operator", and
       * neither answers "the suspension somebody explained by quoting a ticket
       * number". The reason is the only free prose in the log and it was the
       * only column nothing could search.
       */
      q: z.string().trim().max(120).optional(),

      /**
       * A window, rather than only a cursor.
       *
       * `before` pages backwards from now and cannot express "the week of the
       * outage". Somebody auditing an incident knows the dates, not how many
       * pages back they are.
       */
      since: z.coerce.date().optional(),
      until: z.coerce.date().optional(),

      /**
       * Everything, or only what changed something.
       *
       * Reads are recorded on purpose and outnumber the rest several to one,
       * so "what has been done to this platform" is a question the whole log
       * answers badly. Derived from the action name rather than stored, so a
       * route added tomorrow is classified without a migration.
       */
      kind: z.enum(['all', 'changes']).default('all'),

      /// An ISO timestamp from the previous page's last row. A cursor rather
      /// than an offset because the log grows while it is being read, and
      /// `skip` would show the same row twice or miss one entirely.
      before: z.coerce.date().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { practice, action, admin, q: text, since, until, kind, before, limit } = q(req);

    const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    /*
     * The operator's window and the pager's cursor, on one field.
     *
     * `before` pages backwards and `since`/`until` are the dates somebody
     * typed, and all three narrow `at`. Built as one object because two `at`
     * keys in an object literal silently discard the first — paging would stop
     * working the moment anybody picked a date, and it would look like the log
     * had run out.
     */
    const at = {
      ...(since ? { $gte: since } : {}),
      ...(until ? { $lte: until } : {}),
      ...(before ? { $lt: before } : {}),
    };

    /*
     * Reads out, when asked.
     *
     * `.read` and `.list` are the suffixes every read route in this namespace
     * uses, so the rule is one expression rather than a list of every action
     * that is not one — which would go stale the first Friday somebody adds a
     * route. `$and` because `action` may already carry the prefix filter, and
     * two `action` keys would discard one of them the same way.
     */
    const actionClauses = [
      // A prefix, so "admin.practice" finds every practice action without the
      // operator having to know the full name of each one.
      ...(action ? [{ action: new RegExp('^' + escape(action)) }] : []),
      ...(kind === 'changes' ? [{ action: { $not: /\.(read|list)$/ } }] : []),
    ];

    const filter = {
      ...(practice ? { practice } : {}),
      ...(admin ? { adminEmail: admin } : {}),
      ...(Object.keys(at).length ? { at } : {}),
      ...(actionClauses.length ? { $and: actionClauses } : {}),
      // The reason is the only free prose in the log and was the only column
      // nothing could search. The actor comes along because "who was Sarah"
      // and "what did Sarah say" are the same question asked twice.
      ...(text
        ? {
            $or: [
              { reason: new RegExp(escape(text), 'i') },
              { adminEmail: new RegExp(escape(text), 'i') },
            ],
          }
        : {}),
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

    /*
     * How many match, not how many are on screen.
     *
     * "Page 3" tells an operator nothing: it cannot say whether a filter
     * matched almost everything or almost nothing, which is the only thing
     * worth knowing after typing one. The register already answers this and
     * the trail did not.
     *
     * Counted against the filter minus the cursor — `before` is where the
     * pager has got to, and including it would make the total shrink as
     * somebody paged, which reads as the log deleting itself.
     */
    const { at: _cursorWindow, ...withoutCursor } = filter;
    const total = await AdminAuditLog.countDocuments({
      ...withoutCursor,
      ...(since || until
        ? { at: { ...(since ? { $gte: since } : {}), ...(until ? { $lte: until } : {}) } }
        : {}),
    });

    /*
     * Who it was done to.
     *
     * The id has been recorded since this collection existed and nothing ever
     * showed it, so the trail could say a plan moved from essential to
     * professional without saying whose — which on a platform with one
     * practice is obvious and on a platform with twenty is unreviewable.
     *
     * Looked up rather than populated, because `.populate()` on a practice
     * that has since been deleted yields null and takes the id with it. The
     * row would then read as though it had never been practice-scoped at all:
     * a missing name drawn as "nothing was targeted". Here the id survives its
     * practice, and the name is null — which the console can say out loud.
     *
     * After paging, so it asks about the fifty ids on this page rather than
     * every practice that has ever appeared in the log.
     */
    const practiceIds = [...new Set(page.filter((r) => r.practice).map((r) => String(r.practice)))];
    const names = new Map(
      practiceIds.length
        ? (await Practice.find({ _id: { $in: practiceIds } })
            .select('name')
            .lean()
          ).map((p) => [String(p._id), p.name])
        : [],
    );

    res.json({
      hasMore,
      total,
      nextBefore: hasMore ? page[page.length - 1].at : null,
      items: page.map((r) => ({
        id: String(r._id),
        admin: r.adminEmail,
        /*
         * Where from, and on what.
         *
         * Both have been recorded on every entry since the collection existed
         * and neither was ever returned. "Who looked" is the half of an audit
         * trail usually missing, and it is only half an answer without where
         * they looked from: the question this log is opened for is whether an
         * account was used by the person it belongs to, and one sign-in from
         * an address nobody recognises is the whole of the evidence.
         */
        ip: r.ip ?? null,
        userAgent: r.userAgent ?? null,
        action: r.action,
        practice: r.practice
          ? { id: String(r.practice), name: names.get(String(r.practice)) ?? null }
          : null,
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

    const [locations, departments, memberships, patients, activePatients, subscription] =
      await Promise.all([
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
      // Not clinical: a subscription names a practice and a provider id and no
      // patient. The newest, whatever its state — a cancelled one is the answer
      // to "why did they stop paying", which is a question support gets.
      Subscription.findOne({ practice: practice._id }).sort({ createdAt: -1 }).lean(),
    ]);

    // Asked, not re-derived. The header used to print "no registration number"
    // from practice.registrationNo alone, which is blank for most solo
    // practices — the number is on the doctor. It said nothing was on file for
    // practices that could be verified perfectly well.
    const registration = await registrationOnFile(practice);

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
      // null when there is nothing to check against a register, which is what
      // makes "Mark verified" unavailable rather than merely unwise.
      registration,

      /*
       * What the provider thinks, and whether it agrees with us.
       *
       * Two things now write `practice.plan`: an operator in this console, and
       * the billing webhook. So "this practice is on Professional" stopped
       * being a whole answer — bought and granted look identical, and support
       * cannot tell a webhook that never arrived from a deliberate comp.
       *
       * `disagrees` is the one worth surfacing: an active subscription for a
       * plan the practice is not on means either a delivery was missed or
       * somebody edited over it. Computed here rather than in the console so
       * every surface answers it the same way.
       */
      subscription: subscription
        ? {
            id: String(subscription._id),
            plan: subscription.plan,
            status: subscription.status,
            providerSubscriptionId: subscription.providerSubscriptionId,
            currentPeriodEnd: subscription.currentPeriodEnd ?? null,
            // How old the provider's last word is. A row nothing has confirmed
            // looks healthy for ever otherwise.
            confirmedAt: subscription.confirmedAt ?? null,
            createdAt: subscription.createdAt,
            disagrees:
              subscription.status === SUBSCRIPTION_STATUS.ACTIVE &&
              subscription.plan !== practice.plan,
          }
        : null,

      /*
       * What this practice can actually do, and what is stopping the rest.
       *
       * The console let an operator set a type and a plan and showed neither
       * the result nor the reasoning. `DEPARTMENT` clears three independent
       * gates — the type must be an organisation that has departments, the
       * plan must pay for them, and the member must hold MANAGE_DEPARTMENT —
       * and the app draws nothing when any one fails, on purpose. Right for
       * the doctor; useless for whoever set the practice up and is looking at
       * a screen with no departments on it and no way to learn why.
       *
       * Resolved by the same function the app is answered from, so this panel
       * cannot disagree with what the practice experiences.
       */
      capabilities: explainCapabilities(practice),

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

/**
 * Correct the details on the letterhead, and what kind of practice this is.
 *
 * ---- Type and specialty were settable once and never again --------------
 *
 * Both were on the create form and on neither edit path, so a practice created
 * before either field existed had no way to acquire them and a practice
 * created with the wrong one had no way to lose it. The register drew both as
 * pills and there was no screen anywhere that could change what they said.
 *
 * That is not cosmetic. `practiceType` is an input to the capability resolver,
 * so the ceiling on what a practice may do was fixed at the moment somebody
 * filled in a form; and `specialty` now decides what the AI assistant tells
 * patients their doctor practises.
 *
 * Nullable, both. `null` is a real value the resolver reads as unclassified,
 * and an operator who set one by mistake needs the way back.
 */
router.patch(
  '/practices/:id',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160).optional(),
      tagline: z.string().trim().max(160).optional(),
      doctorDisplayName: z.string().trim().max(160).optional(),
      registrationNo: z.string().trim().max(60).optional(),
      notes: z.string().trim().max(2000).optional(),
      practiceType: z.enum(Object.values(PRACTICE_TYPE)).nullable().optional(),
      specialty: z.string().trim().max(80).nullable().optional(),
      /**
       * What this practice's prescription references start with. Null or empty
       * goes back to the neutral RX. References already issued keep theirs.
       */
      prescriptionPrefix: z.string().trim().toUpperCase().max(8).nullable().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    // Checked before anything is written, so a refused prefix saves nothing
    // else from the same form either.
    if (req.body.prescriptionPrefix) {
      const verdict = await prefixAvailability(req.body.prescriptionPrefix, practice._id);
      if (!verdict.ok) {
        throw verdict.reason === 'taken' || verdict.reason === 'issued'
          ? conflict(
              verdict.holder
                ? `${req.body.prescriptionPrefix} is ${verdict.holder}'s prefix.`
                : PREFIX_REFUSAL[verdict.reason],
            )
          : badRequest(PREFIX_REFUSAL[verdict.reason]);
      }
    }

    const fields = [
      'name',
      'tagline',
      'doctorDisplayName',
      'registrationNo',
      'notes',
      'practiceType',
      'specialty',
      'prescriptionPrefix',
    ];
    const before = {};
    const after = {};
    for (const f of fields) {
      if (req.body[f] === undefined || req.body[f] === practice[f]) continue;
      // An emptied box means "this practice has no answer", which the model
      // and the resolver both spell `null`. Storing '' would be a third state
      // that reads as set and behaves as unset.
      const value = req.body[f] === '' ? null : req.body[f];
      if (value === (practice[f] ?? null)) continue;
      before[f] = practice[f] ?? null;
      after[f] = value;
      practice[f] = value;
    }
    if (!Object.keys(after).length) return res.json({ practice: practice.toPublic() });

    try {
      await practice.save();
    } catch (err) {
      // Two operators giving two practices one prefix in the same second: the
      // unique index refuses the second, and it is told so in words.
      if (err?.code === 11000 && err.keyPattern?.prescriptionPrefix) {
        throw conflict(PREFIX_REFUSAL.taken);
      }
      throw err;
    }
    // The letterhead and the assistant read the practice through a cache.
    forgetClinicIdentity();
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

    /*
     * A plan change resets the limits to that plan's.
     *
     * Without this the tiers enforced nothing: every practice starts on all
     * nulls, so "Essential" and "Enterprise" were the same product plus a
     * capability list until somebody typed three numbers in by hand, per
     * customer, and remembered to.
     *
     * Explicit limits in the same request still win, and are applied after —
     * that is the operator saying "this plan, but these numbers", which is the
     * negotiated case the per-practice field exists for.
     */
    const planChanged = Boolean(req.body.plan) && req.body.plan !== practice.plan;
    if (req.body.plan) practice.plan = req.body.plan;
    if (planChanged) {
      const defaults = defaultLimitsFor(practice.plan);
      for (const k of ['patients', 'staff', 'locations']) practice.limits[k] = defaults[k];
    }

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
    const now = Date.now();
    const since = (days) => new Date(now - days * 86_400_000);
    const window30 = since(30);

    /**
     * A trend is the total now against the total a month ago.
     *
     * ---- Not arrivals in one window against arrivals in the previous one ---
     *
     * That is what this did first, and it produced "Locations 2 — down 2",
     * which is a sentence about a deletion that never happened. Both locations
     * were created between thirty and sixty days ago, so the recent window held
     * none and the older one held two.
     *
     * The card shows a total. A trend beside a total has to describe how that
     * total moved, or the two halves of one card are measuring different things
     * and the reader is left to notice.
     *
     * ---- Still two counts, not a stored series ----------------------------
     *
     * The total a month ago is the rows that existed a month ago, which for
     * data nothing deletes is `createdAt < window30`. A daily snapshot table
     * would be more precise and would also be a second source of truth that can
     * drift from the first.
     */
    const movement = async (Model, filter = {}) => {
      const [current, previous] = await Promise.all([
        Model.countDocuments(filter),
        Model.countDocuments({ ...filter, createdAt: { $lt: window30 } }),
      ]);
      return { current, previous };
    };

    const [
      byStatus,
      byVerification,
      byPlan,
      patients,
      staff,
      locations,
      admins,
      practiceMove,
      staffMove,
      locationMove,
      enrolMove,
    ] = await Promise.all([
      Practice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Practice.aggregate([{ $group: { _id: '$verification', count: { $sum: 1 } } }]),
      Practice.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]),
      platformPatientCount(),
      Membership.countDocuments({ status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null }),
      Clinic.countDocuments({}),
      PlatformAdmin.countDocuments({ isActive: true }),
      movement(Practice),
      movement(Membership, { status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null }),
      movement(Clinic),
      enrolmentMovement(window30),
    ]);

    const tally = (rows) => Object.fromEntries(rows.map((r) => [r._id ?? 'unknown', r.count]));

    res.json({
      practices: tally(byStatus),
      verification: tally(byVerification),
      plans: tally(byPlan),
      activeEnrolments: patients,
      staff,
      locations,
      admins,
      trends: {
        practices: practiceMove,
        staff: staffMove,
        locations: locationMove,
        patients: enrolMove,
      },
      newPracticesThisWeek: await Practice.countDocuments({ createdAt: { $gte: since(7) } }),
    });
  }),
);

/**
 * What is waiting on a person, with enough detail to act on it.
 *
 * The brief for this screen is three questions: what is happening, what needs
 * my attention, what do I do next. The counts above answer the first. This
 * answers the second, and each item carries the link that answers the third —
 * an alert that cannot be acted on from where it appears is a worry, not a
 * task.
 *
 * Every item is derived, never stored. A dismissible notification table would
 * need a rule for when something comes back, and the honest rule is "when it is
 * still true", which is what recomputing already means.
 */
router.get(
  '/attention',
  asyncHandler(async (req, res) => {
    const [waitingApplications, pendingVerification, onboarding, weakAdmins, capped] = await Promise.all([
      // Waiting on an operator. `more_info` is waiting on the applicant.
      PracticeApplication.countDocuments({
        status: { $in: [APPLICATION_STATUS.SUBMITTED, APPLICATION_STATUS.UNDER_REVIEW] },
      }),
      Practice.countDocuments({ verification: VERIFICATION.PENDING }),
      Practice.countDocuments({ status: PRACTICE_STATUS.ONBOARDING }),
      /**
       * No second factor of any kind.
       *
       * Not `totpEnabled` alone. An operator who registered a passkey and never
       * touched an authenticator app is protected, and telling them otherwise
       * is a warning about something they have already done — which teaches
       * them to ignore the section.
       */
      PlatformAdmin.countDocuments({
        isActive: true,
        totpEnabled: { $ne: true },
        $or: [{ passkeys: { $exists: false } }, { passkeys: { $size: 0 } }],
      }),
      practicesNearCapacity(),
    ]);

    const items = [];

    /*
     * A deployment that cannot do what it claims, first.
     *
     * This began as its own route, `/admin/readiness`, and adminPanel.test.js
     * refused it: "a route documented as a curl command is a feature the
     * operator does not have." It was right. A configuration problem is a
     * thing waiting on a person, which is what this endpoint is for — and an
     * operator should not have to know to go and look.
     *
     * Above the practice work deliberately. A misconfigured payment webhook
     * accepts forged callbacks; a practice awaiting verification waits. One of
     * those can carry on being true for a week.
     *
     * `degraded` only. `off` is a development machine or a feature this
     * deployment does not use, and a bell that is always ringing is one nobody
     * hears.
     */
    for (const check of readiness().filter((c) => c.state === 'degraded')) {
      items.push({
        kind: 'configuration',
        severity: 'stopped',
        title: check.because,
        detail: check.affects,
        // Nowhere to click: this is fixed in a `.env` on the server, not in
        // the console. An href that went somewhere unhelpful would be worse
        // than one that goes nowhere.
        href: '',
        count: 1,
      });
    }

    /*
     * Practices that asked to exist and have not been answered.
     *
     * Missing until now, so the overview said "Nothing is waiting on you" over a
     * queue of applications — the one kind of waiting where the person on the
     * other end has been told, on three screens, that somebody will be in touch.
     */
    if (waitingApplications) {
      items.push({
        kind: 'applications',
        severity: 'waiting',
        title: `${waitingApplications} practice application${waitingApplications === 1 ? '' : 's'} waiting for a decision`,
        detail: 'They have been told MedPin will review them. Nothing is created until an operator decides.',
        href: '/signups/',
        count: waitingApplications,
      });
    }

    if (pendingVerification) {
      items.push({
        kind: 'verification',
        severity: 'waiting',
        title: `${pendingVerification} practice${pendingVerification === 1 ? '' : 's'} awaiting verification`,
        detail: 'Nobody can be told they are approved until somebody decides.',
        href: '/practices/?verification=pending',
        count: pendingVerification,
      });
    }

    if (onboarding) {
      items.push({
        kind: 'onboarding',
        severity: 'waiting',
        title: `${onboarding} practice${onboarding === 1 ? '' : 's'} still onboarding`,
        detail: 'Created but never activated. Their staff cannot sign in yet.',
        href: '/practices/?status=onboarding',
        count: onboarding,
      });
    }

    for (const p of capped) {
      items.push({
        kind: 'capacity',
        // At the cap is a refusal happening now; near it is a warning.
        severity: p.used >= p.cap ? 'stopped' : 'waiting',
        title:
          p.used >= p.cap
            ? `${p.name} has reached its patient limit`
            : `${p.name} is near its patient limit`,
        detail: `${p.used} of ${p.cap}. Registration is refused at the cap, with the number named.`,
        href: `/practices/?id=${p.id}`,
        count: p.used,
      });
    }

    if (weakAdmins) {
      items.push({
        kind: 'security',
        severity: 'waiting',
        title: `${weakAdmins} administrator${weakAdmins === 1 ? ' has' : 's have'} no second factor`,
        detail:
          'A password alone stands between anyone who learns it and every practice. ' +
          'A passkey takes about ten seconds and needs nothing installed.',
        href: '/admins/',
        count: weakAdmins,
      });
    }

    res.json({ items });
  }),
);

/**
 * Practices at or approaching their patient cap.
 *
 * Only those with a cap set, which today is none of them — a practice with no
 * limit cannot be near one, and reporting "0 of unlimited" as a warning would
 * make the whole section noise on day one.
 */
async function practicesNearCapacity(threshold = 0.8) {
  const capped = await Practice.find({ 'limits.patients': { $ne: null } })
    .select('name limits')
    .lean();
  if (!capped.length) return [];

  const rows = await Promise.all(
    capped.map(async (p) => ({
      id: String(p._id),
      name: p.name,
      cap: p.limits.patients,
      used: await activePatientCount(p._id),
    })),
  );

  return rows
    .filter((r) => r.cap > 0 && r.used / r.cap >= threshold)
    .sort((a, b) => b.used / b.cap - a.used / a.cap);
}

/**
 * Growth, month by month.
 *
 * ---- Cumulative, not new-per-month ---------------------------------------
 *
 * "How many practices exist" is the question an operator actually has. A bar
 * chart of sign-ups per month answers a different one, and reads as a collapse
 * whenever a good month is followed by an ordinary one.
 *
 * ---- Twelve buckets, built from createdAt --------------------------------
 *
 * No snapshot table. A second store of the same fact drifts from the first, and
 * the first is already here. The cost is that a deleted row rewrites history,
 * which is acceptable when nothing here is ever deleted.
 */
router.get(
  '/analytics',
  validate({ query: z.object({ months: z.coerce.number().int().min(3).max(24).default(12) }) }),
  asyncHandler(async (req, res) => {
    const months = q(req).months;

    // Month starts, oldest first. A clinic-local boundary would matter for a
    // daily chart; at this resolution it does not.
    const now = new Date();
    const starts = [];
    for (let i = months - 1; i >= 0; i -= 1) {
      starts.push(new Date(now.getFullYear(), now.getMonth() - i, 1));
    }

    const endOfRange = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [practices, memberships, locations, patients, byPlan, capped] = await Promise.all([
      Practice.find({}).select('createdAt status').lean(),
      Membership.find({ status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null })
        .select('createdAt')
        .lean(),
      Clinic.find({}).select('createdAt').lean(),
      enrolmentCumulative(starts, endOfRange),
      Practice.aggregate([{ $group: { _id: '$plan', count: { $sum: 1 } } }]),
      Practice.find({ 'limits.patients': { $ne: null } }).select('name limits').lean(),
    ]);

    const endOf = (i) => starts[i + 1] ?? endOfRange;

    /** How many existed at the end of each month. */
    const cumulative = (rows) =>
      starts.map((_, i) => rows.filter((r) => new Date(r.createdAt) < endOf(i)).length);

    const utilisation = await Promise.all(
      capped.map(async (p) => ({
        id: String(p._id),
        name: p.name,
        cap: p.limits.patients,
        used: await activePatientCount(p._id),
      })),
    );

    res.json({
      months: starts.map((d) => d.toISOString().slice(0, 7)),
      series: {
        practices: cumulative(practices),
        staff: cumulative(memberships),
        locations: cumulative(locations),
        patients,
      },
      status: {
        active: practices.filter((p) => p.status === PRACTICE_STATUS.ACTIVE).length,
        onboarding: practices.filter((p) => p.status === PRACTICE_STATUS.ONBOARDING).length,
        suspended: practices.filter((p) => p.status === PRACTICE_STATUS.SUSPENDED).length,
      },
      plans: Object.fromEntries(byPlan.map((r) => [r._id ?? 'unknown', r.count])),
      // Only practices with a cap. One without cannot be near a limit, and
      // reporting "0 of unlimited" would make the section noise.
      utilisation: utilisation.sort((a, b) => b.used / b.cap - a.used / a.cap),
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
