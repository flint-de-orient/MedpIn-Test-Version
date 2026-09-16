/**
 * Deterministic notification id for one dose SLOT — identical to the Dart
 * `medDailyReminderId` on the client, so a server push and the on-device
 * daily-repeating alarm for the same dose collapse into a single notification
 * instead of reminding twice.
 *
 * FNV-1a (32-bit) over `medId|HH:mm` (no date — the local alarm now repeats
 * daily under one stable id), folded into the medication reserved id range
 * [700000, 790000). `Math.imul` keeps the multiply in true 32-bit space so it
 * matches Dart's `(hash * prime) & 0xFFFFFFFF`.
 */
export function medReminderNotificationId(medId, hhmm) {
  return 700000 + (fnv1a(`${medId}|${hhmm}`) % 90000);
}

function fnv1a(key) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

/**
 * The id for ONE dose on ONE date — for a reminder the device arms as a single
 * alarm rather than a daily repeat. Identical to the Dart
 * `medOccurrenceReminderId`.
 *
 * Its own range, and a wide one. A fortnight of single alarms is a few hundred
 * ids, and folded into the daily range's 90 000 the chance that two of them
 * collide — and one silently replaces the other, a dose with no alarm — was
 * roughly one in three. Across a billion it is negligible.
 */
export const MED_OCCURRENCE_ID_BASE = 10000000;
export const MED_OCCURRENCE_ID_SPAN = 1000000000;

export function medOccurrenceNotificationId(medId, hhmm, dateStr) {
  return MED_OCCURRENCE_ID_BASE + (fnv1a(`${medId}|${hhmm}|${dateStr}`) % MED_OCCURRENCE_ID_SPAN);
}

/**
 * Whether the device reminds about this medicine with one alarm repeating every
 * day, or with a single alarm per dose. The same rule the Dart
 * `remindsDaily` applies — the two ends must choose alike, or a push and an
 * alarm for one dose carry different ids and the patient is reminded twice.
 *
 * A daily repeat cannot skip a day or stop on a date. So it is only for a
 * medicine taken every day with no end: anything with days of the week, an
 * interval, or a course end is armed dose by dose. A weekly methotrexate on a
 * daily repeat was a daily reminder to take methotrexate.
 */
export function remindsDaily(med) {
  return !(med.daysOfWeek?.length) && (med.dayInterval ?? 1) === 1 && !med.endDate;
}

/** The notification id for this medicine's dose at `hhmm` on clinic date `dateStr`. */
export function reminderIdFor(med, hhmm, dateStr) {
  return remindsDaily(med)
    ? medReminderNotificationId(String(med._id), hhmm)
    : medOccurrenceNotificationId(String(med._id), hhmm, dateStr);
}
