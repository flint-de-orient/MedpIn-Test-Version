/**
 * Clinical thresholds, in one place.
 *
 * These are intentionally hard-coded constants rather than model judgement or
 * runtime configuration. They are the values the rest of the system trusts when
 * deciding whether a patient is in danger, and they must be reviewed and signed
 * off by Dr. Dey before any change ships.
 *
 * All glucose values are mg/dL.
 */

export const GLUCOSE = Object.freeze({
  SEVERE_LOW: 54, // < 54 -> level-2 hypoglycaemia, clinically significant
  LOW: 70, // < 70 -> level-1 hypoglycaemia
  FASTING_TARGET_MIN: 80,
  FASTING_TARGET_MAX: 130,
  POST_PRANDIAL_TARGET_MAX: 180,
  HIGH: 250, // sustained hyperglycaemia, ketone check territory
  CRITICAL_HIGH: 400, // brief specifies >400 as an emergency trigger
});

export const BLOOD_PRESSURE = Object.freeze({
  HYPOTENSION_SYSTOLIC: 90,
  HYPOTENSION_DIASTOLIC: 60,
  ELEVATED_SYSTOLIC: 120,
  STAGE1_SYSTOLIC: 130,
  STAGE1_DIASTOLIC: 80,
  STAGE2_SYSTOLIC: 140,
  STAGE2_DIASTOLIC: 90,
  CRISIS_SYSTOLIC: 180,
  CRISIS_DIASTOLIC: 120,
});

export const HBA1C = Object.freeze({
  TARGET_MAX: 7.0,
  POOR_CONTROL: 9.0,
});

export const VITALS = Object.freeze({
  SPO2_CRITICAL: 92,
  FEVER_C: 38.0,
  HIGH_FEVER_C: 39.0,
  PULSE_LOW: 50,
  PULSE_HIGH: 120,
});

/** Urgency ladder. Order matters — `maxUrgency` relies on these indexes. */
export const URGENCY = Object.freeze(['routine', 'advice', 'urgent', 'emergency']);

export function maxUrgency(a = 'routine', b = 'routine') {
  return URGENCY.indexOf(a) >= URGENCY.indexOf(b) ? a : b;
}

