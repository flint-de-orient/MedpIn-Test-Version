import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * Whoever runs MedPin. Not a `User`, and deliberately not.
 *
 * ---- Why this is a separate table and not a role ------------------------
 *
 * A flag on a user would mean the platform's most powerful account lives in
 * the same collection, behind the same login, reachable by the same routes as
 * every patient and clinician. Then a bug in the clinic app — a role check
 * inverted, a scope forgotten, a token minted with the wrong claims — reaches
 * every practice on the platform rather than one clinic's records.
 *
 * The specification puts it plainly: the platform role lives elsewhere, with
 * its own login and its own audit log, and no clinical data.
 *
 * So this shares nothing with `User`. Different collection, different secret
 * (see [services/adminTokens.js]), different issuer. A clinic token cannot
 * verify against the admin secret and an admin token cannot verify against the
 * clinic's — the separation is cryptographic, not a claim somebody could forge
 * or a check somebody could forget to write.
 *
 * ---- What it deliberately cannot do -------------------------------------
 *
 * There is no patient, no enrollment and no clinical route in the admin
 * namespace. An administrator can create a practice, verify its registration,
 * activate and suspend it. They cannot read a record. Verifying a practice is
 * not being given its patients.
 */
const platformAdminSchema = new mongoose.Schema(
  {
    /// Email rather than phone: this is a desk-and-laptop account, and the
    /// OTP-by-SMS flow the clinic uses is built for people standing at a
    /// counter.
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
    },

    name: { type: String, required: true, trim: true, maxlength: 120 },

    /// Bcrypt. Never selected by default, so a stray `.find()` in a future
    /// route cannot put it in a response.
    passwordHash: { type: String, required: true, select: false },

    /// Soft-disable, so a departed administrator's audit entries still resolve
    /// to a name and a reason for having had access.
    isActive: { type: Boolean, default: true, index: true },

    /// Second factor. Base32, never selected by default — the same reasoning
    /// as the password hash, and more so: a leaked TOTP secret is a permanent
    /// bypass of the factor it exists to provide.
    totpSecret: { type: String, default: null, select: false },

    /// True once a code has been verified against the secret. Enrolment is not
    /// complete until the operator has proved their app works, or a mistyped
    /// setup locks them out of their own panel.
    totpEnabled: { type: Boolean, default: false },

    /// Consecutive failures, and the wall they build.
    ///
    /// The IP rate limit is the first line and it is defeated by rotating
    /// addresses, which is cheap. This one is per account, so the attacker's
    /// budget is spent whatever address they come from.
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },

    /// A reset in flight. Hashed, never stored plainly — a database dump must
    /// not hand somebody a working reset, which is the same reason the password
    /// is not stored either.
    resetTokenHash: { type: String, default: null, select: false },
    resetTokenExpiresAt: { type: Date, default: null },

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

platformAdminSchema.methods.checkPassword = function checkPassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
};

/// How long the account is shut after repeated failures.
///
/// Five attempts then fifteen minutes. Long enough that guessing is hopeless,
/// short enough that a locked-out operator waits rather than needing a shell on
/// the server — a lockout only an engineer can lift is one that becomes an
/// engineer's Sunday.
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

platformAdminSchema.methods.isLocked = function isLocked() {
  return Boolean(this.lockedUntil && this.lockedUntil > new Date());
};

/// Record a failure, locking the account once it has had enough.
platformAdminSchema.methods.noteFailure = function noteFailure() {
  this.failedAttempts = (this.failedAttempts ?? 0) + 1;
  if (this.failedAttempts >= MAX_ATTEMPTS) {
    this.lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000);
    this.failedAttempts = 0;
  }
  return this.save();
};

/// A success clears the count. Four failures then a correct password is a
/// person who mistyped, not an attacker who got lucky.
platformAdminSchema.methods.noteSuccess = function noteSuccess() {
  this.failedAttempts = 0;
  this.lockedUntil = null;
  this.lastLoginAt = new Date();
  return this.save();
};

platformAdminSchema.statics.hashPassword = function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
};

platformAdminSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    email: this.email,
    name: this.name,
    isActive: this.isActive,
    lastLoginAt: this.lastLoginAt,
  };
};

export const PlatformAdmin = mongoose.model('PlatformAdmin', platformAdminSchema);
