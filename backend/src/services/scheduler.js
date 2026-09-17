import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';

import { Appointment } from '../models/Appointment.js';
import { ACTIVE_STATUSES } from './scheduling.js';
import { notifyClinicOfTomorrowSchedule, notifyVisitTomorrow } from './notifications.js';
import { User, ROLES } from '../models/User.js';
import { practiceOfAppointment, memberIdsOf } from '../middleware/practiceScope.js';
import { sendChatDigests } from './chatDigest.js';
import { claimReminderPass } from '../models/ReminderRun.js';
import { ownsTheCrons, notStartedHere } from './cronOwner.js';
import { env } from '../config/env.js';
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
 *
 * Returns how many were reminded. `now` and `notify` are replaceable so a test
 * can run it for a chosen evening and count what would have been sent.
 */
export async function sendVisitReminders({ now, notify = notifyVisitTomorrow } = {}) {
  const start = (now ?? dayjs().tz(CLINIC_TZ)).add(1, 'day').startOf('day');
  const end = start.endOf('day');

  const due = await Appointment.find({
    scheduledFor: { $gte: start.toDate(), $lte: end.toDate() },
    status: { $in: ACTIVE_STATUSES },
    remindedAt: null,
  })
    .populate('patient', 'name language deviceTokens')
    .limit(200)
    .lean();

  if (!due.length) return 0;

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

  let sent = 0;
  for (const appt of due) {
    // Claimed on the row before the push. It was marked after: two processes
    // reading the same due list — or a tick overlapping a slow one — both found
    // `remindedAt` empty and both reminded. Only one of them can fill it.
    const claimedAt = new Date();
    const claim = await Appointment.updateOne(
      { _id: appt._id, remindedAt: null },
      { $set: { remindedAt: claimedAt } },
    );
    if (claim.modifiedCount !== 1) continue;

    try {
      const doctorTokens = await doctorTokensFor(appt);
      await notify(appt, { patient: appt.patient, doctorTokens });
      sent += 1;
    } catch (err) {
      // Released, so a push that throws is retried on the next tick rather
      // than silently skipped for good — the reason it was marked after.
      await Appointment.updateOne(
        { _id: appt._id, remindedAt: claimedAt },
        { $set: { remindedAt: null } },
      ).catch(() => {});
      logger.error({ err, appointmentId: String(appt._id) }, 'visit reminder failed');
    }
  }

  logger.info({ due: due.length, sent }, 'sent day-before visit reminders');
  return sent;
}

async function tick() {
  try {
    const now = dayjs().tz(CLINIC_TZ);
    const today = now.format('YYYY-MM-DD');

    // Each evening push is claimed in the database, once per clinic day, before
    // it is sent (see ReminderRun). It was a date in memory, on the reasoning
    // that a restart inside the hour cost one repeated push; a restart re-sent
    // the whole list, and a second process would have sent it every evening.
    if (now.hour() === DIGEST_HOUR && (await claimReminderPass('digest:tomorrow', today))) {
      await sendTomorrowDigest();
    }

    // The day's patient conversations, summarised, to the clinicians who were
    // pushed only what could not wait. See services/chatDigest.js.
    if (now.hour() === env.CHAT_DIGEST_HOUR && (await claimReminderPass('digest:chat', today))) {
      const { sent } = await sendChatDigests(today);
      logger.info({ sent, for: today }, 'sent conversation digest');
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
 * Starts the background schedule, in the process that owns the background jobs
 * (see cronOwner.js). Returns a stop function so tests and a clean shutdown can
 * cancel it, or null when another process owns the jobs.
 *
 * The digest goes out the evening before rather than the morning of, because
 * knowing the shape of a day is only useful while there is still time to change
 * it — move a clash, prepare for a complex case, start late if the morning is
 * empty. By the time the clinic opens, none of that is possible any more.
 */
export function startScheduler() {
  if (!ownsTheCrons()) {
    notStartedHere('scheduler');
    return null;
  }

  const handle = setInterval(tick, TICK_MS);
  // Do not hold the process open on account of the scheduler alone.
  handle.unref?.();
  logger.info({ digestHour: DIGEST_HOUR, tz: CLINIC_TZ }, 'scheduler started');
  return () => clearInterval(handle);
}
