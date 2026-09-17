import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { switchAdminOn, switchAdminBack, makeOperator } from './helpers/adminSession.js';
import { Practice, PRACTICE_TYPE, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { Clinic } from '../src/models/Clinic.js';
import { Membership } from '../src/models/Membership.js';
import { Department } from '../src/models/Department.js';
import { User, ROLES } from '../src/models/User.js';
import { PracticeApplication, APPLICATION_STATUS } from '../src/models/PracticeApplication.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { signPhoneToken } from '../src/services/otp.js';
import { useMessagingForTests } from '../src/config/firebase.js';
import { clinicIdentity, forgetClinicIdentity } from '../src/services/clinicIdentity.js';
import { buildSystemPrompt } from '../src/services/ai/prompts.js';

/**
 * Bringing a practice into existence, from the console and from an approval.
 *
 * ---- The defects ----------------------------------------------------------
 *
 * The console's create stopped at the owner: no location, no hours, no
 * departments, no number for patients to ring and no word to the doctor. A
 * practice made there could not take a booking. Approval made a location but
 * no hours or public phone, and nothing reached the owner's phone.
 *
 * And a number that belonged to a patient was refused as head doctor only after
 * the practice row had been written — then deleted again. A tenant that exists
 * for one request is a tenant something can read in that request.
 *
 * ---- What these pin -------------------------------------------------------
 *
 * Both paths produce the same complete practice through one service; every
 * refusal happens before anything is written; the doctor proves the number
 * with a code and no password is ever set; the owner is told through the push
 * abstraction and email, with nothing actually sent under test.
 */

const PHONE = '+919812345671';
const MAIL = 'medpin:mail';

let operator;
let pushes;
let mail;
const onMail = (m) => mail.push(m);

const HOURS = [
  { dayOfWeek: 1, start: '10:00', end: '14:00' },
  { dayOfWeek: 1, start: '17:00', end: '20:00' },
  { dayOfWeek: 4, start: '10:00', end: '13:00' },
];

const create = (over = {}) =>
  as(operator.token).post('/admin/practices', {
    name: 'Meridian Heart Centre',
    practiceType: PRACTICE_TYPE.SPECIALTY_CENTRE,
    specialty: 'cardiology',
    registrationNo: 'WB-77001',
    headDoctorName: 'Dr. Priya Nair',
    headDoctorPhone: PHONE,
    headDoctorPhoneToken: signPhoneToken(PHONE),
    headDoctorRegistrationNo: 'WBMC-4471',
    headDoctorEmail: 'priya@meridian.example',
    departments: ['cardiology', 'diabetology', 'not-a-real-department'],
    headDoctorDepartment: 'cardiology',
    emergencyPhone: '+91 33 2400 1234',
    location: {
      name: 'Park Street',
      addressLine: '14 Park Street',
      city: 'Kolkata',
      phone: '+91 33 2400 5678',
      slotMinutes: 20,
      weeklyHours: HOURS,
    },
    ...over,
  });

/** Nothing of a practice exists: no row, no location, no membership, no account. */
async function nothingWritten() {
  assert.equal(await Practice.countDocuments({}), 0, 'a practice row was written');
  assert.equal(await Clinic.countDocuments({}), 0, 'a location was written');
  assert.equal(await Membership.countDocuments({}), 0, 'a membership was written');
}

/** Counts every Practice.create for the length of `fn`. The app runs in this process. */
async function countingCreates(fn) {
  const real = Practice.create;
  let calls = 0;
  Practice.create = function counted(...args) {
    calls += 1;
    return real.apply(this, args);
  };
  try {
    await fn();
  } finally {
    Practice.create = real;
  }
  return calls;
}

describe('onboarding a practice', () => {
  before(async () => {
    await boot();
    switchAdminOn();
    subscribe(MAIL, onMail);
  });
  after(async () => {
    unsubscribe(MAIL, onMail);
    useMessagingForTests(null);
    switchAdminBack();
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
    forgetClinicIdentity();
    pushes = [];
    mail = [];
    useMessagingForTests({
      async sendEachForMulticast(message) {
        pushes.push(message);
        return {
          responses: message.tokens.map(() => ({ success: true })),
          successCount: message.tokens.length,
          failureCount: 0,
        };
      },
    });
    operator = await makeOperator();
    await Department.create([
      { practice: null, key: 'cardiology', names: { en: 'Cardiology' }, isActive: true },
      { practice: null, key: 'diabetology', names: { en: 'Diabetology' }, isActive: true },
    ]);
  });

  describe('from the console', () => {
    test('makes the whole practice: owner, departments, number, location with phone and hours', async () => {
      const res = await create();
      assert.equal(res.status, 201, JSON.stringify(res.body));

      const practice = await Practice.findById(res.body.practice.id).lean();
      assert.equal(practice.status, PRACTICE_STATUS.ONBOARDING);
      assert.equal(practice.verification, VERIFICATION.UNVERIFIED);
      assert.equal(practice.emergencyPhone, '+913324001234');
      assert.ok(practice.headDoctor, 'no head doctor on the practice');

      const location = await Clinic.findOne({ practice: practice._id }).lean();
      assert.ok(location, 'no location — the practice cannot take a booking');
      assert.equal(location.name, 'Park Street');
      assert.equal(location.phone, '+913324005678');
      assert.equal(location.slotMinutes, 20);
      assert.deepEqual(
        location.weeklyHours.map((w) => ({ dayOfWeek: w.dayOfWeek, start: w.start, end: w.end })),
        HOURS,
      );
      assert.equal(String(location.doctor), String(practice.headDoctor));

      const departments = await Department.find({ practice: practice._id }).lean();
      assert.deepEqual(departments.map((d) => d.key).sort(), ['cardiology', 'diabetology']);

      const owner = await Membership.findOne({ practice: practice._id, isOwner: true }).lean();
      const cardiology = departments.find((d) => d.key === 'cardiology');
      assert.equal(String(owner.department), String(cardiology._id));

      assert.equal(res.body.outcome.locationCreated, true);
      assert.deepEqual(res.body.outcome.departments.sort(), ['cardiology', 'diabetology']);
      assert.equal(res.body.outcome.headDoctorDepartment, 'cardiology');
    });

    test('a clinic gets no departments, whatever was sent', async () => {
      const res = await create({ practiceType: PRACTICE_TYPE.CLINIC });
      assert.equal(res.status, 201);
      assert.equal(await Department.countDocuments({ practice: res.body.practice.id }), 0);
      assert.equal(res.body.outcome.headDoctorDepartment, null);
    });

    test('with nothing but the essentials it still makes a location named for the practice', async () => {
      const res = await as(operator.token).post('/admin/practices', {
        name: 'Behala Evening Clinic',
        headDoctorName: 'Dr. Rina Sen',
        headDoctorPhone: PHONE,
        headDoctorPhoneToken: signPhoneToken(PHONE),
      });
      assert.equal(res.status, 201, JSON.stringify(res.body));
      const location = await Clinic.findOne({ practice: res.body.practice.id }).lean();
      assert.equal(location.name, 'Behala Evening Clinic');
      assert.deepEqual(location.weeklyHours, []);
      assert.equal((await Practice.findById(res.body.practice.id).lean()).emergencyPhone, null);
    });

    test('the doctor proved the number and nobody set a password', async () => {
      await create();
      const doctor = await User.findOne({ phone: PHONE }).select('+passwordHash role phoneVerifiedAt').lean();
      assert.equal(doctor.role, ROLES.DOCTOR);
      assert.ok(doctor.phoneVerifiedAt, 'the proved number is not recorded as proved');
      assert.ok(!doctor.passwordHash, 'a password was set on the doctor’s behalf');

      // A proof for another number is refused, and nothing is made.
      await wipe();
      operator = await makeOperator();
      const mismatch = await create({ headDoctorPhoneToken: signPhoneToken('+919800000001') });
      assert.equal(mismatch.status, 400);
      await nothingWritten();
    });

    test('the head doctor is told on their phones and by email, and nothing is really sent', async () => {
      // An account already on MedPin, signed in on one phone.
      await User.create({
        name: 'Dr. Priya Nair',
        phone: PHONE,
        role: ROLES.DOCTOR,
        isActive: true,
        deviceTokens: ['device-token-priya'],
      });

      const res = await create();
      assert.equal(res.status, 201);
      assert.equal(res.body.outcome.headDoctorAccount, 'existing');
      assert.deepEqual(res.body.outcome.notified, {
        devices: 1,
        emailTo: 'priya@meridian.example',
        sms: 'not_available',
      });

      assert.equal(pushes.length, 1);
      assert.deepEqual(pushes[0].tokens, ['device-token-priya']);
      assert.match(pushes[0].notification.title, /Meridian Heart Centre is set up on MedPin/);
      assert.equal(pushes[0].data.kind, 'practice_ready');

      // The mailer is fire-and-forget; give it its turn.
      await new Promise((r) => setTimeout(r, 50));
      const sent = mail.find((m) => m.to === 'priya@meridian.example');
      assert.ok(sent, 'the head doctor was not emailed');
      assert.match(sent.text, /There is no password to set up\./);
      assert.match(sent.text, new RegExp(PHONE.replace('+', '\\+')));

      const audit = await AdminAuditLog.findOne({ action: 'admin.practice.create' }).lean();
      assert.equal(audit.after.notified.devices, 1);
      assert.equal(audit.after.location, String((await Clinic.findOne({}).lean())._id));
    });

    describe('every refusal comes before anything is written', () => {
      test('a patient’s number', async () => {
        await User.create({ name: 'A Patient', phone: PHONE, role: ROLES.PATIENT, isActive: true });
        let res;
        const creates = await countingCreates(async () => {
          res = await create();
        });
        assert.equal(res.status, 409);
        assert.match(res.body.error.message, /patient account/);
        assert.equal(creates, 0, 'a practice row was created and then deleted');
        await nothingWritten();
        assert.equal(await User.countDocuments({ phone: PHONE, role: ROLES.PATIENT }), 1);
      });

      test('an account in another role', async () => {
        await User.create({ name: 'A Dietician', phone: PHONE, role: ROLES.DIETICIAN, isActive: true });
        let res;
        const creates = await countingCreates(async () => {
          res = await create();
        });
        assert.equal(res.status, 409);
        assert.equal(creates, 0);
        await nothingWritten();
      });

      test('a licence already registered', async () => {
        await makePractice('Existing', { registrationNo: 'WB-77001' });
        let res;
        const creates = await countingCreates(async () => {
          res = await create();
        });
        assert.equal(res.status, 400);
        assert.equal(creates, 0);
        assert.equal(await Practice.countDocuments({}), 1);
        assert.equal(await Clinic.countDocuments({}), 0);
      });

      test('an emergency number nobody can ring, and hours that end before they start', async () => {
        for (const over of [
          { emergencyPhone: '+91-0000000000' },
          { location: { phone: '1234' } },
          { location: { weeklyHours: [{ dayOfWeek: 2, start: '18:00', end: '09:00' }] } },
        ]) {
          let res;
          const creates = await countingCreates(async () => {
            res = await create(over);
          });
          assert.equal(res.status, 400, `${JSON.stringify(over)} was accepted`);
          assert.equal(creates, 0, `${JSON.stringify(over)} created a practice first`);
          await nothingWritten();
          assert.equal(await User.countDocuments({ phone: PHONE }), 0, 'an account was made for a refused practice');
        }
      });

      test('a prescription prefix another practice holds', async () => {
        await makePractice('Holder', { prescriptionPrefix: 'MHC' });
        let res;
        const creates = await countingCreates(async () => {
          res = await create({ prescriptionPrefix: 'mhc' });
        });
        assert.equal(res.status, 409);
        assert.equal(creates, 0);
        assert.equal(await Practice.countDocuments({}), 1);
      });
    });
  });

  describe('from an approved application', () => {
    async function applied(over = {}) {
      return PracticeApplication.create({
        practiceName: 'Lake Town Heart Centre',
        practiceType: PRACTICE_TYPE.SPECIALTY_CENTRE,
        specialty: 'cardiology',
        addressLine: '2 Lake Town Road',
        city: 'Kolkata',
        state: 'West Bengal',
        postalCode: '700089',
        contactName: 'Dr. Meera Iyer',
        contactEmail: 'meera@laketown.example',
        contactIsPrimaryDoctor: true,
        contactPhone: PHONE,
        phoneVerifiedAt: new Date(),
        doctorName: 'Dr. Meera Iyer',
        departments: ['cardiology'],
        doctorDepartment: 'cardiology',
        history: [{ action: 'submitted', note: null }],
        ...over,
      });
    }

    test('makes the same complete practice, with the operator’s phone and hours', async () => {
      const a = await applied();
      const res = await as(operator.token).post(`/admin/applications/${a._id}/approve`, {
        note: 'Council register checked.',
        emergencyPhone: '+91 33 2500 1111',
        location: { phone: '+91 33 2500 2222', weeklyHours: HOURS },
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));

      const practice = await Practice.findOne({ name: 'Lake Town Heart Centre' }).lean();
      assert.equal(practice.emergencyPhone, '+913325001111');
      const location = await Clinic.findOne({ practice: practice._id }).lean();
      assert.equal(location.phone, '+913325002222', 'the location’s phone is not the operator’s');
      assert.notEqual(location.phone, PHONE, 'the applicant’s own mobile became the desk number');
      assert.equal(location.addressLine, '2 Lake Town Road, West Bengal 700089');
      assert.equal(location.weeklyHours.length, 3);
      assert.deepEqual(
        (await Department.find({ practice: practice._id }).lean()).map((d) => d.key),
        ['cardiology'],
      );
      assert.deepEqual(res.body.outcome.notified, {
        devices: 0,
        emailTo: 'meera@laketown.example',
        sms: 'not_available',
      });
    });

    test('an owner already signed in somewhere is told on that phone', async () => {
      await User.create({
        name: 'Dr. Meera Iyer',
        phone: PHONE,
        role: ROLES.DOCTOR,
        isActive: true,
        deviceTokens: ['device-token-meera'],
      });
      const a = await applied();
      const res = await as(operator.token).post(`/admin/applications/${a._id}/approve`, { note: 'Checked.' });
      assert.equal(res.status, 200);
      assert.equal(pushes.length, 1);
      assert.deepEqual(pushes[0].tokens, ['device-token-meera']);
    });

    test('a patient’s number is refused before anything is made, and the application stays open', async () => {
      await User.create({ name: 'A Patient', phone: PHONE, role: ROLES.PATIENT, isActive: true });
      const a = await applied();

      let res;
      const creates = await countingCreates(async () => {
        res = await as(operator.token).post(`/admin/applications/${a._id}/approve`, { note: 'Checked.' });
      });
      assert.equal(res.status, 409);
      assert.equal(creates, 0, 'a practice row was created and then deleted');
      await nothingWritten();

      const after = await PracticeApplication.findById(a._id).lean();
      assert.equal(after.status, APPLICATION_STATUS.SUBMITTED);
      assert.equal(after.approvingUntil, null, 'the approval lease was not let go');
    });

    test('a practice owned by a manager names no doctor it does not have', async () => {
      /*
       * V-40: the identity fell back to DOCTOR_DISPLAY_NAME — Dr. Amit Kumar
       * Dey — for any practice with no printed doctor, which is every practice
       * whose applicant was its manager. The doctor they named is not on the
       * platform yet and is not named either.
       */
      const a = await applied({
        contactName: 'Anita Roy',
        contactIsPrimaryDoctor: false,
        doctorName: 'Dr. Not Yet Joined',
      });
      const res = await as(operator.token).post(`/admin/applications/${a._id}/approve`, { note: 'Checked.' });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.outcome.managesOnly, true);

      const identity = await clinicIdentity(null, { practiceId: res.body.practice.id });
      assert.equal(identity.clinicName, 'Lake Town Heart Centre');
      assert.equal(identity.doctorName, null);

      const prompt = buildSystemPrompt({
        language: 'en',
        triage: { urgency: 'routine' },
        patientContext: '',
        groundingContext: '',
        careTeamNotes: '',
        identity,
      });
      assert.ok(!/Amit|Dey\b/.test(prompt), 'a manager-owned practice’s assistant names the founding doctor');
      assert.ok(prompt.includes('your doctor, cardiology, at Lake Town Heart Centre'));
    });
  });
});
