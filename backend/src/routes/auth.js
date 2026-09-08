import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { User, ROLES, LANGUAGES } from '../models/User.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { signAccessToken, issueRefreshToken, rotateRefreshToken, revokeAllForUser } from '../services/tokens.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, unauthorized, conflict, badRequest, notFound } from '../middleware/errors.js';
import { requestOtp, verifyOtp, signPhoneToken, phoneFromToken } from '../services/otp.js';
import { AuditLog } from '../models/AuditLog.js';
import { audit } from '../middleware/audit.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { getClinicSettings } from '../models/ClinicSettings.js';
import { Medication } from '../models/Medication.js';
import { recomputeSchedule } from '../services/medicationSchedule.js';
import { toE164 } from '../utils/phone.js';
import { resolveDoctor } from '../services/doctorContext.js';
import { capabilityContext } from '../middleware/requireCapability.js';
import { describeCapabilities } from '../services/capabilities.js';

const router = Router();

// Credential endpoints are the one place brute force actually pays off.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Please try again in a few minutes.' } },
});

// Normalised to E.164 before it is validated, so a number typed as ten bare
// digits registers and logs in as the same account as one typed with +91.
// Without this the two are different strings, and the lookup is exact.
const phoneSchema = z
  .string()
  .trim()
  .transform(toE164)
  .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number'));

const registerSchema = z.object({
  name: z.string().trim().min(2).max(120),

  // Proof from `/auth/otp/verify` that this number was texted a code and the
  // code came back. The phone is read out of the token, never off the body:
  // taking both and trusting them to match would let a caller verify one
  // number and register another.
  phoneToken: z.string().min(20),
  email: z.string().email().optional(),
  language: z.enum(LANGUAGES).default('en'),
  dateOfBirth: z.coerce.date().optional(),
  gender: z.enum(['male', 'female', 'other', 'undisclosed']).default('undisclosed'),
  address: z.string().trim().max(300).optional(),
  // Optional health details a patient may self-report at sign-up. Ignored for a
  // dietician account. A VitalRecord / GlucoseReading is written only when a
  // value is present.
  heightCm: z.coerce.number().min(50).max(250).optional(),
  weightKg: z.coerce.number().min(10).max(400).optional(),
  systolic: z.coerce.number().min(50).max(300).optional(),
  diastolic: z.coerce.number().min(30).max(200).optional(),
  pulse: z.coerce.number().min(25).max(250).optional(),
  spo2: z.coerce.number().min(50).max(100).optional(),
  glucoseMgDl: z.coerce.number().min(10).max(900).optional(),
  complaints: z.string().trim().max(1000).optional(),
  // No default. It used to be 'type2', so every patient who never answered the
  // question arrived on their own Home screen labelled "Type 2 Diabetes" —
  // a diagnosis nobody had made, printed as fact, on the screen they trust
  // most. The field stays empty until a doctor's diagnosis fills it, and the
  // app already knows how to show "Not set".
  diabetesType: z.enum(['type1', 'type2', 'gestational', 'prediabetes', 'none']).optional(),
  // A dietician onboarding code turns this sign-up into a dietician account
  // instead of a patient. Anything else (or empty) registers a patient.
});

/**
 * Whether a typed code currently onboards a dietician.
 *
 * Read from the clinic settings the doctor last generated, falling back to the
 * env var for a clinic that has never rotated one. Without the stored code
 * here, pressing Generate would mint a code that self-registration then
 * refused — a rotate button that quietly breaks the thing it rotates.
 */
/**
 * Registration makes patients. There is no other kind.
 *
 * There used to be an invite code: a shared secret that, typed into the
 * registration form, turned the new account into a dietician or a front desk.
 * It has been removed, and the reason is not tidiness.
 *
 * A shared code is a credential that cannot be un-shared. It is read out over a
 * counter, forwarded, and photographed; it does not identify who used it, and
 * it works until somebody thinks to rotate it. One of them was used by an
 * account nobody at the clinic recognised, which is exactly the failure the
 * shape guarantees eventually — and a dietician account with no explicit
 * assignments can read every patient record in the clinic.
 *
 * Clinical accounts are created by the doctor, one at a time, in the panel. The
 * doctor knows who they are hiring; a code does not.
 */

// A code request costs the clinic an SMS// A code request costs the clinic an SMS and costs whoever owns the number
// their attention, so it is limited harder than the credential endpoints.
/**
 * The phone reporting whether its medication alarms are actually armed.
 *
 * Posted after every arming pass, so the answer is never older than the last
 * time the app ran. See `remindersArmedAt` on the User model for what it
 * decides.
 */
router.post(
  '/reminder-health',
  requireAuth,
  validate({
    body: z.object({
      armed: z.number().int().min(0).max(500),
      expected: z.number().int().min(0).max(500),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { armed, expected } = req.body;
    await User.updateOne(
      { _id: req.user._id },
      {
        $set: {
          // Only a phone that armed everything it meant to counts as
          // confirmed. A partial set still needs the louder backstop for the
          // doses that are missing, and the server cannot tell which.
          remindersArmedAt: armed > 0 && armed >= expected ? new Date() : null,
          remindersArmedCount: armed,
        },
      },
    );
    res.json({ ok: true });
  }),
);

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 6,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many code requests. Please try again in a few minutes.' } },
});

const otpPurpose = z.enum(['register', 'login']);

/**
 * Text a one-time passcode.
 *
 * The existence check differs by purpose and is deliberate rather than
 * careless: registration has to say "this number already has an account, log
 * in instead" or the patient fills a whole form to be rejected at the end, and
 * login has to say "no account here" or they sit waiting for a message that is
 * never coming. Both answers reveal whether a number is registered. That is
 * the cost of the flow the clinic asked for, and it is the same cost every
 * OTP sign-in in the country pays.
 */
router.post(
  '/otp/request',
  otpLimiter,
  validate({ body: z.object({ phone: phoneSchema, purpose: otpPurpose }) }),
  asyncHandler(async (req, res) => {
    const { phone, purpose } = req.body;

    // Any number this account signs in with, not just its primary. A desk
    // with two lines is one account; a code sent to the second line has to
    // find it, or the number receives a code it can never spend.
    const existing = await User.findByLoginPhone(phone).select('isActive').lean();

    if (purpose === 'register' && existing) {
      throw conflict('This phone number is already registered. Please log in instead.', {
        reason: 'ALREADY_REGISTERED',
      });
    }
    if (purpose === 'login') {
      if (!existing) {
        throw notFound('No account found for this number. Please register first.');
      }
      if (!existing.isActive) {
        throw unauthorized('This account has been deactivated. Please contact the clinic.');
      }
    }

    const result = await requestOtp({ phone, purpose });
    res.json(result);
  }),
);

/**
 * Spend a code.
 *
 * A login ends here with a session. A registration ends with a phone token,
 * because the form still has to be filled in and something has to carry
 * "this number is theirs" across that gap.
 */
router.post(
  '/otp/verify',
  authLimiter,
  validate({
    body: z.object({
      phone: phoneSchema,
      purpose: otpPurpose,
      code: z.string().trim().regex(/^\d{4,8}$/, 'Enter the code from the SMS'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { phone, purpose, code } = req.body;

    await verifyOtp({ phone, purpose, code });

    if (purpose === 'register') {
      // Re-checked after the code is spent: the number could have been
      // registered by someone else during the ten minutes it was valid.
      if (await User.phoneTaken(phone)) {
        throw conflict('This phone number is already registered. Please log in instead.', {
          reason: 'ALREADY_REGISTERED',
        });
      }
      return res.json({ phoneToken: signPhoneToken(phone) });
    }

    const user = await User.findByLoginPhone(phone);
    if (!user || !user.isActive) throw unauthorized('No account found for this number.');

    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user, { req });

    AuditLog.create({ actor: user._id, actorRole: user.role, action: 'login_otp', resource: 'User', resourceId: user._id, ip: req.ip }).catch(() => {});

    res.json({ user: user.toPublic(), accessToken, refreshToken });
  }),
);

router.post(
  '/register',
  authLimiter,
  validate({ body: registerSchema }),
  asyncHandler(async (req, res) => {
    const { name, phoneToken, email, language, dateOfBirth, gender, address, diabetesType } = req.body;

    const phone = phoneFromToken(phoneToken);

    // Checked again here, not only when the code was requested. Between the
    // two calls is a real gap, and two people registering the same number at
    // once must not both succeed.
    if (await User.phoneTaken(phone)) {
      throw conflict('An account with this phone number already exists');
    }

    // Public sign-up is a patient by default; the private dietician code is the
    // only way to self-register a non-patient account.
    //
    // Checked against the code the doctor last generated, falling back to the
    // env var for a clinic that has never rotated one. Without the stored code
    // here, pressing Generate would mint a code that self-registration then
    // refused — a rotate button that quietly breaks the thing it rotates.
    // Not read off the request, and no longer derived from anything the
    // caller can supply. An edited APK can post `role: 'staff'`; there is now
    // nothing here that would look at it.
    const role = ROLES.PATIENT;

    const user = new User({
      name,
      phone,
      email,
      language,
      dateOfBirth,
      gender,
      role,
      // Reaching here means a code sent to this number came back, so the
      // number is proved by construction.
      phoneVerifiedAt: new Date(),
      consent: {
        termsAcceptedAt: new Date(),
        dataProcessingAcceptedAt: new Date(),
        aiDisclaimerAcceptedAt: new Date(),
      },
    });
    // No password. Patients and dieticians sign in with a code texted to the
    // number they just proved is theirs; there is nothing here to set, and a
    // password nobody uses is a credential to lose.
    await user.save();

    // Only patients get a clinical profile. Neither a dietician nor a
    // receptionist has a diabetes record.
    if (role === ROLES.PATIENT) {
      // Assignment, not attribution: `assignedDoctor` is optional, and a
      // patient with none is one the desk assigns later. So this asks without
      // `required` — an ambiguous answer leaves the field unset rather than
      // failing a registration.
      const doctor = await resolveDoctor({});
      const { heightCm, weightKg, systolic, diastolic, pulse, spo2, glucoseMgDl, complaints } = req.body;
      await PatientProfile.create({
        user: user._id,
        diabetesType,
        assignedDoctor: doctor?._id,
        ...(address ? { address } : {}),
        ...(heightCm != null ? { heightCm } : {}),
        ...(weightKg != null ? { baselineWeightKg: weightKg } : {}),
        ...(complaints ? { chiefComplaint: complaints } : {}),
      });

      // Self-reported intake vitals, written only when a value was given.
      const vitals = {};
      if (systolic != null) vitals.systolic = systolic;
      if (diastolic != null) vitals.diastolic = diastolic;
      if (pulse != null) vitals.pulse = pulse;
      if (spo2 != null) vitals.spo2 = spo2;
      if (weightKg != null) vitals.weightKg = weightKg;
      if (Object.keys(vitals).length) await VitalRecord.create({ patient: user._id, ...vitals });
      if (glucoseMgDl != null) {
        await GlucoseReading.create({ patient: user._id, valueMgDl: glucoseMgDl, context: 'random', source: 'manual' });
      }
    }

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user, { req });

    AuditLog.create({ actor: user._id, actorRole: user.role, action: 'register', resource: 'User', resourceId: user._id, ip: req.ip }).catch(() => {});

    res.status(201).json({ user: user.toPublic(), accessToken, refreshToken });
  }),
);

router.post(
  '/login',
  authLimiter,
  validate({ body: z.object({ phone: phoneSchema, password: z.string().min(1) }) }),
  asyncHandler(async (req, res) => {
    const { phone, password } = req.body;

    const user = await User.findByLoginPhone(phone).select('+passwordHash');
    // Same error either way — a different message for "no such user" tells an
    // attacker which numbers are registered patients. An account with no
    // password hash (every patient and dietician registered since OTP sign-up)
    // fails here for the same reason and with the same words.
    if (!user || !user.isActive || !user.passwordHash || !(await user.verifyPassword(password))) {
      logger.warn({ phone: `***${phone.slice(-4)}` }, 'failed login attempt');
      throw unauthorized('Incorrect phone number or password');
    }

    user.lastLoginAt = new Date();
    await user.save();

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user, { req });

    AuditLog.create({ actor: user._id, actorRole: user.role, action: 'login', resource: 'User', resourceId: user._id, ip: req.ip }).catch(() => {});

    res.json({ user: user.toPublic(), accessToken, refreshToken });
  }),
);

router.post(
  '/refresh',
  validate({ body: z.object({ refreshToken: z.string().min(10) }) }),
  asyncHandler(async (req, res) => {
    const record = await rotateRefreshToken(req.body.refreshToken, req);
    const user = await User.findById(record.user);
    if (!user || !user.isActive) throw unauthorized('Account is inactive');

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user, { familyId: record.familyId, req });

    res.json({ accessToken, refreshToken });
  }),
);

router.post(
  '/logout',
  requireAuth,
  asyncHandler(async (req, res) => {
    await revokeAllForUser(req.user._id, 'logout');
    res.status(204).end();
  }),
);

router.post(
  '/device-token',
  requireAuth,
  validate({ body: z.object({ token: z.string().min(10).max(500) }) }),
  asyncHandler(async (req, res) => {
    // A device belongs to whoever signed in on it LAST. Detach this token from
    // every OTHER account first, then attach it here — so a shared phone (or one
    // person testing both the patient and doctor roles) never keeps receiving a
    // previous user's notifications.
    await User.updateMany(
      { _id: { $ne: req.user._id }, deviceTokens: req.body.token },
      { $pull: { deviceTokens: req.body.token } },
    );
    await User.updateOne({ _id: req.user._id }, { $addToSet: { deviceTokens: req.body.token } });
    res.status(204).end();
  }),
);

// No requireAuth on purpose: sign-out clears the session BEFORE this fires, so a
// requireAuth version 401s and the token lingers on the account — the exact bug
// that made a signed-out/next user keep getting the previous user's pushes.
// Unregistering a device by its own token is safe, so remove it from everyone.
router.delete(
  '/device-token',
  validate({ body: z.object({ token: z.string().min(10).max(500) }) }),
  asyncHandler(async (req, res) => {
    await User.updateMany({ deviceTokens: req.body.token }, { $pull: { deviceTokens: req.body.token } });
    res.status(204).end();
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const profile =
      req.user.role === ROLES.PATIENT ? await PatientProfile.findOne({ user: req.user._id }).lean() : null;
    res.json({ user: req.user.toPublic(), profile });
  }),
);

/**
 * What this account may see and do, so the client can build itself.
 *
 * ---- Why the client is told rather than deciding ------------------------
 *
 * The alternative is a switch in the app: `if (plan == 'hospital') showTabs()`.
 * That puts the product's shape in the client, where it ships on a release
 * cycle measured in app-store reviews, and where two clients disagree the
 * moment one of them is a version behind. A doctor upgrading their plan would
 * see the same six tabs until they updated the app.
 *
 * So the server answers "what is available" and the client answers "where to
 * put it". A capability the server stops sending disappears from the
 * navigation on the next load, on every client at once.
 *
 * ---- And it is not a security boundary ----------------------------------
 *
 * Nothing here is trusted. `requireCapability` guards the routes, and this
 * endpoint exists so the app does not offer a button that would be refused —
 * which is a courtesy to the person using it, not a control on them. An app
 * that ignored this response would get 403s, not data.
 *
 * `practice` is what the organisation has. `effective` is what this person may
 * use, which is the smaller of the two and the one to build navigation from.
 * Both are sent because "your practice has this and your account does not" is
 * an answer worth being able to give.
 */
router.get(
  '/me/capabilities',
  requireAuth,
  asyncHandler(async (req, res) => {
    const ctx = await capabilityContext(req);
    res.json({
      ...describeCapabilities(ctx),
      // Null for a caller the backfill has not reached, and for every patient.
      // The client should read it as "no practice context", not as "no access".
      membership: ctx.membership
        ? {
            role: ctx.membership.role,
            isOwner: Boolean(ctx.membership.isOwner),
            permissions: ctx.membership.permissions ?? [],
          }
        : null,
    });
  }),
);

router.patch(
  '/me',
  requireAuth,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      email: z.string().email().optional(),
      language: z.enum(LANGUAGES).optional(),
      dateOfBirth: z.coerce.date().optional(),
      gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional(),
      // The patient's home address — captured at registration but, until now,
      // editable nowhere afterward.
      address: z.string().trim().max(300).optional(),
      avatarAssetId: z.string().optional(),
      // Doctor letterhead + signature.
      qualifications: z.string().trim().max(120).optional(),
      specialty: z.string().trim().max(120).optional(),
      registrationNo: z.string().trim().max(60).optional(),
      signatureAssetId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    Object.assign(req.user, req.body);
    await req.user.save();
    res.json({ user: req.user.toPublic() });
  }),
);

/**
 * Delete (deactivate) the signed-in user's own account.
 *
 * Deactivates rather than physically erasing: a clinic record must not silently
 * vanish, and both login and every patient/overview listing already exclude
 * inactive accounts — so the account disappears from the app and can no longer
 * sign in. (This is also what removes a throwaway/test account from the clinic.)
 */
router.delete(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    req.user.isActive = false;
    await req.user.save();
    res.status(204).end();
  }),
);

router.patch(
  '/me/profile',
  audit('update', 'PatientProfile'),
  requireAuth,
  validate({
    body: z.object({
      heightCm: z.number().min(50).max(250).optional(),
      diabetesType: z.enum(['type1', 'type2', 'gestational', 'prediabetes', 'none']).optional(),
      diagnosedOn: z.coerce.date().optional(),
      // The patient's main concern — captured at registration ("Complaints"),
      // editable here so they can keep it current. Empty string clears it.
      chiefComplaint: z.string().trim().max(1000).optional(),
      allergies: z.array(z.string().max(120)).max(30).optional(),
      emergencyContact: z
        .object({ name: z.string().max(120), phone: z.string().max(20), relation: z.string().max(60) })
        .partial()
        .optional(),
      targets: z
        .object({
          fastingMin: z.number().min(50).max(200),
          fastingMax: z.number().min(60).max(250),
          postPrandialMax: z.number().min(80).max(300),
          hba1cMax: z.number().min(5).max(12),
        })
        .partial()
        .optional(),
      mealTimes: z
        .object({
          breakfast: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          lunch: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          dinner: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        })
        .partial()
        .optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const profile = await PatientProfile.findOneAndUpdate(
      { user: req.user._id },
      { $set: flattenForUpdate(req.body) },
      { new: true, upsert: true },
    ).lean();

    // When meal times change, re-derive reminder times for every active medicine
    // the patient has NOT hand-overridden, so "before breakfast" tracks the new
    // breakfast time automatically.
    if (req.body.mealTimes) {
      const meds = await Medication.find({ patient: req.user._id, isActive: true, timesCustomized: { $ne: true } });
      for (const med of meds) {
        med.schedule = recomputeSchedule(med.schedule, profile.mealTimes);
        await med.save();
      }
    }

    res.json({ profile });
  }),
);

/** Dot-notation so a partial `targets` patch does not wipe unsent sibling keys. */
function flattenForUpdate(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
      Object.assign(out, flattenForUpdate(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

export default router;
