import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { Clinic } from '../src/models/Clinic.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { User, ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { signAccessToken } from '../src/services/tokens.js';
import { inClinicTz, clinicDateTime } from '../src/utils/clinicTime.js';

/**
 * Practice + location + role + permission.
 *
 * A membership said who works at a practice and what they may do there, and
 * nothing about where. A receptionist hired for Clinic A could rename Clinic B,
 * close it, and book, move, cancel and check in its patients. `Membership.
 * locations` narrows a person to particular locations; empty — every row that
 * existed before it — is all of them, and the owner is never narrowed.
 *
 * Every refusal here is followed by a look at the database. A 403 that still
 * wrote is the failure that matters, and a status code cannot see it.
 */

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, start: '09:00', end: '21:00' }));
const tomorrow = () => inClinicTz(new Date()).add(1, 'day').format('YYYY-MM-DD');
const at = (time) => clinicDateTime(tomorrow(), time).toDate();

let w;

const narrow = (member, clinics) =>
  Membership.updateOne({ _id: member.membership._id }, { locations: clinics.map((c) => c._id) });

async function setUp() {
  const practice = await makePractice('Salt Lake Group', {
    practiceType: PRACTICE_TYPE.POLYCLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  const head = await makeMember(practice, { name: 'Dr Head', isOwner: true });
  const drTwo = await makeMember(practice, { name: 'Dr Two' });
  const deskA = await makeMember(practice, { name: 'Clinic A Desk', role: ROLES.STAFF });
  const deskB = await makeMember(practice, { name: 'Clinic B Desk', role: ROLES.STAFF });
  const managerA = await makeMember(practice, { name: 'Clinic A Manager', role: ROLES.PRACTICE_MANAGER });

  const clinicA = await Clinic.create({
    name: 'Clinic A',
    practice: practice._id,
    doctor: head.user._id,
    slotMinutes: 30,
    weeklyHours: EVERY_DAY,
  });
  const clinicB = await Clinic.create({
    name: 'Clinic B',
    practice: practice._id,
    doctor: head.user._id,
    slotMinutes: 30,
    weeklyHours: EVERY_DAY,
  });

  await narrow(deskA, [clinicA]);
  await narrow(managerA, [clinicA]);

  const patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
  await PatientProfile.create({ user: patient.user._id, assignedDoctor: head.user._id });

  const booked = (clinic, time, extra = {}) =>
    Appointment.create({
      patient: patient.user._id,
      doctor: head.user._id,
      practice: practice._id,
      clinic: clinic?._id,
      scheduledFor: at(time),
      status: 'confirmed',
      ...extra,
    });

  return {
    practice,
    head,
    drTwo,
    deskA,
    deskB,
    managerA,
    clinicA,
    clinicB,
    patient,
    apptA: await booked(clinicA, '10:00'),
    apptB: await booked(clinicB, '11:00'),
    remote: await booked(null, '12:00', { mode: 'teleconsult' }),
    request: await Appointment.create({
      patient: patient.user._id,
      doctor: head.user._id,
      practice: practice._id,
      status: 'requested',
      preferredFor: clinicDateTime(tomorrow(), '00:00').toDate(),
    }),
  };
}

const refusedAsNotManaged = (res, what) => {
  assert.equal(res.status, 403, `${what}: answered ${res.status} ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error.code, 'LOCATION_NOT_MANAGED', what);
};

const lean = (Model, id) => Model.findById(id).lean();

describe('staff narrowed to Clinic A do not run Clinic B', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await setUp();
  });

  test('they cannot edit, close or add a location outside their own', async () => {
    const desk = as(w.deskA.token);

    refusedAsNotManaged(await desk.patch(`/clinics/${w.clinicB._id}`, { name: 'Renamed B' }), 'edit B');
    assert.equal((await lean(Clinic, w.clinicB._id)).name, 'Clinic B');

    refusedAsNotManaged(await desk.del(`/clinics/${w.clinicB._id}`), 'close B');
    assert.equal((await lean(Clinic, w.clinicB._id)).isActive, true);

    refusedAsNotManaged(await desk.post('/clinics', { name: 'Clinic C' }), 'add a location');
    assert.equal(await Clinic.countDocuments({ practice: w.practice._id }), 2);

    // Their own is theirs to edit.
    const own = await desk.patch(`/clinics/${w.clinicA._id}`, { phone: '+913312345678' });
    assert.equal(own.status, 200);
  });

  test('they cannot book, confirm, move, cancel, check in or advance Clinic B’s appointments', async () => {
    const desk = as(w.deskA.token);
    const before = await Appointment.countDocuments({});

    refusedAsNotManaged(
      await desk.post('/appointments', {
        patientId: String(w.patient.user._id),
        clinicId: String(w.clinicB._id),
        scheduledFor: at('15:00').toISOString(),
      }),
      'book at B',
    );
    assert.equal(await Appointment.countDocuments({}), before);

    refusedAsNotManaged(
      await desk.patch(`/appointments/${w.request._id}/confirm`, {
        clinicId: String(w.clinicB._id),
        scheduledFor: at('15:00').toISOString(),
      }),
      'confirm into B',
    );
    assert.equal((await lean(Appointment, w.request._id)).status, 'requested');

    refusedAsNotManaged(
      await desk.patch(`/appointments/${w.apptB._id}/reschedule`, { scheduledFor: at('16:00').toISOString() }),
      'move within B',
    );
    refusedAsNotManaged(
      await desk.patch(`/appointments/${w.apptA._id}/reschedule`, {
        scheduledFor: at('16:00').toISOString(),
        clinicId: String(w.clinicB._id),
      }),
      'move from A into B',
    );
    refusedAsNotManaged(await desk.patch(`/appointments/${w.apptB._id}/cancel`, {}), 'cancel at B');
    refusedAsNotManaged(await desk.post(`/appointments/${w.apptB._id}/check-in`, {}), 'check in at B');
    refusedAsNotManaged(
      await desk.patch(`/appointments/${w.apptB._id}/status`, { status: 'in_consultation' }),
      'advance at B',
    );

    for (const id of [w.apptA._id, w.apptB._id]) {
      const row = await lean(Appointment, id);
      assert.equal(row.status, 'confirmed', `a refused action changed ${id}`);
      assert.equal(row.queueNumber ?? null, null);
    }
    assert.equal(await Appointment.countDocuments({}), before, 'a refused action wrote a row');
  });

  test('and they do all of it at Clinic A', async () => {
    const desk = as(w.deskA.token);

    const booked = await desk.post('/appointments', {
      patientId: String(w.patient.user._id),
      clinicId: String(w.clinicA._id),
      scheduledFor: at('15:00').toISOString(),
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    const confirmed = await desk.patch(`/appointments/${w.request._id}/confirm`, {
      clinicId: String(w.clinicA._id),
      scheduledFor: at('16:00').toISOString(),
      allowSameDay: true,
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));

    assert.equal((await desk.post(`/appointments/${w.apptA._id}/check-in`, {})).status, 200);
    const moved = await desk.patch(`/appointments/${booked.body.appointment.id}/reschedule`, {
      scheduledFor: at('17:00').toISOString(),
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal((await desk.patch(`/appointments/${moved.body.appointment.id}/cancel`, {})).status, 200);
  });

  test('their diary and waiting room hold Clinic A and the practice’s unplaced work, not Clinic B', async () => {
    const desk = as(w.deskA.token);

    const diary = await desk.get('/appointments');
    const ids = diary.body.items.map((a) => a.id).sort();
    assert.deepEqual(
      ids,
      [w.apptA, w.remote, w.request].map((a) => String(a._id)).sort(),
      'the diary held another location’s appointments, or dropped the practice’s unplaced ones',
    );
    assert.equal(diary.body.total, 3);

    const asked = await desk.get(`/appointments?clinicId=${w.clinicB._id}`);
    assert.equal(asked.body.items.length, 0, 'naming Clinic B opened its day');

    // Both rooms have somebody in them; the desk sees its own.
    const head = as(w.head.token);
    assert.equal((await head.post(`/appointments/${w.apptA._id}/check-in`, {})).status, 200);
    const other = await makePatient({ name: 'Mira Das', practices: [w.practice] });
    const atB = await Appointment.create({
      patient: other.user._id,
      doctor: w.drTwo.user._id,
      practice: w.practice._id,
      clinic: w.clinicB._id,
      scheduledFor: at('11:00'),
      status: 'confirmed',
    });
    assert.equal((await head.post(`/appointments/${atB._id}/check-in`, {})).status, 200);

    const room = await desk.get('/appointments/queue/today');
    assert.deepEqual(room.body.entries.map((e) => e.patientName), ['Rahul Bose']);
    refusedAsNotManaged(await desk.get(`/appointments/queue/today?clinicId=${w.clinicB._id}`), 'open B’s room');

    // The head sees both rooms, and either one by name.
    const all = await head.get('/appointments/queue/today');
    assert.equal(all.body.entries.length, 2);
    const onlyB = await head.get(`/appointments/queue/today?clinicId=${w.clinicB._id}`);
    assert.deepEqual(onlyB.body.entries.map((e) => e.patientName), ['Mira Das']);
  });

  test('the location list says which ones the reader runs', async () => {
    const mine = await as(w.deskA.token).get('/clinics');
    const byName = Object.fromEntries(mine.body.items.map((c) => [c.name, c.managedByYou]));
    assert.deepEqual(byName, { 'Clinic A': true, 'Clinic B': false });

    const heads = await as(w.head.token).get('/clinics');
    assert.ok(heads.body.items.every((c) => c.managedByYou === true));

    const patients = await as(w.patient.token).get('/clinics');
    assert.ok(patients.body.items.every((c) => !('managedByYou' in c)), 'a patient was told what they manage');
  });

  test('a doctor is not narrowed, and runs Clinic B', async () => {
    const doctor = as(w.drTwo.token);
    assert.equal((await doctor.patch(`/clinics/${w.clinicB._id}`, { phone: '+913300000000' })).status, 200);
    const booked = await doctor.post('/appointments', {
      patientId: String(w.patient.user._id),
      clinicId: String(w.clinicB._id),
      doctorId: String(w.drTwo.user._id),
      scheduledFor: at('15:00').toISOString(),
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal((await doctor.post(`/appointments/${w.apptB._id}/check-in`, {})).status, 200);
  });

  test('unless their membership says so', async () => {
    await narrow(w.drTwo, [w.clinicA]);
    refusedAsNotManaged(
      await as(w.drTwo.token).post('/appointments', {
        patientId: String(w.patient.user._id),
        clinicId: String(w.clinicB._id),
        doctorId: String(w.drTwo.user._id),
        scheduledFor: at('15:00').toISOString(),
      }),
      'a narrowed doctor booked at B',
    );
  });

  test('the owner is never narrowed, whatever the row says', async () => {
    await narrow(w.head, [w.clinicA]);
    assert.equal((await as(w.head.token).patch(`/clinics/${w.clinicB._id}`, { phone: '+913311111111' })).status, 200);
    assert.equal((await as(w.head.token).del(`/clinics/${w.clinicB._id}`)).status, 200);
  });

  test('a membership written before locations existed runs every location', async () => {
    const user = await User.create({ name: 'Old Desk', phone: '+919800000001', role: ROLES.STAFF, isActive: true });
    await Membership.collection.insertOne({
      user: user._id,
      practice: w.practice._id,
      role: ROLES.STAFF,
      isOwner: false,
      permissions: presetFor({ role: ROLES.STAFF }),
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
      startedOn: new Date(),
    });
    const res = await as(signAccessToken(user)).patch(`/clinics/${w.clinicB._id}`, { phone: '+913322222222' });
    assert.equal(res.status, 200, 'a membership with no location list lost access on deploy');
  });

});

describe('who runs which location', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    w = await setUp();
  });

  test('the owner narrows a receptionist to a location, and gives them all of them back', async () => {
    const head = as(w.head.token);

    const narrowed = await head.put(`/clinics/access/${w.deskB.membership._id}`, {
      locationIds: [String(w.clinicB._id)],
    });
    assert.equal(narrowed.status, 200, JSON.stringify(narrowed.body));
    assert.deepEqual(narrowed.body.membership.locations, [String(w.clinicB._id)]);
    refusedAsNotManaged(await as(w.deskB.token).patch(`/clinics/${w.clinicA._id}`, { phone: '+91330' }), 'B desk edits A');

    const list = await as(w.deskB.token).get('/clinics/access');
    const row = list.body.items.find((r) => r.membershipId === String(w.deskB.membership._id));
    assert.deepEqual([row.everyLocation, row.locations], [false, [String(w.clinicB._id)]]);
    const owner = list.body.items.find((r) => r.isOwner);
    assert.equal(owner.everyLocation, true);

    const restored = await head.put(`/clinics/access/${w.deskB.membership._id}`, { locationIds: [] });
    assert.equal(restored.status, 200);
    assert.equal((await as(w.deskB.token).patch(`/clinics/${w.clinicA._id}`, { phone: '+913344' })).status, 200);
  });

  test('refused to anybody who may not decide it, and nothing changes', async () => {
    const target = `/clinics/access/${w.deskB.membership._id}`;
    const body = { locationIds: [String(w.clinicA._id)] };

    // The desk holds no MANAGE_STAFF.
    assert.equal((await as(w.deskA.token).put(target, body)).status, 403);
    // A manager narrowed to Clinic A holds it, and reaches past Clinic A.
    refusedAsNotManaged(await as(w.managerA.token).put(target, body), 'narrowed manager');
    // A manager who runs everything but neither doctor nor owner — the rule the
    // team routes apply to changing who works here.
    const manager = await makeMember(w.practice, { name: 'Group Manager', role: ROLES.PRACTICE_MANAGER });
    assert.equal((await as(manager.token).put(target, body)).status, 403);

    assert.deepEqual((await lean(Membership, w.deskB.membership._id)).locations ?? [], []);

    // The owner is not narrowed from here.
    const owner = await as(w.head.token).put(`/clinics/access/${w.head.membership._id}`, body);
    assert.equal(owner.status, 400);
    assert.deepEqual((await lean(Membership, w.head.membership._id)).locations ?? [], []);
  });

  test('another practice’s people and locations are not found', async () => {
    const other = await makePractice('Behala', { practiceType: PRACTICE_TYPE.POLYCLINIC, plan: PLAN.PROFESSIONAL });
    const theirDesk = await makeMember(other, { name: 'Behala Desk', role: ROLES.STAFF });
    const theirClinic = await Clinic.create({ name: 'Behala Clinic', practice: other._id, weeklyHours: EVERY_DAY });

    const theirs = await as(w.head.token).put(`/clinics/access/${theirDesk.membership._id}`, {
      locationIds: [String(w.clinicA._id)],
    });
    assert.equal(theirs.status, 404);
    assert.deepEqual((await lean(Membership, theirDesk.membership._id)).locations ?? [], []);

    const theirPlace = await as(w.head.token).put(`/clinics/access/${w.deskB.membership._id}`, {
      locationIds: [String(theirClinic._id)],
    });
    assert.equal(theirPlace.status, 404);
    assert.deepEqual((await lean(Membership, w.deskB.membership._id)).locations ?? [], []);

    const list = await as(w.head.token).get('/clinics/access');
    assert.ok(!list.body.items.some((r) => r.name === 'Behala Desk'), 'another practice’s staff were listed');
  });
});

describe('the rule, on the model', () => {
  test('empty is every location, a list is only those, and the owner is never narrowed', () => {
    const a = '66b1f2a4c9e11a0012345678';
    const b = '66b1f2a4c9e11a0012345679';
    assert.equal(Membership.locationScopeOf({ locations: [] }), null);
    assert.equal(Membership.locationScopeOf({}), null);
    assert.deepEqual(Membership.locationScopeOf({ locations: [a] }), [a]);
    assert.equal(Membership.locationScopeOf({ isOwner: true, locations: [a] }), null);

    const narrowed = new Membership({ role: ROLES.STAFF, locations: [a] });
    assert.equal(narrowed.worksAt(a), true);
    assert.equal(narrowed.worksAt(b), false);
    assert.equal(new Membership({ role: ROLES.STAFF }).worksAt(b), true);
  });
});
