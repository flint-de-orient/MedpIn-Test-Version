import { dayjs, CLINIC_TZ } from '../../utils/clinicTime.js';

/**
 * "Can I see the doctor on Tuesday?" — recognised, and turned into an offer.
 *
 * The patient's care thread is where they already talk to the clinic, so it is
 * where they ask for appointments. Until now the assistant answered that it
 * could not book anything and the sentence went nowhere: the desk's "Waiting
 * for a time" queue had no way to be fed except a booking screen most patients
 * never open.
 *
 * ---- Why this is rules and not the model ----------------------------------
 *
 * Detection runs on every message, before generation, and has to work when
 * Gemini is down — the same reason triage is rules-first. It is also the part
 * that must be testable line by line: "I missed my appointment yesterday" and
 * "can I get an appointment?" differ by tense, and a model that gets that
 * wrong in Bengali is not something a test can pin down.
 *
 * ---- Why a wrong answer here is cheap -------------------------------------
 *
 * Nothing is created. A match produces a card the patient may tap, showing the
 * day it thinks they meant. A false positive is a card somebody ignores; a
 * misread date is one they correct before sending. That is the whole reason
 * this is allowed to be generous — the alternative, creating requests from
 * sentences, puts phantoms on the desk's queue, and a queue with phantoms in it
 * is one the desk stops trusting.
 */

/** Someone is asking to be seen. */
const ASKING = [
  // English
  /\bappointment\b/i,
  /\b(book|schedule|fix|arrange|get)\s+(an?\s+)?(appointment|slot|time|visit)\b/i,
  /\b(can|could|may)\s+i\s+(see|meet|visit|come)\b/i,
  /\bwant\s+to\s+(see|meet|visit|come)\b/i,
  /\bneed\s+(to\s+see|an?\s+appointment)\b/i,
  /\bconsultation\b.*\b(book|want|need|when)\b/i,

  // Bengali. "দেখাতে চাই" — literally "want to show [myself]" — is how this is
  // actually said, far more often than the loanword.
  /অ্যা?পয়ে?ন্ট/,
  /এপয়ে?ন্ট/,
  /(ডাক্তার|ডক্টর).{0,12}(দেখাতে|দেখাব|দেখােবা|দেখাতে চাই)/,
  /দেখাতে\s*চাই/,
  /সময়\s*(পাব|পাবো|দেবেন|দিন)/,

  // Hindi. Likewise "दिखाना है" rather than the loanword.
  /अपॉ?इं?ट/,
  /(डॉक्टर|डाक्टर).{0,12}(दिखाना|दिखाऊं|मिलना)/,
  /दिखाना\s*है/,
  /मिलने\s*का\s*समय/,
];

/**
 * Talking about an appointment without asking for one.
 *
 * Checked first and wins outright. A patient saying they missed Tuesday's
 * appointment, or asking to cancel one, is the commonest way a keyword match
 * would be wrong — and cancelling in particular must never surface a card that
 * books them in again.
 */
const NOT_ASKING = [
  /\b(missed|cancel|cancelled|postpone|reschedul\w*)\b/i,
  /\b(had|attended|went\s+to|came\s+for)\s+(my|the|an?)\s+\w*\s*appointment/i,
  /\bappointment\s+(was|is)\s+(cancel|over|done|finished)/i,
  /\b(how much|what.{0,30}\b(cost|fee|charge|price)s?\b|price)\b/i,
  /(বাতিল|মিস|ক্যান্সেল|হয়ে\s*গেছে|কত\s*টাকা|ফি\s*কত)/,
  /(रद्द|मिस|कैंसिल|हो\s*गया|कितने\s*पैसे|फीस)/,
];

/** Bengali and Devanagari digits, so "৪টা" and "४ बजे" read as 4. */
const DIGITS = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4',
  '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

const latinise = (s) => s.replace(/[০-৯०-९]/g, (d) => DIGITS[d] ?? d);

const WEEKDAYS = [
  ['sunday|sun\\b|রবিবার|রবি|रविवार|इतवार', 0],
  ['monday|mon\\b|সোমবার|সোম|सोमवार', 1],
  ['tuesday|tue\\b|tues\\b|মঙ্গলবার|মঙ্গল|मंगलवार', 2],
  ['wednesday|wed\\b|বুধবার|বুধ|बुधवार', 3],
  ['thursday|thu\\b|thurs\\b|বৃহস্পতিবার|বৃহস্পতি|गुरुवार|बृहस्पतिवार', 4],
  ['friday|fri\\b|শুক্রবার|শুক্র|शुक्रवार', 5],
  ['saturday|sat\\b|শনিবার|শনি|शनिवार', 6],
];

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec';

/**
 * The day the patient seems to mean, or null when they did not say.
 *
 * Null is a perfectly good answer — "can I get an appointment?" names no day,
 * and the card then asks for one rather than inventing tomorrow.
 *
 * A resolved day is always today or later. Someone asking on Saturday for
 * "Friday" means the Friday coming, not the one that has gone.
 */
export function extractPreferredDay(text, now = dayjs().tz(CLINIC_TZ)) {
  const t = latinise(text).toLowerCase();
  const today = now.startOf('day');

  // Bengali "কাল" and Hindi "कल" mean both yesterday and tomorrow. In a
  // sentence asking to be seen, only one of those is a possible meaning — and
  // the card shows the resolved date, so a reader can see if it guessed wrong.
  if (/\b(day after tomorrow)\b/.test(t) || /পরশু/.test(text) || /परसों/.test(text)) {
    return today.add(2, 'day');
  }
  if (/\btomorrow\b/.test(t) || /(আগামী\s*কাল|কালকে|কাল)/.test(text) || /कल/.test(text)) {
    return today.add(1, 'day');
  }
  if (/\btoday\b/.test(t) || /আজ/.test(text) || /आज/.test(text)) {
    return today;
  }

  // "next week" with no day named: the same weekday, seven days on.
  const nextWeek = /\bnext\s+week\b/.test(t) || /আগামী\s*সপ্তাহ/.test(text) || /अगले\s*हफ़?्?ते/.test(text);

  for (const [pattern, dow] of WEEKDAYS) {
    if (!new RegExp(pattern, 'i').test(t) && !new RegExp(pattern).test(text)) continue;
    let d = today.day(dow);
    if (!d.isAfter(today, 'day')) d = d.add(7, 'day');
    if (nextWeek && d.diff(today, 'day') < 7) d = d.add(7, 'day');
    return d;
  }

  if (nextWeek) return today.add(7, 'day');

  // "on the 12th", "12/9", "12 Sep".
  const dm = t.match(new RegExp(`\\b(\\d{1,2})\\s*(?:st|nd|rd|th)?\\s*(?:of\\s+)?(${MONTHS})`, 'i'));
  if (dm) {
    // An index, not a format string. `dayjs(..., 'YYYY-MMM-D')` wants "Sep",
    // and the text here has been lower-cased for matching — so it parsed to
    // Invalid Date and every "3 sep" quietly found no day at all.
    const month = MONTHS.split('|').indexOf(dm[2].toLowerCase()) + 1;
    const d = dayjs
      .tz(
        `${today.year()}-${String(month).padStart(2, '0')}-${dm[1].padStart(2, '0')}`,
        'YYYY-MM-DD',
        CLINIC_TZ,
      )
      .startOf('day');
    if (d.isValid()) return d.isBefore(today, 'day') ? d.add(1, 'year') : d;
  }

  const slash = t.match(/\b(\d{1,2})\s*[/-]\s*(\d{1,2})\b/);
  if (slash) {
    // Day-first. This clinic is in India and nobody there writes 9/12 for the
    // ninth of December.
    const d = dayjs.tz(
      `${today.year()}-${slash[2].padStart(2, '0')}-${slash[1].padStart(2, '0')}`,
      'YYYY-MM-DD',
      CLINIC_TZ,
    ).startOf('day');
    if (d.isValid()) return d.isBefore(today, 'day') ? d.add(1, 'year') : d;
  }

  return null;
}

/**
 * The time of day they mentioned, as they wrote it, or null.
 *
 * Kept as their own words and never parsed into a slot. A request carries a
 * day and no time on purpose — the desk offers times the doctor is actually
 * free — so storing "16:00" would record an hour the clinic has not agreed to.
 * "around 4pm" beside the request is what the desk needs, and it is true.
 */
export function extractPreferredTime(text) {
  const t = latinise(text);
  const m =
    t.match(/\b(\d{1,2})\s*(?::|\.)\s*(\d{2})\s*(am|pm)?/i) ||
    t.match(/\b(\d{1,2})\s*(am|pm)\b/i) ||
    t.match(/\b(\d{1,2})\s*(?:টা|বাজে|बजे)/);
  if (!m) return null;
  return m[0].trim().replace(/\s+/g, ' ');
}

/**
 * Does this message ask for an appointment, and for when?
 *
 * @returns {{preferredFor: Date|null, timePhrase: string|null}|null}
 */
export function detectAppointmentIntent(text, now = dayjs().tz(CLINIC_TZ)) {
  const raw = (text ?? '').trim();
  if (raw.length < 3) return null;

  for (const no of NOT_ASKING) if (no.test(raw)) return null;

  const asking = ASKING.some((re) => re.test(raw));
  if (!asking) return null;

  const day = extractPreferredDay(raw, now);
  return {
    preferredFor: day ? day.toDate() : null,
    timePhrase: extractPreferredTime(raw),
  };
}
