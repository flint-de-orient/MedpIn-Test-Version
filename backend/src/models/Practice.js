import mongoose from 'mongoose';

/**
 * The business a patient thinks of as "the clinic".
 *
 * `Clinic` in this codebase means a *place* — an address, a phone number, a
 * weekly schedule the slot engine turns into bookable times. That was right
 * while there was one doctor at one address. It stops being right the moment a
 * practice has two branches, because a `Clinic` row carries both the brand
 * ("Dey Diabetes Clinic", the logo, the registration number) and the location
 * (Salt Lake, 10:00–14:00, this phone). Two branches means two rows, which
 * means two copies of the brand, which means renaming the practice renames it
 * in one place and not the other.
 *
 * So the brand moves up here and the place stays down there. One Practice, many
 * Clinic rows beneath it.
 *
 * ---- Nothing is taken away from Clinic ----------------------------------
 *
 * The backfill *copies* the brand fields up; it does not clear them. A location
 * that sets its own name or phone keeps winning over the practice's — see
 * [services/clinicIdentity.js], where the resolution order is location, then
 * practice, then the environment.
 *
 * That order is not an accident. The settings screen the clinic uses today
 * writes to the Clinic row. If the practice won, saving that screen would look
 * like it had done nothing. Beneath that, it is also the semantics a polyclinic
 * wants: the practice brand is the default and a branch may override it.
 *
 * ---- Verification is not access -----------------------------------------
 *
 * `status` says whether the practice may use the app. `verification` says
 * whether a human has checked the registration papers. They are separate
 * fields because collapsing them means either a verified practice that cannot
 * log in or an unverified one that can print prescriptions, and the honest
 * arrangement is a practice that works from day one while its badge says
 * pending.
 */
export const PRACTICE_STATUS = Object.freeze({
  ONBOARDING: 'onboarding',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

export const VERIFICATION = Object.freeze({
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

const practiceSchema = new mongoose.Schema(
  {
    /// What a patient reads: "Dey Diabetes Clinic".
    name: { type: String, required: true, trim: true, maxlength: 160 },

    /// The line under the name — "Diabetes Obesity & Metabolic Clinic".
    tagline: { type: String, trim: true, maxlength: 160 },

    /// The doctor's name as it should print, which is not always the name on
    /// their account. Stays here as well as on the location because a
    /// single-doctor practice has exactly one and repeating it per branch is
    /// how the two drift apart.
    doctorDisplayName: { type: String, trim: true, maxlength: 160 },

    /// Printed under the signature on a prescription.
    registrationNo: { type: String, trim: true, maxlength: 60 },

    /// Two logo assets, never an inverted copy of one another — inverting
    /// artwork destroys the brand colour. See the note on the same fields in
    /// [models/Clinic.js].
    logoLightAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
    logoDarkAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
    logoNeedsDarkChip: { type: Boolean, default: false },

    /// The doctor who owns the practice and may add other doctors, staff and
    /// locations. MedPin onboards this one person; everyone else is added by
    /// them. Nullable so the backfill can create a practice for an existing
    /// clinic that has no doctor row set.
    headDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    /// May this practice use the app. See the note above.
    status: {
      type: String,
      enum: Object.values(PRACTICE_STATUS),
      default: PRACTICE_STATUS.ACTIVE,
      index: true,
    },

    /// Have the papers been checked. Separate from access, deliberately.
    verification: {
      type: String,
      enum: Object.values(VERIFICATION),
      default: VERIFICATION.UNVERIFIED,
    },
    verifiedAt: { type: Date, default: null },

    /// Set on the practice that existed before practices did, so the backfill
    /// can be re-run without creating a second one and so support can tell at a
    /// glance which row is the original clinic.
    isFounding: { type: Boolean, default: false },
  },
  { timestamps: true },
);

/// "Which practices does this doctor head" — the admin surface's first query.
practiceSchema.index({ headDoctor: 1, status: 1 });

practiceSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    tagline: this.tagline ?? null,
    doctorDisplayName: this.doctorDisplayName ?? null,
    registrationNo: this.registrationNo ?? null,
    logoLightUrl: this.logoLightAssetId ? `/api/v1/uploads/${this.logoLightAssetId}/raw` : null,
    logoDarkUrl: this.logoDarkAssetId ? `/api/v1/uploads/${this.logoDarkAssetId}/raw` : null,
    logoNeedsDarkChip: Boolean(this.logoNeedsDarkChip),
    status: this.status,
    verification: this.verification,
    createdAt: this.createdAt,
  };
};

export const Practice = mongoose.model('Practice', practiceSchema);
