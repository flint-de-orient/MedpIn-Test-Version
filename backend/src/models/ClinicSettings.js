import mongoose from 'mongoose';

/**
 * Clinic-wide settings. A single document — there is one clinic.
 *
 * Exists because the food-log review cadence used to be set per patient, which
 * had the same flaw as per-patient dietician assignment: one or two dieticians
 * and hundreds of patients, so the default became "this patient is never due
 * for review" and it fell to the doctor to fix, one patient at a time. A
 * clinic-wide default is one decision that covers everyone.
 *
 * A per-patient override still wins where it is set, so a patient who needs
 * watching weekly is not held to the clinic's monthly rhythm.
 */
const clinicSettingsSchema = new mongoose.Schema(
  {
    /// Marks the singleton. A fixed key with a unique index is what stops a
    /// second settings document appearing and quietly winning half the reads.
    key: { type: String, default: 'clinic', unique: true, immutable: true },

    /// How often a patient's food log should be reviewed, in days, unless that
    /// patient's record says otherwise.
    dietReviewIntervalDays: { type: Number, min: 1, max: 90, default: 14 },

    /// The code a dietician types to self-register against this clinic.
    ///
    /// Held here rather than in an env var so the doctor can rotate it from the
    /// app. A code that can only change with a redeploy is one that never
    /// changes — and this one is shared over WhatsApp, so it should be
    /// replaceable the moment it reaches someone it should not have.
    dieticianInviteCode: { type: String, trim: true, maxlength: 24 },

    // The same lever for the front desk.
    //
    // Kept separate from the dietician's on purpose: one code that opened both
    // roles would mean rotating it for a departing receptionist also locked out
    // every dietician waiting to register, and a code handed to the wrong
    // person would decide for itself what it made them.
    staffInviteCode: { type: String, trim: true, maxlength: 24 },
  },
  { timestamps: true },
);

export const ClinicSettings = mongoose.model('ClinicSettings', clinicSettingsSchema);

/** Reads the settings document, creating it with defaults on first use. */
export async function getClinicSettings() {
  return ClinicSettings.findOneAndUpdate(
    { key: 'clinic' },
    { $setOnInsert: { key: 'clinic' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
}
