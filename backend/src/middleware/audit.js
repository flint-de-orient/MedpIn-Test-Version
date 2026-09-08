import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

/**
 * Records access to patient data. Fire-and-forget: an audit write must never
 * fail a clinical request, but a failure to write must be loud in the logs.
 */
export function audit(action, resource, { when } = {}) {
  return (req, res, next) => {
    res.on('finish', () => {
      if (res.statusCode >= 400) return;

      /*
       * Some 2xx responses did nothing.
       *
       * A webhook endpoint answers 200 to events it ignores, because a non-2xx
       * tells the sender to retry and "we do not handle this" is permanent. So
       * a provider configured to send everything — which is the default a
       * person ticks when a dashboard offers ninety checkboxes — would write an
       * audit row per refund and per settlement, for events that were read and
       * discarded.
       *
       * `when` lets a route say which of its successes were real. Absent, every
       * 2xx counts, which is right for a route that only answers 2xx when it
       * has done something.
       */
      if (typeof when === 'function' && !when(req)) return;
      AuditLog.create({
        actor: req.user?._id,
        actorRole: req.user?.role,
        action,
        resource,
        resourceId: req.auditResourceId,
        subjectPatient: req.patientId ?? req.user?._id,
        ip: req.ip,
        userAgent: req.get('user-agent')?.slice(0, 300),
        meta: { method: req.method, path: req.route?.path ?? req.originalUrl, status: res.statusCode },
      }).catch((err) => logger.error({ err }, 'audit write failed'));
    });
    next();
  };
}
