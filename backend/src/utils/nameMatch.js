/**
 * Is the name on this prescription the patient whose record it is being filed
 * onto?
 *
 * The clinic's pilot runs on paper: fifty prescriptions written by hand, each
 * photographed at the desk and attached to a record. The one mistake that
 * matters is attaching the wrong one — a medicine list belonging to somebody
 * else, on a diabetic's chart, invisible until it does harm. Nobody notices,
 * because a filed prescription looks exactly as correct as a misfiled one.
 *
 * So the name is read off the page and compared here, and the desk is *shown*
 * the answer. It is never used to pick a patient: the record was chosen by a
 * human before the photograph was taken, and a model that resolves patients by
 * name would eventually resolve two Rahul Dases to one chart.
 *
 * ---- Why this is deliberately not clever ----------------------------------
 *
 * No fuzzy distance, no phonetics. Indian names transliterate many ways —
 * Dey/Dae, Chowdhury/Choudhuri, Sanjay/Sanjoy — and a similarity score tuned to
 * accept those also accepts Rahul Das for Rahul Dhara, who may well both be in
 * the same clinic on the same morning. The three answers below are honest about
 * that: exact, partial, and different. A partial is not "probably fine", it is
 * "a person must look".
 */

/** Lower-case, strip honorifics and punctuation, collapse spaces. */
export function normaliseName(raw) {
  return String(raw ?? '')
    .toLowerCase()
    // Titles are written on paper and not in the record, or the reverse.
    .replace(/\b(mr|mrs|ms|miss|master|dr|smt|shri|sri|md|late)\.?\s+/g, ' ')
    // Devanagari and Bengali danda, and the usual punctuation.
    .replace(/[.,/\\|@#$%^&*()_+=<>?;:'"`~[\]{}।॥-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The parts of a name, in no particular order. */
const partsOf = (raw) => normaliseName(raw).split(' ').filter((p) => p.length > 1);

/**
 * Compare the name on the page with the name on the record.
 *
 * @returns {{verdict: 'exact'|'partial'|'different'|'unknown', onPaper: string|null}}
 *
 * - `unknown`  — nothing legible on the page. Common on a handwritten slip that
 *                only carries the medicines, and not a reason to block: the
 *                desk chose the record and a blank tells them nothing new.
 * - `exact`    — the same name, allowing for titles, spacing and punctuation.
 * - `partial`  — they share a name part. "Rahul Das" against "Rahul Kumar Das"
 *                is the same person written twice; "Rahul Das" against "Rahul
 *                Dhara" is two people. This cannot tell them apart, and says so.
 * - `different`— no part in common. Almost certainly the wrong record.
 */
export function compareNames(onPaper, onFile) {
  const paper = partsOf(onPaper);
  const file = partsOf(onFile);

  if (!paper.length) return { verdict: 'unknown', onPaper: null };
  const shown = normaliseName(onPaper);

  if (!file.length) return { verdict: 'unknown', onPaper: shown };
  if (paper.join(' ') === file.join(' ')) return { verdict: 'exact', onPaper: shown };

  // Order-independent: "Das Rahul" on a form and "Rahul Das" in the record are
  // the same person, and forms in this clinic are filled both ways.
  const sortedPaper = [...paper].sort().join(' ');
  const sortedFile = [...file].sort().join(' ');
  if (sortedPaper === sortedFile) return { verdict: 'exact', onPaper: shown };

  const shares = paper.some((p) => file.includes(p));
  return { verdict: shares ? 'partial' : 'different', onPaper: shown };
}

/** True when a human must confirm before this is filed. */
export const needsConfirmation = (verdict) =>
  verdict === 'partial' || verdict === 'different';
