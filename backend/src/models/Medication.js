import mongoose from 'mongoose';

export const MED_FORMS = Object.freeze([
  'tablet',
  'capsule',
  'insulin',
  'injection',
  'syrup',
  'inhaler',
  'topical',
  'other',
]);

/**
 * A medication the patient is currently expected to take. Insulin is modelled
 * here too (form: 'insulin') so adherence and dose logging share one pipeline.
 */
const medicationSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    name: { type: String, required: true, trim: true, maxlength: 160 },
    genericName: { type: String, trim: true, maxlength: 160 },
    form: { type: String, enum: MED_FORMS, default: 'tablet' },

    strength: { type: String, trim: true, maxlength: 60 }, // e.g. "500 mg", "100 IU/mL"
    dose: { type: String, trim: true, maxlength: 60 }, // e.g. "1 tablet", "12 units"

    // Local clock times "HH:mm" — reminders are scheduled on the device, so the
    // server stays timezone-agnostic.
    schedule: [
      {
        time: { type: String, required: true, match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm'] },
        // The meal slot this dose is anchored to, so its time can be re-derived
        // when the patient changes their meal times. Absent for a manual time.
        slot: { type: String, enum: ['morning', 'noon', 'afternoon', 'night', 'bedtime'] },
        relationToMeal: {
          type: String,
          enum: ['before_meal', 'after_meal', 'with_meal', 'any'],
          default: 'any',
        },
      },
    ],
    daysOfWeek: {
      // 0 = Sunday. Empty means every day.
      type: [Number],
      default: [],
      validate: [(v) => v.every((d) => d >= 0 && d <= 6), 'daysOfWeek must be 0-6'],
    },

    // How the dose is given (PO/IV/SC/…). Presentation only; does not affect the
    // schedule.
    route: {
      type: String,
      enum: ['oral', 'iv', 'sc', 'im', 'topical', 'inhaled'],
      default: 'oral',
    },
    // PRN/SOS — taken only when required, so it carries an empty schedule and
    // arms no reminders.
    asNeeded: { type: Boolean, default: false },
    // Stat — a single immediate dose, not a recurring one.
    stat: { type: Boolean, default: false },
    // Every-other-day (EOD) etc.: 1 = daily, 2 = every other day. The device
    // scheduler only arms a dose on days matching this interval from startDate.
    dayInterval: { type: Number, default: 1, min: 1, max: 30 },

    startDate: { type: Date, default: Date.now },
    endDate: Date,
    isActive: { type: Boolean, default: true, index: true },
    // True once the patient overrides a reminder time by hand — a later
    // meal-time change then leaves this medicine's schedule untouched.
    timesCustomized: { type: Boolean, default: false },

    prescribedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription' },

    /// How this medicine got here.
    ///
    /// `clinic` means a clinician issued it through the app, and prescribedBy
    /// names them. `scan` means the patient photographed a paper prescription —
    /// possibly one this clinic never wrote. The two were indistinguishable:
    /// a scanned medicine landed in the tracker with prescribedBy null, looking
    /// exactly like one of the doctor's own, and the doctor had no way to tell
    /// which of the medicines on the screen they were responsible for.
    source: { type: String, enum: ['clinic', 'scan', 'manual'], default: 'clinic', index: true },

    /// Who wrote the paper prescription, as read off the photograph.
    ///
    /// Unverified on purpose, and never used to decide anything. A doctor's
    /// name on a prescription is handwriting, a stamp or a letterhead, and OCR
    /// of it is not evidence — so it is carried as a label the reader can weigh
    /// and never as a gate. In particular it does NOT filter the medicine out:
    /// a list missing the steroid another doctor prescribed is more dangerous
    /// than a list with an unfamiliar name on it, because raised glucose with
    /// no visible cause is exactly what that omission produces.
    externalPrescriber: {
      name: { type: String, trim: true, maxlength: 160 },
      speciality: { type: String, trim: true, maxlength: 120 },
      clinic: { type: String, trim: true, maxlength: 160 },
      writtenOn: Date,
    },
    instructions: { type: String, maxlength: 600 },
  },
  { timestamps: true },
);

medicationSchema.index({ patient: 1, isActive: 1 });

export const Medication = mongoose.model('Medication', medicationSchema);
