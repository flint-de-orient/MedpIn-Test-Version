import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

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
    passwordHash: { type: String, select: false },
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
    avatarUrl: this.avatarAssetId ? `/api/v1/uploads/${this.avatarAssetId}/raw` : null,
    // Doctor letterhead fields; null for patients/staff who never set them.
    qualifications: this.qualifications ?? null,
    specialty: this.specialty ?? null,
    registrationNo: this.registrationNo ?? null,
    signatureUrl: this.signatureAssetId ? `/api/v1/uploads/${this.signatureAssetId}/raw` : null,
    createdAt: this.createdAt,
  };
};

export const User = mongoose.model('User', userSchema);
