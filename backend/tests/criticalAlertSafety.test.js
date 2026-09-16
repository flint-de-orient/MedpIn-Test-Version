import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ClinicalAlert } from '../src/models/ClinicalAlert.js';
import { User, ROLES } from '../src/models/User.js';
import { raiseAlert } from '../src/services/alerts.js';
import { staffFor, notifyClinicStaff } from '../src/services/notifications.js';

/**
 * The three findings that were not like the others (verification V-01, V-30,
 * V-31).
 *
 * V-01 — a patient no practice cares for used to wake every doctor and desk on
 * the platform, with their name and complaint on the lock screen.
 * V-30 — a warning open for twenty minutes swallowed an emergency of the same
 * kind: no alert, no page, no escalation.
 * V-31 — "staff notified" was written whether or not anything was delivered.
 */

const until = async (check, what) => {
  for (let i = 0; i < 40; i += 1) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`timed out waiting for ${what}`);
};

async function staffedPractice(name) {
  const practice = await makePractice(name);
  const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
  const desk = await makeMember(practice, { name: `${name} Desk`, role: ROLES.STAFF });
  // Every one of them has a phone that could ring.
  await User.updateMany({ _id: { $in: [doctor.user._id, desk.user._id] } }, { deviceTokens: [`token-${name}`] });
  return { practice, doctor, desk };
}

describe('V-01: a patient nobody cares for wakes nobody', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('no practice means no recipients — not every clinician on the platform', async () => {
    await staffedPractice('Salt Lake');
    await staffedPractice('Behala');
    const stranger = await makePatient({ name: 'Signed Up Alone' });

    const woken = await staffFor(stranger.user._id, [ROLES.DOCTOR, ROLES.STAFF]);
    assert.deepEqual(woken, [], 'an unenrolled patient’s alert went to every practice’s staff');
  });

  test('an emergency about them is still recorded, and says nobody was reached', async () => {
    await staffedPractice('Salt Lake');
    const stranger = await makePatient({ name: 'Chest Pain Stranger' });

    const alert = await raiseAlert({
      patientId: stranger.user._id,
      severity: 'emergency',
      type: 'chest_pain',
      title: 'Chest pain reported',
      detail: 'Crushing chest pain for 20 minutes',
      source: { kind: 'chat' },
    });

    const attempted = await until(
      async () => (await ClinicalAlert.findById(alert._id).lean())?.staffNotification?.attemptedAt && ClinicalAlert.findById(alert._id).lean(),
      'the notification attempt',
    );
    assert.equal(attempted.staffNotification.recipients, 0);
    assert.equal(attempted.notifiedStaffAt ?? null, null, 'recorded as notified when nobody was');
  });

  test('an enrolled patient still wakes their own practice, and only it', async () => {
    const salt = await staffedPractice('Salt Lake');
    await staffedPractice('Behala');
    const patient = await makePatient({ name: 'Enrolled Here', practices: [salt.practice] });

    const woken = (await staffFor(patient.user._id, [ROLES.DOCTOR, ROLES.STAFF])).map((u) => String(u._id)).sort();
    assert.deepEqual(woken, [String(salt.doctor.user._id), String(salt.desk.user._id)].sort());
  });
});

describe('V-30: severity is part of de-duplication', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  const warning = (patient) =>
    raiseAlert({
      patientId: patient.user._id,
      severity: 'warning',
      type: 'critical_hyperglycaemia',
      title: 'Glucose rising',
      detail: '260 mg/dL',
      source: { kind: 'glucose' },
    });

  test('an emergency after a same-type warning escalates the alert and pages, instead of vanishing', async () => {
    const salt = await staffedPractice('Salt Lake');
    const patient = await makePatient({ name: 'Rising Sugar', practices: [salt.practice] });

    const first = await warning(patient);
    const second = await raiseAlert({
      patientId: patient.user._id,
      severity: 'emergency',
      type: 'critical_hyperglycaemia',
      title: 'Glucose 520 mg/dL',
      detail: '520 mg/dL with vomiting',
      source: { kind: 'glucose' },
    });

    assert.equal(String(second._id), String(first._id), 'the episode split into two alerts');
    assert.equal(second.severity, 'emergency', 'the emergency was swallowed by the warning');
    assert.deepEqual(
      second.escalations.map((e) => [e.from, e.to, e.previousTitle]),
      [['warning', 'emergency', 'Glucose rising']],
    );
    await until(
      async () => (await ClinicalAlert.findById(first._id).lean())?.staffNotification?.attemptedAt,
      'the escalation to page staff',
    );
    assert.equal(await ClinicalAlert.countDocuments({ patient: patient.user._id }), 1);
  });

  test('a repeat that is no worse is reused, and an emergency is never downgraded', async () => {
    const salt = await staffedPractice('Salt Lake');
    const patient = await makePatient({ name: 'Repeats', practices: [salt.practice] });

    const emergency = await raiseAlert({
      patientId: patient.user._id,
      severity: 'emergency',
      type: 'critical_hyperglycaemia',
      title: 'Glucose 540 mg/dL',
      source: { kind: 'glucose' },
    });
    const later = await warning(patient);

    assert.equal(String(later._id), String(emergency._id));
    assert.equal((await ClinicalAlert.findById(emergency._id).lean()).severity, 'emergency', 'an emergency was downgraded');
    assert.equal(await ClinicalAlert.countDocuments({ patient: patient.user._id }), 1);
  });

  test('five copies of one emergency at the same instant are one alert', async () => {
    await ClinicalAlert.createIndexes();
    const salt = await staffedPractice('Salt Lake');
    const patient = await makePatient({ name: 'Five Taps', practices: [salt.practice] });

    const raised = await Promise.all(
      Array.from({ length: 5 }, () =>
        raiseAlert({
          patientId: patient.user._id,
          severity: 'emergency',
          type: 'severe_hypoglycaemia',
          title: 'Glucose 38 mg/dL',
          source: { kind: 'glucose' },
        }),
      ),
    );

    assert.equal(new Set(raised.map((a) => String(a._id))).size, 1, 'parallel copies were answered with different alerts');
    assert.equal(await ClinicalAlert.countDocuments({ patient: patient.user._id }), 1, 'one emergency paged five times');
  });

  test('an alert raised with no de-duplication window is always its own alert', async () => {
    const salt = await staffedPractice('Salt Lake');
    const patient = await makePatient({ name: 'Two Medicines Stopped', practices: [salt.practice] });
    for (const title of ['Stopped taking Metformin', 'Stopped taking Amlodipine']) {
      await raiseAlert({
        patientId: patient.user._id,
        severity: 'warning',
        type: 'medication_nonadherence',
        title,
        source: { kind: 'adherence' },
        dedupeWindowMinutes: 0,
      });
    }
    assert.equal(await ClinicalAlert.countDocuments({ patient: patient.user._id }), 2);
  });
});

describe('V-31: notified means delivered', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('an attempt that reached no phone is recorded as such, and never as "notified"', async () => {
    const salt = await staffedPractice('Salt Lake');
    const patient = await makePatient({ name: 'Nobody Reached', practices: [salt.practice] });
    const alert = await ClinicalAlert.create({
      patient: patient.user._id,
      severity: 'urgent',
      type: 'abnormal_trend',
      title: 'Blood pressure 190/120',
      source: { kind: 'vital' },
    });

    // No push credentials in tests: every delivery fails to be made.
    await notifyClinicStaff(alert);

    const after = await ClinicalAlert.findById(alert._id).lean();
    assert.equal(after.staffNotification.recipients, 2);
    assert.equal(after.staffNotification.delivered, 0);
    assert.equal(after.notifiedStaffAt ?? null, null, 'stamped as notified with nothing delivered');
  });
});
