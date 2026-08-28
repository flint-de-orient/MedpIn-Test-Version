import { createApp } from './app.js';
import { connectDb, disconnectDb } from './config/db.js';
import { assertClinicContactConfigured } from './services/clinicContact.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { startMedicationReminderCron } from './services/medicationReminderCron.js';
import { startPatientReminderCron } from './services/patientReminderCron.js';

async function main() {
  // Before anything can serve a request. A clinic number that was never set
  // only reveals itself inside an emergency reply — the one place nobody tests
  // and the worst place to be wrong. Refusing to boot moves that discovery from
  // the patient to the deploy.
  assertClinicContactConfigured();

  await connectDb();

  const app = createApp();
  const server = app.listen(env.PORT, () => {
    logger.info(`AKD Care API listening on http://localhost:${env.PORT}/api/v1`);
  });

  // The evening appointment digest is intentionally NOT started: the app no
  // longer exposes an appointment feature, so a nightly "tomorrow's schedule"
  // push — including the empty "no appointments" one — is just noise.

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
