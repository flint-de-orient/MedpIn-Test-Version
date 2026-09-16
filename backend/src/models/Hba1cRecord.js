import mongoose from 'mongoose';
import { clinicalRecord } from './plugins/clinicalRecord.js';

const hba1cSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    percentage: { type: Number, required: true, min: 3, max: 20 },
    testedOn: { type: Date, required: true, index: true },
    labName: { type: String, trim: true, maxlength: 160 },
    reportFile: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
    /// The lab report it was read off, when it came from one.
    labResult: { type: mongoose.Schema.Types.ObjectId, ref: 'LabResult', default: null, index: true },
    notes: { type: String, maxlength: 500 },
  },
  { timestamps: true },
);

hba1cSchema.index({ patient: 1, testedOn: -1 });

/** eAG in mg/dL — the ADAG formula patients actually recognise from their meter. */
hba1cSchema.virtual('estimatedAverageGlucose').get(function eag() {
  return Math.round(28.7 * this.percentage - 46.7);
});

hba1cSchema.set('toJSON', { virtuals: true });

hba1cSchema.plugin(clinicalRecord, { hideVoided: true });

export const Hba1cRecord = mongoose.model('Hba1cRecord', hba1cSchema);
