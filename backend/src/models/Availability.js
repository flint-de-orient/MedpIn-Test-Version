import mongoose from 'mongoose';
import { TIME_RE, DATE_RE } from '../utils/clinicTime.js';

const timeValidator = { validator: (v) => TIME_RE.test(v), message: 'time must be HH:mm (24h)' };

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
 * When a particular doctor sits at a particular location.
 *
 * ---- Why the hours moved off the clinic ---------------------------------
 *
 * `Clinic.weeklyHours` describes when the *building* is open, which is the same
 * thing as the doctor's diary only while there is one doctor. A polyclinic with
 * eight of them has one building and eight diaries, and hours on the location
 * would give all eight the same one — booking a cardiologist into a slot the
 * dermatologist is sitting in.
 *
 * So availability is a row per doctor per location. Dr. Dey at Salt Lake on
 * Mondays is one row; the same doctor at Behala on Thursday evenings is
 * another.
 *
 * ---- The shape is deliberately identical to Clinic's --------------------
 *
 * `weeklyHours`, `overrides` and `slotMinutes` carry exactly the field names
 * the clinic uses, because [services/scheduling.js] reads those three and
 * nothing else. That makes an availability row a drop-in for a clinic in the
 * slot engine — the pure functions did not change at all, and the fallback
 * costs one line rather than a parallel code path.
 */
const availabilitySchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /// The place. Still called `Clinic` in the codebase; it is the location.
    location: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', required: true, index: true },

    /// Per doctor, not per building: a consultant may take 20 minutes where a
    /// general clinic takes 10, in the same room on different days.
    slotMinutes: { type: Number, default: 15, min: 5, max: 120 },

    weeklyHours: { type: [weeklyHoursSchema], default: [] },
    overrides: { type: [overrideSchema], default: [] },

    /// Soft-disable, so appointments already booked against this diary keep a
    /// valid reference when a doctor stops sitting at a location.
    isActive: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);

/// One diary per doctor per location. A second row is a duplicate, not a second
/// sitting — several sittings in a week are several `weeklyHours` entries.
availabilitySchema.index({ doctor: 1, location: 1 }, { unique: true });

/// "Who sits here, and when" — the query behind a location's booking page.
availabilitySchema.index({ location: 1, isActive: 1 });

availabilitySchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    doctor: String(this.doctor),
    location: String(this.location),
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
  };
};

export const Availability = mongoose.model('Availability', availabilitySchema);
