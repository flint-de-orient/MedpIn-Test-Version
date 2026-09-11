import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import { phoneFromToken } from '../services/otp.js';
import { PRACTICE_TYPE, PRACTICE_TYPE_ORDER } from '../models/Practice.js';
import {
  PracticeApplication,
  APPLICATION_STATUS,
} from '../models/PracticeApplication.js';
import { logger } from '../config/logger.js';
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

router.post(
  '/',
  submitLimiter,
  validate({
    body: z.object({
      // ---- the practice ---------------------------------------------------
      practiceName: z.string().trim().min(2).max(160),
      practiceType: z.enum(Object.values(PRACTICE_TYPE)).optional(),
      specialty: optionalText(80),
      addressLine: optionalText(200),
      city: optionalText(80),
      state: optionalText(80),
      postalCode: optionalText(12),

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
