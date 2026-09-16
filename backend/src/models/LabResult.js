import mongoose from 'mongoose';
import { clinicalRecord } from './plugins/clinicalRecord.js';

/**
 * A test report the patient uploaded against a lab test the doctor advised
 * (Prescription.labTestsAdvised). The photo/PDF is a MediaAsset served from
 * /uploads/:id/raw.
 */
const labResultSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    testName: { type: String, required: true, trim: true, maxlength: 200 },
    note: { type: String, trim: true, maxlength: 1000 },
    photo: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    /**
     * What was read off the report.
     *
     * `status` is explicit rather than inferred from empty values, because
     * "we could not read this" and "this report has no HbA1c on it" must not
     * look the same to a doctor. Only `done` means the numbers below were
     * actually found; `failed` means the file could not be parsed and the
     * report still needs reading by a human.
     */
    analysis: {
      status: {
        type: String,
        enum: ['pending', 'done', 'failed', 'unsupported'],
        default: 'pending',
        index: true,
      },
      summary: { type: String, maxlength: 1000 },
      hba1cPercent: Number,
      fastingGlucoseMgDl: Number,
      postPrandialGlucoseMgDl: Number,
      totalCholesterol: Number,
      ldl: Number,
      hdl: Number,
      triglycerides: Number,
      creatinine: Number,
      /// The date printed on the report, when it carries one. A report uploaded
      /// today may be six weeks old, and filing it as today's result would move
      /// the patient's risk band on stale numbers.
      testedOn: Date,
      abnormal: [String],
      analysedAt: Date,
      modelVersion: String,
    },
  },
  { timestamps: true },
);

labResultSchema.index({ patient: 1, createdAt: -1 });

// Withdrawn, not deleted: a report the patient uploaded, that the doctor may
// have read and acted on, stays on the record with who withdrew it and why.
labResultSchema.plugin(clinicalRecord, { hideVoided: true });

export const LabResult = mongoose.model('LabResult', labResultSchema);
