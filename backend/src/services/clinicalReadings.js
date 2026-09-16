import { PatientProfile } from '../models/PatientProfile.js';
import { classifyGlucose, classifyBloodPressure } from './triage/engine.js';

/**
 * The clinical band a reading belongs in, wherever it was taken.
 *
 * ---- Why one place ----------------------------------------------------------
 *
 * A patient logging their own blood pressure had it banded — normal, elevated,
 * stage 1, stage 2, crisis, low — and their sugar banded against their own
 * targets. The same numbers taken by a doctor in a consultation, or by the desk
 * at registration, were written with no band at all. Nothing downstream could
 * tell that 190/120 measured in the consulting room was a crisis, and the risk
 * score that orders the waiting list ignored every reading the clinic took.
 *
 * The thresholds already live in the triage engine. This is the one way a
 * writer asks for them, so a new place that records a reading cannot band it
 * differently — or forget to band it.
 */

/** A patient's own glucose targets, or the defaults when a doctor set none. */
export async function glucoseTargetsFor(patientId) {
  const profile = await PatientProfile.findOne({ user: patientId }).select('targets').lean();
  return profile?.targets ?? {};
}

/** The band for a blood pressure, or undefined when it is not a whole reading. */
export function bloodPressureBand(systolic, diastolic) {
  return classifyBloodPressure(systolic, diastolic)?.flag;
}

/** The band for a sugar, against this patient's own targets. */
export async function glucoseBand(patientId, valueMgDl, context = 'random') {
  if (valueMgDl == null) return undefined;
  return classifyGlucose(valueMgDl, context, await glucoseTargetsFor(patientId))?.flag;
}
