import mongoose from 'mongoose';

export const MEAL_TYPES = Object.freeze(['breakfast', 'lunch', 'dinner', 'snack', 'other']);

/**
 * A meal the patient logged for their dietician to review. A photo is optional
 * (a MediaAsset served from /uploads/:id/raw); a note describes what they ate.
 */
const foodLogSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    mealType: { type: String, enum: MEAL_TYPES, default: 'other' },
    note: { type: String, trim: true, maxlength: 1000 },
    photo: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    /// The chat message this arrived in, when the patient sent it to their
    /// dietician rather than logging it from the food screen. Logging a meal
    /// and showing it to the dietician are the same act, so they produce one
    /// record — this is the link back to the conversation it came from.
    sourceMessage: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage' },

    /// When a dietician marked this specific meal as read, and who.
    ///
    /// Separate from `PatientProfile.lastDietReviewAt`, which was doing both
    /// jobs and could only do one of them honestly. That field answers "when
    /// is the next review cycle due"; this one answers "has anyone actually
    /// looked at this plate". Inferring the second from the first meant
    /// replying about one worrying meal silently marked the other three read.
    /// The dietician's verdict on this meal, set when they review it.
    ///
    /// Their judgement, not a computation: nothing here can look at a
    /// photograph of rice and dal and know the portion, the oil or what the
    /// patient ate around it. A guess dressed as an assessment on a clinical
    /// screen would be believed, so the person who can actually tell is the
    /// one who says.
    ///
    /// on_track — fits the plan.  review — worth a conversation.
    /// concern  — a significant deviation.
    mealStatus: {
      type: String,
      enum: ['on_track', 'review', 'concern'],
      default: null,
    },

    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

foodLogSchema.index({ patient: 1, createdAt: -1 });
// The dashboard's hottest question — "which of this caseload's meals are still
// unread" — is a scan over patient + reviewedAt, on every load, for every
// dietician.
foodLogSchema.index({ patient: 1, reviewedAt: 1 });

export const FoodLog = mongoose.model('FoodLog', foodLogSchema);
