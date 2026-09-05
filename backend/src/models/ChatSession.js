import mongoose from 'mongoose';

const chatSessionSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 200, default: 'New conversation' },
    language: { type: String, enum: ['en', 'bn', 'hi'], default: 'en' },

    /// Which conversation this is.
    ///
    /// `care` is the main thread: the assistant and the doctor. `nutrition` is
    /// the dietician's, kept apart so diet coaching does not interleave with
    /// clinical questions and leave both harder to follow.
    ///
    /// Defaults to `care` for new sessions — but a Mongoose default only
    /// applies on write, so every session created before this field existed has
    /// no `kind` at all. Querying `{ kind: 'care' }` therefore matched none of
    /// them and made every patient's history vanish the moment it shipped.
    ///
    /// Read paths must ask for `{ kind: { $ne: 'nutrition' } }`, which catches
    /// both the tagged and the untagged. Do not "tidy" that back to an equality
    /// check unless every document has been backfilled.
    kind: { type: String, enum: ['care', 'nutrition'], default: 'care', index: true },

    /// Which practice relationship this conversation belongs to.
    ///
    /// A thread hangs off an enrollment, not off a patient, because a patient
    /// who sees two doctors has two conversations and neither should be able to
    /// read the other. Null on every session written before enrollments
    /// existed, and null keeps working: the resolver treats it as the patient's
    /// one relationship, which is what it was.
    enrollment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Enrollment',
      default: null,
      index: true,
    },

    /// Which specialty, within that practice.
    ///
    /// Deliberately the department and not the doctor. A thread per doctor
    /// breaks the moment a department has four of them: a patient messaging
    /// cardiology and getting whoever is on duty is better served than one
    /// waiting on a named consultant who is on leave. Any clinician in the
    /// department may answer, and every message carries its own author — so the
    /// patient reads "Cardiology — Dr. Sen replied". The continuity they need is
    /// the department's; the accountability is the author's.
    ///
    /// Null means the practice's general thread, which is what a single-
    /// department clinic has and what every existing session is.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },

    // Rolling summary of older turns, so long conversations stay in context
    // without resending the entire history to the model each turn.
    runningSummary: { type: String, maxlength: 6000 },
    summarisedUpToSeq: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },

    highestUrgency: {
      type: String,
      enum: ['routine', 'advice', 'urgent', 'emergency'],
      default: 'routine',
      index: true,
    },
    lastMessageAt: { type: Date, default: Date.now, index: true },

    // Set when a doctor or staff member opens this thread for review.
    flaggedForReview: { type: Boolean, default: false, index: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: Date,

    isArchived: { type: Boolean, default: false },

    /// Whether the assistant answers in this thread.
    ///
    /// On by default: most questions arrive when nobody from the clinic is
    /// awake, and an answer then is the whole point of it. A clinician turns it
    /// off for a conversation they want to hold themselves — a difficult
    /// diagnosis, a distressed patient — and back on when they are done.
    assistantEnabled: { type: Boolean, default: true },

    /// Whether a clinician has actually made this choice, as opposed to the
    /// thread simply never having been configured.
    ///
    /// The difference decides whether presence applies. "On" reached by
    /// default means "nobody has said" — hold the assistant back while a
    /// clinician is reading, so it does not beat them to a reply. "On" chosen
    /// deliberately means "let it answer, I am only watching", and presence
    /// must not override that: without this the switch appeared to do nothing,
    /// because the heartbeat kept suppressing the assistant the whole time the
    /// clinician sat on the thread they had just re-enabled it for.
    assistantExplicit: { type: Boolean, default: false },

    /// A clinician has this thread open until this moment.
    ///
    /// Refreshed by a heartbeat while the screen is in the foreground, so it
    /// lapses on its own if the app is killed, the phone sleeps or the person
    /// simply walks away — which is what makes it safe to suppress an answer
    /// on: the worst case is that it expires and the assistant resumes.
    clinicianPresentUntil: { type: Date, default: null },
  },
  { timestamps: true },
);

chatSessionSchema.index({ patient: 1, lastMessageAt: -1 });
chatSessionSchema.index({ patient: 1, kind: 1 });

/// One care thread per enrollment per department. A second is a duplicate, not
/// a new conversation — a patient returning to the same specialty continues the
/// thread they already have, with its history.
///
/// Sparse, because the overwhelming majority of rows today have neither field
/// and a plain unique index would collide them all on (null, null).
chatSessionSchema.index(
  { enrollment: 1, department: 1, kind: 1 },
  { unique: true, sparse: true, partialFilterExpression: { enrollment: { $type: 'objectId' } } },
);

export const ChatSession = mongoose.model('ChatSession', chatSessionSchema);
