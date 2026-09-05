import mongoose from 'mongoose';

/**
 * One practice seeing another practice's records for a patient — the shape,
 * not the feature.
 *
 * ---- Why this exists before anything uses it ----------------------------
 *
 * Whether Dr. Sen may read Dr. Dey's prescriptions for Rahul is an open
 * decision, and the default is no. But the *shape* of the answer is fixed, and
 * writing it now costs a file while retrofitting it later means unpicking
 * whatever ad-hoc thing gets built when somebody first asks.
 *
 * Nothing reads this model. It is deliberately inert.
 *
 * ---- The one rule the shape has to encode -------------------------------
 *
 * The patient grants it, and the patient revokes it. Never the practice that
 * wants the access, and never the practice that holds the records.
 *
 * That is not a preference. A clinic able to grant itself access to another
 * clinic's notes has an enrollment that means something quite different from
 * what the patient agreed to, and a clinic able to *refuse* to share is a clinic
 * holding a record hostage. Both directions belong to the person the record is
 * about.
 *
 * ---- And why it expires --------------------------------------------------
 *
 * A grant with no end is one nobody revisits. A second opinion needs a month,
 * not permanent standing access, and an expiry that has to be renewed is a
 * decision made twice rather than once and forgotten.
 */
export const SHARE_SCOPE = Object.freeze({
  /// Prescriptions only — enough for a second opinion on a treatment plan.
  PRESCRIPTIONS: 'prescriptions',
  /// Readings and lab results.
  RESULTS: 'results',
  /// Everything the sharing practice holds from `enrolledOn` forward.
  FULL: 'full',
});

const shareGrantSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    /// Whose records are being shared.
    fromPractice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    /// Who may read them.
    toPractice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    scope: { type: String, enum: Object.values(SHARE_SCOPE), required: true },

    /// Always the patient. Recorded rather than assumed, so the row can be
    /// audited without inferring who must have acted.
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    grantedAt: { type: Date, default: Date.now },

    /// Required. See the note above on why a grant without an end is one
    /// nobody revisits.
    expiresAt: { type: Date, required: true },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

/// "May this practice read that one's records for this patient" — the query
/// this exists to answer, once anything asks it.
shareGrantSchema.index({ patient: 1, toPractice: 1, revokedAt: 1 });

/**
 * Whether this grant is in force right now.
 *
 * Expiry is checked here rather than by a job that sweeps rows: a grant that
 * expired an hour ago must stop working an hour ago, not whenever the sweep
 * next runs.
 */
shareGrantSchema.methods.isCurrent = function isCurrent() {
  return this.revokedAt == null && this.expiresAt > new Date();
};

export const ShareGrant = mongoose.model('ShareGrant', shareGrantSchema);

/**
 * Break-glass: an unconscious patient and a doctor who is not theirs.
 *
 * ---- Designed, deliberately not built -----------------------------------
 *
 * Real, and rare enough that building it now would be speculation about a
 * workflow nobody has walked through. What is fixed here is the shape, so it
 * can be added without redesigning anything around it.
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
