import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { Clinic } from '../src/models/Clinic.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * One patient, two clinics, and the request each of them is holding.
 *
 * ---- What this is about --------------------------------------------------
 *
 * An open appointment request was found by patient and status alone:
 *
 *     Appointment.findOne({ patient: patientId, status: 'requested' })
 *
 * with no practice and no doctor. A patient enrolled at two practices who
 * asked the second one for an appointment therefore rewrote the row sitting in
 * the first one's diary — the same row, re-dated. `doctor` was never
 * reassigned, so it stayed in the first practice's list: the second clinic
 * never saw the request at all, and the first saw a day and a time the patient
 * had asked somebody else for. The patient was told it had been received.
 *
 * The same-day check had the same shape, and returned the other practice's
 * appointment time in its error.
 *
 * ---- Why it looked right -------------------------------------------------
 *
 * "One open request at a time" is a true rule about a clinic: somebody asking
 * twice is one person wanting one appointment, and the desk should see one
 * line. It is not a true rule about a person, who may legitimately be asking a
 * diabetologist and a cardiologist in the same week.
 */

let a;
let b;
/** One patient, enrolled at both. */
let shared;

async function twoPractices() {
  const mk = async (name) => {
    const practice = await makePractice(name, {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
    const desk = await makeMember(practice, { name: `${name} Desk`, role: ROLES.STAFF });

    /*
     * A building that is open all week. The hours are not what is being tested
     * — a confirm has to land on a real slot before it reaches the check that
     * is, so they are wide enough never to be the reason a test fails.
     */
    const clinic = await Clinic.create({
      name: `${name} Clinic`,
      practice: practice._id,
      doctor: doctor.user._id,
      slotMinutes: 30,
      isActive: true,
      weeklyHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({
        dayOfWeek,
        start: '00:00',
        end: '23:30',
      })),
    });

    return { practice, doctor, desk, clinic };
  };

  a = await mk('Salt Lake');
  b = await mk('Behala');

  shared = await makePatient({
    name: 'Rahul Bose',
    practices: [a.practice, b.practice],
  });

  // The patient is under Salt Lake's doctor, which is what the request path
  // reads when a patient asks without naming anybody.
  await PatientProfile.create({
    user: shared.user._id,
    assignedDoctor: a.doctor.user._id,
  });
}

/** Tomorrow, so no request is refused for being in the past. */
const day = (plus = 1) => {
  const d = new Date();
  d.setDate(d.getDate() + plus);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

describe('two practices asked by one patient', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('the second practice gets its own request, and the first keeps hers', async () => {
    const first = await as(a.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(1),
      preferredTime: '10:30',
      reason: 'Sugar running high since Monday',
    });
    assert.equal(first.status, 201);

    const second = await as(b.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(3),
      preferredTime: '17:00',
      reason: 'Chest tightness on the stairs',
    });
    assert.equal(second.status, 201, 'the second practice could not take a request');

    const open = await Appointment.find({
      patient: shared.user._id,
      status: 'requested',
    }).lean();
    assert.equal(open.length, 2, 'one practice’s request overwrote the other’s');

    // Each sits with the practice that took it.
    const byDoctor = Object.fromEntries(open.map((r) => [String(r.doctor), r]));
    assert.ok(byDoctor[String(a.doctor.user._id)], 'Salt Lake’s request is gone');
    assert.ok(byDoctor[String(b.doctor.user._id)], 'Behala’s request went to the wrong doctor');

    // And the first one still says what she asked for, not what she asked the
    // other clinic for.
    assert.equal(byDoctor[String(a.doctor.user._id)].preferredTime, '10:30');
    assert.match(byDoctor[String(a.doctor.user._id)].reason, /Sugar running high/);
  });

  test('each desk sees only its own', async () => {
    await as(a.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(1),
      preferredTime: '10:30',
    });
    await as(b.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(3),
      preferredTime: '17:00',
    });

    const mine = await as(b.desk.token).get('/appointments?status=requested');
    assert.equal(mine.status, 200);
    const times = mine.body.items.map((i) => i.preferredTime);
    assert.deepEqual(times, ['17:00'], 'a desk was shown another practice’s request');
  });

  test('asking the same practice twice still updates the one request', async () => {
    /*
     * The half that has to keep working. Somebody asking again because nobody
     * has answered is one person wanting one appointment, and the desk should
     * see one line — within that practice.
     */
    const first = await as(a.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(1),
      preferredTime: '10:30',
    });
    assert.equal(first.status, 201);

    const again = await as(a.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(2),
      preferredTime: '11:15',
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.updated, true);

    const open = await Appointment.find({ patient: shared.user._id, status: 'requested' }).lean();
    assert.equal(open.length, 1);
    assert.equal(open[0].preferredTime, '11:15');
  });

  test('a patient asking without naming anybody asks the practice they are under', async () => {
    const res = await as(shared.token).post('/appointments/request', {
      preferredFor: day(1),
      preferredTime: '09:30',
    });
    assert.equal(res.status, 201);

    const open = await Appointment.find({ patient: shared.user._id, status: 'requested' }).lean();
    assert.equal(open.length, 1);
    assert.equal(
      String(open[0].doctor),
      String(a.doctor.user._id),
      'the request did not go to the doctor the patient is under',
    );
  });

  test('a same-day appointment at the other practice is not this practice’s business', async () => {
    /*
     * The desk was refused with `SAME_DAY_APPOINTMENT` and handed the ISO
     * timestamp of the other practice's appointment — a refusal that both
     * blocks legitimate work and discloses it. Two practices seeing one
     * patient on one day is normal; only a clash inside a practice is worth a
     * warning.
     */
    const at = new Date();
    at.setDate(at.getDate() + 1);
    at.setHours(11, 0, 0, 0);

    await Appointment.create({
      patient: shared.user._id,
      doctor: a.doctor.user._id,
      scheduledFor: at,
      status: 'confirmed',
      mode: 'teleconsult',
    });

    const request = await as(b.desk.token).post('/appointments/request', {
      patientId: String(shared.user._id),
      preferredFor: day(1),
    });
    assert.equal(request.status, 201);

    const later = new Date(at);
    later.setHours(18, 0, 0, 0);
    const confirmed = await as(b.desk.token).patch(
      `/appointments/${request.body.appointment.id}/confirm`,
      { clinicId: String(b.clinic._id), scheduledFor: later.toISOString() },
    );

    assert.equal(
      confirmed.status,
      200,
      'the other practice’s appointment blocked this one',
    );
    assert.ok(
      !JSON.stringify(confirmed.body).includes(at.toISOString()),
      'the other practice’s appointment time was disclosed',
    );
  });
});

describe('two taps in the same instant', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    /*
     * Mongoose builds a model's indexes once per process, against whichever
     * database was connected at the time. This suite boots a second one, so
     * the index has to be created here — the server builds it at startup
     * against a database that persists, which is the case being rehearsed.
     */
    await Appointment.createIndexes();
    await twoPractices();
  });

  test('make one request, not two', async () => {
    /*
     * The lookup that finds an existing request and the write that creates one
     * are a read followed by a write. Two requests a few milliseconds apart
     * both read "nothing there", and the desk was shown one person listed
     * twice wanting two appointments. The unique index is what stops the
     * second row; the route turns its refusal into the answer the second tap
     * was asking for.
     */
    const body = {
      patientId: String(shared.user._id),
      preferredFor: day(1),
      preferredTime: '10:30',
    };

    const [one, two] = await Promise.all([
      as(a.desk.token).post('/appointments/request', body),
      as(a.desk.token).post('/appointments/request', body),
    ]);

    assert.ok([200, 201].includes(one.status), `first tap answered ${one.status}`);
    assert.ok([200, 201].includes(two.status), `second tap answered ${two.status}`);

    const open = await Appointment.find({
      patient: shared.user._id,
      status: 'requested',
    }).lean();
    assert.equal(open.length, 1, 'one patient, one practice, two open requests');

    // And both taps were told about the same one.
    assert.equal(one.body.appointment.id, two.body.appointment.id);
  });
});
