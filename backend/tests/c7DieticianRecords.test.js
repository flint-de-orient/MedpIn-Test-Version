import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Enrollment, ENROLLMENT_STATUS, DIETICIAN_SOURCE } from '../src/models/Enrollment.js';
import { Prescription } from '../src/models/Prescription.js';
import { LabResult } from '../src/models/LabResult.js';
import { FoodLog } from '../src/models/FoodLog.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { DietPlan } from '../src/models/DietPlan.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * A patient two practices care for, now that each practice's dietician can
 * hold them at the same time.
 *
 * While the assignment was one field on the profile, only one practice's
 * dietician could hold a shared patient, and that hid two things the dietician
 * routes had never asked: from when may this practice read the record, and
 * whose diet plan is this. With per-practice assignment both dieticians reach
 * the patient legitimately, so both questions are answered here the way the
 * rest of the platform answers them:
 *
 *   - a dietician reads no more of the record than their practice may — every
 *     dated row from the day the practice was given access (`recordWindow`),
 *     the medicine list excepted, as on the doctor's own screens;
 *   - a diet plan is the practice's that wrote it. `DietPlan` is still one
 *     document per patient, so the other practice's dietician is not shown it
 *     and is refused, by name, rather than silently overwriting it.
 */

const MAY = new Date('2026-05-01T09:00:00Z');
const JUNE = new Date('2026-06-01T09:00:00Z');

let w;

/** Written through the driver: the timestamps plugin will not backdate createdAt. */
async function backdate(Model, doc, at) {
  await Model.collection.updateOne({ _id: doc._id }, { $set: { createdAt: at, updatedAt: at } });
}

async function world() {
  const side = async (name) => {
    const practice = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    return {
      practice,
      doctor: await makeMember(practice, { name: `Dr ${name}`, isOwner: true }),
      dietician: await makeMember(practice, { name: `${name} Dietician`, role: ROLES.DIETICIAN }),
    };
  };
  const a = await side('Salt Lake');
  const b = await side('Behala');

  const patient = await makePatient({ name: 'Shared Patient' });
  const pid = patient.user._id;
  await PatientProfile.create({ user: pid });
  // Salt Lake since May; Behala since an hour ago. Each holds the patient with
  // its own dietician.
  a.enrollment = await Enrollment.create({
    patient: pid,
    practice: a.practice._id,
    status: ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: MAY,
    dietician: a.dietician.user._id,
    dieticianSource: DIETICIAN_SOURCE.DOCTOR,
  });
  b.enrollment = await Enrollment.create({
    patient: pid,
    practice: b.practice._id,
    status: ENROLLMENT_STATUS.ACTIVE,
    enrolledOn: new Date(Date.now() - 60 * 60 * 1000),
    dietician: b.dietician.user._id,
    dieticianSource: DIETICIAN_SOURCE.DOCTOR,
  });

  // June, at Salt Lake — before Behala had any access.
  await Prescription.create({
    patient: pid,
    doctor: a.doctor.user._id,
    referenceNo: `SL-${Date.now()}`,
    issuedOn: JUNE,
    diagnosis: ['Salt Lake diagnosis: type 2 diabetes'],
    generalAdvice: 'Salt Lake advice: walk daily',
  });
  const juneLab = await LabResult.create({ patient: pid, testName: 'Salt Lake lipid profile' });
  await backdate(LabResult, juneLab, JUNE);
  const juneMeal = await FoodLog.create({ patient: pid, mealType: 'lunch', note: 'June lunch at Salt Lake' });
  await backdate(FoodLog, juneMeal, JUNE);
  await GlucoseReading.create({ patient: pid, valueMgDl: 311, measuredAt: JUNE, context: 'fasting' });
  await VitalRecord.create({ patient: pid, recordedAt: JUNE, weightKg: 91 });

  // Today, at Behala.
  await Prescription.create({
    patient: pid,
    doctor: b.doctor.user._id,
    referenceNo: `BH-${Date.now()}`,
    issuedOn: new Date(),
    diagnosis: ['Behala diagnosis: hypertension'],
    generalAdvice: 'Behala advice: less salt',
  });
  const todayMeal = await FoodLog.create({ patient: pid, mealType: 'dinner', note: 'Dinner this week' });

  return { a, b, pid, juneMeal, todayMeal };
}

function lifecycle() {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await world();
  });
}

describe('a dietician reads the shared patient’s record from their own practice’s enrolment', () => {
  lifecycle();

  test('the overview holds this practice’s window and nothing from before it', async () => {
    const behala = await as(w.b.dietician.token).get(`/dietician/patients/${w.pid}/overview`);
    assert.equal(behala.status, 200, JSON.stringify(behala.body));
    const text = allText(behala.body);
    assert.ok(text.includes('Behala advice: less salt'), 'Behala’s own advice is missing');
    assert.ok(!text.includes('Salt Lake advice'), 'Behala’s dietician read Salt Lake’s June prescription');
    assert.ok(!text.includes('Salt Lake lipid profile'), 'Behala’s dietician read a June lab report');
    assert.equal(behala.body.vitals.glucose, null, 'a June glucose reading was shown to Behala');
    assert.equal(behala.body.vitals.weightKg, null, 'a June weight was shown to Behala');

    const saltLake = await as(w.a.dietician.token).get(`/dietician/patients/${w.pid}/overview`);
    assert.equal(saltLake.status, 200);
    const theirs = allText(saltLake.body);
    assert.ok(theirs.includes('Salt Lake advice: walk daily'), 'Salt Lake lost its own record');
    assert.ok(theirs.includes('Salt Lake lipid profile'));
    assert.equal(saltLake.body.vitals.glucose.valueMgDl, 311);
  });

  test('the food log, and what can be marked read in it, start at the enrolment too', async () => {
    const list = await as(w.b.dietician.token).get(`/dietician/patients/${w.pid}/food-log`);
    assert.equal(list.status, 200);
    const notes = list.body.items.map((i) => i.note);
    assert.deepEqual(notes, ['Dinner this week']);

    const old = await as(w.b.dietician.token).post(`/dietician/patients/${w.pid}/food-log/${w.juneMeal._id}/review`, {});
    assert.equal(old.status, 404, 'Behala marked a meal from before its access as read');

    const all = await as(w.b.dietician.token).post(`/dietician/patients/${w.pid}/food-log/review-all`, {});
    assert.equal(all.status, 200);
    assert.equal(all.body.reviewed, 1);
    assert.equal((await FoodLog.findById(w.juneMeal._id).lean()).reviewedAt ?? null, null);
  });

  test('a meal review with a malformed body is refused as a bad request, and changes nothing', async () => {
    // Its schema was passed to `validate` bare, so nothing was checked at all.
    const res = await as(w.b.dietician.token).post(`/dietician/patients/${w.pid}/food-log/${w.todayMeal._id}/review`, {
      note: { not: 'a string' },
    });
    assert.equal(res.status, 400, `answered ${res.status}`);
    assert.equal((await FoodLog.findById(w.todayMeal._id).lean()).reviewedAt ?? null, null);
  });

  test('and so does the dashboard’s list of recent meals', async () => {
    const res = await as(w.b.dietician.token).get('/dietician/dashboard');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const notes = res.body.recentLogs.map((l) => l.note);
    assert.ok(notes.includes('Dinner this week'));
    assert.ok(!notes.includes('June lunch at Salt Lake'), 'the dashboard showed a meal from before Behala’s access');
  });

  test('a new patient’s older meals do not push another patient’s off that list', async () => {
    /*
     * The list is the latest twelve. Windowing what came back, rather than the
     * query, let a dozen meals from before Behala's access fill the twelve and
     * then be thrown away — and a patient Behala has held for a month vanished
     * from the list with them.
     */
    const HOUR = 60 * 60 * 1000;
    const regular = await makePatient({ name: 'Behala Regular', practices: [w.b.practice] });
    await PatientProfile.create({ user: regular.user._id });
    await Enrollment.updateOne(
      { patient: regular.patient._id, practice: w.b.practice._id },
      {
        $set: {
          enrolledOn: new Date(Date.now() - 30 * 24 * HOUR),
          dietician: w.b.dietician.user._id,
          dieticianSource: DIETICIAN_SOURCE.DOCTOR,
        },
      },
    );
    const breakfast = await FoodLog.create({ patient: regular.user._id, mealType: 'breakfast', note: 'Regular breakfast' });
    await backdate(FoodLog, breakfast, new Date(Date.now() - 72 * HOUR));
    for (let i = 0; i < 12; i += 1) {
      const snack = await FoodLog.create({ patient: w.pid, mealType: 'snack', note: `Before Behala ${i}` });
      await backdate(FoodLog, snack, new Date(Date.now() - (2 + i) * HOUR));
    }

    const res = await as(w.b.dietician.token).get('/dietician/dashboard');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const notes = res.body.recentLogs.map((l) => l.note);
    assert.ok(notes.includes('Regular breakfast'), 'another patient’s meal was pushed off the list');
    assert.ok(!notes.some((n) => n.startsWith('Before Behala')), 'a meal from before Behala’s access was shown');
  });
});

describe('a diet plan is the practice’s that wrote it', () => {
  lifecycle();

  const plan = (goal) => ({
    goal,
    meals: [{ name: 'Breakfast', items: ['Two rotis'] }],
    avoid: ['Sugar'],
    notes: '',
  });

  test('the other practice’s dietician is not shown it, and cannot write over it', async () => {
    const written = await as(w.a.dietician.token).put(`/dietician/patients/${w.pid}/diet`, plan('Salt Lake goal'));
    assert.equal(written.status, 200, JSON.stringify(written.body));
    assert.equal((await as(w.a.dietician.token).post(`/dietician/patients/${w.pid}/diet/send`)).status, 201);

    const read = await as(w.b.dietician.token).get(`/dietician/patients/${w.pid}/diet`);
    assert.equal(read.status, 200);
    assert.equal(read.body.plan, null, 'Behala’s dietician was shown Salt Lake’s plan');

    const overwrite = await as(w.b.dietician.token).put(`/dietician/patients/${w.pid}/diet`, plan('Behala goal'));
    assert.equal(overwrite.status, 409, `answered ${overwrite.status}`);
    assert.equal(overwrite.body.error.code, 'PLAN_HELD_ELSEWHERE');

    for (const path of ['diet/new', 'diet/send']) {
      const res = await as(w.b.dietician.token).post(`/dietician/patients/${w.pid}/${path}`);
      assert.equal(res.status, 409, `${path} answered ${res.status}`);
    }

    const stored = await DietPlan.findOne({ patient: w.pid }).lean();
    assert.equal(stored.goal, 'Salt Lake goal', 'Salt Lake’s plan was changed by Behala');
    assert.equal(String(stored.dietician), String(w.a.dietician.user._id));
    assert.ok(stored.sharedAt, 'Salt Lake’s sent plan was archived by Behala');

    // The practice that wrote it carries on.
    const again = await as(w.a.dietician.token).put(`/dietician/patients/${w.pid}/diet`, plan('Salt Lake, revised'));
    assert.equal(again.status, 200);
  });

  test('a plan from before memberships belongs to the practice the patient had then', async () => {
    /*
     * A dietician who left before memberships existed has no membership row at
     * all, so their plans name nobody's colleague. They were written at the
     * patient's first practice — Salt Lake, since May — and the founding
     * clinic's dietician must not be locked out of their predecessor's plans.
     */
    const predecessor = await User.create({ name: 'Former Dietician', phone: '+919811100001', role: ROLES.DIETICIAN, isActive: false });
    await DietPlan.create({ patient: w.pid, dietician: predecessor._id, goal: 'Before memberships', sharedAt: JUNE });

    const saltLake = await as(w.a.dietician.token).get(`/dietician/patients/${w.pid}/diet`);
    assert.equal(saltLake.body.plan?.goal, 'Before memberships', 'the first practice lost its old plan');
    const behala = await as(w.b.dietician.token).get(`/dietician/patients/${w.pid}/diet`);
    assert.equal(behala.body.plan, null, 'a later practice was shown the old plan');

    assert.equal((await as(w.b.dietician.token).put(`/dietician/patients/${w.pid}/diet`, plan('Behala goal'))).status, 409);
    assert.equal((await as(w.a.dietician.token).put(`/dietician/patients/${w.pid}/diet`, plan('Salt Lake takes over'))).status, 200);
  });

  test('two saves from the same practice at once are one plan, not a refusal', async () => {
    await DietPlan.createIndexes();
    const url = `/dietician/patients/${w.pid}/diet`;
    const [one, two] = await Promise.all([
      as(w.a.dietician.token).put(url, plan('First')),
      as(w.a.dietician.token).put(url, plan('Second')),
    ]);
    assert.deepEqual([one.status, two.status], [200, 200], `${JSON.stringify(one.body)} ${JSON.stringify(two.body)}`);
    assert.equal(await DietPlan.countDocuments({ patient: w.pid }), 1);
  });
});
