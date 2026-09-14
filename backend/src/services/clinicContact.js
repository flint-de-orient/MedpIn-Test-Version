import { env } from '../config/env.js';

/**
 * The number a patient is told to ring, or null when there isn't a real one.
 *
 * This exists because of what the assistant does with it. In an emergency or
 * urgent verdict the reply tells the patient, in their own language, to call the
 * clinic on this number. `CLINIC_EMERGENCY_PHONE` used to default to
 * '+91-0000000000', so a deployment that had not set it was handing somebody
 * with chest pain a number that rings nowhere — and doing it in the one reply
 * where being wrong matters most.
 *
 * The prescription PDF already knew not to print a placeholder. The prompts
 * never learned, because each of the six places that mention the number
 * interpolated the env var directly. There is one place now, and it can say
 * "no".
 */

/** Digits that mean "nobody filled this in". */
const PLACEHOLDER = /^\+?[\s-]*0+[\s-]*$|0{6,}/;

/**
 * A callable clinic number, or null.
 *
 * Null is a useful answer: the caller drops the "or call ..." clause entirely
 * rather than completing the sentence with something untrue. "Go to the nearest
 * hospital" on its own is correct advice; "go to the nearest hospital or call
 * +91-0000000000" is worse than saying nothing, because a patient will try it.
 */
export function clinicEmergencyPhone() {
  return callablePhone(env.CLINIC_EMERGENCY_PHONE);
}

/**
 * A number somebody could actually ring, or null — whichever source it came
 * from. A location saved with the old placeholder is no more callable than the
 * environment was.
 */
export function callablePhone(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (PLACEHOLDER.test(raw.replace(/[^\d+]/g, ''))) return null;
  // Fewer than eight digits cannot be a phone number anyone can ring.
  if (raw.replace(/\D/g, '').length < 8) return null;
  return raw;
}

/**
 * The "or call ..." clause, ready to drop into a sentence, or ''.
 *
 * `phone` is the number for this patient's practice — `emergencyPhone` on the
 * clinic identity. Left out, it is the configured number, which is what every
 * caller meant before practices had numbers of their own. `null` is an answer
 * rather than an omission: that practice has no number, and gets no clause.
 *
 * @param {string} lang - 'en' | 'bn' | 'hi'
 * @param {string|null} [phone]
 */
export function orCallClinic(lang = 'en', phone = clinicEmergencyPhone()) {
  if (!phone) return '';
  return {
    en: ` or call the clinic on ${phone}`,
    bn: ` অথবা ক্লিনিকে ${phone} নম্বরে ফোন করুন`,
    hi: ` या क्लिनिक को ${phone} पर कॉल करें`,
  }[lang] ?? ` or call the clinic on ${phone}`;
}

/**
 * Refuse to start a production server that would speak a placeholder.
 *
 * Called at boot. A misconfiguration that only shows itself inside an emergency
 * reply is one nobody finds in testing — it is found by the patient it fails.
 */
export function assertClinicContactConfigured() {
  if (env.NODE_ENV !== 'production') return;
  if (clinicEmergencyPhone()) return;
  throw new Error(
    'CLINIC_EMERGENCY_PHONE is not set to a real number. The assistant tells patients to ring it ' +
      'during an emergency, so the server will not start without one.',
  );
}
