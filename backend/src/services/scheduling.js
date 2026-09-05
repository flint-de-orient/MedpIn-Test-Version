import { dayjs, inClinicTz, clinicDateTime, clinicDayOfWeek } from '../utils/clinicTime.js';
import { Appointment } from '../models/Appointment.js';
import { Availability } from '../models/Availability.js';

/** Statuses that occupy a slot — a cancelled/completed one frees it. */
export const ACTIVE_STATUSES = ['requested', 'confirmed', 'checked_in', 'in_consultation'];

/**
 * The availability windows that apply to a clinic on a given clinic-local date.
 * A date-specific override (holiday closure or special hours) wins over the
 * weekly pattern; otherwise the weekly entries for that day-of-week apply.
 *
 * @returns {{start:string,end:string}[]} sorted, each 'HH:mm'
 */
export function windowsForDate(clinic, dateStr) {
  const override = (clinic.overrides ?? []).find((o) => o.date === dateStr);
  if (override) {
    if (override.isClosed) return [];
    if (override.windows?.length) {
      return [...override.windows]
        .map((w) => ({ start: w.start, end: w.end }))
        .sort((a, b) => a.start.localeCompare(b.start));
    }
    // An override with neither closure nor windows is treated as "no special
    // change" and falls through to the weekly pattern below.
  }

  const dow = clinicDayOfWeek(dateStr);
  return (clinic.weeklyHours ?? [])
    .filter((w) => w.dayOfWeek === dow)
    .map((w) => ({ start: w.start, end: w.end }))
    .sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * The slot start times a clinic's schedule yields on a date, before any
 * booking/past filtering. Pure (no DB) so it can be reasoned about and tested
 * on its own. Slot starts run from each window's start up to — but not
 * including — its end, so a 10:00–14:00 window at 15 min yields 10:00 … 13:45.
 *
 * @returns {{time:string,instant:import('dayjs').Dayjs}[]} sorted by time
 */
export function buildSlotTimes(clinic, dateStr) {
  const windows = windowsForDate(clinic, dateStr);
  const step = clinic.slotMinutes;
  const seen = new Set();
  const out = [];

  for (const w of windows) {
    let t = clinicDateTime(dateStr, w.start);
    const end = clinicDateTime(dateStr, w.end);
    while (t.isBefore(end)) {
      const time = t.format('HH:mm');
      if (!seen.has(time)) {
        seen.add(time);
        out.push({ time, instant: t });
      }
      t = t.add(step, 'minute');
    }
  }

  return out.sort((a, b) => a.time.localeCompare(b.time));
}

/**
 * The diary to read for a doctor at a location — theirs, or the building's.
 *
 * Availability is per doctor per location, but the clinic still carries the
 * hours it always did and this falls back to them. That fallback is what lets
 * the row exist before anything writes one: a location with no availability
 * rows behaves exactly as it did, so the migration can run late, partially, or
 * never without a patient losing the ability to book.
 *
 * It returns the clinic itself in that case rather than a copy, because the
 * slot engine reads three fields — `weeklyHours`, `overrides`, `slotMinutes` —
 * and a Clinic and an Availability both have all three under those names.
 */
export async function scheduleFor(clinic, doctorId = null) {
  if (!doctorId || !clinic?._id) return clinic;

  const own = await Availability.findOne({
    doctor: doctorId,
    location: clinic._id,
    isActive: true,
  }).lean();

  // A doctor with no diary at this location falls back to the building's hours.
  // Returning nothing instead would read as "never available", which would take
  // a working clinic's booking page down the moment this shipped.
  return own ?? clinic;
}

/**
 * Bookable slots for a clinic on a clinic-local date, each marked available or
 * not. A slot is unavailable if it is already taken by an active appointment or
 * if its start time has passed.
 *
 * @returns {Promise<{time:string,iso:string,available:boolean}[]>}
 */
export async function generateSlots(clinic, dateStr, { now = dayjs(), doctorId = null } = {}) {
  // Whose diary, then which slots. The appointment lookup below still keys on
  // the clinic: two doctors at one location hold separate diaries but share the
  // rooms, and a slot taken is taken.
  const schedule = await scheduleFor(clinic, doctorId);
  const times = buildSlotTimes(schedule, dateStr);
  if (!times.length) return [];

  const dayStart = clinicDateTime(dateStr, '00:00');
  const booked = await Appointment.find({
    clinic: clinic._id,
    status: { $in: ACTIVE_STATUSES },
    scheduledFor: { $gte: dayStart.toDate(), $lt: dayStart.add(1, 'day').toDate() },
  })
    .select('scheduledFor')
    .lean();

  const taken = new Set(booked.map((b) => inClinicTz(b.scheduledFor).format('HH:mm')));

  return times.map(({ time, instant }) => ({
    time,
    iso: instant.toDate().toISOString(),
    available: !taken.has(time) && instant.isAfter(now),
  }));
}

/**
 * Whether a specific instant is a legitimately bookable slot for a clinic:
 * it must land on the schedule, be in the future, and not already be taken.
 * This is the server-side guard that makes booking transactional — the client
 * cannot book a time the schedule does not offer.
 */
export async function isSlotBookable(clinic, scheduledFor, { now = dayjs(), doctorId = null } = {}) {
  const local = inClinicTz(scheduledFor);
  const dateStr = local.format('YYYY-MM-DD');
  const time = local.format('HH:mm');
  const slots = await generateSlots(clinic, dateStr, { now, doctorId });
  const match = slots.find((s) => s.time === time);
  return Boolean(match && match.available);
}
