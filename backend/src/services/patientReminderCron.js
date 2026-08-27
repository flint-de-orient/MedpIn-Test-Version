import { inClinicTz } from '../utils/clinicTime.js';
import { User, ROLES } from '../models/User.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { LabResult } from '../models/LabResult.js';
import { Prescription } from '../models/Prescription.js';
import { sendGlucoseCheckinPush, sendLabUploadNudgePush } from './notifications.js';
import { logger } from '../config/logger.js';
import { ReminderRun, claimReminderPass } from '../models/ReminderRun.js';
import { outstandingTests } from '../utils/testNames.js';

/**
 * Two gentle, patient-facing nudges the app owes but never sent: "log a blood
 * sugar" and "upload the lab report your doctor advised".
 *
 * Both are deliberately quiet. They fire only in the late morning — 9:00 for the
 * glucose check-in, 11:00 for the lab nudge — so a reminder never lands at night
 * (the fixed daytime hours ARE the quiet-hours guard; nothing here can fire
 * between dusk and morning). Each is capped so it can never become a daily
 * drumbeat: the glucose nudge backs off the longer a patient stays away, and the
 * lab nudge is sent at most three times per advised report.
 *
 * Dedup is a claimed row per pass per clinic day. It used to be a module-level
 * date flag, on the reasoning that the worst a mid-morning restart could cost
 * was one repeated nudge. That held while deploys were rare; it stopped holding
 * when a redeploy inside the reminder hour started re-firing the whole pass,
 * and patients got the same lab nudge twice in half an hour.
 */
const TICK_MS = 5 * 60 * 1000;
const GLUCOSE_HOUR = 9;
const LAB_HOUR = 11;

/** Days after the doctor advised a test that we nudge — then never again. */
const LAB_NUDGE_DAYS = new Set([3, 7, 12]);



/**
 * Whether a patient who last logged `gapDays` ago should be nudged this morning.
 *
 * Daily for the first three lapsed days (a diabetic should log daily, so an
 * early nudge is a service, not a nag), then every other day up to a fortnight,
 * then weekly — so someone who simply will not log settles at one nudge a week
 * instead of an uninstall-inducing daily one. `0` means they already logged
 * today; never nudge then.
 */
export function shouldNudgeGlucose(gapDays) {
  if (gapDays <= 0) return false;
  if (gapDays <= 3) return true;
  if (gapDays <= 14) return gapDays % 2 === 1;
  return gapDays % 7 === 0;
}

async function glucosePass(now) {
  const patients = await User.find({ role: ROLES.PATIENT, isActive: true })
    .select('_id deviceTokens language createdAt')
    .lean();

  let sent = 0;
  for (const patient of patients) {
    if (!patient.deviceTokens?.length) continue;

    // eslint-disable-next-line no-await-in-loop
    const last = await GlucoseReading.findOne({ patient: patient._id })
      .sort({ measuredAt: -1 })
      .select('measuredAt')
      .lean();

    // No reading ever → count from signup, so a patient who has logged nothing
    // since registering is still eventually (and gently) reminded.
    const sinceInstant = last?.measuredAt ?? patient.createdAt;
    if (!sinceInstant) continue;

    const gapDays = now.startOf('day').diff(inClinicTz(sinceInstant).startOf('day'), 'day');
    if (!shouldNudgeGlucose(gapDays)) continue;

    // eslint-disable-next-line no-await-in-loop
    await sendGlucoseCheckinPush({ patient, gapDays });
    sent += 1;
  }
  logger.info({ candidates: patients.length, sent }, 'glucose check-in nudges sent');
  return sent;
}

async function labPass(now) {
  const patients = await User.find({ role: ROLES.PATIENT, isActive: true })
    .select('_id deviceTokens language')
    .lean();

  let sent = 0;
  for (const patient of patients) {
    if (!patient.deviceTokens?.length) continue;

    // The most recent active prescription that actually advised a test.
    // eslint-disable-next-line no-await-in-loop
    const rx = await Prescription.findOne({
      patient: patient._id,
      isActive: true,
      'labTestsAdvised.0': { $exists: true },
    })
      .sort({ createdAt: -1 })
      .select('createdAt labTestsAdvised')
      .lean();
    if (!rx) continue;

    const gapDays = now.startOf('day').diff(inClinicTz(rx.createdAt).startOf('day'), 'day');
    if (!LAB_NUDGE_DAYS.has(gapDays)) continue;

    // Which of the advised tests are actually still missing, by name.
    //
    // This used to ask whether *any* report had been uploaded since the
    // prescription was written. A patient who had already uploaded the report
    // — sent to the clinic before the doctor typed the advice, which is the
    // normal order when a test is discussed in the room — matched nothing, and
    // was told to upload a report that was sitting in their own records. It
    // also nudged with the full advised list when three of four were done.
    // eslint-disable-next-line no-await-in-loop
    const results = await LabResult.find({ patient: patient._id })
      .select('testName')
      .lean();
    const outstanding = outstandingTests(rx.labTestsAdvised, results);
    if (outstanding.length === 0) continue;

    // eslint-disable-next-line no-await-in-loop
    await sendLabUploadNudgePush({ patient, tests: outstanding });
    sent += 1;
  }
  logger.info({ candidates: patients.length, sent }, 'lab-upload nudges sent');
  return sent;
}

/**
 * Run `fn` at most once per clinic day.
 *
 * The claim is taken before the work, not after: two processes reaching this
 * at the same moment must not both send, and a pass that crashes half way
 * through must not re-send to everyone it already reached on the retry.
 */
async function runOnceToday(pass, day, fn) {
  let claimed;
  try {
    claimed = await claimReminderPass(pass, day);
  } catch (err) {
    // The database is unreachable. Skipping is the safe failure: a missed
    // nudge is recoverable tomorrow, an unbounded loop of duplicates is not.
    logger.error({ err: err?.message, pass, day }, 'could not claim reminder pass');
    return;
  }
  if (!claimed) return;

  const sent = await fn();
  await ReminderRun.updateOne({ pass, day }, { $set: { sent } }).catch(() => {});
}

async function tick() {
  const now = inClinicTz(new Date());
  const today = now.format('YYYY-MM-DD');
  const hour = now.hour();

  if (hour === GLUCOSE_HOUR) await runOnceToday('glucose', today, () => glucosePass(now));
  if (hour === LAB_HOUR) await runOnceToday('lab', today, () => labPass(now));
}

let handle = null;

/** Starts the cron. Idempotent; `unref` so it never holds the process open. */
export function startPatientReminderCron() {
  if (handle) return;
  handle = setInterval(() => {
    tick().catch((err) => logger.error({ err }, 'patient reminder tick failed'));
  }, TICK_MS);
  handle.unref?.();
  logger.info({ glucoseHour: GLUCOSE_HOUR, labHour: LAB_HOUR }, 'patient reminder cron started');
}
