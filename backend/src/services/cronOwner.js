import { logger } from '../config/logger.js';

/**
 * Whether this process runs the background jobs: the scheduler (tomorrow's
 * list, visit reminders, the conversation digest), the medicine-reminder pushes
 * and the morning nudges.
 *
 * ---- The failure this prevents -------------------------------------------
 *
 * The jobs live inside the API process. Run the API under `pm2 -i max` and
 * every worker starts its own copy, so a patient with a 9pm insulin reminder
 * gets it once per CPU core — four prompts to take a dose they should take
 * once. Nothing errors. Nothing is logged. The only symptom is a patient being
 * told four times, and the plausible response to that is to take it again.
 *
 * So the guard is here rather than in a deployment note. A note is followed
 * until the evening somebody scales the API to fix a slow endpoint and does not
 * think about reminders.
 *
 * It used to live in the scheduler, and only the scheduler asked it. The
 * medicine-reminder job — the very job that example is about — and the morning
 * nudges started in every worker regardless.
 *
 * pm2 numbers its workers in `NODE_APP_INSTANCE`; worker 0 runs the jobs and
 * the rest do not. Unset — a plain `node src/server.js` — means there is one
 * process and it is this one.
 *
 * `RUN_SCHEDULER` overrides both ways, for the step after this: the jobs
 * extracted into a process of their own, where the API sets it false and the
 * worker sets it true.
 *
 * ---- What this does not solve -------------------------------------------
 *
 * Two *machines*. Each has its own worker 0, so both would run the jobs, and
 * that needs a lock in the database rather than a look at an environment
 * variable. So no job relies on this guard alone: every send is claimed in the
 * database before it is made — each dose push (MedicationReminderPush), each
 * nudge pass and each evening digest (ReminderRun), each visit reminder (on the
 * appointment) — and a second process running a job anyway finds the work
 * already claimed. The guard saves the queries; the claims keep a patient told
 * once.
 */
export function ownsTheCrons() {
  const override = process.env.RUN_SCHEDULER;
  if (override === 'true') return true;
  if (override === 'false') return false;
  return (process.env.NODE_APP_INSTANCE ?? '0') === '0';
}

/**
 * Logged rather than silent: a worker that is deliberately not running a job
 * should say so, or the first question during an incident is whether the jobs
 * are running at all, and silence answers it wrongly.
 */
export function notStartedHere(job) {
  logger.info(
    { job, instance: process.env.NODE_APP_INSTANCE ?? null },
    `${job} not started in this worker — another process owns the crons`,
  );
}
