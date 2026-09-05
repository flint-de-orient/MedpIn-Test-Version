import mongoose from 'mongoose';
import crypto from 'node:crypto';

/**
 * A one-time passcode in flight.
 *
 * The code itself is never stored. What is kept is a SHA-256 of the code
 * salted with the phone number and the purpose, so a leaked collection cannot
 * be replayed and a code minted for a login cannot be spent on a registration.
 * SHA over bcrypt here on purpose: this is a six-digit secret that lives for
 * ten minutes behind an attempt counter, so the cost of a slow hash buys
 * nothing an attacker cannot already brute-force out of the rate limiter —
 * and verification sits on the login path, where latency is felt.
 */
const otpChallengeSchema = new mongoose.Schema(
  {
    // E.164, matching User.phone, so the same number is the same row however
    // the patient typed it.
    phone: { type: String, required: true, index: true },

    // Registration and login are separate secrets. A code texted to prove a
    // new number must not open an existing account.
    // `enrol` is a desk asking to be linked to a patient who already has an
    // account elsewhere. Its own purpose rather than reusing `register`,
    // because there is one live code per number per purpose and an enrolment
    // code arriving would otherwise burn a registration the patient was
    // part-way through.
    purpose: { type: String, enum: ['register', 'login', 'enrol'], required: true },

    codeHash: { type: String, required: true },

    // Wrong guesses so far. At the cap the challenge is dead and the caller
    // has to ask for a new code — which the resend cooldown then paces.
    attempts: { type: Number, default: 0 },

    // Set the moment a code is spent. A consumed challenge verifies as
    // failed, so a code cannot be used twice even inside its ten minutes.
    consumedAt: { type: Date, default: null },

    // Drives the resend cooldown.
    lastSentAt: { type: Date, default: Date.now },

    // Mongo drops the document at this time. The row is transient by nature
    // and there is no reason to keep a record of who asked for a code.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

// One live challenge per number per purpose. Requesting again overwrites,
// which is what makes "the newest code is the only code" true rather than a
// convention some endpoint has to remember.
otpChallengeSchema.index({ phone: 1, purpose: 1 }, { unique: true });

// TTL. Mongo's reaper runs about once a minute, so a document can outlive
// expiresAt briefly — every read checks the date rather than trusting the
// collection to be clean.
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/** The stored form of a code. Salted with what it was issued for. */
export function hashOtp(code, phone, purpose) {
  return crypto.createHash('sha256').update(`${phone}:${purpose}:${code}`).digest('hex');
}

/**
 * A six-digit code from a cryptographic source.
 *
 * `randomInt` rather than `Math.random`, and never zero-padded from a smaller
 * range: "000000" through "099999" have to be as likely as any other code or
 * the first digit leaks.
 */
export function generateOtp() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
}

export const OtpChallenge = mongoose.model('OtpChallenge', otpChallengeSchema);
