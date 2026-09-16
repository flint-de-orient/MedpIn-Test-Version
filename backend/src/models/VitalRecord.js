import mongoose from 'mongoose';

/**
 * Blood pressure, weight and other point-in-time vitals. Lifestyle inputs
 * (diet/exercise/water) live in LifestyleLog instead — different cadence,
 * different query patterns.
 */
const vitalRecordSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    recordedAt: { type: Date, required: true, default: Date.now, index: true },

    systolic: { type: Number, min: 50, max: 300 },
    diastolic: { type: Number, min: 30, max: 200 },
    pulse: { type: Number, min: 25, max: 250 },

    weightKg: { type: Number, min: 10, max: 400 },
    waistCm: { type: Number, min: 30, max: 250 },
    spo2: { type: Number, min: 50, max: 100 },
    temperatureC: { type: Number, min: 30, max: 45 },

    flag: {
      type: String,
      enum: ['normal', 'elevated', 'stage1', 'stage2', 'hypertensive_crisis', 'hypotension'],
      index: true,
    },
    notes: { type: String, maxlength: 500 },

    /**
     * The request that wrote this, for a client retrying it.
     *
     * Set only when the request carried an `Idempotency-Key`. The hash is of
     * what was asked for, so the same key replayed with different values is
     * refused rather than answered with this record — see
     * middleware/idempotency.js. Null on every row written without one, which
     * is every row written before this existed.
     */
    idempotencyKey: { type: String, default: null },
    idempotencyHash: { type: String, default: null },
  },
  { timestamps: true },
);

vitalRecordSchema.index({ patient: 1, recordedAt: -1 });

/**
 * One set of vitals per request key.
 *
 * What makes a retry safe rather than merely checked: two identical requests a
 * few milliseconds apart both find nothing, and this refuses the second write.
 * Partial on the key being a string, so the rows with none never collide.
 */
vitalRecordSchema.index(
  { patient: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

vitalRecordSchema.virtual('bmi').get(function bmi() {
  if (!this.weightKg || !this._heightCm) return null;
  const m = this._heightCm / 100;
  return Number((this.weightKg / (m * m)).toFixed(1));
});

export const VitalRecord = mongoose.model('VitalRecord', vitalRecordSchema);
