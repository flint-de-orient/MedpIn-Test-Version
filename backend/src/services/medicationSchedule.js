/**
 * Turns a prescription "frequency" into concrete daily reminder times, anchored
 * to the patient's OWN meal times when known — so "before breakfast" fires
 * relative to when they actually eat, not a fixed clock — and shifted by the
 * relation to the meal. Falls back to clinic-standard times when a patient has
 * not set their meal times.
 *
 * Handles the Indian "1-0-1" notation (morning-noon-night) and the common
 * shorthands (OD/BD/TDS/QID and their word forms). Times are local clock
 * "HH:mm"; the device schedules the actual alarms.
 */
import { env } from '../config/env.js';

export const DEFAULT_MEAL_TIMES = Object.freeze({ breakfast: '08:00', lunch: '13:30', dinner: '20:30' });

// Minutes to shift a dose relative to its meal. "before"/"after" are a clinic-
// wide convention set in config (default ∓30); with-meal and any never shift.
const MEAL_OFFSET_MIN = {
  before_meal: -env.MEAL_OFFSET_BEFORE_MIN,
  after_meal: env.MEAL_OFFSET_AFTER_MIN,
  with_meal: 0,
  any: 0,
};

function addMinutes(hhmm, delta) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const total = (((h * 60 + m + delta) % 1440) + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Which meal each dose slot hangs off. */
function slotBase(slot, meals) {
  // An hour the prescription named outright, carried as `at:HH:mm`.
  //
  // These do not hang off a meal at all: "1 tab each 10 AM" means ten o'clock
  // whatever time the patient eats, so it must not drift when they set their
  // meal times, and must not take the ±30 minute before/after shift either.
  if (typeof slot === 'string' && slot.startsWith('at:')) return slot.slice(3);

  switch (slot) {
    case 'morning':
      return meals.breakfast;
    case 'noon':
      return meals.lunch;
    case 'afternoon':
      return addMinutes(meals.lunch, 180);
    case 'night':
      return meals.dinner;
    case 'bedtime':
      // ~90 min after dinner — HS ("hora somni", at bedtime).
      return addMinutes(meals.dinner, 90);
    default:
      return meals.breakfast;
  }
}

/** The clock time for a dose slot, given the patient's meals and meal relation. */
export function slotToTime(slot, mealTimes, relationToMeal = 'any') {
  const meals = { ...DEFAULT_MEAL_TIMES, ...(mealTimes ?? {}) };
  const base = slotBase(slot, meals);
  // A named hour is already the answer. Shifting "10 AM" by the after-meal
  // offset would turn a time the doctor wrote down into 10:30.
  const explicit = typeof slot === 'string' && slot.startsWith('at:');
  return explicit ? base : addMinutes(base, MEAL_OFFSET_MIN[relationToMeal] ?? 0);
}

/**
 * Everything a prescription line says about *when*, as one string.
 *
 * The timing is not reliably in `frequency`. A doctor writes "1 tab each AF
 * Lunch" as a single phrase, and a model asked to split that into fields will
 * put "OD" in frequency and "after lunch" in instructions as readily as the
 * other way round — so reading only `frequency` throws away the meal on roughly
 * half the prescriptions, and a thrown-away meal becomes eight in the morning.
 *
 * Order matters: frequency first, so an explicit count ("BD") is seen before a
 * meal named in the instructions and still wins.
 */
export function scheduleText(item) {
  // whenText first among the descriptive fields, because it is the one asked
  // for verbatim: "1 tab each AF Lunch" rather than the model's reading of it.
  //
  // frequency stays ahead of it so an explicit count still wins — "1 tab BD
  // after dinner" is twice a day, and only when nothing has said how often does
  // the named meal get to choose the single slot.
  return [item?.frequency, item?.whenText, item?.instructions, item?.dose]
    .filter((s) => typeof s === 'string' && s.trim())
    .join(' ');
}

/**
 * Before or after food, read from the same words the timing came from.
 *
 * The model is asked for `relationToMeal` and often does not return it — the
 * prescription says "1 tab each AF Lunch" and it answers with a frequency and
 * nothing else. Every dose then carried "any", and the patient's list read
 * "Anytime" against a line that plainly says after food. That is not a missing
 * label; it is the app contradicting the prescription in front of them.
 *
 * Returns null when nothing was said, which stays "any" — a medicine with no
 * meal instruction genuinely has none, and inventing one would be the same
 * fault in the other direction.
 */
export function relationFromText(text) {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  // Checked before "after", because "before food" contains neither word twice
  // but a careless order would let a stray "af" inside another word win.
  if (/\b(bf|before\s+(food|meal|meals|breakfast|lunch|dinner)|empty\s+stomach|khali\s*pet)\b/.test(s)) {
    return 'before_meal';
  }
  if (/\b(af|pc|after\s+(food|meal|meals|breakfast|lunch|dinner))\b/.test(s)) {
    return 'after_meal';
  }
  if (/\b(with\s+(food|meal|meals))\b/.test(s)) return 'with_meal';
  return null;
}

/** Frequency notation → the ordered dose slots it means. */
export function frequencyToSlots(frequency) {
  if (!frequency) return ['morning'];

  const pattern = String(frequency).replace(/\s/g, '');

  const tds = /^(\d)-(\d)-(\d)$/.exec(pattern);
  if (tds) {
    const slots = [];
    if (Number(tds[1]) > 0) slots.push('morning');
    if (Number(tds[2]) > 0) slots.push('noon');
    if (Number(tds[3]) > 0) slots.push('night');
    return slots.length ? slots : ['morning'];
  }

  const qds = /^(\d)-(\d)-(\d)-(\d)$/.exec(pattern);
  if (qds) {
    const map = ['morning', 'noon', 'afternoon', 'night'];
    const slots = qds.slice(1).map(Number).map((n, i) => (n > 0 ? map[i] : null)).filter(Boolean);
    return slots.length ? slots : ['morning'];
  }

  const lower = String(frequency).toLowerCase();
  // As-needed / immediate one-off carry no recurring schedule at all.
  if (/\b(prn|sos|stat)\b/.test(lower)) return [];

  // An hour written out: "10 AM", "10:30 pm", "22:00".
  //
  // Checked before the shorthand codes because it is the most specific thing a
  // prescription can say about when to take something, and after the numeric
  // patterns above, which contain digits but never a colon or am/pm.
  const named = /\b(\d{1,2})(?::([0-5]\d))?\s*(a\.?m|p\.?m)\b/.exec(lower)
    ?? /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(lower);
  if (named) {
    let hour = Number(named[1]);
    const minute = named[2] ? Number(named[2]) : 0;
    const meridiem = named[3];
    if (meridiem?.startsWith('p') && hour < 12) hour += 12;
    if (meridiem?.startsWith('a') && hour === 12) hour = 0;
    if (hour <= 23) {
      return [`at:${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`];
    }
  }

  if (/\b(hs|bedtime|nocte|on)\b/.test(lower)) return ['bedtime'];
  if (/\b(bd|bid|twice)\b/.test(lower)) return ['morning', 'night'];
  if (/\b(tds|tid|thrice|three times)\b/.test(lower)) return ['morning', 'noon', 'night'];
  if (/\b(qid|qds|four times)\b/.test(lower)) return ['morning', 'noon', 'afternoon', 'night'];

  // The meal the prescription actually named.
  //
  // This is the case that sent a patient's dinner tablet to breakfast. Written
  // Indian prescriptions say "1 tab AF Lunch" or "1 tab A Dinner" far more often
  // than they say OD or 1-0-1, and none of those words matched anything here —
  // so every one of them fell through to the ['morning'] default below and was
  // scheduled for eight in the morning.
  //
  // Checked after the count-based codes on purpose: "1 tab BD after dinner"
  // means twice a day, and the count is the stronger statement. Only when
  // nothing has said how *often* does the named meal decide the single slot.
  const meals = [];
  if (/\b(breakfast|morning|subah|সকাল)\b/.test(lower)) meals.push('morning');
  if (/\b(lunch|noon|midday|mid-day|dupur|দুপুর)\b/.test(lower)) meals.push('noon');
  if (/\b(dinner|night|evening|supper|rat|রাত)\b/.test(lower)) meals.push('night');
  if (meals.length) return meals;

  if (/\b(od|qd|once|om)\b/.test(lower)) return ['morning'];

  return ['morning'];
}

/**
 * Full schedule entries for a prescription item — keeps the `slot` so the times
 * can be re-derived later if the patient changes their meal times.
 */
export function buildSchedule(frequency, mealTimes, relationToMeal = 'any') {
  return frequencyToSlots(frequency).map((slot) => ({
    slot,
    time: slotToTime(slot, mealTimes, relationToMeal),
    relationToMeal,
  }));
}

/** Re-derive times for existing schedule entries against new meal times. */
export function recomputeSchedule(schedule, mealTimes) {
  return (schedule ?? []).map((s) => ({
    slot: s.slot ?? null,
    relationToMeal: s.relationToMeal ?? 'any',
    // Only slot-anchored entries can move; a manually-set time with no slot stays.
    time: s.slot ? slotToTime(s.slot, mealTimes, s.relationToMeal ?? 'any') : s.time,
  }));
}
