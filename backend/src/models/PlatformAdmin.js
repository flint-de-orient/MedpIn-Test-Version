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

    lastLoginAt: { type: Date, default: null },
  },
  { timestamps: true },
);

platformAdminSchema.methods.checkPassword = function checkPassword(plain) {
  if (!this.passwordHash) return false;
  return bcrypt.compare(plain, this.passwordHash);
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
