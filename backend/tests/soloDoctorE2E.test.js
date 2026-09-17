import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { Appointment } from '../src/models/Appointment.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { Clinic } from '../src/models/Clinic.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Membership } from '../src/models/Membership.js';
import { Prescription } from '../src/models/Prescription.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { User } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { signAccessToken } from '../src/services/tokens.js';
import { inClinicTz, clinicDateTime } from '../src/utils/clinicTime.js';

/**
 * One doctor, no staff, no location — the commonest practice there is.
 *
 * Everything a solo doctor does in a day, in the order they do it: register a
 * patient at their own desk, open the record, take the vitals in the consult,
 * prescribe, give the patient's appointment request a time, move it when the
 * patient cannot come, see them through the waiting room to completed, and
 * answer them in the care thread.
 *
 * Each step already worked for a practice with a receptionist and a building.
 * Two of them did not work without: giving a request a time demanded a
 * location, and so did booking one in person — so a doctor with no location
 * could take requests they could never answer. And the app's "Move to another
 * time" did nothing at all. What this proves is that nothing on the way needs
 * a second person or a location, and that none is quietly created.
 */

const day = (plus) => inClinicTz(new Date()).add(plus, 'day').format('YYYY-MM-DD');
const at = (time, plus) => clinicDateTime(day(plus), time).toDate().toISOString();

let practice;
let doctor;

describe('a solo doctor’s day, with no staff and no location', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Dr Mitra’s Clinic', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.ESSENTIAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Mitra', isOwner: true });
  });

  test('register → view → consult → prescribe → give a time → move it → complete → answer', async () => {
    const dr = as(doctor.token);

    // Register, at the doctor's own desk.
    const registered = await dr.post('/doctor/patients', {
      name: 'Anita Ghosh',
      phone: `+9198${String(Date.now()).slice(-8)}`,
      age: 58,
      gender: 'female',
      complaints: 'Thirsty all the time',
    });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const patientId = registered.body.id;
    assert.ok(await Enrollment.exists({ patient: patientId, practice: practice._id }), 'not enrolled here');

    // View: the register, and the record itself. (The generated course summary
    // is a paid insight on top of the record, gated by plan rather than by who
    // or where — the record stays readable on every plan.)
    const list = await dr.get('/doctor/patients');
    assert.equal(list.status, 200);
    assert.ok(list.body.items.some((p) => String(p.id ?? p._id) === String(patientId)), 'not on the register');
    const record = await dr.get(`/patients/${patientId}/dashboard`);
    assert.equal(record.status, 200, JSON.stringify(record.body));

    // Consult: the vitals taken in the room.
    const vitals = await dr.post(`/doctor/patients/${patientId}/vitals`, {
      systolic: 146,
      diastolic: 92,
      pulse: 84,
      weightKg: 71,
      glucoseMgDl: 212,
      complaint: 'Thirst, tired in the afternoons',
    });
    assert.equal(vitals.status, 201, JSON.stringify(vitals.body));
    assert.equal(await VitalRecord.countDocuments({ patient: patientId }), 1);

    // Prescribe.
    const rx = await dr.post(`/patients/${patientId}/prescriptions`, {
      items: [{ name: 'Metformin', strength: '500mg', frequency: '1-0-1', durationDays: 30 }],
    });
    assert.equal(rx.status, 201, JSON.stringify(rx.body));
    assert.equal(await Prescription.countDocuments({ patient: patientId }), 1);

    // The patient asks for a follow-up from their own phone.
    const patient = await User.findById(patientId);
    const asked = await as(signAccessToken(patient)).post('/appointments/request', {
      preferredFor: day(3),
      reason: 'Review of sugars',
    });
    assert.equal(asked.status, 201, JSON.stringify(asked.body));

    // The doctor gives it a time — with no location to name.
    const confirmed = await dr.patch(`/appointments/${asked.body.appointment.id}/confirm`, {
      scheduledFor: at('10:30', 3),
    });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.appointment.status, 'confirmed');

    // The patient cannot come; the doctor moves it.
    const moved = await dr.patch(`/appointments/${asked.body.appointment.id}/reschedule`, {
      scheduledFor: at('17:00', 4),
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.appointment.status, 'confirmed', 'the move turned the booking back into a request');
    const visitId = moved.body.appointment.id;

    // Through the waiting room to done.
    const checkedIn = await dr.post(`/appointments/${visitId}/check-in`, {});
    assert.equal(checkedIn.status, 200, JSON.stringify(checkedIn.body));
    const inRoom = await dr.patch(`/appointments/${visitId}/status`, { status: 'in_consultation' });
    assert.equal(inRoom.status, 200);
    const completed = await dr.patch(`/appointments/${visitId}/status`, {
      status: 'completed',
      consultationNotes: 'Sugars high. Metformin started; review in a month.',
    });
    assert.equal(completed.status, 200);
    assert.equal((await Appointment.findById(visitId).lean()).status, 'completed');

    // And answer them.
    const reply = await dr.post(`/chat/patients/${patientId}/clinician-message`, {
      content: 'Your reports look better. Keep taking the metformin after food.',
    });
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    assert.equal(
      await ChatMessage.countDocuments({ patient: patientId, role: 'clinician', content: /metformin after food/ }),
      1,
    );

    // Nobody else was needed, and nothing was set up behind their back.
    assert.equal(await Membership.countDocuments({ practice: practice._id }), 1, 'a second person was needed');
    assert.equal(await Clinic.countDocuments({}), 0, 'a location was created on the way');
  });

  test('the doctor books a visit in person directly, and moves it, with no location', async () => {
    const dr = as(doctor.token);
    const registered = await dr.post('/doctor/patients', {
      name: 'Bikash Pal',
      phone: `+9197${String(Date.now()).slice(-8)}`,
    });
    assert.equal(registered.status, 201);

    const booked = await dr.post('/appointments', {
      patientId: registered.body.id,
      scheduledFor: at('11:00', 1),
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(String(booked.body.appointment.doctorId), String(doctor.user._id));

    const moved = await dr.patch(`/appointments/${booked.body.appointment.id}/reschedule`, {
      scheduledFor: at('12:00', 1),
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));

    const diary = await dr.get('/appointments');
    const live = diary.body.items.filter((a) => a.status === 'confirmed');
    assert.equal(live.length, 1);
    assert.equal(new Date(live[0].scheduledFor).toISOString(), at('12:00', 1));
  });
});
