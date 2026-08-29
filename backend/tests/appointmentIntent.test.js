import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  detectAppointmentIntent,
  extractPreferredDay,
  extractPreferredTime,
} from '../src/services/triage/appointmentIntent.js';
import { dayjs, CLINIC_TZ } from '../src/utils/clinicTime.js';

/** A fixed Saturday, so "next Friday" and "Tuesday" have one right answer. */
const SAT = dayjs.tz('2026-08-29 10:00', 'YYYY-MM-DD HH:mm', CLINIC_TZ);
const on = (d) => dayjs(d).tz(CLINIC_TZ).format('YYYY-MM-DD');

describe('asking to be seen', () => {
  const yes = [
    'Can I get an appointment tomorrow at 4pm?',
    'I want to book an appointment',
    'need to see the doctor',
    'Could I meet Dr Dey on Tuesday?',
    'please fix a slot for me',
    'ডাক্তার দেখাতে চাই',
    'একটা অ্যাপয়েন্টমেন্ট লাগবে',
    'কাল সময় পাব?',
    'डॉक्टर को दिखाना है',
    'मुझे अपॉइंटमेंट चाहिए',
  ];
  for (const text of yes) {
    test(`"${text}"`, () => {
      assert.notEqual(detectAppointmentIntent(text, SAT), null);
    });
  }
});

describe('talking about one without asking for one', () => {
  const no = [
    // The commonest way a keyword match goes wrong.
    'I missed my appointment yesterday',
    'I want to cancel my appointment',
    'can you reschedule my appointment',
    'my appointment was cancelled',
    'how much is an appointment?',
    'what is the appointment fee',
    'অ্যাপয়েন্টমেন্ট বাতিল করতে চাই',
    'অ্যাপয়েন্টমেন্ট মিস হয়ে গেছে',
    'अपॉइंटमेंट रद्द करना है',
    // Nothing to do with appointments at all.
    'my sugar was 240 this morning',
    'আজ সুগার বেশি',
  ];
  for (const text of no) {
    test(`"${text}"`, () => {
      assert.equal(detectAppointmentIntent(text, SAT), null);
    });
  }
});

describe('the day they meant', () => {
  const cases = [
    ['tomorrow', '2026-08-30'],
    ['day after tomorrow', '2026-08-31'],
    ['today', '2026-08-29'],
    // Saturday asking for Tuesday means the Tuesday coming.
    ['on tuesday', '2026-09-01'],
    // ...and for a weekday that has already gone this week, the next one.
    ['on friday', '2026-09-04'],
    ['next week', '2026-09-05'],
    ['on 3 sep', '2026-09-03'],
    // Day-first. Nobody in India writes 9/12 for the ninth of December.
    ['on 2/9', '2026-09-02'],
    ['আগামীকাল', '2026-08-30'],
    ['পরশু', '2026-08-31'],
    ['मंगलवार को', '2026-09-01'],
  ];
  for (const [text, expected] of cases) {
    test(`"${text}" → ${expected}`, () => {
      const d = extractPreferredDay(text, SAT);
      assert.notEqual(d, null, 'no day found');
      assert.equal(on(d), expected);
    });
  }

  test('a day already past this year rolls to next', () => {
    const d = extractPreferredDay('on 3 jan', SAT);
    assert.equal(on(d), '2027-01-03');
  });

  test('no day named is null, not a guess', () => {
    // "Can I get an appointment?" names no day. Inventing tomorrow would put a
    // date in front of the patient that they never said and might not read.
    assert.equal(extractPreferredDay('can I get an appointment?', SAT), null);
    assert.equal(
      detectAppointmentIntent('can I get an appointment?', SAT).preferredFor,
      null,
    );
  });

  test('a resolved day is never in the past', () => {
    for (const text of ['on friday', 'on sunday', 'on 1 jan', 'monday']) {
      const d = extractPreferredDay(text, SAT);
      if (d == null) continue;
      assert.ok(
        !dayjs(d).tz(CLINIC_TZ).isBefore(SAT.startOf('day'), 'day'),
        `${text} resolved into the past`,
      );
    }
  });
});

describe('the time they mentioned', () => {
  test('kept as they wrote it, never parsed into a slot', () => {
    // A request carries a day and no time on purpose — the desk offers times
    // the doctor is actually free. Storing "16:00" would record an hour the
    // clinic has not agreed to.
    assert.match(extractPreferredTime('appointment tomorrow at 4pm'), /4\s?pm/i);
    assert.match(extractPreferredTime('around 10:30 am please'), /10:30/);
    assert.match(extractPreferredTime('কাল ৪টা'), /4/);
    assert.match(extractPreferredTime('कल ४ बजे'), /4/);
  });

  test('null when no time is mentioned', () => {
    assert.equal(extractPreferredTime('appointment tomorrow'), null);
  });
});

describe('the whole thing', () => {
  test('day and time together', () => {
    const got = detectAppointmentIntent(
      'Can I get an appointment tomorrow at 4pm?',
      SAT,
    );
    assert.equal(on(got.preferredFor), '2026-08-30');
    assert.match(got.timePhrase, /4\s?pm/i);
  });

  test('an empty or trivial message is not an intent', () => {
    assert.equal(detectAppointmentIntent('', SAT), null);
    assert.equal(detectAppointmentIntent('ok', SAT), null);
  });
});
