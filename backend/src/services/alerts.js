import { ClinicalAlert } from '../models/ClinicalAlert.js';
import { logger } from '../config/logger.js';
import { notifyClinicStaff, notifyPatient } from './notifications.js';

/**
 * Creates an escalation record and pushes it to whoever needs to see it.
 *
 * De-duplicates: an identical open alert for the same patient within the
 * dedupe window is reused rather than creating a second one, so a patient
 * sending three panicked messages does not produce three identical pages.
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
  const since = new Date(Date.now() - dedupeWindowMinutes * 60 * 1000);

  const existing = await ClinicalAlert.findOne({
    patient: patientId,
    type,
    status: 'open',
    createdAt: { $gte: since },
  });

  if (existing) {
    logger.debug({ alertId: existing._id, type }, 'reusing recent open alert');
    return existing;
  }

  const alert = await ClinicalAlert.create({
    patient: patientId,
    severity,
    type,
    title,
    detail,
    source,
    matchedRules,
  });

  logger.warn({ alertId: alert._id.toString(), patientId: String(patientId), type, severity }, 'clinical alert raised');

  // Notification failures must not roll back the alert — the record in the
  // doctor dashboard is the durable part; push is best-effort.
  if (severity === 'emergency' || severity === 'urgent') {
    notifyClinicStaff(alert).catch((err) => logger.error({ err }, 'staff notification failed'));
  }
  if (severity === 'emergency') {
    notifyPatient(patientId, alert).catch((err) => logger.error({ err }, 'patient notification failed'));
  }

  return alert;
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
