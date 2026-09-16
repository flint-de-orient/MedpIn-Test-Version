import mongoose from 'mongoose';

/**
 * An electrocardiogram: the tracing, and what a clinician read in it.
 *
 * ---- Read by a person, never by the platform ------------------------------
 *
 * Every field that describes the heart here is entered by the clinician who read
 * the tracing. Nothing is inferred from the image. An eye report asks the
 * assistant to explain a grading a person already made; an ECG gets no such
 * pass, because a rhythm "read" by a language model from a photograph of paper
 * is a diagnosis nobody made, and a cardiologist opening the record would take
 * it for one.
 *
 * So the impression is the reader's: normal, borderline, abnormal — or unknown,
 * which is the honest default for a tracing filed before anybody has read it.
 *
 * ---- Whose record ------------------------------------------------------------
 *
 * `practice` is stamped when it is written, from the clinician's membership, so
 * the record says which practice made it rather than leaving that to be worked
 * out later from a doctor who may have moved on.
 */
export const ECG_RHYTHMS = Object.freeze([
  'sinus',
  'atrial_fibrillation',
  'atrial_flutter',
  'supraventricular_tachycardia',
  'ventricular_tachycardia',
  'heart_block',
  'paced',
  'other',
  'unknown',
]);

export const ECG_IMPRESSIONS = Object.freeze(['normal', 'borderline', 'abnormal', 'unknown']);

const ecgReportSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', default: null, index: true },

    /// When the tracing was taken, which is the date the record window reads.
    recordedOn: { type: Date, required: true, index: true },
    files: [{ type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' }],

    rhythm: { type: String, enum: ECG_RHYTHMS, default: 'unknown' },
    heartRate: { type: Number, min: 20, max: 300 },
    prIntervalMs: { type: Number, min: 40, max: 600 },
    qrsDurationMs: { type: Number, min: 20, max: 300 },
    qtcMs: { type: Number, min: 200, max: 800 },

    impression: { type: String, enum: ECG_IMPRESSIONS, default: 'unknown', index: true },
    findings: { type: String, trim: true, maxlength: 2000 },

    /// Who read the tracing, as they sign it — which may be a cardiologist
    /// elsewhere, not the person entering it.
    readBy: { type: String, trim: true, maxlength: 160 },
    /// Who entered it here.
    recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * The request that wrote this, for a client retrying it — the contract in
     * middleware/idempotency.js, as prescriptions and vitals keep it. A
     * duplicated abnormal ECG is two abnormal ECGs on the cardiology panel.
     */
    idempotencyKey: { type: String, default: null },
    idempotencyHash: { type: String, default: null },
  },
  { timestamps: true },
);

ecgReportSchema.index({ patient: 1, recordedOn: -1 });

/**
 * One ECG per request key, per person filing — the shape prescriptions use.
 * Partial, so the rows written without a key never collide.
 */
ecgReportSchema.index(
  { recordedBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

export const EcgReport = mongoose.model('EcgReport', ecgReportSchema);
