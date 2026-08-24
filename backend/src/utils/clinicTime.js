import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import relativeTime from 'dayjs/plugin/relativeTime.js';
import { env } from '../config/env.js';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);
// Needed by anything that renders "2 hours ago" rather than a timestamp — the
// dietician's attention list and activity feed both do. Without it `fromNow`
// is simply absent and the call throws at request time, not at import.
dayjs.extend(relativeTime);

/**
 * The clinic's wall-clock timezone. Every appointment slot is reasoned about in
 * this zone so that "10:00 at the Salt Lake clinic" means the same instant
 * whether the API runs on a laptop in IST or a VPS in UTC.
 */
export const CLINIC_TZ = env.CLINIC_TZ;

export { dayjs };

/** An absolute instant, viewed as clinic-local wall-clock. */
export const inClinicTz = (instant) => dayjs(instant).tz(CLINIC_TZ);

/**
 * Compose an absolute instant from a clinic-local date + time.
 * @param {string} dateStr 'YYYY-MM-DD'
 * @param {string} timeStr 'HH:mm'
 */
export const clinicDateTime = (dateStr, timeStr) =>
  dayjs.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm', CLINIC_TZ);

/** 0 (Sunday) – 6 (Saturday) for a clinic-local calendar date. */
export const clinicDayOfWeek = (dateStr) => clinicDateTime(dateStr, '00:00').day();

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
