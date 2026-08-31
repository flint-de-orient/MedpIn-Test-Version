import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

/**
 * The filter that finds an account by any number it can sign in with.
 *
 * Written once and used by every lookup in the auth path. Eight places asked
 * `{ phone }` directly; each would have had to learn about alternates
 * separately, and the one that was missed would be a number that receives a
 * code and then cannot spend it.
 */
export function byLoginPhone(phone) {
  return { $or: [{ phone }, { altPhones: phone }] };
}

export const ROLES = Object.freeze({
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  STAFF: 'staff',
  DIETICIAN: 'dietician',
});

export const LANGUAGES = Object.freeze(['en', 'bn', 'hi']);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      // Stored E.164-ish; the app normalises to +91XXXXXXXXXX before sending.
      match: [/^\+?[1-9]\d{7,14}$/, 'invalid phone number'],
    },
    email: {
      type: String,
      lowercase: true,
      trim: true,
      sparse: true,
      unique: true,
      match: [/^\S+@\S+\.\S+$/, 'invalid email'],
    },
    // Optional since sign-in moved to a texted code. Patients and dieticians
    // registered this way never get one; doctors and staff, who are onboarded
    // by the clinic and may sign in with a password, do. Accounts created
    // before the change keep theirs and keep working.
    /// Other numbers that sign in to this same account.
    ///
    /// A clinic reception desk is one identity with two lines. Giving it two
    /// accounts would work — staff data is clinic-wide, so both would see the
    /// same thing — but a patient would then get replies from "Clinic
    /// Reception" and "Clinic Reception 2" and reasonably wonder how many
    /// receptions there are. One desk should look like one desk.
    ///
    /// These are login credentials, not contact details. The numbers patients
    /// ring live on the Clinic record; these are numbers that can receive a
    /// one-time code for this account. Every one of them can sign in and reach
    /// exactly the same data, and every action is recorded against the one
    /// account whichever line was used.
    ///
    /// Uniqueness is enforced by `phoneTaken()` rather than by an index: a
    /// unique index on this array would stop two accounts sharing an alternate,
    /// but not stop an alternate colliding with another account's primary, and
    /// half a guarantee in the auth path is worse than a stated one.
    altPhones: {
      type: [String],
      default: [],
      index: true,
    },

    passwordHash: { type: String, select: false },

    // When a code texted to this number was typed back correctly.
    //
    // Sign-in is that code, so an unproved number is an account nobody can get
    // into — and the person who cannot get in is the patient, weeks later, with
    // no way to tell whether the number was mistyped at the desk. Null means it
    // has never been proved, which the doctor's screen says out loud rather
    // than leaving to be discovered.
    phoneVerifiedAt: { type: Date, default: null },
    role: { type: String, enum: Object.values(ROLES), default: ROLES.PATIENT, index: true },
    language: { type: String, enum: LANGUAGES, default: 'en' },

    dateOfBirth: Date,
    gender: { type: String, enum: ['male', 'female', 'other', 'undisclosed'], default: 'undisclosed' },

    // Home address.
    //
    // This was missing from the schema while `toPublic()` returned it and both
    // registration and PATCH /auth/me accepted it. Mongoose drops assignments
    // to paths it does not know about, so the value was written to the
    // in-memory document, echoed back in the response — which is why the app
    // said "saved" and showed the new address — and then silently discarded on
    // save(). Reading the record afterwards returned null. Every address any
    // patient, doctor or dietician has ever typed was lost this way.
    address: { type: String, trim: true, maxlength: 300 },

    // Push delivery targets for reminders and escalations.
    deviceTokens: [{ type: String }],

    // Optional profile photo — a MediaAsset id, served from /uploads/:id/raw.
    avatarAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    // Doctor letterhead + signature (unused for patients). `qualifications` e.g.
    // "MBBS, MD"; `registrationNo` is the medical-council number; `signatureAssetId`
    // is an uploaded image embedded into generated prescription PDFs.
    qualifications: { type: String, trim: true, maxlength: 120 },
    specialty: { type: String, trim: true, maxlength: 120 },
    registrationNo: { type: String, trim: true, maxlength: 60 },
    signatureAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    /// When this phone last confirmed its medication alarms are armed.
    ///
    /// The device is the only thing that can know. It reads the platform's
    /// pending-alarm table — what Android will actually act on, rather than
    /// what the app remembers asking for — and says so.
    ///
    /// This decides how the server's backstop is sent. A phone that confirmed
    /// recently will draw the reminder itself from a silent data message, and
    /// the two collapse on a shared notification id. A phone that has not
    /// confirmed cannot draw anything — its app may be force-stopped, which is
    /// the failure the backstop exists for — so the server sends one Android
    /// will draw without the app's help.
    ///
    /// Stale rather than false is the safe reading: an old timestamp gets the
    /// louder envelope, and the cost of being wrong that way is one reminder
    /// arriving twice instead of not at all.
    remindersArmedAt: { type: Date },
    remindersArmedCount: { type: Number, default: 0 },

    isActive: { type: Boolean, default: true },
    lastLoginAt: Date,

    // Consent is a compliance requirement, not a UI checkbox we can forget.
    consent: {
      termsAcceptedAt: Date,
      dataProcessingAcceptedAt: Date,
      aiDisclaimerAcceptedAt: Date,
    },
  },
  { timestamps: true },
);

userSchema.methods.setPassword = async function setPassword(plain) {
  this.passwordHash = await bcrypt.hash(plain, 12);
};

userSchema.methods.verifyPassword = function verifyPassword(plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

userSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id.toString(),
    name: this.name,
    phone: this.phone,
    email: this.email ?? null,
    role: this.role,
    language: this.language,
    dateOfBirth: this.dateOfBirth ?? null,
    gender: this.gender,
    // `||`, not `??`: a cleared address is stored as an empty string, and
    // the app should read that as "none set" rather than as a blank line.
    address: this.address || null,
    altPhones: this.altPhones ?? [],
    avatarUrl: this.avatarAssetId ? `/api/v1/uploads/${this.avatarAssetId}/raw` : null,
    // Doctor letterhead fields; null for patients/staff who never set them.
    qualifications: this.qualifications ?? null,
    specialty: this.specialty ?? null,
    registrationNo: this.registrationNo ?? null,
    signatureUrl: this.signatureAssetId ? `/api/v1/uploads/${this.signatureAssetId}/raw` : null,
    createdAt: this.createdAt,
  };
};

/**
 * Is this number already claimed by anyone — as a primary or an alternate?
 *
 * The check every place that assigns a number has to make. Two accounts
 * claiming one number means a code sent to it signs somebody into whichever
 * document the query happened to return first.
 */
userSchema.statics.phoneTaken = async function phoneTaken(phone, exceptId = null) {
  const q = { ...byLoginPhone(phone) };
  if (exceptId) q._id = { $ne: exceptId };
  return Boolean(await this.exists(q));
};

/** Find the account that signs in with this number, primary or alternate. */
userSchema.statics.findByLoginPhone = function findByLoginPhone(phone) {
  return this.findOne(byLoginPhone(phone));
};

export const User = mongoose.model('User', userSchema);
