import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler, badRequest, notFound } from '../middleware/errors.js';
import {
  applicantPhoneFromToken,
  requestOtp,
  signApplicationPhoneToken,
  verifyOtp,
} from '../services/otp.js';
import { User, ROLES } from '../models/User.js';
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
import { Department } from '../models/Department.js';
import { BY_TYPE, CAPABILITIES } from '../services/capabilities.js';
import { PracticeApplication, OPEN_STATUSES } from '../models/PracticeApplication.js';
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
 *   * The phone is proved first. `/verify/check` returns a short-lived token,
 *     and this route takes the token rather than the number. One person cannot
 *     file applications naming numbers that are not theirs.
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
    /*
     * Which kinds of practice have departments, answered from the table that
     * decides it rather than from a copy.
     *
     * `BY_TYPE` in capabilities.js is what actually grants DEPARTMENT, and a
     * clinic never has one on any plan — that is what a solo practice is. A
     * list of "types with departments" written into this route, or worse into
     * the form, would be a second opinion that disagrees the first time
     * somebody edits the real one.
     *
     * The plan is not consulted. An applicant has no plan yet, and this only
     * decides whether the form is worth showing them: an operator approving a
     * polyclinic onto Essential will find DEPARTMENT withheld later, which is
     * a sale rather than a mistake in the application.
     */
    const departmental = new Set(
      Object.entries(BY_TYPE)
        .filter(([, caps]) => caps.includes(CAPABILITIES.DEPARTMENT))
        .map(([type]) => type),
    );

    /*
     * The shared departments, which are also the specialties.
     *
     * `practice: null` rows are the standard list every practice sees — see
     * Department.js on why "Cardiologist" is not kept a hundred times. It is
     * the same vocabulary the console's own create wizard offers, from the
     * same query, so an application cannot name a specialty the console has
     * never heard of.
     */
    const shared = await Department.find({ practice: null, isActive: true })
      .select('key names')
      .sort({ key: 1 })
      .lean();

    res.json({
      types: PRACTICE_TYPE_ORDER.map((key) => ({
        key,
        label: key
          .split('_')
          .map((w) => w[0].toUpperCase() + w.slice(1))
          .join(' '),
        hasDepartments: departmental.has(key),
      })),
      departments: shared.map((d) => ({ key: d.key, label: d.names?.en ?? d.key })),
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
 * ---- Written first, sent after --------------------------------------------
 *
 * The token is minted and stored before the applicant is answered, so a status
 * page opened the next second already knows an email is on its way. The message
 * itself goes out after the answer — see deliverConfirmation.
 *
 * With no SMTP configured `sendMail` writes the message to the log rather than
 * pretending, so a deployment without mail still shows the reference on screen
 * and the link is recoverable by whoever reads the logs.
 */
async function prepareConfirmation(application) {
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

  return {
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
  };
}

/**
 * Send it, without anybody waiting.
 *
 * ---- Never fatal, and never awaited ---------------------------------------
 *
 * A send that throws must not fail the submission. The application is already
 * written and it is the thing that matters; an SMTP timeout is not a reason to
 * tell somebody their registration did not go through, and the operator can
 * see the address is unconfirmed and chase the phone number instead.
 *
 * It was awaited, over a transport with no timeouts, so a mail host that took
 * the connection and said nothing held the applicant on "Submitting…" for as
 * long as it liked — long enough to press Submit again, into "already with
 * us". The applicant is answered first now, and a failure is logged.
 */
function deliverConfirmation(application, message) {
  sendMail(message).catch((err) => {
    logger.error(
      { err, reference: application.reference },
      'could not send the application confirmation',
    );
  });
}

const EMAIL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether the account already on this number, if any, may own a new practice.
 *
 * ---- A doctor may, and nobody else already signed in may -----------------
 *
 * This refused every number with an account, on the grounds that applying is
 * for a practice that is not on the platform. It is — but not for a *person*
 * who is not. A doctor opening a second practice is the case approval was built
 * for: joinByPhone joins the account that exists rather than making a second
 * one. Telling them to "sign in on the app" sent them somewhere with nothing to
 * apply with.
 *
 * Every other account is still refused, and is now told why. The number that
 * applies becomes the owner's sign-in, and an account keeps one role
 * everywhere: a patient's number would put their own record under whoever runs
 * the practice, and a desk or a dietician somewhere cannot become the owner of
 * a practice by filling in a form.
 *
 * Asked once the code is answered and again on submission, and never before a
 * code is answered: the refusal names the kind of account, and a patient's
 * number must not tell a stranger that its owner is a patient. Submission asks
 * again because a proof can be had from /auth/otp/verify without passing
 * through /verify/check.
 */
async function assertMayApply(phone) {
  const existing = await User.findByLoginPhone(phone).select('role').lean();
  if (!existing || existing.role === ROLES.DOCTOR) return;

  const kind = String(existing.role).replace(/_/g, ' ');
  throw new AppError(
    409,
    'ACCOUNT_NOT_ELIGIBLE',
    `This number already has a MedPin ${kind} account, so it cannot register a practice. ` +
      'The number that applies becomes the practice owner’s sign-in, and an account keeps one role ' +
      'everywhere. Apply with the doctor’s or the practice manager’s own number instead.',
  );
}

/** The open application on this number, if there is one. */
function openApplicationFor(phone) {
  return PracticeApplication.findOne({ contactPhone: phone, status: { $in: OPEN_STATUSES } })
    .select('reference')
    .lean();
}

/**
 * "Already with us", carrying the reference that sentence tells them to use.
 *
 * A 409 with its own code rather than a 400. Nothing about the request is
 * malformed — it collides with something that exists — and the form has to
 * tell this refusal from every other one, because the right thing to show is
 * the application, not an error. Handing the reference back is safe here: the
 * caller has just proved they answer the number it was filed from.
 */
function alreadyOpen(open) {
  return new AppError(
    409,
    'APPLICATION_OPEN',
    'An application from this number is already with us, so this one was not filed. ' +
      'Use its reference to see where it has got to.',
    { reference: open.reference },
  );
}

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
    // No account check here. The refusal names the kind of account, and said
    // before the code is answered it would tell whoever typed a number that its
    // owner is a MedPin patient. /verify/check asks once the code is answered,
    // and submission asks again.
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
    // Whoever answered the code holds the number, so they may be told why it
    // cannot apply — and are given no proof to apply with.
    await assertMayApply(req.body.phone);
    // The token carries the number, so the submission never takes it from a
    // field beside the proof — a form that did could verify one number and
    // apply with another. It outlives the code; see signApplicationPhoneToken.
    res.json({
      phoneToken: signApplicationPhoneToken(req.body.phone),
      expiresInSeconds: env.APPLICATION_PHONE_TOKEN_MINUTES * 60,
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
       * Whether the person applying is the doctor who will run it.
       *
       * Optional so a form served before the question existed can still file,
       * and read as yes — the only answer that form ever gave. See the model.
       */
      contactIsPrimaryDoctor: z.boolean().optional(),

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

      // Keys, checked against the shared catalogue below. A cap because this is
      // an unauthenticated route and an unbounded array is a way to write a lot
      // of somebody else's disk.
      departments: z.array(z.string().trim().min(1).max(80)).max(24).optional(),
      doctorDepartment: optionalText(80),
      notes: optionalText(2000),
    }),
  }),
  asyncHandler(async (req, res) => {
    const b = req.body;
    // An expired proof is refused by name, so the form can ask for the number
    // again rather than let the applicant press Submit into the same wall.
    const phone = applicantPhoneFromToken(b.phoneToken);

    await assertMayApply(phone);

    /*
     * Departments, kept only where they are real and only where they apply.
     *
     * Two filters, and each refuses something different. The catalogue check
     * drops a key the platform has never defined — an applicant cannot invent a
     * specialty that becomes a row on approval. The type check drops the lot
     * when the practice is a kind that has none: a clinic that posted a
     * department list, by hand or because the form was stale, is a clinic, and
     * the capability table is what says so.
     */
    const asked = [...new Set(b.departments ?? [])];
    const departmental = BY_TYPE[b.practiceType]?.includes(CAPABILITIES.DEPARTMENT) ?? false;

    const known = asked.length
      ? (
          await Department.find({ practice: null, isActive: true, key: { $in: asked } })
            .select('key')
            .lean()
        ).map((d) => d.key)
      : [];

    const departments = departmental ? known : [];

    /*
     * One open application per number.
     *
     * Somebody who submits twice has usually pressed the button twice, and two
     * rows for one clinic is two operators reviewing the same thing. A second
     * application is allowed once the first is decided — a rejection is not a
     * ban, and a practice that was turned down for missing papers should be
     * able to come back with them.
     *
     * Read first for the ordinary case, and refused by the unique index on
     * `openPhone` for the other one: two presses arriving together both read
     * "nothing open" before either has written, and only the database can say
     * no to the second. Either way the answer carries the reference.
     */
    const open = await openApplicationFor(phone);
    if (open) throw alreadyOpen(open);

    const blank = (v) => (v && String(v).trim() ? String(v).trim() : null);

    let application;
    try {
      application = await PracticeApplication.create({
        practiceName: b.practiceName,
        practiceType: b.practiceType ?? null,
        specialty: blank(b.specialty),
        addressLine: blank(b.addressLine),
        city: blank(b.city),
        state: blank(b.state),
        postalCode: blank(b.postalCode),

        contactName: b.contactName,
        contactEmail: b.contactEmail,
        contactIsPrimaryDoctor: b.contactIsPrimaryDoctor ?? null,
        contactPhone: phone,
        phoneVerifiedAt: new Date(),

        registrationNo: blank(b.registrationNo),
        doctorName: blank(b.doctorName),
        doctorRegistrationNo: blank(b.doctorRegistrationNo),
        departments,
        doctorDepartment: departments.includes(b.doctorDepartment) ? b.doctorDepartment : null,
        notes: blank(b.notes),

        history: [{ action: 'submitted', note: null }],
        ip: req.ip ?? null,
      });
    } catch (err) {
      if (err?.code === 11000 && err.keyPattern?.openPhone) {
        const winner = await openApplicationFor(phone);
        if (winner) throw alreadyOpen(winner);
      }
      throw err;
    }

    logger.info(
      { reference: application.reference, practice: application.practiceName },
      'practice application submitted',
    );

    const confirmation = await prepareConfirmation(application);
    res.status(201).json({ application: application.toApplicant() });
    deliverConfirmation(application, confirmation);
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
    const confirmation = await prepareConfirmation(application);
    res.json({ sent: true });
    deliverConfirmation(application, confirmation);
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
