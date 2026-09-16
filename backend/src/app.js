import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';

import routes from './routes/index.js';
import { errorHandler, notFoundHandler } from './middleware/errors.js';
import { logger } from './config/logger.js';
import { allowedOrigins, isProd } from './config/env.js';

export function createApp() {
  const app = express();

  // Behind a reverse proxy in production; needed for correct req.ip in
  // rate limiting and audit logs.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The prescription print view is served as inline-styled HTML.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  /*
   * Who may call this from a browser.
   *
   * `false` — refuse every cross-origin browser call — is the right answer for
   * a deployment that serves only the phone app, which sends no Origin and is
   * unaffected either way. It is the wrong answer for one running the operator
   * console, and the two are indistinguishable from here. So the list decides,
   * `readiness()` reports the console-without-origins combination, and nothing
   * about it is silent any more.
   */
  const browserOrigins = allowedOrigins();

  app.use(
    cors({
      origin: isProd ? (browserOrigins.length ? browserOrigins : false) : true,
      credentials: true,
    }),
  );

  app.use(compression());
  /**
   * The raw body, kept only where a signature is checked against it.
   *
   * A webhook signature is an HMAC over the exact bytes the sender hashed.
   * `express.json` parses those bytes and throws them away, and re-serialising
   * the parsed object does not reproduce them — key order, whitespace and
   * number formatting all differ. Verifying against `JSON.stringify(req.body)`
   * therefore fails for every genuine callback and, once somebody "fixes" it by
   * loosening the check, succeeds for forged ones.
   *
   * Captured for the billing webhook alone rather than globally: this is a chat
   * app that polls, and holding a second copy of every request body to serve
   * one endpoint is a cost paid on the wrong requests.
   */
  app.use(
    express.json({
      limit: '1mb',
      verify: (req, _res, buf) => {
        if (req.originalUrl?.startsWith('/api/v1/billing/webhook')) req.rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  app.use(
    morgan(isProd ? 'combined' : 'dev', {
      stream: { write: (msg) => logger.info(msg.trim()) },
      // Health checks would otherwise dominate the logs.
      skip: (req) => req.path === '/api/v1/health',
    }),
  );

  // Broad backstop; per-route limiters handle the sensitive paths.
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      skip: (req) => req.path === '/api/v1/health',
    }),
  );

  app.use('/api/v1', routes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
