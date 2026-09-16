import { inClinicTz, clinicDateTime } from '../utils/clinicTime.js';
import { Medication } from '../models/Medication.js';
import { MedicationLog } from '../models/MedicationLog.js';
import { sendMedicationReminderPush } from './notifications.js';
import { reminderIdFor } from '../utils/medReminderId.js';
import { completeEndedCourses, doseExpected } from './medicationLifecycle.js';
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
 * minute; an in-memory per-minute guard keyed by notification id stops the same
 * dose being pushed twice within its minute. Single-process prod makes the
 * in-memory guard sufficient; the client's id-collapse is the final safety net.
 */
const TICK_MS = 30 * 1000;

const sentThisMinute = new Set();
let currentMinute = '';

async function tick() {
  const now = inClinicTz(new Date());
  const hhmm = now.format('HH:mm');
  const today = now.format('YYYY-MM-DD');

  const minuteKey = `${today} ${hhmm}`;
  if (minuteKey !== currentMinute) {
    currentMinute = minuteKey;
    sentThisMinute.clear();
    // Courses that ran out end here as well, once a minute — not only when the
    // patient next opens their list, which for a finished course may be never.
    await completeEndedCourses().catch((err) => logger.error({ err }, 'course completion sweep failed'));
  }

  const startOfToday = clinicDateTime(today, '00:00').toDate();
  // Only meds with a slot due THIS minute — cheap even at 30s cadence.
  const meds = await Medication.find({
    isActive: true,
    'schedule.time': hhmm,
    startDate: { $lte: new Date() },
    $or: [{ endDate: null }, { endDate: { $gte: startOfToday } }],
  })
    .select('patient name dose schedule daysOfWeek dayInterval asNeeded stat startDate endDate stoppedByDoctor cancelled patientStops')
    .lean();

  for (const med of meds) {
    for (const slot of med.schedule ?? []) {
      if (slot.time !== hhmm) continue;

      // The dose calendar every schedule reads: the weekday and the
      // every-other-day interval (never asked here, so an alternate-day tablet
      // was pushed daily), the start, and the end of the course to the minute
      // (a course ending at ten was still pushed at eight that evening).
      const scheduledFor = clinicDateTime(today, slot.time).toDate();
      if (!doseExpected(med, scheduledFor)) continue;

      const notifId = reminderIdFor(med, slot.time, today);
      if (sentThisMinute.has(notifId)) continue;

      // Already taken or skipped today → don't nag.
      // eslint-disable-next-line no-await-in-loop
      const log = await MedicationLog.findOne({ medication: med._id, scheduledFor }).select('status').lean();
      if (log && (log.status === 'taken' || log.status === 'skipped')) continue;

      sentThisMinute.add(notifId);
      // eslint-disable-next-line no-await-in-loop
      await sendMedicationReminderPush({
        patientId: med.patient,
        med,
        time: slot.time,
        relationToMeal: slot.relationToMeal,
        notifId,
      });
    }
  }
}

let handle = null;

/** Starts the cron. Idempotent; `unref` so it never holds the process open. */
export function startMedicationReminderCron() {
  if (handle) return;
  handle = setInterval(() => {
    tick().catch((err) => logger.error({ err }, 'medication reminder tick failed'));
  }, TICK_MS);
  handle.unref?.();
  logger.info('medication reminder cron started (30s tick)');
}
