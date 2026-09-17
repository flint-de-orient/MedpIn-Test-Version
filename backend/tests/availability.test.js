import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Availability } from '../src/models/Availability.js';
import { windowsForDate, buildSlotTimes } from '../src/services/scheduling.js';

/**
 * A diary per doctor per location.
 *
 * `Clinic.weeklyHours` says when the building is open, which equals the
 * doctor's diary only while there is one doctor. A polyclinic with eight has
 * one building and eight diaries, and hours on the location would book a
 * cardiologist into a slot the dermatologist is sitting in.
 *
 * What is pinned here is mostly the fallback: a location with no availability
 * row must behave exactly as it did, or shipping this takes the booking page
 * down for the clinic running today.
 */
const scheduling = readFileSync(
  new URL('../src/services/scheduling.js', import.meta.url),
  'utf8',
);
const backfill = readFileSync(
  new URL('../scripts/backfillAvailability.js', import.meta.url),
  'utf8',
);

describe('the fallback keeps today working', () => {
  test('no doctor means the building own hours, unchanged', () => {
    // The signature every existing caller uses. `scheduleFor` returns the
    // clinic itself, so nothing downstream can tell the difference.
    assert.match(scheduling, /if \(!doctorId \|\| !clinic\?\._id\) return clinic;/);
  });

  test('a doctor with no diary at this location falls back too', () => {
    // Returning nothing would read as "never available", which would take a
    // working clinic booking page down the hour this shipped.
    assert.match(scheduling, /return own \?\? clinic;/);
  });

  test('only active diaries are read', () => {
    const block = scheduling.slice(scheduling.indexOf('export async function scheduleFor'));
    assert.match(block, /isActive: true/);
  });
});

describe('the slot engine did not have to change', () => {
  // The whole reason Availability copies Clinic's field names: the pure
  // functions read `weeklyHours`, `overrides` and `slotMinutes` and nothing
  // else, so a diary row is a drop-in and there is no parallel code path.
  const diary = {
    weeklyHours: [
      { dayOfWeek: 1, start: '10:00', end: '12:00' },
      { dayOfWeek: 1, start: '17:00', end: '18:00' },
    ],
    overrides: [{ date: '2026-09-07', isClosed: true, windows: [] }],
    slotMinutes: 30,
  };

  test('an availability row yields windows exactly as a clinic does', () => {
    // 2026-09-07 is a Monday.
    assert.deepEqual(windowsForDate(diary, '2026-09-14'), [
      { start: '10:00', end: '12:00' },
      { start: '17:00', end: '18:00' },
    ]);
  });

  test('an override closes the day for the doctor, not the building', () => {
    assert.deepEqual(windowsForDate(diary, '2026-09-07'), []);
  });

  test('slot length comes from the diary, not the location', () => {
    // A consultant may take 30 minutes where the general clinic takes 15, in
    // the same room on different days.
    const times = buildSlotTimes(diary, '2026-09-14').map((t) => t.time);
    assert.deepEqual(times, ['10:00', '10:30', '11:00', '11:30', '17:00', '17:30']);
  });
});

describe('the model', () => {
  test('one diary per doctor per location', () => {
    // Several sittings in a week are several weeklyHours entries, not several
    // rows.
    const idx = Availability.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find((i) => i.f.doctor === 1 && i.f.location === 1);
    assert.ok(unique, 'no doctor+location index');
    assert.equal(unique.o.unique, true);
  });

  test('"who sits here" is indexed', () => {
    const idx = Availability.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.location === 1 && f.isActive === 1));
  });

  test('it carries the same three field names the engine reads', () => {
    const paths = Object.keys(Availability.schema.paths);
    for (const f of ['weeklyHours', 'overrides', 'slotMinutes']) {
      assert.ok(paths.includes(f), `Availability has no ${f}`);
    }
  });
});

describe('the migration', () => {
  test('never modifies a clinic', () => {
    assert.ok(!/\$unset/.test(backfill));
    assert.ok(
      !/Clinic\.(updateOne|updateMany|findOneAndUpdate)/.test(backfill),
      'the backfill writes to Clinic',
    );
  });

  test('skips a location with no doctor rather than guessing', () => {
    // A row on the wrong doctor is worse than none: none falls back correctly,
    // a wrong one silently offers a cardiologist's hours for a dermatologist.
    assert.match(backfill, /no doctor named on the location/);
    assert.match(backfill, /clinics\.filter\(\(c\) => c\.doctor\)/);
  });

  test('is re-runnable without resetting an edited diary', () => {
    assert.match(backfill, /\$setOnInsert/);
    assert.match(backfill, /already have one — left alone/);
  });

  test('does not write unless asked', () => {
    assert.match(backfill, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(backfill, /if \(!apply\)/);
  });
});

describe('the booking routes ask whose diary', () => {
  const appts = readFileSync(new URL('../src/routes/appointments.js', import.meta.url), 'utf8');
  const clinics = readFileSync(new URL('../src/routes/clinics.js', import.meta.url), 'utf8');

  test('every slot check names a doctor', () => {
    // Three: booking, confirming a request onto a time, and rescheduling. A
    // check that omitted the doctor would validate against the building and let
    // a patient book an hour their doctor is not there.
    const calls = appts.match(/isSlotBookable\([^)]*\)/g) ?? [];
    assert.equal(calls.length, 3, calls.join(' | '));
    for (const c of calls) assert.match(c, /doctorId:/, c);
  });

  test('the slots endpoint accepts one, and without it asks for the doctor a booking would go to', () => {
    // Absent a doctor it used to answer for the building, so another doctor's
    // appointment at the same hour hid this one's slot. Booking resolves the
    // doctor from the location; the list asks the same question. The behaviour
    // is held over HTTP in locationRules.test.js.
    assert.match(clinics, /doctorId: z\.string\(\)\.optional\(\)/);
    assert.match(clinics, /doctorId \?\? \(await resolveDoctor\(\{ clinicId: clinic\._id \}\)/);
    assert.match(clinics, /generateSlots\(clinic, date, \{ doctorId: forDoctor \}\)/);
  });
});
