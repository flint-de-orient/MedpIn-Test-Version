import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

import { Appointment } from '../models/Appointment.js';
import { ACTIVE_STATUSES } from './scheduling.js';
import { notifyClinicOfTomorrowSchedule, notifyVisitTomorrow } from './notifications.js';
import { User, ROLES } from '../models/User.js';
import { logger } from '../config/logger.js';

dayjs.extend(utc);
dayjs.extend(timezone);

/** The clinic is in Kolkata; the server may well not be. */
const CLINIC_TZ = 'Asia/Kolkata';

/** Local hour at which the doctor is sent tomorrow's list. */
const DIGEST_HOUR = 20;

/**
 * How often the clock is checked. Any interval comfortably under an hour works;
 * five minutes keeps the digest punctual without meaningful cost.
 */
const TICK_MS = 5 * 60 * 1000;

/**
 * Guards against sending twice. In memory rather than persisted: the only cost
 * of a restart inside the digest window is one repeated notification, which is
 * not worth a collection and a write to prevent.
 */
let lastDigestDate = null;

async function sendTomorrowDigest() {
  const start = dayjs().tz(CLINIC_TZ).add(1, 'day').startOf('day');
  const end = start.endOf('day');

  const appointments = await Appointment.find({
    scheduledFor: { $gte: start.toDate(), $lte: end.toDate() },
    status: { $in: ACTIVE_STATUSES },
  })
    .sort({ scheduledFor: 1 })
    .lean();

  await notifyClinicOfTomorrowSchedule(appointments);
  logger.info({ count: appointments.length, for: start.format('YYYY-MM-DD') }, 'sent tomorrow digest');
}

/**
 * Remind each patient, and the doctor, about tomorrow's appointment.
 *
 * Alongside the digest rather than inside it. The digest is the shape of a day
 * — "six tomorrow, first at 10:30" — which is what a doctor plans from and
 * which no patient may be shown. This is one appointment, with an hour on it,
 * to the person who has to turn up for it.
 *
 * Guarded on the appointment itself. An in-memory flag would re-remind fifty
 * patients after a restart, and the whole point of the guard is that a person's
 * phone buzzes once.
 */
async function sendVisitReminders() {
  const start = dayjs().tz(CLINIC_TZ).add(1, 'day').startOf('day');
  const end = start.endOf('day');

  const due = await Appointment.find({
    scheduledFor: { $gte: start.toDate(), $lte: end.toDate() },
    status: { $in: ACTIVE_STATUSES },
    remindedAt: null,
  })
    .populate('patient', 'name language deviceTokens')
    .limit(200)
    .lean();

  if (!due.length) return;

  // Once, not once per appointment: a clinic with forty tomorrow would
  // otherwise make forty identical queries for the same doctor.
  const doctors = await User.find({ role: ROLES.DOCTOR, isActive: true })
    .select('deviceTokens')
    .lean();
  const doctorTokens = doctors.flatMap((d) => d.deviceTokens ?? []);

  for (const appt of due) {
    try {
      await notifyVisitTomorrow(appt, { patient: appt.patient, doctorTokens });
      // Marked after the send, so a push that throws is retried on the next
      // tick rather than silently skipped for good.
      await Appointment.updateOne({ _id: appt._id }, { $set: { remindedAt: new Date() } });
    } catch (err) {
      logger.error({ err, appointmentId: String(appt._id) }, 'visit reminder failed');
    }
  }

  logger.info({ count: due.length }, 'sent day-before visit reminders');
}

async function tick() {
  try {
    const now = dayjs().tz(CLINIC_TZ);
    const today = now.format('YYYY-MM-DD');

    if (now.hour() === DIGEST_HOUR && lastDigestDate !== today) {
      lastDigestDate = today;
      await sendTomorrowDigest();
    }

    // Every tick, not only at the digest hour. An appointment confirmed at
    // nine tonight for tomorrow morning would otherwise be reminded about
    // never — the digest hour has passed, and there is no second chance.
    // `remindedAt` on the row is what keeps this to one buzz per person.
    if (now.hour() >= DIGEST_HOUR || now.hour() < 6) {
      await sendVisitReminders();
    }
  } catch (err) {
    // A scheduler that dies on one bad tick is worse than one that logs and
    // tries again in five minutes.
    logger.error({ err }, 'scheduler tick failed');
  }
}

/**
 * Starts the background schedule. Returns a stop function so tests and a clean
 * shutdown can cancel it.
 *
 * The digest goes out the evening before rather than the morning of, because
 * knowing the shape of a day is only useful while there is still time to change
 * it — move a clash, prepare for a complex case, start late if the morning is
 * empty. By the time the clinic opens, none of that is possible any more.
 */
export function startScheduler() {
  const handle = setInterval(tick, TICK_MS);
  // Do not hold the process open on account of the scheduler alone.
  handle.unref?.();
  logger.info({ digestHour: DIGEST_HOUR, tz: CLINIC_TZ }, 'scheduler started');
  return () => clearInterval(handle);
}
