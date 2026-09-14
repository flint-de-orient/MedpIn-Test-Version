import { readFileSync } from 'node:fs';
// Modular subpath imports, not the default export. firebase-admin v12+ ships
// ESM-aware entry points, and `import admin from 'firebase-admin'` yields an
// interop object whose `.credential` is undefined — so `admin.credential.cert`
// throws a TypeError that reads like a bad key when the key is fine.
import { initializeApp, cert } from 'firebase-admin/app';
import { getMessaging as messagingFor } from 'firebase-admin/messaging';

import { env } from './env.js';
import { logger } from './logger.js';
import { outboundBlocked } from './outbound.js';

/**
 * Firebase Admin, initialised lazily and at most once.
 *
 * Returns null when no credentials are configured rather than throwing, so a
 * development machine — or a deployment where push is not wanted yet — runs
 * every notification caller unchanged and simply logs instead of sending.
 *
 * The service-account key is read from a path, never from the repo. That key
 * can push to every device registered to the project, so it belongs on the
 * server's filesystem with the rest of the secrets.
 */
let messaging;
let attempted = false;

/**
 * A stand-in for FCM, installed by a test.
 *
 * The only way to see who a push was actually addressed to: a test hands in an
 * object with `sendEachForMulticast` and reads what it was given. Under the
 * test runner nothing else is ever returned — see config/outbound.js — so a
 * test that installs nothing pushes to nobody, never to a real project.
 */
let testMessaging = null;

export function useMessagingForTests(fake) {
  testMessaging = fake ?? null;
}

export function getMessaging() {
  if (outboundBlocked()) return testMessaging;
  if (attempted) return messaging;
  attempted = true;

  const path = env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!path) {
    logger.warn('GOOGLE_APPLICATION_CREDENTIALS not set — notifications will be logged, not sent');
    return null;
  }

  try {
    const serviceAccount = JSON.parse(readFileSync(path, 'utf8'));
    const app = initializeApp({ credential: cert(serviceAccount) });
    messaging = messagingFor(app);
    logger.info({ projectId: serviceAccount.project_id }, 'firebase messaging ready');
    return messaging;
  } catch (err) {
    // Deliberately not fatal: a clinic should keep taking appointments and
    // answering patients even if push is misconfigured.
    logger.error({ err, path }, 'could not initialise firebase; notifications will be logged only');
    return null;
  }
}
