import mongoose from 'mongoose';
import { clinicalRecord } from './plugins/clinicalRecord.js';

export const GLUCOSE_CONTEXTS = Object.freeze([
  'fasting',
  'pre_meal',
  'post_meal',
  'bedtime',
  'random',
  'hypo_check',
]);

const glucoseReadingSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // Always stored in mg/dL. The client converts mmol/L on input so that every
    // threshold in the triage engine can assume one unit.
    valueMgDl: { type: Number, required: true, min: 10, max: 900 },
    context: { type: String, enum: GLUCOSE_CONTEXTS, default: 'random' },
    measuredAt: { type: Date, required: true, default: Date.now, index: true },

    source: { type: String, enum: ['manual', 'cgm', 'clinic'], default: 'manual' },
    notes: { type: String, maxlength: 500 },

    // Set by the triage engine at write time so the dashboard and doctor alerts
    // never have to re-derive severity.
    flag: {
      type: String,
      enum: ['severe_low', 'low', 'in_range', 'high', 'very_high', 'critical_high'],
      index: true,
    },
    triggeredAlert: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalAlert' },
    /// The lab report this reading was read off, when it came from one — so
    /// withdrawing the report withdraws exactly its readings, and never a
    /// reading somebody typed with the same value on the same day.
    labResult: { type: mongoose.Schema.Types.ObjectId, ref: 'LabResult', default: null, index: true },

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

glucoseReadingSchema.index({ patient: 1, measuredAt: -1 });

/**
 * One reading per request key.
 *
 * What makes a retry safe rather than merely checked: two identical requests a
 * few milliseconds apart both find nothing, and this refuses the second write.
 * Partial on the key being a string, so the rows with none never collide.
 */
glucoseReadingSchema.index(
  { patient: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

// Removed readings are voided, with who and why, never deleted — and every
// read leaves them out. See plugins/clinicalRecord.js.
glucoseReadingSchema.plugin(clinicalRecord, { hideVoided: true });

export const GlucoseReading = mongoose.model('GlucoseReading', glucoseReadingSchema);
