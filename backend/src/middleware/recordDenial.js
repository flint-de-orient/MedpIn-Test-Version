import { AuditLog } from '../models/AuditLog.js';
import { logger } from '../config/logger.js';

/**
 * Write down a refusal.
 *
 * ---- The entry that is always missing ------------------------------------
 *
 * `audit()` is middleware wrapped around a handler, so it records what
 * happened. A guard that refuses throws before the handler ever runs, and the
 * request leaves no trace at all.
 *
 * That is precisely backwards. A clinician reading their own patient is
 * routine; a clinician being refused another practice's patient is the single
 * most interesting line an audit trail can hold — it is either somebody
 * fumbling a link, or somebody trying. Both are worth knowing and neither was
 * recorded.
 *
 * ---- Never blocks, never throws ------------------------------------------
 *
 * Fire-and-forget with the failure logged. A refusal must still be a refusal if
 * the audit write fails: turning a 403 into a 500 because the log was
 * unavailable would convert a working guard into an outage, and the caller was
 * being denied either way.
 */
export function recordDenial(
  req,
  // `detail` is whatever makes the entry readable for this kind of refusal —
  // the capability that was missing, the department that did not match. It goes
  // into meta rather than into the action, so the action stays a short set a
  // query can group by.
  { reason, patientId = null, practiceId = null, ...detail },
) {
  AuditLog.create({
    actor: req.user?._id ?? null,
    actorRole: req.user?.role ?? null,
    // Prefixed so a query can find every refusal without knowing the reasons.
    action: `denied.${reason}`,
    resource: 'Patient',
    resourceId: patientId ?? null,
    subjectPatient: patientId ?? null,
    ip: req.ip,
    userAgent: req.get?.('user-agent') ?? null,
    // The practice the *caller* was in. What they were reaching for is the
    // resource; this is where they were reaching from, and the pair is what
    // makes the entry readable six months later.
    meta: { practice: practiceId ? String(practiceId) : null, ...detail },
  }).catch((err) => {
    logger.warn({ err, reason }, 'could not record a denied access');
  });
}
