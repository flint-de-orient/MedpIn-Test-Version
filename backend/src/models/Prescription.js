import mongoose from 'mongoose';

/**
 * A prescription is an immutable clinical record. Corrections create a new
 * version pointing at `supersedes` rather than mutating the original — an
 * edited prescription with no history is a compliance problem.
 */
const prescriptionSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    appointment: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },

    // Human-readable, printed on the PDF. e.g. "AKD-2026-000412"
    referenceNo: { type: String, required: true, unique: true },
    issuedOn: { type: Date, required: true, default: Date.now, index: true },
    validUntil: Date,

    // The presenting complaint at this visit, snapshotted so the printed
    // prescription reflects what was said that day even as the patient's
    // current complaint on their profile moves on.
    complaint: { type: String, trim: true, maxlength: 1000 },

    diagnosis: [{ type: String, trim: true, maxlength: 300 }],
    items: [
      {
        name: { type: String, required: true, trim: true, maxlength: 160 },
        strength: { type: String, trim: true, maxlength: 60 },
        dose: { type: String, trim: true, maxlength: 60 },
        frequency: { type: String, trim: true, maxlength: 120 }, // "1-0-1"
        durationDays: { type: Number, min: 1, max: 365 },
        relationToMeal: {
          type: String,
          enum: ['before_meal', 'after_meal', 'with_meal', 'any'],
          default: 'any',
        },
        instructions: { type: String, maxlength: 400 },
      },
    ],

    labTestsAdvised: [{ type: String, trim: true, maxlength: 200 }],
    generalAdvice: { type: String, maxlength: 4000 },
    followUpOn: Date,

    pdfFile: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    /// How this prescription came to exist.
    ///
    /// `composed` is one written in the app: the doctor filled the consult
    /// form, the items below are structured, and the PDF is generated from
    /// them. `scanned` is a photograph or PDF of a paper prescription the
    /// doctor wrote by hand, filed afterwards by whoever was at the desk.
    ///
    /// The clinic runs its pilot on paper, so for the first fifty patients
    /// every prescription is the second kind. Recording which is which matters
    /// more than it looks: a scanned one has no machine-readable medicines, so
    /// nothing downstream — reminders, interaction checks, adherence — may
    /// treat its empty `items` as "this patient is on nothing".
    source: {
      type: String,
      enum: ['composed', 'scanned'],
      default: 'composed',
      index: true,
    },

    /// The photograph or PDF, for a `scanned` prescription.
    scanFile: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    /// Who filed it, when that is not the prescriber.
    ///
    /// `doctor` stays the doctor whose prescription it is — their name is on
    /// the paper and it belongs on the record. This says a receptionist put it
    /// into the system, which is a different claim and has to be a separate
    /// field: collapsing the two would either credit the desk with prescribing
    /// or record the doctor as having used an app they never opened.
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription' },
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

prescriptionSchema.index({ patient: 1, issuedOn: -1 });

export const Prescription = mongoose.model('Prescription', prescriptionSchema);
