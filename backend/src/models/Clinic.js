import mongoose from 'mongoose';
import { TIME_RE, DATE_RE } from '../utils/clinicTime.js';

const timeValidator = { validator: (v) => TIME_RE.test(v), message: 'time must be HH:mm (24h)' };

/**
 * One recurring window in the weekly schedule — e.g. Monday 10:00–14:00. A day
 * can have several (a morning and an evening sitting), so this is a flat list
 * keyed by dayOfWeek rather than one entry per day.
 */
const weeklyHoursSchema = new mongoose.Schema(
  {
    dayOfWeek: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    start: { type: String, required: true, validate: timeValidator },
    end: { type: String, required: true, validate: timeValidator },
  },
  { _id: false },
);

const windowSchema = new mongoose.Schema(
  {
    start: { type: String, required: true, validate: timeValidator },
    end: { type: String, required: true, validate: timeValidator },
  },
  { _id: false },
);

/**
 * A date-specific exception to the weekly pattern: a holiday closure
 * (`isClosed`) or special one-off hours (`windows`). Overrides win over the
 * weekly schedule for that date.
 */
const overrideSchema = new mongoose.Schema(
  {
    date: { type: String, required: true, match: DATE_RE }, // 'YYYY-MM-DD'
    isClosed: { type: Boolean, default: false },
    windows: { type: [windowSchema], default: [] },
    note: { type: String, maxlength: 200 },
  },
  { _id: false },
);

/**
 * A physical location where the doctor holds consultations, together with the
 * schedule of when they are available there. Doctor and staff manage these; the
 * slot engine ([services/scheduling.js]) turns the schedule into bookable
 * times, and patients book against it.
 */
const clinicSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 160 },
    addressLine: { type: String, trim: true, maxlength: 400 },
    city: { type: String, trim: true, maxlength: 120 },
    phone: { type: String, trim: true, maxlength: 40 },
    // A clinic usually publishes more than one line, and a patient who cannot
    // get through on the first should not have to hunt for the second.
    altPhone: { type: String, trim: true, maxlength: 40 },
    // Optional map link (Google Maps, etc.) so a patient can find the place.
    mapUrl: { type: String, trim: true, maxlength: 600 },

    // ---- Brand ------------------------------------------------------------
    //
    // The clinic's identity as the patient meets it: on the chat header, on the
    // prescription letterhead, in an appointment confirmation. This lived in
    // two env vars, which meant renaming the clinic took a redeploy — and made
    // a second clinic impossible, since one process can only hold one value.
    //
    // MedPin is the product; this is the tenant. The app's own name stays on
    // the icon, the splash and the About screen, and everything a patient reads
    // carries the clinic instead.

    /// The line under the name — "Diabetes Obesity & Metabolic Clinic".
    tagline: { type: String, trim: true, maxlength: 160 },

    /// The doctor's name as it should be printed, which is not always the name
    /// on their account ("Dr. Amit Kumar Dey" vs how they sign).
    doctorDisplayName: { type: String, trim: true, maxlength: 160 },

    /// Two logo assets, not one, and never an inverted copy of the other.
    ///
    /// Inverting artwork to fit a background destroys the brand colour — this
    /// clinic's teal comes out orange. So the two variants are stored as the
    /// designer drew them: `logoLight` is the one that reads on a light
    /// surface, `logoDark` the one for a dark surface.
    ///
    /// The app is light-only today, so `logoLight` is the one it draws. A
    /// clinic that only ever supplies dark-background artwork still renders —
    /// see `logoNeedsDarkChip`.
    logoLightAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
    logoDarkAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },

    /// Set when the only artwork supplied is drawn for a dark background.
    ///
    /// Measured on upload from the mean luminance of the non-transparent
    /// pixels, not guessed. When true the app paints the logo on a dark rounded
    /// chip rather than inverting it: the brand colours survive and the mark
    /// stays legible on a white screen.
    logoNeedsDarkChip: { type: Boolean, default: false },

    /// Printed under the signature on a prescription.
    registrationNo: { type: String, trim: true, maxlength: 60 },

    // The doctor whose availability this schedule represents. Single-doctor
    // today; the ref keeps a multi-doctor build open.
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    slotMinutes: { type: Number, default: 15, min: 5, max: 120 },
    weeklyHours: { type: [weeklyHoursSchema], default: [] },
    overrides: { type: [overrideSchema], default: [] },

    // Soft-disable rather than delete, so past appointments keep their clinic.
    isActive: { type: Boolean, default: true, index: true },
    sortIndex: { type: Number, default: 0 },
  },
  { timestamps: true },
);

clinicSchema.methods.toPublic = function toPublic() {
  return {
    id: this._id,
    name: this.name,
    addressLine: this.addressLine ?? null,
    city: this.city ?? null,
    phone: this.phone ?? null,
    altPhone: this.altPhone ?? null,
    mapUrl: this.mapUrl ?? null,
    tagline: this.tagline ?? null,
    doctorDisplayName: this.doctorDisplayName ?? null,
    registrationNo: this.registrationNo ?? null,
    logoLightUrl: this.logoLightAssetId ? `/api/v1/uploads/${this.logoLightAssetId}/raw` : null,
    logoDarkUrl: this.logoDarkAssetId ? `/api/v1/uploads/${this.logoDarkAssetId}/raw` : null,
    logoNeedsDarkChip: Boolean(this.logoNeedsDarkChip),
    slotMinutes: this.slotMinutes,
    weeklyHours: (this.weeklyHours ?? [])
      .map((w) => ({ dayOfWeek: w.dayOfWeek, start: w.start, end: w.end }))
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start)),
    overrides: (this.overrides ?? []).map((o) => ({
      date: o.date,
      isClosed: o.isClosed,
      windows: (o.windows ?? []).map((w) => ({ start: w.start, end: w.end })),
      note: o.note ?? null,
    })),
    isActive: this.isActive,
    sortIndex: this.sortIndex,
    createdAt: this.createdAt,
  };
};

/** Lightweight shape for embedding on an appointment. */
clinicSchema.methods.toBrief = function toBrief() {
  return {
    id: this._id,
    name: this.name,
    addressLine: this.addressLine ?? null,
    city: this.city ?? null,
    phone: this.phone ?? null,
  };
};

export const Clinic = mongoose.model('Clinic', clinicSchema);
