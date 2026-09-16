import { ClinicalAlert } from '../models/ClinicalAlert.js';
import { logger } from '../config/logger.js';
import { notifyClinicStaff, notifyPatient } from './notifications.js';

/** Higher is worse. */
export const SEVERITY_RANK = Object.freeze({ info: 0, warning: 1, urgent: 2, emergency: 3 });
const rank = (severity) => SEVERITY_RANK[severity] ?? 0;

/**
 * Creates an escalation record and pushes it to whoever needs to see it.
 *
 * ---- Repeats are reused; escalations are not ---------------------------------
 *
 * An open alert of the same kind for the same patient inside the window is
 * reused when the new event is no worse, so three panicked messages do not page
 * three times.
 *
 * Severity used to be left out of that question. A warning at 10:00 meant an
 * emergency of the same type at 10:20 created nothing, sent nothing and never
 * escalated — the de-duplication swallowed the one event it existed to let
 * through. Now a worse event raises the open alert to its severity in place,
 * records the escalation, and notifies exactly as a new alert of that severity
 * would.
 *
 * ---- One page for one event, even at the same instant ---------------------------
 *
 * The look-up cannot see an alert another request is creating at the same
 * moment. A unique key on patient, type, severity and the window refuses the
 * second copy, which then answers with the first.
 */
export async function raiseAlert({
  patientId,
  severity,
  type,
  title,
  detail,
  source,
  matchedRules = [],
  dedupeWindowMinutes = 30,
}) {
  const now = Date.now();
  const since = new Date(now - dedupeWindowMinutes * 60 * 1000);

  const existing = dedupeWindowMinutes > 0
    ? await ClinicalAlert.findOne({
        patient: patientId,
        type,
        status: 'open',
        createdAt: { $gte: since },
      }).sort({ createdAt: -1 })
    : null;

  if (existing && rank(severity) <= rank(existing.severity)) {
    logger.debug({ alertId: existing._id, type }, 'reusing recent open alert');
    return existing;
  }

  if (existing) {
    // Worse than what is open: raised in place, only from the severity we read,
    // so two escalations at once raise it once.
    const escalated = await ClinicalAlert.findOneAndUpdate(
      { _id: existing._id, severity: existing.severity, status: 'open' },
      {
        $set: { severity, title, detail, source },
        $push: {
          escalations: { from: existing.severity, to: severity, at: new Date(now), previousTitle: existing.title },
        },
        $addToSet: { matchedRules: { $each: matchedRules } },
      },
      { new: true },
    );
    if (!escalated) return ClinicalAlert.findById(existing._id);

    logger.warn(
      { alertId: escalated._id.toString(), patientId: String(patientId), type, from: existing.severity, to: severity },
      'clinical alert escalated',
    );
    notifyFor(escalated, patientId, severity);
    return escalated;
  }

  const dedupeKey =
    dedupeWindowMinutes > 0
      ? [String(patientId), type, severity, Math.floor(now / (dedupeWindowMinutes * 60 * 1000))].join('|')
      : null;

  let alert;
  try {
    alert = await ClinicalAlert.create({
      patient: patientId,
      severity,
      type,
      title,
      detail,
      source,
      matchedRules,
      dedupeKey,
    });
  } catch (err) {
    // The same alert, raised by another request in the same instant.
    if (err?.code !== 11000 || !dedupeKey) throw err;
    const first = await ClinicalAlert.findOne({ dedupeKey });
    if (first) return first;
    throw err;
  }

  logger.warn({ alertId: alert._id.toString(), patientId: String(patientId), type, severity }, 'clinical alert raised');
  notifyFor(alert, patientId, severity);
  return alert;
}

/**
 * Pages for an alert of this severity. Notification failures must not roll
 * back the alert — the record on the doctor's dashboard is the durable part;
 * push is best-effort, and what came of it is recorded on the alert.
 */
function notifyFor(alert, patientId, severity) {
  if (severity === 'emergency' || severity === 'urgent') {
    notifyClinicStaff(alert).catch((err) => logger.error({ err }, 'staff notification failed'));
  }
  if (severity === 'emergency') {
    notifyPatient(patientId, alert).catch((err) => logger.error({ err }, 'patient notification failed'));
  }
}

/**
 * The filter for changing one alert, inside a practice.
 *
 * ---- Why the scope is required -------------------------------------------
 *
 * These took an id and nothing else, and `requireDoctor` in front of them was
 * the whole guard — so any doctor on the platform could mark another
 * practice's urgent alert as seen, or resolve it. A resolved alert leaves that
 * practice's triage queue, which is how a patient who needed a doctor stops
 * being shown to one.
 *
 * An optional scope is how that comes back: the next caller leaves it off and
 * nothing complains. So a missing one throws. `{}` is still a real answer —
 * `practicePatients` gives it where the enrolment backfill has not run — and
 * has to be passed on purpose.
 */
function inScope(alertId, scope) {
  if (!scope || typeof scope !== 'object') {
    throw new Error('Changing an alert needs a practice scope: pass practicePatients(req, "patient").');
  }
  // `$and`, so a scope can never stand in for the id that was asked for.
  return { $and: [{ _id: alertId }, scope] };
}

export async function acknowledgeAlert(alertId, userId, scope) {
  return ClinicalAlert.findOneAndUpdate(
    inScope(alertId, scope),
    { status: 'acknowledged', acknowledgedBy: userId, acknowledgedAt: new Date() },
    { new: true },
  );
}

export async function resolveAlert(alertId, userId, notes, scope) {
  return ClinicalAlert.findOneAndUpdate(
    inScope(alertId, scope),
    { status: 'resolved', resolvedBy: userId, resolvedAt: new Date(), resolutionNotes: notes },
    { new: true },
  );
}
