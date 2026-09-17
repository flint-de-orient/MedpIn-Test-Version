import mongoose from 'mongoose';

/**
 * A patient's feedback about the app or about the clinic.
 *
 * Kept apart from ClinicalAlert and the care thread on purpose. Feedback is not
 * a clinical event: routing "the app is slow" into the same queue as a chest-pain
 * escalation would either bury the alert or train the clinic to skim the queue.
 *
 * Never anonymous internally — the clinic can follow up on a complaint about
 * care, and a patient who says treatment went wrong deserves a reply rather than
 * a suggestion box. Whether the patient is *told* it is attributable is a copy
 * decision on the form.
 *
 * ---- Whose it is ---------------------------------------------------------
 *
 * Every row says where it went, and nobody reads a row that did not go to them.
 *
 *   practice   feedback about a clinic, from a patient enrolled there. It names
 *              that practice and that enrolment, and that practice's clinical
 *              team reads it — while the patient is still enrolled there.
 *   platform   feedback about the app, and feedback about "the clinic" from
 *              somebody no practice has taken on. MedPin reads it, without the
 *              patient's identity; no practice ever does.
 *   none       rows written before feedback said where it went. Nothing records
 *              which clinic an old complaint meant, and guessing would hand a
 *              patient's words to a practice they may not have been talking
 *              about — so they are `legacy_unattributed` and private to the
 *              patient who wrote them.
 *
 * It used to be one list per practice built from "this practice's patients",
 * so a patient at two clinics had every word about either — and about the app
 * — read by both.
 */
export const FEEDBACK_ABOUT = Object.freeze({ APP: 'app', CLINIC: 'clinic' });

export const FEEDBACK_ROUTE = Object.freeze({
  PRACTICE: 'practice',
  PLATFORM: 'platform',
  NONE: 'none',
});

export const FEEDBACK_ORIGIN = Object.freeze({
  PATIENT_APP: 'patient_app',
  LEGACY_UNATTRIBUTED: 'legacy_unattributed',
});

export const FEEDBACK_STATE = Object.freeze({
  /// Nobody has replied.
  OPEN: 'open',
  /// Somebody replied, and the patient can read it.
  ANSWERED: 'answered',
});

const replySchema = new mongoose.Schema(
  {
    body: { type: String, trim: true, required: true, maxlength: 2000 },
    /// Which side answered. A practice's reply names the practice to the
    /// patient; MedPin's names MedPin, and never which operator.
    from: { type: String, enum: [FEEDBACK_ROUTE.PRACTICE, FEEDBACK_ROUTE.PLATFORM], required: true },
    /// A User for a practice reply, a PlatformAdmin for a platform one.
    by: { type: mongoose.Schema.Types.ObjectId, required: true },
    at: { type: Date, default: Date.now },
    /// The retry of one reply is that reply. See middleware/idempotency.js.
    idempotencyKey: { type: String, default: null },
    idempotencyHash: { type: String, default: null },
  },
  { _id: true },
);

const feedbackSchema = new mongoose.Schema(
  {
    /// The person the feedback is about the care of — the patient whose
    /// enrolment it went to, or the login that wrote it.
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /// What is being rated. Separated because they are acted on by different
    /// people: `app` is a product issue, `clinic` is the practice's to answer.
    about: { type: String, enum: Object.values(FEEDBACK_ABOUT), required: true, index: true },

    /// 1–5. Optional: someone with a specific complaint should not be forced to
    /// reduce it to a number before they can send it.
    rating: { type: Number, min: 1, max: 5 },

    message: { type: String, trim: true, maxlength: 2000 },

    /// Where it went. See the note above. Absent on rows written before this
    /// existed, which every inbox excludes by asking for a value explicitly.
    route: { type: String, enum: Object.values(FEEDBACK_ROUTE) },
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', default: null },
    enrollment: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', default: null },

    /// Provenance: who wrote the row, in what capacity, from where.
    origin: { type: String, enum: Object.values(FEEDBACK_ORIGIN) },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdByRole: { type: String },
    state: { type: String, enum: Object.values(FEEDBACK_STATE) },

    /*
     * Who has read it, one entry per person.
     *
     * It was one `reviewedAt` for the whole practice, so the first person to
     * glance at a complaint cleared it from everybody's list — the doctor it was
     * about included. Each reader now has their own answer, and the badge each
     * of them sees counts what they have not read.
     */
    readBy: {
      type: [{ user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, at: Date, _id: false }],
      default: [],
    },
    /// The same, per MedPin operator, for platform rows.
    platformReadBy: {
      type: [{ admin: { type: mongoose.Schema.Types.ObjectId, ref: 'PlatformAdmin' }, at: Date, _id: false }],
      default: [],
    },

    replies: { type: [replySchema], default: [] },

    /// The old practice-wide "reviewed" mark, kept on the rows that have it
    /// and no longer written.
    reviewedAt: { type: Date },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    idempotencyKey: { type: String, default: null },
    idempotencyHash: { type: String, default: null },
  },
  { timestamps: true },
);

feedbackSchema.index({ createdAt: -1 });

/// A practice's inbox, newest first.
feedbackSchema.index({ route: 1, practice: 1, createdAt: -1 });

/// A patient's own list.
feedbackSchema.index({ createdBy: 1, createdAt: -1 });

feedbackSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const Feedback = mongoose.model('Feedback', feedbackSchema);
