import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { assertClinicContactConfigured } from './services/clinicContact.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { readiness } from './config/readiness.js';
import { startMedicationReminderCron } from './services/medicationReminderCron.js';
import { startPatientReminderCron } from './services/patientReminderCron.js';
import { startScheduler } from './services/scheduler.js';

async function main() {
  // Before anything can serve a request. A clinic number that was never set
  // only reveals itself inside an emergency reply — the one place nobody tests
  // and the worst place to be wrong. Refusing to boot moves that discovery from
  // the patient to the deploy.
  assertClinicContactConfigured();

  await connectDb();

  /*
   * What this deployment can actually do, said out loud at boot.
   *
   * Not fatal. A development machine has no SMTP, no Firebase key and no
   * Razorpay account, and refusing to start without them would be a server
   * nobody could run locally — see readiness.js on why the answer is to stop
   * being quiet rather than to fail.
   *
   * `degraded` is warned about individually because it is the state that looks
   * like working: a Razorpay key with no webhook secret accepts every forged
   * callback, and the server that does it boots perfectly.
   */
  const config = readiness();
  for (const check of config.filter((c) => c.state === 'degraded')) {
    logger.warn({ check: check.key, because: check.because }, `misconfigured: ${check.affects}`);
  }
  const off = config.filter((c) => c.state === 'off').map((c) => c.key);
  if (off.length) logger.info({ off }, 'features switched off by configuration');

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`AKD Care API listening on http://localhost:${env.PORT}/api/v1`);
  });

  // The evening digest of tomorrow's list, for the doctor.
  //
  // This was written, exported, and never called. The comment that stood here
  // said it was left off deliberately because "the app no longer exposes an
  // appointment feature" — true when it was written and not since: patients
  // request, the desk gives times, and the doctor's day fills up without him
  // hearing about it until he opens the app.
  //
  // Deliberately the evening before rather than the morning of. The point of
  // knowing the shape of a day is being able to act on it — move a clash,
  // prepare for a complex case, start late if the morning is empty — and by
  // the time the clinic opens none of that is possible.
  //
  // The old comment's other worry was right and is now handled where it
  // belongs: an empty digest is not sent (see notifyClinicOfTomorrowSchedule).
  startScheduler();

  // Server-side medication-reminder backstop: pushes a reminder at each dose
  // time as a safety net for on-device alarms an OEM may have killed. Deduped
  // against the local alarm by a shared deterministic notification id.
  startMedicationReminderCron();

  // Two gentle patient nudges — a morning blood-sugar check-in and a reminder
  // to upload a lab report the doctor advised. Both cap themselves and fire
  // only in daytime hours (see patientReminderCron).
  startPatientReminderCron();

  // Finish in-flight clinical writes before dying.
  const shutdown = async (signal) => {
    logger.info({ signal }, 'shutting down');
    server.close(async () => {
      await disconnectDb();
      process.exit(0);
    });
    setTimeout(() => {
      logger.error('forced shutdown after timeout');
      process.exit(1);
    }, 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'uncaught exception');
    process.exit(1);
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start server');
  process.exit(1);
});
