import mongoose from 'mongoose';

const chatMessageSchema = new mongoose.Schema(
  {
    session: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatSession', required: true, index: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    seq: { type: Number, required: true },
    role: { type: String, enum: ['user', 'assistant', 'system', 'clinician', 'dietician'], required: true },

    // Set only on `clinician` turns: which clinician wrote it, so the patient
    // reads "Dr. Amit Kumar Dey" rather than an anonymous clinic voice, and an
    // audit can attribute clinical advice to a named person.
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Not required: a message may be a photo (or voice note) with no caption.
    // The route validation guarantees a turn always has text or an attachment.
    content: { type: String, default: '', maxlength: 20000 },
    language: { type: String, enum: ['en', 'bn', 'hi'], default: 'en' },

    attachments: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' }],

    /// When the author last rewrote this message, and what it said before.
    ///
    /// The original is kept rather than overwritten because this is a clinical
    /// record: a dietician may already have read "I had two rotis" and acted on
    /// it before it became "I had four". The thread shows the current text
    /// marked as edited; the audit trail still holds what was there when the
    /// clinic saw it.
    editedAt: { type: Date, default: null },
    originalContent: { type: String, default: null, maxlength: 20000 },

    /// Something the app can offer the reader to do, under this turn.
    ///
    /// One shape rather than a flag per feature: the first is an appointment
    /// request recognised in what the patient wrote, and the next will not be
    /// worth another column. `kind` says which card to draw and the rest is
    /// that card's business.
    ///
    /// Nothing here has happened. It is an offer, and it stays an offer until
    /// somebody taps it — which is what lets the detection behind it be
    /// generous. See [services/triage/appointmentIntent.js].
    action: {
      kind: { type: String, enum: ['appointment_request'] },
      /// The day the patient seems to have meant, or absent when they named
      /// none. Absent is a real answer: "can I get an appointment?" says no
      /// day, and the card asks for one rather than inventing tomorrow.
      preferredFor: Date,
      /// The hour they mentioned, in their own words — "around 4pm". Never
      /// parsed into a slot: a request carries a day and no time, because the
      /// desk offers times the doctor is actually free.
      timePhrase: { type: String, maxlength: 40 },
    },

    // --- assistant-turn metadata ---
    triage: {
      urgency: { type: String, enum: ['routine', 'advice', 'urgent', 'emergency'] },
      matchedRules: [{ type: String }],
      redFlags: [{ type: String }],
      // True when deterministic rules fired, i.e. the verdict did not depend on
      // the model's judgement.
      ruleDriven: { type: Boolean, default: false },
    },
    // Knowledge-base chunks that grounded this answer — shown to the doctor
    // during chat review so an answer can be traced to approved content.
    citations: [
      {
        chunk: { type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeChunk' },
        title: String,
        score: Number,
      },
    ],
    modelVersion: String,
    latencyMs: Number,
    tokenUsage: {
      promptTokens: Number,
      responseTokens: Number,
    },

    // Set when the answer was produced by the safe fallback path (model error,
    // safety block, or no grounding found).
    isFallback: { type: Boolean, default: false },

    alert: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalAlert' },
    flaggedByPatient: { type: Boolean, default: false },

    /// The message this one answers. Clinical chat runs over days, so a reply
    /// arriving hours later has to say what it is replying to.
    replyTo: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },

    /// Pinned to the top of the thread. A dosing instruction otherwise scrolls
    /// away within a day and the patient cannot find it again.
    pinnedAt: { type: Date },
    pinnedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /// Users who have hidden this message from their own view.
    ///
    /// Deliberately never a delete. These messages are part of a medical
    /// record, and the audit log, immutable prescriptions and citation trail
    /// all assume the conversation that produced a decision still exists.
    /// Hiding is per-person and reversible; the record is untouched.
    hiddenFor: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    /// "Delete for everyone" — set only by the message's own author. Like
    /// hiddenFor, the row and its text are DELIBERATELY kept: the medical record,
    /// audit log and citation trail must survive. What changes is presentation —
    /// the serialiser returns a tombstone, so no client renders the original
    /// words or files. Never allowed on an emergency/alerted message, which is
    /// the evidence the clinic was paged.
    deletedForEveryoneAt: { type: Date },
    deletedForEveryoneBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /// When the clinic first opened the thread containing this message. Drives
    /// the patient's "Seen by the clinic" mark — chosen over a typing
    /// indicator, which would promise a reply within seconds that a clinician
    /// with a full list cannot keep.
    seenByClinicAt: { type: Date },
  },
  { timestamps: true },
);

chatMessageSchema.index({ session: 1, seq: 1 }, { unique: true });
// The bell, the badges and "seen by the clinic": unread patient turns within a
// set of conversations — the queries that run on every inbox refresh (V-52).
chatMessageSchema.index({ session: 1, role: 1, seenByClinicAt: 1 });

export const ChatMessage = mongoose.model('ChatMessage', chatMessageSchema);
