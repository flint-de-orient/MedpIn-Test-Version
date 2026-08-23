/**
 * A check on the language a reply actually came back in.
 *
 * Everything else about the reply language is a request to the model: the
 * system prompt asks, the primer turn asks again with recency behind it. Both
 * are still asking. This measures what came back, so that when the model
 * ignores both — and it has, repeatedly, in every arrangement tried so far —
 * the patient is not the one who finds out.
 *
 * Scripts rather than languages, because script is what can be read off the
 * text with certainty. The clinic's three languages happen to separate cleanly:
 * English is Latin, Bengali is Bengali, Hindi is Devanagari. Telling Hindi from
 * Marathi would need a real language model; telling Devanagari from Latin needs
 * a codepoint range.
 */

const BENGALI = /[ঀ-৿]/g;
const DEVANAGARI = /[ऀ-ॿ]/g;
const LATIN = /[A-Za-z]/g;

/** Which script the clinic's three languages are written in. */
const SCRIPT_FOR_LANGUAGE = Object.freeze({
  en: 'latin',
  bn: 'bengali',
  hi: 'devanagari',
});

function count(text, re) {
  return (text.match(re) ?? []).length;
}

/**
 * The script most of `text` is written in, or null when there is not enough to
 * tell.
 *
 * "Not enough" is deliberate and matters: a reply of "OK" or "125 mg/dL" is
 * script-less in any meaningful sense, and calling that Latin would flag a
 * perfectly good Bengali conversation as wrong.
 */
export function dominantScript(text) {
  const s = (text ?? '').trim();
  if (!s) return null;

  const bengali = count(s, BENGALI);
  const devanagari = count(s, DEVANAGARI);
  const latin = count(s, LATIN);
  const total = bengali + devanagari + latin;

  // Under a dozen letters there is no reliable signal — medicine names, units
  // and numbers are Latin in every one of these languages.
  if (total < 12) return null;

  if (bengali >= devanagari && bengali >= latin && bengali / total >= 0.3) {
    return 'bengali';
  }
  if (devanagari >= bengali && devanagari >= latin && devanagari / total >= 0.3) {
    return 'devanagari';
  }
  // Latin has to win outright. A Bengali reply quoting "Metformin 500 mg" is
  // still a Bengali reply, and the threshold above is what protects it.
  if (latin / total >= 0.7) return 'latin';
  return null;
}

/**
 * Whether `reply` is in the wrong language for `language`.
 *
 * The patient's own message is passed in because of the one exception the
 * prompt allows: somebody who writes at length in another language is answered
 * in theirs, and a reply that follows them is correct rather than wrong.
 */
export function replyIsWrongLanguage({ reply, language, patientText }) {
  const want = SCRIPT_FOR_LANGUAGE[language];
  if (!want) return false;

  const got = dominantScript(reply);
  if (got == null || got === want) return false;

  // The exception: if the patient wrote in the script the reply came back in,
  // the model followed them, which is what it was told to do.
  const theirs = dominantScript(patientText);
  if (theirs != null && theirs === got) return false;

  return true;
}

export { SCRIPT_FOR_LANGUAGE };
