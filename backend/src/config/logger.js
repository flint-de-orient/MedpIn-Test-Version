import pino from 'pino';
import { env, isProd, visibleChars } from './env.js';

/**
 * Patient data must never land in logs. `redact` covers the fields most likely
 * to carry PHI if an object is logged wholesale by mistake.
 */
/**
 * How much to say.
 *
 * `LOG_LEVEL` wins, so a noisy box can be turned down without a deploy.
 *
 * Silent under the test runner, which sets `NODE_TEST_CONTEXT` in every worker
 * it spawns. Booting the real app in a test otherwise writes pino-pretty debug
 * lines and a morgan line per request straight into the TAP stream that node is
 * parsing on stdout — unreadable at best, and at worst a `not ok` in a log
 * message that the summary counts as a failing test.
 */
const level =
  process.env.LOG_LEVEL || (process.env.NODE_TEST_CONTEXT ? 'silent' : isProd ? 'info' : 'debug');

export const logger = pino({
  level,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.body.password',
      'req.body.currentPassword',
      'req.body.newPassword',
      'req.body.message',
      'password',
      'passwordHash',
      'refreshTokenHash',
      '*.password',
      '*.passwordHash',
    ],
    censor: '[redacted]',
  },
  transport:
    isProd || level === 'silent'
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' },
        },
});

logger.info(
  { env: env.NODE_ENV, chatModel: env.GEMINI_CHAT_MODEL },
  'logger initialised',
);

// A model name env.js had to clean (see cleanModelName). The server works, but
// the file still holds the bad value, so it is shown with the hidden
// characters written out.
for (const key of ['GEMINI_CHAT_MODEL', 'GEMINI_VISION_MODEL', 'GEMINI_EMBED_MODEL']) {
  const raw = process.env[key];
  if (raw !== undefined && raw !== env[key]) {
    logger.warn({ key, found: visibleChars(raw), using: env[key] }, 'Gemini model name cleaned; correct it in .env');
  }
}
