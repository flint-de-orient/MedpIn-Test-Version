import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The chain from "can I see the doctor?" to somebody turning up.
 *
 * Patient asks → desk queue → desk gives a time → both sides told → the doctor's
 * home shows it → both are reminded the day before. Every link existed except
 * the first and the last, and the last had been written and never called.
 *
 * Read from the source, because most of what matters here is a *missing* line —
 * a scheduler that is never started, a guard that stops a reminder going twice —
 * and a request that is never made cannot be tested by making requests.
 */
const server = readFileSync(new URL('../src/server.js', import.meta.url), 'utf8');
const scheduler = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');
const notifications = readFileSync(new URL('../src/services/notifications.js', import.meta.url), 'utf8');
const appointments = readFileSync(new URL('../src/routes/appointments.js', import.meta.url), 'utf8');
const model = readFileSync(new URL('../src/models/Appointment.js', import.meta.url), 'utf8');

describe('the scheduler actually runs', () => {
  test('startScheduler is called', () => {
    // It was defined, exported, and never invoked. The evening digest had
    // therefore never fired on any deploy, and no test would have caught that
    // because the function itself was perfectly correct.
    assert.match(server, /import \{ startScheduler \}/);
    assert.match(server, /^\s*startScheduler\(\);/m);
  });

  test('an empty digest is not sent', () => {
    // A push every night of every closed day, saying nothing is happening, is
    // the notification that teaches someone to mute the rest.
    const fn = notifications.slice(
      notifications.indexOf('export async function notifyClinicOfTomorrowSchedule'),
      notifications.indexOf('export async function notifyWaitlistOfFreedSlot'),
    );
    assert.match(fn, /if \(!appointments\.length\) return \{ delivered: 0, skipped: 'empty' \}/);
  });
});

describe('the day-before reminder', () => {
  test('reaches the patient and the doctor', () => {
    const fn = notifications.slice(
      notifications.indexOf('export async function notifyVisitTomorrow'),
      notifications.indexOf('export async function notifyClinicOfTomorrowSchedule'),
    );
    assert.ok(fn.length > 0, 'notifyVisitTomorrow is missing');
    assert.match(fn, /patient\?\.deviceTokens/);
    assert.match(fn, /doctorTokens\.length/);
  });

  test('in the patient’s own language', () => {
    // A reminder nobody can read is a reminder they miss.
    const fn = notifications.slice(
      notifications.indexOf('const VISIT_TOMORROW'),
      notifications.indexOf('export async function notifyVisitTomorrow'),
    );
    for (const lang of ['en', 'bn', 'hi']) {
      assert.match(fn, new RegExp(`\\b${lang}:`), `no ${lang} copy`);
    }
  });

  test('goes out once, and the guard survives a restart', () => {
    // An in-memory flag would re-remind fifty patients after a deploy, and the
    // whole point of the guard is that one person's phone buzzes once.
    assert.match(model, /remindedAt: \{ type: Date \}/);
    assert.match(scheduler, /remindedAt: null/);
    assert.match(scheduler, /\$set: \{ remindedAt: new Date\(\) \}/);
  });

  test('is marked only after the push, so a failure retries', () => {
    const fn = scheduler.slice(
      scheduler.indexOf('async function sendVisitReminders'),
      scheduler.indexOf('async function tick'),
    );
    assert.ok(
      fn.indexOf('notifyVisitTomorrow') < fn.indexOf('remindedAt: new Date()'),
      'the appointment is marked reminded before the push is attempted',
    );
  });

  test('runs on every evening tick, not only at the digest hour', () => {
    // An appointment confirmed at nine tonight for tomorrow morning would
    // otherwise be reminded about never: the digest hour has gone, and there
    // is no second chance.
    const fn = scheduler.slice(scheduler.indexOf('async function tick'));
    assert.match(fn, /now\.hour\(\) >= DIGEST_HOUR \|\| now\.hour\(\) < 6/);
  });
});

describe('the hour the patient asked for', () => {
  test('is accepted, stored and returned', () => {
    assert.match(appointments, /preferredTime: z\s*[\s\S]{0,40}\.regex/);
    assert.match(model, /preferredTime: \{ type: String, match:/);
    assert.match(appointments, /preferredTime: a\.preferredTime \?\? null/);
  });

  test('is cleared when the desk confirms a real time', () => {
    // Two times on one row, one of them imaginary, is how somebody turns up at
    // the wrong hour.
    const confirm = appointments.slice(
      appointments.indexOf("appointment.status = 'confirmed';"),
    );
    assert.match(confirm.slice(0, 400), /appointment\.preferredTime = undefined;/);
  });

  test('a repeat request without a time clears the old one', () => {
    // Asking again *without* an hour is changing your mind about the hour.
    // Keeping the old one would leave the desk working from a withdrawn wish.
    assert.match(appointments, /existing\.preferredTime = preferredTime \?\? undefined;/);
  });
});
