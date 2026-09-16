import mongoose from 'mongoose';

/**
 * Every uploaded file (foot photo, retinal report, lab PDF) is registered here.
 * Storing ownership on the asset lets one authorisation check guard all
 * downloads, instead of each module re-implementing access rules.
 */
const mediaAssetSchema = new mongoose.Schema(
  {
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },

    kind: {
      type: String,
      enum: [
        'foot_photo',
        'retinal_report',
        'lab_report',
        'prescription_pdf',
        'meal_photo',
        'avatar',
        // A doctor's handwritten signature image, embedded into prescription PDFs.
        'signature',
        // The clinic's own mark, drawn on every panel header and on the
        // prescription letterhead. Kept out of `avatar` on purpose: an avatar
        // belongs to a person and is cropped to a circle, and a wordmark
        // cropped to a circle is unreadable.
        'clinic_logo',
        // A recording the patient spoke instead of typing. Kept as uploaded so
        // the clinic hears exactly what was said, tone included.
        'voice_note',
        // A photograph or PDF of an electrocardiogram, filed with the reading
        // a clinician made of it (models/EcgReport.js).
        'ecg_tracing',
        'other',
      ],
      required: true,
      index: true,
    },

    /// Words spoken in a `voice_note`, transcribed once at upload.
    ///
    /// Stored rather than derived on read: the triage engine and the assistant
    /// both need text, the doctor needs it to skim a thread without playing
    /// every clip, and re-transcribing on each read would spend a model call to
    /// recompute something that cannot change.
    transcript: {
      type: String,
      maxlength: 8000,
    },

    storageKey: { type: String, required: true }, // path relative to UPLOAD_DIR
    originalName: { type: String, maxlength: 260 },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
    width: Number,
    height: Number,

    // Soft-delete: clinical images are retained for the medical record even
    // after a patient hides them from their own timeline.
    deletedAt: Date,
  },
  { timestamps: true },
);

export const MediaAsset = mongoose.model('MediaAsset', mediaAssetSchema);
