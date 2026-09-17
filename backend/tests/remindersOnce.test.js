import { test, describe, before, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Medication } from '../src/models/Medication.js';
import { MedicationLog } from '../src/models/MedicationLog.js';
import { MedicationReminderPush } from '../src/models/MedicationReminderPush.js';
import { Appointment } from '../src/models/Appointment.js';
import { ReminderRun, claimReminderPass } from '../src/models/ReminderRun.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { clinicDateTime, inClinicTz } from '../src/utils/clinicTime.js';
import { remindDueDoses } from '../src/services/medicationReminderCron.js';
import { sendVisitReminders } from '../src/services/scheduler.js';

/**
 * V-53 — a reminder reaches a patient once.
 *
 * The medicine-reminder push job ticks twice a minute and remembered what it
 * had sent in a Set in memory. A restart inside the minute emptied it, a second
 * process never had it, and two overlapping ticks both passed it. The evening
 * digests were guarded the same way, and the visit reminder was marked only
 * after it was sent. Each of these is a patient, or a doctor, told twice — and
 * for a dose, the plausible response to being told twice is to take it twice.
 */

let clinic;
let patient;

/** Yesterday, clinic time — a day whose every minute has passed. */
const day = inClinicTz(new Date()).subtract(1, 'day').format('YYYY-MM-DD');
const at = (time, onDay = day) => clinicDateTime(onDay, time).toDate();
const nextDay = inClinicTz(at('12:00')).add(1, 'day').format('YYYY-MM-DD');

/** A push that only counts what would have reached a phone. */
function phone() {
  const calls = [];
  const send = async (push) => {
    calls.push(push);
    return { delivered: 1 };
  };
  return { calls, send };
}

const medicine = (who, fields = {}) =>
  Medication.create({
    patient: who.user._id,
    name: 'Insulin glargine',
    dose: '10 units',
    schedule: [{ time: '10:00', relationToMeal: 'any' }],
    prescribedBy: clinic.doctor.user._id,
    practice: clinic.practice._id,
    source: 'clinic',
    startDate: inClinicTz(at('00:00')).subtract(5, 'day').toDate(),
    ...fields,
  });

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return { practice: p, doctor: await makeMember(p, { name: `Dr ${name}`, isOwner: true }) };
}

describe('a medicine dose is pushed once', () => {
  before(async () => {
    await boot();
    // The unique index is the guard; it must exist before anything races it.
    await MedicationReminderPush.init();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    clinic = await practice('Salt Lake');
    patient = await makePatient({ name: 'Evening Insulin', practices: [clinic.practice] });
  });

  test('two ticks — or two servers — reaching the same dose minute push it once', async () => {
    await medicine(patient);
    const { calls, send } = phone();

    const pushed = await Promise.all([1, 2, 3, 4].map(() => remindDueDoses(at('10:00'), { send })));

    assert.equal(calls.length, 1, `one dose was pushed ${calls.length} times`);
    assert.deepEqual(pushed.sort(), [0, 0, 0, 1]);
    assert.equal(await MedicationReminderPush.countDocuments({}), 1);
  });

  test('a restart inside the minute does not push it again', async () => {
    await medicine(patient);
    const { calls, send } = phone();

    // A second copy of the module is a process that has just started: nothing
    // it holds in memory knows what the first one sent.
    const restarted = await import('../src/services/medicationReminderCron.js?restarted');

    await remindDueDoses(at('10:00'), { send });
    await restarted.remindDueDoses(at('10:00'), { send });

    assert.equal(calls.length, 1, 'the restarted process pushed the same dose again');
  });

  test('every other dose still goes out: the same medicine tonight and tomorrow, and another medicine now', async () => {
    const insulin = await medicine(patient, {
      schedule: [
        { time: '10:00', relationToMeal: 'any' },
        { time: '22:00', relationToMeal: 'any' },
      ],
    });
    const other = await makePatient({ name: 'Morning Metformin', practices: [clinic.practice] });
    const metformin = await medicine(other, { name: 'Metformin', dose: '500mg' });
    const { calls, send } = phone();

    await remindDueDoses(at('10:00'), { send });
    await remindDueDoses(at('22:00'), { send });
    await remindDueDoses(at('10:00', nextDay), { send });

    const seen = calls.map((c) => `${String(c.med._id)} ${c.time}`).sort();
    assert.deepEqual(
      seen,
      [
        `${insulin._id} 10:00`,
        `${insulin._id} 10:00`,
        `${insulin._id} 22:00`,
        `${metformin._id} 10:00`,
        `${metformin._id} 10:00`,
      ].sort(),
      'the guard swallowed a dose that was not a repeat',
    );
    // Tomorrow's pushes carry tomorrow's notification id, not today's.
    const insulinMornings = calls.filter((c) => String(c.med._id) === String(insulin._id) && c.time === '10:00');
    assert.equal(insulinMornings.length, 2);
  });

  test('a dose already taken is not pushed, and does not use up the claim', async () => {
    const med = await medicine(patient);
    await MedicationLog.create({
      patient: patient.user._id,
      medication: med._id,
      scheduledFor: at('10:00'),
      status: 'taken',
      takenAt: at('09:58'),
    });
    const { calls, send } = phone();

    assert.equal(await remindDueDoses(at('10:00'), { send }), 0);
    assert.equal(calls.length, 0);
    assert.equal(await MedicationReminderPush.countDocuments({}), 0);
  });

  test('a claim the database cannot take is not pushed, and the tick carries on without throwing', async () => {
    await medicine(patient);
    const { calls, send } = phone();
    const down = mock.method(MedicationReminderPush, 'create', async () => {
      throw Object.assign(new Error('not primary'), { code: 10107 });
    });
    try {
      assert.equal(await remindDueDoses(at('10:00'), { send }), 0);
    } finally {
      down.mock.restore();
    }
    assert.equal(calls.length, 0, 'pushed without a claim — the next tick would push it again');
  });

  test('one patient’s failed push does not cost the next patient their reminder', async () => {
    await medicine(patient);
    const other = await makePatient({ name: 'Next In Line', practices: [clinic.practice] });
    await medicine(other);

    const calls = [];
    const send = async (push) => {
      calls.push(push);
      if (calls.length === 1) throw new Error('FCM unavailable');
      return { delivered: 1 };
    };

    const pushed = await remindDueDoses(at('10:00'), { send });
    assert.equal(calls.length, 2, 'the tick stopped at the first failure');
    assert.equal(pushed, 1);
  });
});

describe('a visit reminder is sent once', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    clinic = await practice('Behala');
    patient = await makePatient({ name: 'Tomorrow Morning', practices: [clinic.practice] });
  });

  const evening = () => inClinicTz(at('20:30'));
  const tomorrowVisit = () =>
    Appointment.create({
      patient: patient.user._id,
      doctor: clinic.doctor.user._id,
      practice: clinic.practice._id,
      status: 'confirmed',
      scheduledFor: at('10:00', nextDay),
    });

  test('two schedulers reading the same evening remind the patient once', async () => {
    const appt = await tomorrowVisit();
    const told = [];
    const notify = async (a) => {
      told.push(String(a._id));
      return { delivered: 1 };
    };

    const sent = await Promise.all([
      sendVisitReminders({ now: evening(), notify }),
      sendVisitReminders({ now: evening(), notify }),
      sendVisitReminders({ now: evening(), notify }),
    ]);

    assert.deepEqual(told, [String(appt._id)], `reminded ${told.length} times`);
    assert.deepEqual(sent.sort(), [0, 0, 1]);
    assert.ok((await Appointment.findById(appt._id).lean()).remindedAt);
  });

  test('a reminder that failed to send is released, and sent on the next tick', async () => {
    const appt = await tomorrowVisit();

    const failing = async () => {
      throw new Error('FCM unavailable');
    };
    assert.equal(await sendVisitReminders({ now: evening(), notify: failing }), 0);
    assert.equal(
      (await Appointment.findById(appt._id).lean()).remindedAt ?? null,
      null,
      'a failed send was recorded as reminded, and will never be retried',
    );

    const told = [];
    const working = async (a) => {
      told.push(String(a._id));
      return { delivered: 1 };
    };
    assert.equal(await sendVisitReminders({ now: evening(), notify: working }), 1);
    assert.deepEqual(told, [String(appt._id)]);
  });
});

describe('each evening push is claimed once per clinic day', () => {
  before(async () => {
    await boot();
    await ReminderRun.init();
  });
  after(shutdown);
  beforeEach(wipe);

  test('eight processes asking at once: one claims the pass', async () => {
    const answers = await Promise.all(Array.from({ length: 8 }, () => claimReminderPass('digest:tomorrow', day)));
    assert.equal(answers.filter(Boolean).length, 1);

    // A different pass, or the next day, is its own claim.
    assert.equal(await claimReminderPass('digest:chat', day), true);
    assert.equal(await claimReminderPass('digest:tomorrow', nextDay), true);
  });

  test('the scheduler claims both digests in the database, and keeps no date in memory', () => {
    const src = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');
    assert.doesNotMatch(src, /let last\w*Date/, 'a digest is guarded by a variable a restart forgets');
    assert.match(src, /claimReminderPass\('digest:tomorrow', today\)/);
    assert.match(src, /claimReminderPass\('digest:chat', today\)/);
  });
});
