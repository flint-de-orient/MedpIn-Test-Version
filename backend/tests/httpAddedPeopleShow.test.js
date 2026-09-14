import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { Membership, MEMBERSHIP_STATUS } from '../src/models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { OtpChallenge, hashOtp } from '../src/models/OtpChallenge.js';
import { PLAN } from '../src/models/Practice.js';
import { signAccessToken } from '../src/services/tokens.js';
import { leavePractice } from '../src/services/memberships.js';

/**
 * People added to a practice, and whether the practice can then see them.
 *
 * Each of these was reported the same way — "I added them and they are not
 * there" — and each had a different cause:
 *
 *   - a patient added at the desk with a new number was given no enrolment, so
 *     every list scoped to the practice's enrolments left them out;
 *   - "restoring" somebody who had left set their status and left the date they
 *     left, so they stayed gone — and an account with no current practice was
 *     not refused anything, so it could list every patient on the platform;
 *   - somebody who already had a MedPin account could not be hired at all;
 *   - a role changed on the People screen changed the membership and not the
 *     account, which is what the pickers and the doctor-only routes read;
 *   - a list sorted by risk, reading or inbox was paged by date first and
 *     sorted afterwards, so the patient who most needed seeing could be on a
 *     page nobody asked for.
 */

let phoneSeq = 0;
const newPhone = () => `+9198765${String(Date.now()).slice(-3)}${String((phoneSeq += 1)).padStart(2, '0')}`;

describe('a patient added at the desk is on that practice’s list', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('a new number is enrolled at the practice that added it, and nowhere else', async () => {
    const saltLake = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const doctor = await makeMember(saltLake, { name: 'Dr Salt Lake', isOwner: true });
    const desk = await makeMember(saltLake, { name: 'Salt Lake Desk', role: ROLES.STAFF });
    const other = await makeMember(behala, { name: 'Dr Behala', isOwner: true });

    const res = await as(desk.token).post('/doctor/patients', { name: 'Anita Paul', phone: newPhone(), age: 52 });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const enrolment = await Enrollment.findOne({ patient: res.body.id }).lean();
    assert.ok(enrolment, 'the patient was added with no enrolment, so no list can show them');
    assert.equal(String(enrolment.practice), String(saltLake._id));
    assert.equal(enrolment.status, ENROLLMENT_STATUS.ACTIVE);
    assert.equal(res.body.existing, false);
    assert.equal(res.body.enrollmentId, String(enrolment._id));

    const list = await as(doctor.token).get('/doctor/patients?sort=name&limit=100');
    assert.ok(
      list.body.items.some((p) => p.name === 'Anita Paul'),
      'the practice that added the patient cannot see them',
    );

    const elsewhere = await as(other.token).get('/doctor/patients?sort=name&limit=100');
    assert.ok(!elsewhere.body.items.some((p) => p.name === 'Anita Paul'), 'another practice can see the patient');
  });

  test('the practice’s patient limit applies to a new number too', async () => {
    const practice = await makePractice('Small Clinic', {
      plan: PLAN.ESSENTIAL,
      limits: { patients: 1, staff: null, locations: null },
    });
    await makeMember(practice, { name: 'Dr Small', isOwner: true });
    const desk = await makeMember(practice, { name: 'Small Desk', role: ROLES.STAFF });

    const first = await as(desk.token).post('/doctor/patients', { name: 'First Patient', phone: newPhone() });
    assert.equal(first.status, 201, JSON.stringify(first.body));

    const refusedPhone = newPhone();
    const second = await as(desk.token).post('/doctor/patients', { name: 'Second Patient', phone: refusedPhone });
    assert.equal(second.status, 400, 'a practice at its patient limit registered another patient');
    assert.match(JSON.stringify(second.body), /limit of 1 patients/);
    assert.equal(await User.countDocuments({ phone: refusedPhone }), 0, 'a refused registration still made an account');
  });
});

describe('somebody brought back is back', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('restoring somebody who left clears the mark, and they can work again', async () => {
    const practice = await makePractice('Meridian');
    const owner = await makeMember(practice, { name: 'Dr Iyer', isOwner: true });
    const desk = await makeMember(practice, { name: 'Sunita Desk', role: ROLES.STAFF });
    await leavePractice(desk.membership._id, { practice: practice._id });

    let roster = await as(owner.token).get('/team');
    assert.equal(roster.body.items.find((m) => m.name === 'Sunita Desk').status, 'left');

    const res = await as(owner.token).patch(`/team/${desk.membership._id}`, { status: 'active' });
    assert.equal(res.status, 200, JSON.stringify(res.body));

    roster = await as(owner.token).get('/team');
    assert.equal(
      roster.body.items.find((m) => m.name === 'Sunita Desk').status,
      'active',
      'restored, and still shown as having left',
    );
    assert.equal((await Membership.findById(desk.membership._id).lean()).endedOn, null);

    const back = await as(desk.token).get('/doctor/patients?limit=5');
    assert.equal(back.status, 200, 'a restored member still cannot work');
  });

  test('bringing somebody back respects the practice’s limit on people', async () => {
    const practice = await makePractice('Sunrise', {
      plan: PLAN.ESSENTIAL,
      limits: { patients: null, staff: 2, locations: null },
    });
    const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    const left = await makeMember(practice, { name: 'Old Desk', role: ROLES.STAFF });
    await leavePractice(left.membership._id, { practice: practice._id });
    // The owner and the new desk fill both places.
    await makeMember(practice, { name: 'New Desk', role: ROLES.STAFF });

    const res = await as(owner.token).patch(`/team/${left.membership._id}`, { status: 'active' });
    assert.equal(res.status, 409, 'somebody was brought back past the practice’s limit');
    assert.match(JSON.stringify(res.body), /limit of 2 people/);
    assert.ok((await Membership.findById(left.membership._id).lean()).endedOn, 'a refused restore still brought them back');
  });
});

describe('an account with no current practice is refused, not unrestricted', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('a doctor whose membership ended can neither list nor open patients', async () => {
    const practice = await makePractice('Salt Lake');
    const owner = await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    const gone = await makeMember(practice, { name: 'Dr Gone' });
    const patient = await makePatient({ name: 'Rina Das', practices: [practice] });
    await leavePractice(gone.membership._id, { practice: practice._id });

    const list = await as(gone.token).get('/doctor/patients?limit=100');
    assert.equal(list.status, 403, `an account with no practice listed patients: ${JSON.stringify(list.body).slice(0, 200)}`);
    assert.equal(list.body.error.code, 'NO_PRACTICE');

    const record = await as(gone.token).get(`/doctor/patients/${patient.user._id}/summary`);
    assert.equal(record.status, 403);
    assert.equal(record.body.error.code, 'NO_PRACTICE');
    assert.ok(!JSON.stringify(record.body).includes('Rina'), 'the refusal carried the patient');

    assert.equal((await as(owner.token).get('/doctor/patients?limit=100')).status, 200, 'the practice itself was refused');
  });

  test('and so is a staff account that was never placed anywhere', async () => {
    const practice = await makePractice('Salt Lake');
    await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    await makePatient({ name: 'Rina Das', practices: [practice] });
    const stray = await User.create({ name: 'Stray Desk', phone: newPhone(), role: ROLES.STAFF, isActive: true });

    const res = await as(signAccessToken(stray)).get('/doctor/patients?limit=100');
    assert.equal(res.status, 403);
    assert.ok(!JSON.stringify(res.body).includes('Rina'));
  });

  test('but it can still be told that it has no practice', async () => {
    const practice = await makePractice('Salt Lake');
    await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    const stray = await User.create({ name: 'Stray Desk', phone: newPhone(), role: ROLES.STAFF, isActive: true });

    const mine = await as(signAccessToken(stray)).get('/practices/mine');
    assert.equal(mine.status, 200, JSON.stringify(mine.body));
    assert.equal(mine.body.practice, null);

    // Billing is the doctor's screen, so it is asked as a doctor who has left.
    const gone = await makeMember(practice, { name: 'Dr Gone' });
    await leavePractice(gone.membership._id, { practice: practice._id });
    const billing = await as(gone.token).get('/billing');
    assert.equal(billing.status, 200, JSON.stringify(billing.body));
    assert.equal(billing.body.hasPractice, false);
  });
});

describe('somebody who already uses MedPin can be hired', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  async function hireCode(token, phone) {
    const sent = await as(token).post('/team/phone/otp', { phone });
    assert.equal(sent.status, 200, `no hiring code: ${JSON.stringify(sent.body)}`);
    // Only a hash is stored, so a known code is planted — what is tested is the
    // route spending it.
    await OtpChallenge.updateOne({ phone, purpose: 'hire' }, { $set: { codeHash: hashOtp('482913', phone, 'hire') } });
    const checked = await as(token).post('/team/phone/verify', { phone, code: '482913' });
    assert.equal(checked.status, 200, `the code was not accepted: ${JSON.stringify(checked.body)}`);
    return checked.body.phoneToken;
  }

  test('a doctor at another practice is added with the account they already have', async () => {
    const saltLake = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const owner = await makeMember(saltLake, { name: 'Dr Owner', isOwner: true });
    const visiting = await makeMember(behala, { name: 'Dr Visiting', isOwner: true });

    const phoneToken = await hireCode(owner.token, visiting.user.phone);
    const res = await as(owner.token).post('/team', { role: ROLES.DOCTOR, name: 'Dr Visiting', phoneToken });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.existing, true);
    assert.equal(res.body.userId, String(visiting.user._id), 'a second account was made for somebody who has one');
    assert.equal(await User.countDocuments({ phone: visiting.user.phone }), 1);
    assert.ok(
      await Membership.exists({ user: visiting.user._id, practice: saltLake._id, status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null }),
    );
    assert.ok(
      await Membership.exists({ user: visiting.user._id, practice: behala._id, isOwner: true, endedOn: null }),
      'hiring them here changed their own practice',
    );

    const roster = await as(owner.token).get('/team');
    assert.ok(
      roster.body.items.some((m) => m.name === 'Dr Visiting' && m.status === 'active'),
      'the person hired is not on the People list',
    );
  });

  test('but a patient’s number, a number in another role, or somebody already here is refused', async () => {
    const practice = await makePractice('Salt Lake');
    const owner = await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    const patient = await makePatient({ name: 'Rina Das', practices: [practice] });
    const dietician = await makeMember(await makePractice('Elsewhere'), { name: 'Dietician Elsewhere', role: ROLES.DIETICIAN });
    const colleague = await makeMember(practice, { name: 'Dr Colleague' });

    const asPatient = await as(owner.token).post('/team', {
      role: ROLES.STAFF,
      name: 'Rina Das',
      phoneToken: await hireCode(owner.token, patient.user.phone),
    });
    assert.equal(asPatient.status, 409);
    assert.match(asPatient.body.error.message, /patient account/);

    const otherRole = await as(owner.token).post('/team', {
      role: ROLES.STAFF,
      name: 'Dietician Elsewhere',
      phoneToken: await hireCode(owner.token, dietician.user.phone),
    });
    assert.equal(otherRole.status, 409);
    assert.match(otherRole.body.error.message, /dietician/);

    const again = await as(owner.token).post('/team', {
      role: ROLES.DOCTOR,
      name: 'Dr Colleague',
      phoneToken: await hireCode(owner.token, colleague.user.phone),
    });
    assert.equal(again.status, 409);
    assert.match(again.body.error.message, /already work/);

    assert.equal(await Membership.countDocuments({ practice: practice._id }), 2, 'a refused hire still added somebody');
  });

  test('only somebody who may change who works here can send a hiring code', async () => {
    const practice = await makePractice('Salt Lake');
    await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    const desk = await makeMember(practice, { name: 'Desk', role: ROLES.STAFF });
    const phone = newPhone();

    const res = await as(desk.token).post('/team/phone/otp', { phone });
    assert.equal(res.status, 403);
    assert.equal(await OtpChallenge.countDocuments({ phone }), 0, 'a code was sent anyway');
  });
});

describe('a role changed here reaches the account', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('changing somebody’s role changes what their account is', async () => {
    const practice = await makePractice('Salt Lake');
    const owner = await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    const desk = await makeMember(practice, { name: 'Sunita', role: ROLES.STAFF });

    const res = await as(owner.token).patch(`/team/${desk.membership._id}`, { role: ROLES.DIETICIAN });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(
      (await User.findById(desk.user._id).lean()).role,
      ROLES.DIETICIAN,
      'the membership says dietician and the account still says front desk',
    );
  });

  test('but not while they work somewhere else in the old role', async () => {
    const saltLake = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const owner = await makeMember(saltLake, { name: 'Dr Owner', isOwner: true });
    const desk = await makeMember(saltLake, { name: 'Sunita', role: ROLES.STAFF });
    await Membership.create({
      user: desk.user._id,
      practice: behala._id,
      role: ROLES.STAFF,
      status: MEMBERSHIP_STATUS.ACTIVE,
      permissions: [],
    });

    const res = await as(owner.token).patch(`/team/${desk.membership._id}`, { role: ROLES.DIETICIAN });
    assert.equal(res.status, 409, 'an account was given a second role');
    assert.equal((await User.findById(desk.user._id).lean()).role, ROLES.STAFF);
    assert.equal((await Membership.findById(desk.membership._id).lean()).role, ROLES.STAFF, 'the refused change was half made');
  });
});

describe('a list is put in order before it is cut into pages', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  async function practiceWithPatients() {
    const practice = await makePractice('Salt Lake');
    const doctor = await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    const make = async (name, risk, daysAgo) => {
      const p = await makePatient({ name, practices: [practice] });
      // Through the driver: Mongoose treats `createdAt` as immutable and silently
      // drops a change to it, and "however long ago they joined" would be untested.
      await User.collection.updateOne(
        { _id: p.user._id },
        { $set: { createdAt: new Date(Date.now() - daysAgo * 86400e3) } },
      );
      await PatientProfile.create({ user: p.user._id, riskScore: risk, riskBand: risk >= 70 ? 'critical' : 'low' });
      return p;
    };
    const oldest = await make('Zubin Oldest', 95, 3);
    const middle = await make('Mira Middle', 10, 2);
    const newest = await make('Anil Newest', 20, 1);
    return { practice, doctor, oldest, middle, newest };
  }

  test('the riskiest patient is on the first page, however long ago they joined', async () => {
    const w = await practiceWithPatients();

    const page1 = await as(w.doctor.token).get('/doctor/patients?sort=risk&limit=2&page=1');
    assert.equal(page1.status, 200, JSON.stringify(page1.body));
    assert.deepEqual(page1.body.items.map((p) => p.name), ['Zubin Oldest', 'Anil Newest']);
    assert.equal(page1.body.total, 3);
    assert.equal(page1.body.hasMore, true);

    const page2 = await as(w.doctor.token).get('/doctor/patients?sort=risk&limit=2&page=2');
    assert.deepEqual(page2.body.items.map((p) => p.name), ['Mira Middle']);
    assert.equal(page2.body.hasMore, false);
  });

  test('the latest reading comes first when that is the order asked for', async () => {
    const w = await practiceWithPatients();
    await GlucoseReading.create({ patient: w.oldest.user._id, valueMgDl: 180, measuredAt: new Date(), source: 'clinic' });

    const page1 = await as(w.doctor.token).get('/doctor/patients?sort=recent&limit=1&page=1');
    assert.equal(page1.status, 200, JSON.stringify(page1.body));
    assert.deepEqual(page1.body.items.map((p) => p.name), ['Zubin Oldest']);
  });

  test('an unread message puts its patient at the top of the inbox, whatever their name', async () => {
    const w = await practiceWithPatients();
    const talk = async (p, { content, minutesAgo, seen }) => {
      const enrollment = await Enrollment.findOne({ patient: p.user._id, practice: w.practice._id });
      const session = await ChatSession.create({ patient: p.user._id, kind: 'care', enrollment: enrollment._id });
      const at = new Date(Date.now() - minutesAgo * 60_000);
      await ChatMessage.create({
        session: session._id,
        patient: p.user._id,
        seq: 1,
        role: 'user',
        content,
        seenByClinicAt: seen ? new Date() : null,
        createdAt: at,
      });
      await ChatSession.updateOne({ _id: session._id }, { $set: { lastMessageAt: at, messageCount: 1 } });
    };
    // Waiting ten minutes, and nobody has read it.
    await talk(w.oldest, { content: 'Are you there?', minutesAgo: 10, seen: false });
    // More recent, and already read: second, not first.
    await talk(w.newest, { content: 'Thanks, all clear', minutesAgo: 1, seen: true });

    const page1 = await as(w.doctor.token).get('/doctor/patients?sort=inbox&limit=1&page=1');
    assert.equal(page1.status, 200, JSON.stringify(page1.body));
    assert.deepEqual(page1.body.items.map((p) => p.name), ['Zubin Oldest']);
    assert.equal(page1.body.items[0].unreadCount, 1);

    // And the rest follow by name, since nobody else has written.
    const all = await as(w.doctor.token).get('/doctor/patients?sort=inbox&limit=10&page=1');
    assert.deepEqual(all.body.items.map((p) => p.name), ['Zubin Oldest', 'Anil Newest', 'Mira Middle']);
  });
});
