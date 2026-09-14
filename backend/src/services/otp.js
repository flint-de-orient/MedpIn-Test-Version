import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { OtpChallenge, generateOtp, hashOtp } from '../models/OtpChallenge.js';
import { sendOtpSms, maskPhone } from './sms.js';
import { AppError, badRequest, tooMany, unauthorized } from '../middleware/errors.js';
import { logger } from '../config/logger.js';

/**
 * Issuing and spending one-time passcodes.
 *
 * The rules the clinic asked for, in one place rather than scattered through
 * the route handlers: ten minutes to live, five wrong guesses, a resend
 * cooldown, one live code per number per purpose, and the code burned the
 * moment it is spent.
 */

const TTL_MS = () => env.OTP_TTL_MINUTES * 60_000;

/**
 * Text a fresh code for this number and purpose.
 *
 * Replaces whatever was outstanding: the newest code is always the only code,
 * so a patient who requests twice and then types the first message's digits is
 * told it is wrong rather than being let in on a superseded secret.
 */
export async function requestOtp({ phone, purpose }) {
  const existing = await OtpChallenge.findOne({ phone, purpose });

  // Cooldown, so the resend button cannot be leaned on — both to keep the
  // clinic's SMS bill finite and to stop a number being flooded by someone
  // who does not own it.
  if (existing?.lastSentAt) {
    const waited = Date.now() - existing.lastSentAt.getTime();
    const cooldown = env.OTP_RESEND_COOLDOWN_SECONDS * 1000;
    if (waited < cooldown) {
      const retryAfter = Math.ceil((cooldown - waited) / 1000);
      throw tooMany(`Please wait ${retryAfter} seconds before asking for another code.`);
    }
  }

  const code = generateOtp();
  const now = new Date();

  // Written before the SMS goes out. If the send throws, the row is removed
  // below — the other order would leave a window where the patient has a code
  // the server has not stored yet.
  await OtpChallenge.findOneAndUpdate(
    { phone, purpose },
    {
      phone,
      purpose,
      codeHash: hashOtp(code, phone, purpose),
      attempts: 0,
      consumedAt: null,
      lastSentAt: now,
      expiresAt: new Date(now.getTime() + TTL_MS()),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  let sent;
  try {
    sent = await sendOtpSms({ phone, code, purpose });
  } catch (err) {
    await OtpChallenge.deleteOne({ phone, purpose }).catch(() => {});
    throw err;
  }

  return {
    expiresInSeconds: Math.floor(TTL_MS() / 1000),
    resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    // Whether the code was actually texted, as the sender reports it — so a
    // clinic running without credentials can see why no SMS arrived, rather
    // than assuming the network ate it. It was `!smsConfigured()`, which said
    // "sent" in a test run holding live credentials that sent nothing. Never
    // true in production: the sender throws there instead.
    simulated: sent?.simulated === true,
  };
}

/**
 * Spend a code.
 *
 * Throws on anything short of a match; returns nothing useful on success
 * because the caller decides what a verified phone earns — tokens for a login,
 * a short-lived phone token for a registration.
 */
export async function verifyOtp({ phone, purpose, code }) {
  const challenge = await OtpChallenge.findOne({ phone, purpose });

  // One message for every failure. Distinguishing "no code was requested" from
  // "wrong digits" tells whoever is guessing which numbers are worth guessing
  // at, and the patient in front of the phone cannot act on the difference.
  const wrong = () => unauthorized('That code is not right, or it has expired. Please request a new one.');

  if (!challenge) throw wrong();
  // Checked rather than trusted to the TTL index: Mongo's reaper runs about
  // once a minute, so an expired document is readable for a while yet.
  if (challenge.expiresAt.getTime() <= Date.now()) throw wrong();
  if (challenge.consumedAt) throw wrong();

  if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
    throw tooMany('Too many incorrect attempts. Please request a new code.');
  }

  if (challenge.codeHash !== hashOtp(code, phone, purpose)) {
    challenge.attempts += 1;
    await challenge.save();
    logger.warn(
      { phone: maskPhone(phone), purpose, attempts: challenge.attempts },
      'incorrect OTP',
    );
    // At the cap the code is dead. Saying so beats a patient trying a sixth
    // time and getting the same "not right" for a reason that has changed.
    if (challenge.attempts >= env.OTP_MAX_ATTEMPTS) {
      throw tooMany('Too many incorrect attempts. Please request a new code.');
    }
    throw wrong();
  }

  // Spent. Deleted rather than flagged — there is nothing here worth keeping
  // and a row that cannot be replayed is better than one that must not be.
  await OtpChallenge.deleteOne({ _id: challenge._id });
  return true;
}

/**
 * Proof that this number was verified, for the registration form to hand back.
 *
 * Registration is two round trips: verify the phone, then submit the details.
 * Something has to carry "this number is theirs" across the gap, and it cannot
 * be the client's word for it. A short-lived signed token does it without a
 * second collection, and its ten minutes is the same ten the patient was told
 * the code would last.
 */
export function signPhoneToken(phone) {
  return jwt.sign({ phone, use: 'phone_verified' }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.OTP_TTL_MINUTES}m`,
    issuer: 'akd-care',
  });
}

/** The number a phone token vouches for, or a 400 if it vouches for nothing. */
export function phoneFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'akd-care' });
  } catch {
    throw badRequest('Phone verification expired. Please verify your number again.');
  }
  // An access token is signed with the same secret and would otherwise pass.
  if (payload.use !== 'phone_verified' || !payload.phone) {
    throw badRequest('Phone verification expired. Please verify your number again.');
  }
  return payload.phone;
}

/** What an application's proof says it is for. See signApplicationPhoneToken. */
const APPLICATION_USE = 'practice_application';

/**
 * Proof of a number for a practice application, which outlives the code.
 *
 * ---- Its own lifetime, and its own `use` --------------------------------
 *
 * The code lives as long as the SMS says. The proof has to last through the
 * rest of a form a patient's registration does not have — see
 * APPLICATION_PHONE_TOKEN_MINUTES — and while it shared the code's ten minutes
 * a slow applicant was refused at Submit with a number they had just proved.
 *
 * A different `use`, so the longer life buys nothing anywhere else. Patient
 * registration and the console's head-doctor check accept `phone_verified`
 * only, and half an hour of proof put in front of either is refused rather
 * than stretching their ten minutes to thirty.
 */
export function signApplicationPhoneToken(phone) {
  return jwt.sign({ phone, use: APPLICATION_USE }, env.JWT_ACCESS_SECRET, {
    expiresIn: `${env.APPLICATION_PHONE_TOKEN_MINUTES}m`,
    issuer: 'akd-care',
  });
}

/**
 * The number an application's proof vouches for, and why it does not.
 *
 * Takes the application proof and the ordinary one: a code spent through
 * `/auth/otp/verify` with purpose `practice` proves the number just as well.
 *
 * What it adds is a name for the commonest failure. An expired proof is
 * `PHONE_TOKEN_EXPIRED`, so the form can drop it and ask for the number again;
 * as a bare 400 with a sentence, the form kept the dead token and the applicant
 * pressed Submit into the same refusal until they gave up.
 */
export function applicantPhoneFromToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'akd-care' });
  } catch (err) {
    if (err?.name === 'TokenExpiredError') {
      throw new AppError(
        400,
        'PHONE_TOKEN_EXPIRED',
        'The check on your mobile number has expired. Verify the number again, then submit.',
      );
    }
    throw badRequest('Phone verification expired. Please verify your number again.');
  }
  // An access token is signed with the same secret and would otherwise pass.
  if (![APPLICATION_USE, 'phone_verified'].includes(payload.use) || !payload.phone) {
    throw badRequest('Phone verification expired. Please verify your number again.');
  }
  return payload.phone;
}
