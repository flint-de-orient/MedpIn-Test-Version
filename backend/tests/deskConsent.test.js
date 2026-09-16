import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { ConsentEvent, CONSENT_ACTION, CONSENT_METHOD } from '../src/models/ConsentEvent.js';
import { OtpChallenge, hashOtp } from '../src/models/OtpChallenge.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { ShareGrant } from '../src/models/ShareGrant.js';
import { signAccessToken } from '../src/services/tokens.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * A desk typing the number of somebody who already has an account.
 *
 * ---- What §26 asks, and what each test here pins -----------------------
 *
 *   - the patient's own code before the practice is connected — for every
 *     account that exists, including one nobody else holds
 *   - nothing about the account shown before that: not its name, not its id,
 *     not the number it signs in with
 *   - a patient coming back keeps the original `enrolledOn`
 *   - the practice reads nothing from before the consent unless the patient,
 *     answering the one-time question in their own app, shares it
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);
const CODE = '424242';

let salt;
let behala;
let seq = 0;

function phone() {
  seq += 1;
  return `+9198${String(Date.now()).slice(-6)}${String(seq).padStart(2, '0')}`;
}

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return {
    practice: p,
    owner: await makeMember(p, { name: `Dr ${name}`, isOwner: true }),
    desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
  };
}

/** Somebody who signed themselves up: an account, readings, no practice. */
async function selfSignedUp(name = 'Meera Account-Name', number = phone()) {
  const user = await User.create({ name, phone: number, role: ROLES.PATIENT, isActive: true });
  await Patient.create({ _id: user._id, login: user._id, name, relationship: RELATIONSHIP.SELF });
  await GlucoseReading.create({ patient: user._id, valueMgDl: 256, context: 'fasting', measuredAt: ago(20) });
  return { user, token: signAccessToken(user), phone: number, name };
}

/** The code the patient's phone would have shown, planted where the server keeps its hash. */
async function plantCode(number) {
  const r = await OtpChallenge.updateOne({ phone: number, purpose: 'enrol' }, { $set: { codeHash: hashOtp(CODE, number, 'enrol') } });
  assert.equal(r.matchedCount, 1, `no enrolment code was sent to ${number}`);
}

function register(desk, number, name = 'Typed At The Desk') {
  return as(desk.token).post('/doctor/patients', { name, phone: number, age: 51, gender: 'female', address: 'Salt Lake' });
}

describe('registering a number that already has an account', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    salt = await practice('Salt Lake');
    behala = await practice('Behala');
  });

  test('asks the patient for a code even when no other practice holds them', async () => {
    const meera = await selfSignedUp();
    const res = await register(salt.desk, meera.phone);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.consentRequired, true, 'a self sign-up was joined to the practice with no code');
    const row = await Enrollment.findOne({ patient: meera.user._id }).lean();
    assert.equal(row.status, ENROLLMENT_STATUS.PENDING);
    assert.ok(await OtpChallenge.exists({ phone: meera.phone, purpose: 'enrol' }), 'no code went to the patient');
  });

  test('and tells the desk nothing about the account before the code comes back', async () => {
    const meera = await selfSignedUp();
    const res = await register(salt.desk, meera.phone);

    const said = allText(res.body);
    assert.ok(!said.includes('Meera Account-Name'), 'the account’s own name was shown to the desk');
    assert.ok(!said.includes(String(meera.user._id)), 'the account’s id was handed to the desk');
    assert.equal(res.body.id, undefined);
    assert.equal(res.body.name, 'Typed At The Desk', 'the desk should get back what it typed');

    const waiting = await as(salt.desk.token).get('/enrolments/pending');
    assert.equal(waiting.status, 200);
    assert.equal(waiting.body.items.length, 1);
    assert.equal(waiting.body.items[0].name, 'Typed At The Desk');
    assert.equal(waiting.body.items[0].phone, meera.phone);
    assert.ok(!allText(waiting.body).includes('Meera Account-Name'), 'the waiting list named the account');
    assert.ok(!allText(waiting.body).includes(String(meera.user._id)), 'the waiting list carried the account id');

    // Nor can the practice open them by any id it might hold.
    const read = await as(salt.owner.token).get(`/patients/${meera.user._id}/glucose`);
    assert.equal(read.status, 403);
    assert.ok(!allText(read.body).includes('Meera'), 'the refusal named the account');

    const list = await as(salt.desk.token).get('/doctor/patients');
    assert.ok(!allText(list.body).includes('Meera Account-Name'), 'a pending account was listed');
  });

  test('a waiting list from before the desk’s words were kept shows nothing about the account', async () => {
    const meera = await selfSignedUp();
    const enrollment = await Enrollment.create({ patient: meera.user._id, practice: salt.practice._id, status: 'pending' });
    await ConsentEvent.record({ enrollment: enrollment._id, action: CONSENT_ACTION.REQUESTED, method: CONSENT_METHOD.OTP_DESK });

    const waiting = await as(salt.desk.token).get('/enrolments/pending');
    assert.equal(waiting.body.items.length, 1);
    assert.equal(waiting.body.items[0].name, null);
    assert.equal(waiting.body.items[0].phone, null);
    assert.ok(!allText(waiting.body).includes('Meera'));
  });

  test('only the practice that asked can finish, and only with the right code', async () => {
    const meera = await selfSignedUp();
    const res = await register(salt.desk, meera.phone);
    await plantCode(meera.phone);

    const elsewhere = await as(behala.desk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: CODE });
    assert.equal(elsewhere.status, 404, 'another practice confirmed this practice’s request');
    assert.ok(!allText(elsewhere.body).includes('Meera'));

    const wrong = await as(salt.desk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: '000001' });
    assert.equal(wrong.status, 401);
    assert.equal((await Enrollment.findById(res.body.enrollmentId).lean()).status, ENROLLMENT_STATUS.PENDING);

    const right = await as(salt.desk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: CODE });
    assert.equal(right.status, 200, JSON.stringify(right.body));
    // Now, and only now, the practice learns who it has enrolled.
    assert.equal(right.body.patient.id, String(meera.user._id));
    assert.equal(right.body.patient.name, 'Meera Account-Name');

    const row = await Enrollment.findById(res.body.enrollmentId).lean();
    assert.equal(row.status, ENROLLMENT_STATUS.ACTIVE);
    assert.ok(Date.now() - new Date(row.enrolledOn).getTime() < 60_000, 'a first consent was not dated at the consent');
  });

  test('the code is checked against the number it went to, which may be a second line', async () => {
    const meera = await selfSignedUp();
    const second = phone();
    await User.updateOne({ _id: meera.user._id }, { $set: { altPhones: [second] } });

    const res = await register(salt.desk, second);
    assert.equal(res.body.consentRequired, true);
    assert.ok(!allText(res.body).includes(meera.phone), 'the account’s primary number was shown to the desk');

    await plantCode(second);
    const right = await as(salt.desk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: CODE });
    assert.equal(right.status, 200, 'a code sent to the number the desk typed could not be spent');
  });

  test('two desks spending one code at once make one consent', async () => {
    const meera = await selfSignedUp();
    const second = await makeMember(salt.practice, { name: 'Second Desk', role: ROLES.STAFF });
    const res = await register(salt.desk, meera.phone);
    await plantCode(meera.phone);

    const answers = await Promise.all([
      as(salt.desk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: CODE }),
      as(second.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: CODE }),
    ]);
    assert.ok(answers.some((a) => a.status === 200));
    const granted = await ConsentEvent.countDocuments({ enrollment: res.body.enrollmentId, action: CONSENT_ACTION.GRANTED });
    assert.equal(granted, 1, `${granted} consents were recorded for one code`);
  });

  test('a clinician’s own number cannot be registered as a patient', async () => {
    const res = await register(salt.desk, behala.owner.user.phone);
    assert.equal(res.status, 400);
    assert.ok(!allText(res.body).includes('Dr Behala'), 'the refusal named whose number it is');
    assert.equal(await Patient.countDocuments({ _id: behala.owner.user._id }), 0);
    assert.equal(await Enrollment.countDocuments({ patient: behala.owner.user._id }), 0);
  });

  test('a brand-new number is registered at once, and asks no history question', async () => {
    const number = phone();
    const res = await register(salt.desk, number, 'Brand New');
    assert.equal(res.status, 201);
    assert.equal(res.body.consentRequired, false);

    const user = await User.findOne({ phone: number });
    const prompts = await as(signAccessToken(user)).get('/sharing/prompts');
    assert.equal(prompts.status, 200);
    assert.deepEqual(prompts.body.items, [], 'a new account the desk made was asked about history it cannot have');
  });

  test('nobody can read a consent trail that is not theirs', async () => {
    const meera = await selfSignedUp();
    const res = await register(salt.desk, meera.phone);
    const stranger = await makePatient({ name: 'Other Patient', practices: [] });

    const read = await as(stranger.token).get(`/enrolments/${res.body.enrollmentId}/consent`);
    assert.equal(read.status, 403, 'a patient read another person’s consent trail');

    const byBehala = await as(behala.desk.token).get(`/enrolments/${res.body.enrollmentId}/consent`);
    assert.equal(byBehala.status, 403);

    const byPatient = await as(meera.token).get(`/enrolments/${res.body.enrollmentId}/consent`);
    assert.equal(byPatient.status, 200);
  });
});

describe('the history from before stays the patient’s to share', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    salt = await practice('Salt Lake');
    behala = await practice('Behala');
  });

  async function connected() {
    const meera = await selfSignedUp();
    const res = await register(salt.desk, meera.phone);
    await plantCode(meera.phone);
    const ok = await as(salt.desk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: CODE });
    assert.equal(ok.status, 200);
    return { meera, enrollmentId: res.body.enrollmentId };
  }

  const glucoseValues = async (token, id) =>
    ((await as(token).get(`/patients/${id}/glucose`)).body.items ?? []).map((g) => g.valueMgDl);

  test('a newly connected practice does not see the earlier records by default', async () => {
    const { meera } = await connected();
    assert.deepEqual(await glucoseValues(salt.owner.token, meera.user._id), []);
  });

  test('the patient is asked once, and sharing opens exactly what they chose', async () => {
    const { meera, enrollmentId } = await connected();

    const prompts = await as(meera.token).get('/sharing/prompts');
    assert.equal(prompts.body.items.length, 1);
    assert.equal(prompts.body.items[0].enrollmentId, enrollmentId);
    assert.equal(prompts.body.items[0].practice.name, 'Salt Lake');

    const answer = await as(meera.token).post(`/sharing/prompts/${enrollmentId}`, { share: true, categories: ['readings'] });
    assert.equal(answer.status, 201, JSON.stringify(answer.body));
    assert.equal(answer.body.grant.origin, 'history_prompt');

    assert.deepEqual(await glucoseValues(salt.owner.token, meera.user._id), [256]);
    assert.deepEqual((await as(meera.token).get('/sharing/prompts')).body.items, [], 'the question was asked again');

    const again = await as(meera.token).post(`/sharing/prompts/${enrollmentId}`, { share: false });
    assert.equal(again.status, 409);
  });

  test('declining shares nothing and is not asked again', async () => {
    const { meera, enrollmentId } = await connected();
    const answer = await as(meera.token).post(`/sharing/prompts/${enrollmentId}`, { share: false });
    assert.equal(answer.status, 201);
    assert.equal(answer.body.grant, null);
    assert.equal(await ShareGrant.countDocuments(), 0);
    assert.deepEqual(await glucoseValues(salt.owner.token, meera.user._id), []);
    assert.deepEqual((await as(meera.token).get('/sharing/prompts')).body.items, []);
  });

  test('two answers at once are one answer and at most one grant', async () => {
    await ConsentEvent.createIndexes();
    const { meera, enrollmentId } = await connected();
    const [one, two] = await Promise.all([
      as(meera.token).post(`/sharing/prompts/${enrollmentId}`, { share: true, categories: ['readings'] }),
      as(meera.token).post(`/sharing/prompts/${enrollmentId}`, { share: true, categories: ['readings'] }),
    ]);
    assert.deepEqual([one.status, two.status].sort(), [201, 409]);
    assert.equal(await ShareGrant.countDocuments(), 1);
    assert.equal(
      await ConsentEvent.countDocuments({ enrollment: enrollmentId, action: CONSENT_ACTION.HISTORY_SHARED }),
      1,
    );
  });

  test('nobody but the patient answers it', async () => {
    const { enrollmentId } = await connected();
    const stranger = await makePatient({ name: 'Other Patient', practices: [salt.practice] });
    assert.equal((await as(stranger.token).post(`/sharing/prompts/${enrollmentId}`, { share: true, categories: ['readings'] })).status, 404);
    assert.equal((await as(salt.owner.token).post(`/sharing/prompts/${enrollmentId}`, { share: true, categories: ['readings'] })).status, 403);
    assert.equal(await ShareGrant.countDocuments(), 0);
  });
});

describe('coming back keeps the original enrolment date', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    salt = await practice('Salt Lake');
  });

  async function withdrawAndReturn(patient, enrollmentId) {
    const withdrawn = await as(patient.token).post(`/enrolments/${enrollmentId}/revoke`, {});
    assert.equal(withdrawn.status, 200);
    // Later that day, past the resend cooldown of any code sent before.
    await OtpChallenge.updateMany({ phone: patient.user.phone }, { $set: { lastSentAt: ago(1) } });
    const res = await register(salt.desk, patient.user.phone, 'Coming Back');
    assert.equal(res.body.consentRequired, true);
    await plantCode(patient.user.phone);
    const ok = await as(salt.desk.token).post(`/enrolments/${enrollmentId}/confirm`, { code: CODE });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    return Enrollment.findById(enrollmentId).lean();
  }

  test('a patient who consented, withdrew and returned', async () => {
    const patient = await makePatient({ name: 'Returning', practices: [salt.practice] });
    const [enrollment] = patient.enrollments;
    await Enrollment.updateOne({ _id: enrollment._id }, { $set: { enrolledOn: ago(100) } });
    await ConsentEvent.record({ enrollment: enrollment._id, action: CONSENT_ACTION.GRANTED, method: CONSENT_METHOD.OTP_DESK });

    const row = await withdrawAndReturn(patient, enrollment._id);
    assert.equal(row.status, ENROLLMENT_STATUS.ACTIVE);
    assert.ok(Math.abs(new Date(row.enrolledOn).getTime() - ago(100).getTime()) < 60_000, 'returning reset the enrolment date');
  });

  test('a patient the migration enrolled, with no consent logged, who withdrew and returned', async () => {
    const patient = await makePatient({ name: 'Migrated', practices: [salt.practice] });
    const [enrollment] = patient.enrollments;
    await Enrollment.updateOne({ _id: enrollment._id }, { $set: { enrolledOn: ago(400) } });

    const row = await withdrawAndReturn(patient, enrollment._id);
    assert.ok(Math.abs(new Date(row.enrolledOn).getTime() - ago(400).getTime()) < 60_000, 'returning reset the enrolment date');
  });

  test('but a request that was never answered opens at the consent, not when it was first asked', async () => {
    const meera = await selfSignedUp();
    const first = await register(salt.desk, meera.phone);
    await Enrollment.updateOne({ _id: first.body.enrollmentId }, { $set: { enrolledOn: ago(30) } });

    // She withdraws the request instead of answering it, and later agrees.
    const row = await withdrawAndReturn({ ...meera, user: meera.user }, first.body.enrollmentId);
    assert.ok(Date.now() - new Date(row.enrolledOn).getTime() < 60_000, 'a request never agreed to opened thirty days back');
  });
});
