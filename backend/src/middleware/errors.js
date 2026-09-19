import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expected = true;
  }
}

export const badRequest = (msg, details) => new AppError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'You do not have access to this resource') => new AppError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Resource not found') => new AppError(404, 'NOT_FOUND', msg);
export const conflict = (msg, details) => new AppError(409, 'CONFLICT', msg, details);
export const tooMany = (msg = 'Too many requests') => new AppError(429, 'RATE_LIMITED', msg);

/** Wraps async route handlers so rejected promises reach the error middleware. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export function notFoundHandler(req, res, next) {
  next(new AppError(404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, next) {
  let status = err.status ?? 500;
  let code = err.code ?? 'INTERNAL_ERROR';
  let message = err.message ?? 'Something went wrong';
  /*
   * What an AppError carried besides its sentence.
   *
   * This started undefined and only the validation branches below set it, so
   * every `badRequest(msg, details)` and `conflict(msg, details)` built an
   * object that never left the server. The practice application's "already
   * with us — use the reference you were given" went out for months without
   * the reference, which was sitting in `details` the whole time.
   *
   * An AppError's only. Anything else that happens to have a `details`
   * property is an internal, and nobody promised it to a client.
   */
  let details = err instanceof AppError ? err.details : undefined;

  if (err instanceof ZodError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = 'Request validation failed';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (err instanceof mongoose.Error.CastError) {
    status = 400;
    code = 'INVALID_ID';
    message = `Invalid value for ${err.path}`;
  } else if (err.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    const field = Object.keys(err.keyPattern ?? {})[0] ?? 'field';
    // Only a phone or email is an account. Any other duplicate is two writes
    // that collided: a chat message numbered twice came back as "An account
    // with that session already exists", which pointed nobody at the cause.
    message = ['phone', 'email'].includes(field)
      ? `An account with that ${field} already exists`
      : 'That was changed by someone else at the same moment. Please try again.';
    // Logged, unlike other 4xx errors. At debug level a duplicate never
    // reached a production log, so conversations refusing every patient
    // message left no trace on the server.
    logger.warn({ path: req.originalUrl, method: req.method, index: err.keyPattern }, 'duplicate key');
  }

  // Driver errors carry their own numeric `code` — MongoServerError 13 is
  // Unauthorized, 18 is AuthenticationFailed — and `err.code ?? ...` above
  // passes it straight through. That breaks the contract in API_CONTRACT.md,
  // where every code is a name, and the app (which matches on names like
  // UNAUTHORIZED) falls through to a bare "unexpected error occurred" that
  // says nothing about what broke. The number is still logged below; only the
  // patient-facing payload is normalised.
  if (typeof code !== 'string') code = 'INTERNAL_ERROR';

  if (status >= 500) {
    logger.error({ err, path: req.originalUrl, method: req.method }, 'unhandled error');
    /*
     * Never leak internal details to a patient's device in production.
     *
     * Read from `env` at call time rather than from the `isProd` const, which
     * is computed once at import and therefore cannot be exercised by a test
     * running as NODE_ENV=test. A mutation run deleted this line and every
     * test stayed green — the sanitisation that keeps a connection string off
     * a patient's screen was unguarded.
     */
    if (env.NODE_ENV === 'production') message = 'Something went wrong. Please try again.';
  } else {
    logger.debug({ code, path: req.originalUrl }, message);
  }

  res.status(status).json({
    error: { code, message, ...(details ? { details } : {}) },
  });
}
