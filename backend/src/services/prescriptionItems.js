/**
 * Tidying what comes back from a photographed prescription, before any of it
 * becomes a reminder.
 *
 * Three faults this exists to correct, all found on one real slip from a Kolkata
 * municipal clinic:
 *
 *   - a line naming two drugs became one medicine. "Teneligliptin (20) +
 *     MF500(SR) — 1 tab each" is two tablets, and only the first was created,
 *     so the patient's metformin — the backbone drug of the prescription — had
 *     no entry and no reminder at all.
 *   - the strength field held the whole line: "40T (TD 12.5) + ADB 1 tab each
 *     10 AM" was stored where "40mg" belongs, which is why the medicines list
 *     printed a giant 40 with a sentence spilling out of it.
 *   - the same drug on two lines collided, because medicines are keyed by name
 *     and the second write overwrote the first. Metformin appears twice on that
 *     slip, at lunch and at dinner. Whichever was written second would have
 *     been the only one to survive.
 *
 * The model is asked to get all three right; this is the net underneath, because
 * a prompt is a request and a patient's metformin reminder should not depend on
 * one being honoured.
 */

/** Words that mean a time or a quantity, never a strength. */
const NOT_A_STRENGTH =
  /\b(tab|tabs|tablet|cap|caps|capsule|od|bd|tds|qid|hs|sos|prn|stat|morning|noon|lunch|dinner|night|evening|breakfast|before|after|daily|each|am|pm)\b/i;

/**
 * A strength, and whatever else was crammed in beside it.
 *
 * Returns `{ strength, leftover }`. `strength` keeps only a leading amount and
 * unit — "20", "20mg", "500mg SR" — and everything after it is handed back so
 * the caller can put it where it belongs rather than silently dropping a note
 * the doctor wrote.
 */
export function tidyStrength(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { strength: undefined, leftover: undefined };

  // A number, an optional unit, and an optional modifier that is part of the
  // strength rather than an instruction — SR, XR, CR, ER for slow release.
  // No trailing \b. There is no word boundary between "40" and the "T" of
  // "40T", so requiring one made the whole pattern fail on exactly the strings
  // this function exists to salvage — and "40T (TD 12.5) + ADB 1 tab each 10
  // AM" came back with no strength at all.
  const m = /^(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|iu|units?|%)?\s*(sr|xr|cr|er|xl)?/i.exec(s);
  if (!m) {
    // No leading amount at all. If the whole thing reads like an instruction,
    // it is not a strength and must not be shown as one.
    return NOT_A_STRENGTH.test(s)
      ? { strength: undefined, leftover: s }
      : { strength: s.length <= 24 ? s : undefined, leftover: s.length > 24 ? s : undefined };
  }

  const strength = [m[1], m[2], m[3]?.toUpperCase()].filter(Boolean).join(m[2] ? ' ' : '');
  const leftover = s.slice(m[0].length).trim().replace(/^[+\-–—,;:.]\s*/, '');
  return { strength: strength.trim(), leftover: leftover || undefined };
}

/**
 * One item per drug.
 *
 * A prescription line joining drugs with "+" is as many medicines as it names,
 * and they share the line's timing: "Teneligliptin (20) + MF500(SR) — 1 tab
 * each AF Lunch" is two tablets, both after lunch.
 *
 * Deliberately conservative about what counts as a join. A single branded
 * combination — "Glycomet GP2" — is one tablet whatever it contains, and
 * splitting it would invent a medicine the patient was never given. Only an
 * explicit "+" between two named drugs splits, because that is what a doctor
 * writes when they mean two.
 *
 * An "=" is not a join either. "Teneligliptin + MF500 = GIP2 + MF500" is the
 * doctor naming the generics and then the brands he wants dispensed; taking it
 * at face value would double the prescription.
 */
export function splitCombination(item) {
  const rawName = String(item?.name ?? '').trim();
  if (!rawName) return [];

  // Everything after the first "=" is the same medicines under other names.
  const beforeEquals = rawName.split(/\s*=\s*/)[0];

  const parts = beforeEquals
    .split(/\s*\+\s*/)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    const { strength, leftover } = tidyStrength(item.strength);
    return [
      {
        ...item,
        name: beforeEquals,
        strength,
        instructions: joinNotes(item.instructions, leftover),
      },
    ];
  }

  // The strength written against the whole line belongs to the first drug; the
  // others carry theirs inside their own name ("MF500(SR)"), which the model is
  // asked to separate and tidyStrength salvages when it does not.
  return parts.map((part, i) => {
    // A separator is required before the number.
    //
    // With `[\s(]*` this also matched a name with digits welded into it, so
    // "MF500(SR)" became a medicine called "MF" at strength 500 — and "MF" on a
    // reminder tells a patient nothing at all. "MF500" is the doctor's own
    // shorthand for metformin 500 and is left exactly as written; only a
    // strength the doctor actually separated ("Telma 40") is lifted out.
    const inline = /^(.*?)[\s(]+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu)?\s*(?:sr|xr|cr|er|xl)?)\s*\)?$/i.exec(part);
    const name = (inline ? inline[1] : part).trim().replace(/[(,\-–—]+$/, '').trim();
    const own = inline ? inline[2] : undefined;
    const fromLine = i === 0 ? tidyStrength(item.strength) : { strength: undefined, leftover: undefined };
    const tidied = own ? tidyStrength(own) : fromLine;

    return {
      ...item,
      name: name || part,
      strength: tidied.strength,
      // The timing on the line applies to every drug on it.
      frequency: item.frequency,
      // The line's timing belongs to every drug written on it. "Teneligliptin
      // + MF500(SR) — 1 tab each AF Lunch" is two tablets, both after lunch,
      // and dropping this from the second one sends it back to breakfast.
      whenText: item.whenText,
      relationToMeal: item.relationToMeal,
      instructions: joinNotes(item.instructions, tidied.leftover, fromLine.leftover),
    };
  });
}

function joinNotes(...bits) {
  const seen = [];
  for (const b of bits) {
    const t = String(b ?? '').trim();
    if (t && !seen.includes(t)) seen.push(t);
  }
  return seen.length ? seen.join(' · ') : undefined;
}

/** The key two prescription lines must share to be the same medicine. */
const keyOf = (item) =>
  `${String(item.name ?? '').toLowerCase().trim()}|${String(item.strength ?? '').toLowerCase().trim()}`;

/**
 * The same drug written on two lines is one medicine taken twice.
 *
 * Metformin 500 SR appears twice on the slip this was built from — once after
 * lunch, once after dinner. Two medicine records would be wrong (the patient
 * takes one drug), and keeping only one would be worse: whichever was written
 * second used to overwrite the first, and a dose disappeared.
 *
 * So they merge, and their times are unioned. One medicine, two reminders.
 */
export function mergeDuplicates(items) {
  const out = new Map();
  for (const item of items) {
    const key = keyOf(item);
    const existing = out.get(key);
    if (!existing) {
      out.set(key, { ...item });
      continue;
    }
    // Keep both timings so neither dose is lost.
    existing.frequency = joinNotes(existing.frequency, item.frequency);
    existing.instructions = joinNotes(existing.instructions, item.instructions);
    existing.durationDays = existing.durationDays ?? item.durationDays;
  }
  return [...out.values()];
}

/** Everything above, in the order it has to happen. */
export function normaliseScannedItems(items) {
  return mergeDuplicates(
    (Array.isArray(items) ? items : []).flatMap((i) => splitCombination(i)),
  );
}
