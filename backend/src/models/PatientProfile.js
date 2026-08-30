import mongoose from 'mongoose';

/**
 * Clinical profile, kept separate from the auth `User` so that doctor/staff
 * accounts never carry empty clinical fields and patient data can be scoped
 * and exported independently.
 */
const patientProfileSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    /// The doctor's diagnosis, not a guess.
    ///
    /// This defaulted to 'type2', and the zod schema in registration defaulted
    /// to it as well — so a patient who was never asked arrived on their own
    /// Home screen labelled "Type 2 Diabetes". A diagnosis nobody made,
    /// printed as fact, on the screen a patient trusts most.
    ///
    /// Undefined until somebody decides. Issuing a prescription already
    /// derives it from the diagnosis text, which is the right moment: a
    /// clinician wrote it down. Until then the app shows "Not set", which it
    /// has always known how to do.
    diabetesType: {
      type: String,
      enum: ['type1', 'type2', 'gestational', 'prediabetes', 'none'],
    },
    diagnosedOn: Date,

    // Postal address, captured at desk registration. Kept on the clinical
    // profile (not the auth User) so it exports with the rest of the record.
    address: { type: String, trim: true, maxlength: 300 },

    heightCm: { type: Number, min: 50, max: 250 },

    // The patient's usual meal times, used to anchor medicine reminders so
    // "before breakfast" fires relative to when THEY eat. Sensible defaults.
    mealTimes: {
      breakfast: { type: String, default: '08:00', match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm'] },
      lunch: { type: String, default: '13:30', match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm'] },
      dinner: { type: String, default: '20:30', match: [/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:mm'] },
    },
    baselineWeightKg: { type: Number, min: 10, max: 400 },

    // Personalised targets; the triage engine falls back to clinic defaults
    // when these are unset.
    targets: {
      fastingMin: { type: Number, default: 80 },
      fastingMax: { type: Number, default: 130 },
      postPrandialMax: { type: Number, default: 180 },
      hba1cMax: { type: Number, default: 7.0 },
      systolicMax: { type: Number, default: 140 },
      diastolicMax: { type: Number, default: 90 },
      dailyWaterMl: { type: Number, default: 2500 },
      dailyStepsGoal: { type: Number, default: 6000 },
    },

    comorbidities: [
      {
        type: String,
        enum: [
          'hypertension',
          'dyslipidaemia',
          'ckd',
          'retinopathy',
          'neuropathy',
          'cad',
          'thyroid',
          'obesity',
          'other',
        ],
      },
    ],
    allergies: [{ type: String, trim: true, maxlength: 120 }],

    // Drives the diabetic-foot module's screening cadence.
    footRiskCategory: { type: String, enum: ['low', 'moderate', 'high', 'urgent'], default: 'low' },
    lastFootScreeningAt: Date,
    lastEyeScreeningAt: Date,

    emergencyContact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      relation: { type: String, trim: true },
    },

    // Denormalised for fast doctor-dashboard segmentation; recomputed by the
    // analytics service rather than trusted as a source of truth.
    riskScore: { type: Number, min: 0, max: 100, default: 0, index: true },
    riskBand: { type: String, enum: ['low', 'moderate', 'high', 'critical'], default: 'low', index: true },
    lastRiskComputedAt: Date,

    assignedDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    // Nutrition care. The doctor assigns a dietician and how often they should
    // review this patient's food log (in days); null = no recurring review set.
    assignedDietician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    dietReviewIntervalDays: { type: Number, min: 1, max: 30, default: null },
    lastDietReviewAt: Date,

    // Continuous monitoring. How often the doctor expects this patient to
    // self-report a glucose check-in (in days). null = fall back to the app
    // default cadence. Drives the "overdue check-in" surfacing and the
    // patient's own (adaptive, non-nagging) reminder.
    checkInIntervalDays: { type: Number, min: 1, max: 30, default: null },

    // The patient's current presenting complaint — captured at registration and
    // updated at each consult; snapshotted onto each prescription at issue time.
    chiefComplaint: { type: String, trim: true, maxlength: 1000 },

    notes: { type: String, maxlength: 4000 },
  },
  { timestamps: true },
);

export const PatientProfile = mongoose.model('PatientProfile', patientProfileSchema);
