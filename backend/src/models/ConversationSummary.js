import mongoose from 'mongoose';

/**
 * One patient's day of conversation with one practice, summarised for the
 * clinicians who were not interrupted by it.
 *
 * ---- Why this exists -------------------------------------------------------
 *
 * A doctor is pushed emergencies and high-risk alerts about their own patients
 * and nothing else — a hundred patients writing "ok" and "thank you" cannot buzz
 * a phone that also has to carry the chest-pain alert. What that leaves is a
 * day of routine conversation nobody clinical has read: the question the
 * assistant rightly declined, the tablet a patient stopped because it upset
 * their stomach, the request to be seen. This is where the doctor catches up.
 *
 * ---- What it is not ----------------------------------------------------------
 *
 * Not a record and not advice. It never replaces the conversation, every point
 * cites the messages it came from, and the doctor opens those to act. A point
 * with nothing to cite is dropped rather than shown.
 *
 * ---- Two sources, one shape --------------------------------------------------
 *
 * `rules` is always available: counts, triage verdicts, requests, what went
 * unanswered, and the patient's own words. `ai` is written by the model on top
 * of that when the practice has the assistant — and can add a reason for the
 * doctor's attention, never remove one the rules found. Triage owns urgency;
 * the summary may not talk it down.
 */

export const SUMMARY_KINDS = Object.freeze(['care', 'nutrition']);

export const POINT_KINDS = Object.freeze([
  'symptom',
  'concern',
  'question',
  'medication',
  'diet',
  'reading',
  'appointment',
  'assistant_answer',
  'follow_up',
]);

const pointSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: POINT_KINDS, required: true },
    text: { type: String, required: true, trim: true, maxlength: 400 },
    messageIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' }],
  },
  { _id: false },
);

const conversationSummarySchema = new mongoose.Schema(
  {
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    enrollment: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', default: null },

    /// The conversation summarised: the care thread, or the dietician's.
    kind: { type: String, enum: SUMMARY_KINDS, default: 'care' },

    /// The clinic's calendar day, `YYYY-MM-DD` in its timezone. A day where the
    /// clinic is, not where the server is.
    day: { type: String, required: true },

    messageCount: { type: Number, default: 0 },
    patientMessageCount: { type: Number, default: 0 },
    /// Patient messages after the last thing a person from the clinic wrote.
    unansweredCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },

    highestUrgency: {
      type: String,
      enum: ['routine', 'advice', 'urgent', 'emergency'],
      default: 'routine',
    },
    needsDoctor: { type: Boolean, default: false },
    /// Why, in a clinician's words. Empty when nothing needs them.
    reasons: [{ type: String, trim: true, maxlength: 200 }],

    overview: { type: String, trim: true, maxlength: 800, default: '' },
    points: { type: [pointSchema], default: [] },

    source: { type: String, enum: ['ai', 'rules'], required: true },
    modelVersion: { type: String, default: null },
    tokenUsage: {
      promptTokens: { type: Number },
      responseTokens: { type: Number },
    },
    generatedAt: { type: Date, default: Date.now },

    /// Who has read it. Per person: one doctor reviewing a patient's day says
    /// nothing about whether their colleague has.
    reviewedBy: [
      {
        _id: false,
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        at: { type: Date },
      },
    ],
  },
  { timestamps: true },
);

/// One summary per patient, per practice, per conversation, per day.
conversationSummarySchema.index({ practice: 1, patient: 1, kind: 1, day: 1 }, { unique: true });
/// The day's list, worst first.
conversationSummarySchema.index({ practice: 1, day: 1, needsDoctor: -1 });

export const ConversationSummary = mongoose.model('ConversationSummary', conversationSummarySchema);
