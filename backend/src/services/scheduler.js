import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

import { Appointment } from '../models/Appointment.js';
import { ACTIVE_STATUSES } from './scheduling.js';
import { notifyClinicOfTomorrowSchedule, notifyVisitTomorrow } from './notifications.js';
import { User, ROLES } from '../models/User.js';
import { practiceOfAppointment, memberIdsOf } from '../middleware/practiceScope.js';
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

  /**
   * The doctors to copy in, for the practice whose day this appointment is.
   *
   * Still once rather than once per appointment — a clinic with forty tomorrow
   * made forty identical queries before the cache — but keyed by practice
   * instead of shared by everybody. Reminding one clinic's doctor about another
   * clinic's patient by name is the same leak as the digest above, one
   * appointment at a time.
   *
   * The appointment's doctor's practice, or its patient's — see
   * `practiceOfAppointment`. It was the patient's assigned doctor alone, which a
   * patient the desk enrolled does not have, and every doctor on the platform
   * was reminded of them by name. `null` is still the unknown bucket, the
   * behaviour this had before, for a patient nobody is caring for.
   */
  const tokenCache = new Map();
  async function doctorTokensFor(appt) {
    const key = (await practiceOfAppointment(appt)) ?? null;
    if (tokenCache.has(key)) return tokenCache.get(key);

    const ids = await memberIdsOf(key, ROLES.DOCTOR);
    const doctors = await User.find({
      role: ROLES.DOCTOR,
      isActive: true,
      ...(ids ? { _id: { $in: ids } } : {}),
    })
      .select('deviceTokens')
      .lean();

    const tokens = doctors.flatMap((d) => d.deviceTokens ?? []);
    tokenCache.set(key, tokens);
    return tokens;
  }

  for (const appt of due) {
    try {
      const doctorTokens = await doctorTokensFor(appt);
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
/**
 * Whether this process is the one that runs the crons.
 *
 * ---- The failure this prevents -------------------------------------------
 *
 * The scheduler lives inside the API process. Run the API under `pm2 -i max`
 * and every worker starts its own copy, so a patient with a 9pm insulin
 * reminder gets it once per CPU core — four prompts to take a dose they should
 * take once. Nothing errors. Nothing is logged. The only symptom is a patient
 * being told four times, and the plausible response to that is to take it
 * again.
 *
 * So the guard is here rather than in a deployment note. A note is followed
 * until the evening somebody scales the API to fix a slow endpoint and does not
 * think about reminders.
 *
 * pm2 numbers its workers in `NODE_APP_INSTANCE`; worker 0 runs the crons and
 * the rest do not. Unset — a plain `node src/server.js` — means there is one
 * process and it is this one.
 *
 * `RUN_SCHEDULER` overrides both ways, for the step after this: the scheduler
 * extracted into a process of its own, where the API sets it false and the
 * worker sets it true.
 *
 * ---- What this does not solve -------------------------------------------
 *
 * Two *machines*. Each has its own worker 0, so both would run the crons. That
 * is fine until step 5 of the scaling order — nginx in front of two app servers
 * — and before then this needs a lock in the database rather than a look at an
 * environment variable. Written down because the guard reads as complete and is
 * not.
 */
function shouldRunScheduler() {
  const override = process.env.RUN_SCHEDULER;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return (process.env.NODE_APP_INSTANCE ?? '0') === '0';
}

export function startScheduler() {
  if (!shouldRunScheduler()) {
    // Logged rather than silent: a worker that is deliberately not scheduling
    // should say so, or the first question during an incident is whether the
    // crons are running at all.
    logger.info(
      { instance: process.env.NODE_APP_INSTANCE ?? null },
      'scheduler not started in this worker — another process owns the crons',
    );
    return () => {};
  }

  const handle = setInterval(tick, TICK_MS);
  // Do not hold the process open on account of the scheduler alone.
  handle.unref?.();
  logger.info({ digestHour: DIGEST_HOUR, tz: CLINIC_TZ }, 'scheduler started');
  return () => clearInterval(handle);
}
