import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import {
  phoneFromToken,
  requestOtp,
  signPhoneToken,
  verifyOtp,
} from '../services/otp.js';
import { User } from '../models/User.js';
import { toE164 } from '../utils/phone.js';

/** The one purpose these codes are spent on. See the note on /verify/send. */
const PRACTICE_PURPOSE = 'practice';

/**
 * Normalised before it is validated, so ten bare digits and a +91 number are
 * the same string — the code is looked up by exact match.
 */
const applicantPhone = z
  .string()
  .trim()
  .transform(toE164)
  .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number'));
import { PRACTICE_TYPE, PRACTICE_TYPE_ORDER } from '../models/Practice.js';
import {
  PracticeApplication,
  APPLICATION_STATUS,
} from '../models/PracticeApplication.js';
import { logger } from '../config/logger.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { sendMail } from '../services/mailer.js';
import { env } from '../config/env.js';

/**
 * A practice asking to exist, from outside.
 *
 * ---- Unauthenticated on purpose, and what that costs ---------------------
 *
 * Nobody filling this in has an account — that is the point of it. So every
 * protection here is something other than a session:
 *
 *   * The phone is proved first. `/auth/otp/verify` with purpose `practice`
 *     returns a short-lived token, and this route takes the token rather than
 *     the number. One person cannot file applications naming numbers that are
 *     not theirs.
 *   * The token's number is what gets stored. Taking both a token and a phone
 *     field and trusting them to agree is how somebody verifies one number and
 *     submits another.
 *   * Rate limited by address, tightly. This writes rows, and a public write
 *     with no ceiling is a queue nobody can read.
 *
 * ---- And what it deliberately does not do -------------------------------
 *
 * It creates nothing but an application. No user, no membership, no practice,
 * no tenant — a Practice is a tenant, and a web form must not produce one. The
 * row here grants nothing at all until an operator approves it, at which point
 * [services/provisionPractice.js] runs, which is the same path used by hand.
 *
 * There is no document upload. Storing files from unauthenticated callers is a
 * security surface in its own right and this platform has no scanning,
 * quarantine or retention story for them. An operator asks for papers in the
 * "more information" note and receives them the way they receive everything
 * else today.
 */
const router = Router();

/**
 * Tighter than the app's limiter, and by address rather than by account.
 *
 * Six an hour is more than any real applicant needs and few enough that the
 * queue stays readable. An operator reviewing these is the scarce resource.
 */
const submitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  // Read per request rather than fixed at construction, so the ceiling can be
  // raised for a suite that files twenty applications from one address and
  // still be proved by a test that lowers it. A limiter switched off under
  // test is a limiter nobody has seen work.
  limit: () => env.APPLICATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many applications from this address. Try again later.' } },
});

/** Reading a status is cheap, but it is still an unauthenticated lookup. */
const statusLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

const optionalText = (max) => z.string().trim().max(max).optional().or(z.literal(''));

/**
 * The vocabulary the form offers.
 *
 * Public, because the form that needs it is. What a practice type is called is
 * product vocabulary rather than anything privileged — and the alternative was
 * a second copy of the list in the client, which is how the public form ends
 * up offering a type the server has never heard of.
 *
 * Title-cased from the key rather than a second table, exactly as the admin
 * endpoint does it, so neither can drift from the enum.
 */
router.get(
  '/options',
  statusLimiter,
  asyncHandler(async (_req, res) => {
    res.json({
      types: PRACTICE_TYPE_ORDER.map((key) => ({
        key,
        label: key
          .split('_')
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(' '),
      })),
    });
  }),
);

/*
 * Proving the number, from inside this router.
 *
 * ---- Why not /auth/otp/request, which does the same thing ---------------
 *
 * It did call that, and it 404ed in production for a reason no amount of
 * reading the code would show: the console is served from its own host and
 * reverse-proxies the API, and the proxy covers `/api/v1/admin/` and
 * `/api/v1/applications/` — not `/api/v1/auth/`. Widening it would put the
 * clinic's entire patient-facing API on the operator origin to gain one
 * endpoint, which is the wall this deployment exists to keep.
 *
 * So the public application flow owns its verification, and everything a
 * practice touches while applying sits under one prefix. A narrow proxy stays
 * narrow, and the next call added here cannot 404 for being in the wrong
 * namespace.
 *
 * `practice` is its own OTP purpose. A code for an enrolment or a login
 * arriving mid-application would otherwise burn the one being waited on — one
 * live code per number per purpose is the rule that makes that safe.
 */
/**
 * The one email an application sends, doing two jobs.
 *
 * It carries the reference — which is otherwise shown once, on a screen the
 * applicant closes — and a link that confirms the address reached somebody.
 * Both have to happen and neither justifies a message of its own.
 *
 * ---- Never fatal --------------------------------------------------------
 *
 * A send that throws must not fail the submission. The application is already
 * written and it is the thing that matters; an SMTP timeout is not a reason to
 * tell somebody their registration did not go through, and the operator can
 * see the address is unconfirmed and chase the phone number instead.
 *
 * With no SMTP configured `sendMail` writes the message to the log rather than
 * pretending, so a deployment without mail still shows the reference on screen
 * and the link is recoverable by whoever reads the logs.
 */
async function sendConfirmation(application) {
  // The raw token is never stored. What is kept is a SHA-256 of it, the way a
  // password reset is, so a leaked collection holds nothing replayable.
  const token = randomBytes(24).toString('base64url');
  application.emailTokenHash = createHash('sha256').update(token).digest('hex');
  application.emailTokenExpiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
  await application.save();

  const base = env.ADMIN_CONSOLE_URL?.replace(/\/+$/, '');
  // Configured, never derived from the request: a link built from a forged
  // Host header points at somebody else's server and looks exactly right.
  const link = base
    ? `${base}/?application=${application.reference}&confirm=${token}`
    : null;

  try {
    await sendMail({
      to: application.contactEmail,
      subject: `Your MedPin application ${application.reference}`,
      text: [
        `Thank you — we have your registration for ${application.practiceName}.`,
        '',
        `Your reference is ${application.reference}. Keep it: it is how you check`,
        'what is happening with the application.',
        '',
        ...(link
          ? ['Please confirm this address so our decision reaches you:', link, '']
          : []),
        'Nothing is created until somebody at MedPin has reviewed this. We will',
        'write to you either way.',
      ].join('\n'),
    });
  } catch (err) {
    // Logged, not raised. See the note above.
    logger.error(
      { err, reference: application.reference },
      'could not send the application confirmation',
    );
  }
}

const EMAIL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const verifyLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: () => env.APPLICATION_RATE_LIMIT * 4,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many codes requested. Try later.' } },
});

router.post(
  '/verify/send',
  verifyLimiter,
  validate({ body: z.object({ phone: applicantPhone }) }),
  asyncHandler(async (req, res) => {
    /*
     * A number that already has an account is refused.
     *
     * Applying is for a practice that is not on the platform. Somebody who can
     * already sign in is either an existing customer — whose practice should be
     * edited, not re-created — or is about to be sent a code that would let an
     * application claim their number.
     */
    const existing = await User.findByLoginPhone(req.body.phone).select('_id').lean();
    if (existing) {
      throw badRequest(
        'This number already has a MedPin account. Sign in on the app, or use a different number.',
      );
    }

    res.json(await requestOtp({ phone: req.body.phone, purpose: PRACTICE_PURPOSE }));
  }),
);

router.post(
  '/verify/check',
  verifyLimiter,
  validate({
    body: z.object({ phone: applicantPhone, code: z.string().trim().regex(/^\d{4,8}$/) }),
  }),
  asyncHandler(async (req, res) => {
    await verifyOtp({ phone: req.body.phone, purpose: PRACTICE_PURPOSE, code: req.body.code });
    // The token carries the number, so the submission never takes it from a
    // field beside the proof — a form that did could verify one number and
    // apply with another.
    res.json({ phoneToken: signPhoneToken(req.body.phone) });
  }),
);

router.post(
  '/',
  submitLimiter,
  validate({
    body: z.object({
      // ---- the practice ---------------------------------------------------
      practiceName: z.string().trim().min(2).max(160),
      practiceType: z.enum(Object.values(PRACTICE_TYPE)).optional(),
      specialty: optionalText(80),

      /*
       * Where the practice is, and it is not optional.
       *
       * These were, and an operator reviewing an application is deciding
       * whether a real clinic exists at a real address — a submission with no
       * location is not a thing anybody can approve or refuse on the evidence.
       * It also has to be checked here and not only on the form: a client is a
       * convenience, and the route is the rule.
       *
       * `practiceType` and `specialty` stay optional, because the model permits
       * null and the capability resolver reads null as unclassified. Requiring
       * them here would be stricter than what the rest of the system enforces.
       */
      addressLine: z.string().trim().min(4).max(200),
      city: z.string().trim().min(2).max(80),
      state: z.string().trim().min(2).max(80),
      // Six digits, which is what an Indian PIN is. A reviewer looking one up
      // cannot do anything with five.
      postalCode: z
        .string()
        .trim()
        .regex(/^\d{6}$/, 'A PIN code is six digits'),

      // ---- who is asking --------------------------------------------------
      contactName: z.string().trim().min(2).max(120),
      contactEmail: z.string().trim().toLowerCase().email(),

      /**
       * Proof, not a number.
       *
       * The phone is read out of this token. A separate `contactPhone` field
       * would be a field somebody can disagree with the proof about.
       */
      phoneToken: z.string().min(10),

      // ---- what a reviewer checks -----------------------------------------
      registrationNo: optionalText(60),
      doctorName: optionalText(120),
      doctorRegistrationNo: optionalText(60),
      notes: optionalText(2000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    const phone = phoneFromToken(b.phoneToken);

    /*
     * One open application per number.
     *
     * Somebody who submits twice has usually pressed the button twice, and two
     * rows for one clinic is two operators reviewing the same thing. A second
     * application is allowed once the first is decided — a rejection is not a
     * ban, and a practice that was turned down for missing papers should be
     * able to come back with them.
     */
    const open = await PracticeApplication.findOne({
      contactPhone: phone,
      status: { $in: [APPLICATION_STATUS.SUBMITTED, APPLICATION_STATUS.UNDER_REVIEW, APPLICATION_STATUS.MORE_INFO] },
    }).lean();

    if (open) {
      throw badRequest(
        'An application from this number is already with us. Use the reference you were given to check it.',
        { reason: 'ALREADY_OPEN', reference: open.reference },
      );
    }

    const blank = (v) => (v && String(v).trim() ? String(v).trim() : null);

    const application = await PracticeApplication.create({
      practiceName: b.practiceName,
      practiceType: b.practiceType ?? null,
      specialty: blank(b.specialty),
      addressLine: blank(b.addressLine),
      city: blank(b.city),
      state: blank(b.state),
      postalCode: blank(b.postalCode),

      contactName: b.contactName,
      contactEmail: b.contactEmail,
      contactPhone: phone,
      phoneVerifiedAt: new Date(),

      registrationNo: blank(b.registrationNo),
      doctorName: blank(b.doctorName),
      doctorRegistrationNo: blank(b.doctorRegistrationNo),
      notes: blank(b.notes),

      history: [{ action: 'submitted', note: null }],
      ip: req.ip ?? null,
    });

    logger.info(
      { reference: application.reference, practice: application.practiceName },
      'practice application submitted',
    );

    // Awaited so the row carries its token before the response goes out, and
    // so a status page opened immediately knows an email is on its way. The
    // send itself cannot throw — see sendConfirmation.
    await sendConfirmation(application);

    res.status(201).json({ application: application.toApplicant() });
  }),
);

/**
 * Where an application has got to.
 *
 * By reference, which is the only thing the applicant holds. It is long and
 * random precisely so this route can exist without a login: a sequential id
 * would let anybody read a stranger's contact details and licence number by
 * counting upwards.
 *
 * A wrong reference is a 404 and says nothing else. "No application with that
 * reference" and "that application is not yours" are the same sentence here.
 */
/**
 * The applicant clicking the link in that email.
 *
 * Public, because the whole point is that it works from an inbox with no
 * account behind it. What makes it safe is the token: unguessable, hashed at
 * rest, spent once, and dead after a week. Knowing a reference is not enough —
 * the status page hands references out and must not be able to confirm one.
 *
 * Idempotent. Somebody who clicks twice, or whose mail client prefetches the
 * link, gets the same answer as the first click rather than an error about a
 * token they used correctly.
 */
router.post(
  '/:reference/confirm-email',
  statusLimiter,
  validate({
    params: z.object({ reference: z.string().trim().min(6).max(40) }),
    body: z.object({ token: z.string().trim().min(10).max(200) }),
  }),
  asyncHandler(async (req, res) => {
    const application = await PracticeApplication.findOne({
      // Not uppercased. The reference is base64url and mixed case is
      // significant — folding it finds nothing, which the first version of
      // this route did and reported as an invalid link.
      reference: req.params.reference,
    }).select('+emailTokenHash');

    // One answer for every failure. Telling a caller that the reference exists
    // but the token is wrong is telling them which references are worth
    // guessing at.
    const refuse = () => badRequest('That confirmation link is not valid, or it has expired.');
    if (!application) throw refuse();

    if (application.contactEmailVerifiedAt) {
      return res.json({ confirmed: true, alreadyConfirmed: true });
    }

    if (!application.emailTokenHash || !application.emailTokenExpiresAt) throw refuse();
    if (application.emailTokenExpiresAt.getTime() < Date.now()) throw refuse();

    const supplied = createHash('sha256').update(req.body.token).digest('hex');
    // Constant-time, so the comparison does not leak the prefix it matched on.
    const ok =
      supplied.length === application.emailTokenHash.length &&
      timingSafeEqual(Buffer.from(supplied), Buffer.from(application.emailTokenHash));
    if (!ok) throw refuse();

    application.contactEmailVerifiedAt = new Date();
    // Spent. The link in the inbox stops working, which is what one-time means.
    application.emailTokenHash = null;
    application.emailTokenExpiresAt = null;
    /*
     * Recorded on the row, which is this application's own log.
     *
     * Neither audit collection can hold it: AdminAuditLog records what an
     * operator did and there is no operator, and the clinical log needs a User
     * as its actor and an applicant has no account. `history` is where the
     * applicant's own actions go — `submitted` is already there — and an
     * operator reading the application sees when the address answered.
     */
    application.history.push({ action: 'email_confirmed' });
    await application.save();

    res.json({ confirmed: true });
  }),
);

/**
 * Send it again, to the address already on the application.
 *
 * Never to an address supplied here. A route that took one would let anybody
 * holding a reference redirect the decision to themselves — and the reference
 * is printed on a confirmation screen.
 */
router.post(
  '/:reference/resend-email',
  verifyLimiter,
  validate({ params: z.object({ reference: z.string().trim().min(6).max(40) }) }),
  asyncHandler(async (req, res) => {
    const application = await PracticeApplication.findOne({
      // Not uppercased. The reference is base64url and mixed case is
      // significant — folding it finds nothing, which the first version of
      // this route did and reported as an invalid link.
      reference: req.params.reference,
    });
    if (!application) throw notFound('No application with that reference.');

    if (application.contactEmailVerifiedAt) {
      return res.json({ sent: false, alreadyConfirmed: true });
    }

    application.history.push({ action: 'email_resent' });
    await sendConfirmation(application);
    res.json({ sent: true });
  }),
);

router.get(
  '/:reference',
  statusLimiter,
  validate({ params: z.object({ reference: z.string().trim().min(6).max(64) }) }),
  asyncHandler(async (req, res) => {
    const application = await PracticeApplication.findOne({
      reference: req.params.reference,
    });
    if (!application) throw notFound('No application with that reference.');

    res.json({ application: application.toApplicant() });
  }),
);

export default router;
