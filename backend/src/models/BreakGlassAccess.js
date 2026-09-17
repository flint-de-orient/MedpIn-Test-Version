import mongoose from 'mongoose';

/**
 * Break-glass: an unconscious patient and a doctor who is not theirs.
 *
 * ---- Designed, deliberately not built -----------------------------------
 *
 * Real, and rare enough that building it now would be speculation about a
 * workflow nobody has walked through. What is fixed here is the shape, so it
 * can be added without redesigning anything around it.
 *
 * It lived in ShareGrant.js until sharing was built. It moved out so that the
 * dead-code exemption covering it covers only it: an exemption naming the
 * grant file would have excused the working sharing model from the check that
 * proves it is wired.
 *
 * Four properties, and the last is the one that makes it safe:
 *
 *   - a reason is mandatory, typed at the time, not chosen from a list
 *   - access expires by itself, in hours
 *   - every read under it is logged, not just the opening
 *   - **the patient is told it happened**
 *
 * Access that notifies the person accessed is access nobody abuses twice. A
 * break-glass that is silent is simply a back door with paperwork.
 */
const breakGlassSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', required: true },
    clinician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /// Typed, not selected. A dropdown of reasons is a dropdown of excuses, and
    /// the sentence somebody wrote at 3am is the one a review can weigh.
    reason: { type: String, required: true, trim: true, minlength: 20, maxlength: 1000 },

    openedAt: { type: Date, default: Date.now },
    /// Hours, not days. Long enough for an emergency, short enough that it
    /// cannot quietly become a standing arrangement.
    expiresAt: { type: Date, required: true },

    /// When the patient was told, and how. Null means they have not been —
    /// which is a state that should never persist, and is visible because it is
    /// a column rather than an absence.
    patientNotifiedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

breakGlassSchema.index({ patient: 1, openedAt: -1 });

breakGlassSchema.methods.isCurrent = function isCurrent() {
  return this.expiresAt > new Date();
};

export const BreakGlassAccess = mongoose.model('BreakGlassAccess', breakGlassSchema);
