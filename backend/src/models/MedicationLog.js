import mongoose from 'mongoose';

/**
 * One row per scheduled dose occurrence. Rows are created lazily: the client
 * reports taken/skipped, and the adherence service materialises "missed" rows
 * for elapsed slots that were never reported.
 */
const medicationLogSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    medication: { type: mongoose.Schema.Types.ObjectId, ref: 'Medication', required: true, index: true },

    scheduledFor: { type: Date, required: true, index: true },
    status: { type: String, enum: ['taken', 'skipped', 'missed'], required: true },
    takenAt: Date,
    /// Taken, but more than the grace period after it was due. Kept beside
    /// `status` rather than as a fourth status, so a build that knows only
    /// taken / skipped / missed still reads the dose as taken.
    takenLate: { type: Boolean, default: false },

    // Insulin doses vary per administration, so the actual units are captured
    // here rather than assumed from the medication record.
    actualDose: { type: String, trim: true, maxlength: 60 },
    unitsAdministered: { type: Number, min: 0, max: 500 },
    injectionSite: {
      type: String,
      enum: ['abdomen', 'left_thigh', 'right_thigh', 'left_arm', 'right_arm', 'buttock', 'other'],
    },

    skipReason: { type: String, maxlength: 300 },
  },
  { timestamps: true },
);

// One log per medication per scheduled slot — makes client retries idempotent.
medicationLogSchema.index({ medication: 1, scheduledFor: 1 }, { unique: true });
medicationLogSchema.index({ patient: 1, scheduledFor: -1 });

export const MedicationLog = mongoose.model('MedicationLog', medicationLogSchema);
