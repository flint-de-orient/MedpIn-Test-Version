import { inClinicTz, clinicDateTime } from '../utils/clinicTime.js';
import { Medication } from '../models/Medication.js';
import { MedicationLog } from '../models/MedicationLog.js';
import { claimDoseReminder } from '../models/MedicationReminderPush.js';
import { sendMedicationReminderPush } from './notifications.js';
import { reminderIdFor } from '../utils/medReminderId.js';
import { completeEndedCourses, doseExpected } from './medicationLifecycle.js';
import { ownsTheCrons, notStartedHere } from './cronOwner.js';
import { logger } from '../config/logger.js';

/**
 * Server-side backstop for medication reminders.
 *
 * On-device alarms are best-effort — an OEM can kill them, a reboot can drop
 * them before the boot receiver re-arms, the alarm slot table can overflow. This
 * cron sends a data-only FCM at each dose time carrying the SAME deterministic
 * notification id the client uses, so when both fire they collapse into one
 * notification, and when the local alarm didn't, the push still lands.
 *
 * Ticks every 30s (not 60) so a slightly-delayed tick can't skip a whole dose
 * minute — which means every dose minute is seen twice. Each dose is claimed in
 * the database before it is pushed (see MedicationReminderPush), so it goes out
 * once across both ticks, a restart inside the minute, and any other process.
 *
 * That guard used to be a Set in memory, on the reasoning that production was a
 * single process. The Set was emptied by a restart, invisible to a second
 * worker, and passed by two overlapping ticks alike. The client's id-collapse is
 * the last safety net, not the first: it only works when the app draws the
 * notification, and this backstop exists for the phones where it cannot.
 */
const TICK_MS = 30 * 1000;

/**
 * Push the reminders due in the clinic-local minute of `instant`, and return how
 * many were pushed.
 *
 * `send` is the push itself, replaceable so a test can count what would have
 * reached a phone.
 */
export async function remindDueDoses(at, { send = sendMedicationReminderPush } = {}) {
  const instant = at ?? new Date();
  const now = inClinicTz(instant);
  const hhmm = now.format('HH:mm');
  const today = now.format('YYYY-MM-DD');

  const startOfToday = clinicDateTime(today, '00:00').toDate();
  // Only meds with a slot due THIS minute — cheap even at 30s cadence.
  const meds = await Medication.find({
    isActive: true,
    'schedule.time': hhmm,
    startDate: { $lte: instant },
    $or: [{ endDate: null }, { endDate: { $gte: startOfToday } }],
  })
    .select('patient name dose schedule daysOfWeek dayInterval asNeeded stat startDate endDate stoppedByDoctor cancelled patientStops')
    .lean();

  let pushed = 0;
  for (const med of meds) {
    for (const slot of med.schedule ?? []) {
      if (slot.time !== hhmm) continue;

      // The dose calendar every schedule reads: the weekday and the
      // every-other-day interval (never asked here, so an alternate-day tablet
      // was pushed daily), the start, and the end of the course to the minute
      // (a course ending at ten was still pushed at eight that evening).
      const scheduledFor = clinicDateTime(today, slot.time).toDate();
      if (!doseExpected(med, scheduledFor)) continue;

      // Already taken or skipped today → don't nag.
      // eslint-disable-next-line no-await-in-loop
      const log = await MedicationLog.findOne({ medication: med._id, scheduledFor }).select('status').lean();
      if (log && (log.status === 'taken' || log.status === 'skipped')) continue;

      // Claimed before the push, not after: two ticks reaching this dose at
      // the same moment must not both send. A database that cannot take the
      // claim skips the push — the phone's own alarm is the reminder, and an
      // unguarded backstop is how a patient is told twice.
      let claimed;
      try {
        // eslint-disable-next-line no-await-in-loop
        claimed = await claimDoseReminder({ medication: med._id, time: slot.time, day: today });
      } catch (err) {
        logger.error({ err: err?.message, medicationId: String(med._id), time: slot.time }, 'could not claim a dose reminder; not pushing it');
        continue;
      }
      if (!claimed) continue;

      try {
        // eslint-disable-next-line no-await-in-loop
        await send({
          patientId: med.patient,
          med,
          time: slot.time,
          relationToMeal: slot.relationToMeal,
          notifId: reminderIdFor(med, slot.time, today),
        });
        pushed += 1;
      } catch (err) {
        // One patient's failed push used to end the tick, and every patient
        // after them in the list missed that minute's reminder.
        logger.error({ err: err?.message, medicationId: String(med._id), time: slot.time }, 'dose reminder push failed');
      }
    }
  }
  return pushed;
}

let sweptMinute = '';

async function tick() {
  const minute = inClinicTz(new Date()).format('YYYY-MM-DD HH:mm');
  if (minute !== sweptMinute) {
    sweptMinute = minute;
    // Courses that ran out end here as well, once a minute — not only when the
    // patient next opens their list, which for a finished course may be never.
    // Each transition is conditional, so a second process sweeping too costs a
    // query, not a wrong answer.
    await completeEndedCourses().catch((err) => logger.error({ err }, 'course completion sweep failed'));
  }
  await remindDueDoses();
}

let handle = null;

/**
 * Starts the cron in the process that owns the background jobs (see
 * cronOwner.js). Idempotent; `unref` so it never holds the process open.
 *
 * Returns a stop function, or null when another process owns the jobs.
 */
export function startMedicationReminderCron() {
  if (!ownsTheCrons()) {
    notStartedHere('medication reminder cron');
    return null;
  }
  if (!handle) {
    handle = setInterval(() => {
      tick().catch((err) => logger.error({ err }, 'medication reminder tick failed'));
    }, TICK_MS);
    handle.unref?.();
    logger.info('medication reminder cron started (30s tick)');
  }
  return () => {
    clearInterval(handle);
    handle = null;
  };
}
