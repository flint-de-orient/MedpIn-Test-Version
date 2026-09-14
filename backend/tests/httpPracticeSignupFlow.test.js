import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import jwt from 'jsonwebtoken';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { signAccessToken } from '../src/services/tokens.js';
import { env } from '../src/config/env.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { Practice, PLAN, defaultLimitsFor } from '../src/models/Practice.js';
import { Membership, PERMISSIONS, PRESETS } from '../src/models/Membership.js';
import { PracticeApplication, APPLICATION_STATUS } from '../src/models/PracticeApplication.js';
import { OtpChallenge, hashOtp } from '../src/models/OtpChallenge.js';
import { Department } from '../src/models/Department.js';
import { Clinic } from '../src/models/Clinic.js';
import { User, ROLES } from '../src/models/User.js';
import { signPhoneToken } from '../src/services/otp.js';

/**
 * A practice signing itself up, end to end, through the real routes.
 *
 * ---- What was broken, and why it took a whole flow to see it -------------
 *
 * Each route passed its own tests and the flow did not work. The form skipped
 * a step; the proof of the phone died with the ten-minute code; a second
 * submission was told "already with us" without the reference that sentence
 * promised, because the error handler dropped every detail an AppError carried;
 * two operators approving at once made two practices; a membership that failed
 * left an account behind; the contact became a doctor whether or not they were
 * one; and the applicant, told on three screens that a decision would reach
 * them, was never written to.
 *
 * So these walk it: a code sent, answered and spent, an application filed, an
 * operator deciding, and the applicant and the app seeing the result.
 *
 * ---- Nothing leaves this process ----------------------------------------
 *
 * Outbound calls are already refused by config/outbound.js under the test
 * runner. A fetch that is not to this process's own server is refused here as
 * well, so a regression there cannot text or email anybody from a laptop whose
 * .env holds live keys. Email is read from the diagnostics channel the mailer
 * announces on when it is not allowed to send — see services/mailer.js.
 */

const ADMIN_SECRET = 'an_admin_secret_for_the_signup_flow_tests_only';
const PHONE = '+919812345611';
const MAIL_CHANNEL = 'medpin:mail';

/* No outbound calls — see httpCrossTenantAudit.test.js. */
const realFetch = globalThis.fetch;
function localOnly(input, init) {
  const url = String(input instanceof Request ? input.url : input);
  if (url.startsWith('http://127.0.0.1:')) return realFetch(input, init);
  return Promise.reject(new Error('outbound request refused by this suite'));
}

let origin;
let token;
let mail = [];
const onMail = (message) => mail.push(message);

async function call(method, path, body, opts = {}) {
  const res = await fetch(origin + path, {
    method,
    headers: {
      ...(opts.anonymous ? {} : { Authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const anonymous = { anonymous: true };

/** The same call, as somebody signed in to the app rather than the console. */
async function callAs(accessToken, method, path, body) {
  const saved = token;
  token = accessToken;
  try {
    return await call(method, path, body);
  } finally {
    token = saved;
  }
}

/** Past whatever the route does after answering, so a message sent then is visible. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

/** What a completed form posts. */
const form = (over = {}) => ({
  practiceName: 'Meridian Heart Centre',
  practiceType: 'clinic',
  specialty: 'cardiology',
  addressLine: '14 Park Street',
  city: 'Kolkata',
  state: 'West Bengal',
  postalCode: '700016',
  contactName: 'Dr Priya Nair',
  contactEmail: 'priya@meridian.example',
  contactIsPrimaryDoctor: true,
  phoneToken: signPhoneToken(PHONE),
  registrationNo: 'WB-99001',
  doctorName: 'Dr Priya Nair',
  doctorRegistrationNo: 'WBMC-4471',
  ...over,
});

/**
 * Boot, raise the ceilings this file needs, and put everything back after.
 *
 * The admin secret is set on both the parsed env and process.env: the guard
 * asks the process whether the console is switched on at all, and the token is
 * signed and checked with the parsed value. A developer's .env normally answers
 * the first, and a suite should not depend on one.
 */
function lifecycle() {
  let realLimit;
  let realSecret;
  let realProcessSecret;

  before(async () => {
    globalThis.fetch = localOnly;
    origin = await boot();
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 1000;
    realSecret = env.ADMIN_JWT_SECRET;
    realProcessSecret = process.env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    process.env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    subscribe(MAIL_CHANNEL, onMail);
    /*
     * The unique index is what makes "one open application per number" hold
     * under two requests at once. Mongoose builds indexes once per model, on
     * the first connection a process makes, and this harness hands each suite
     * a fresh database — so it is built here rather than assumed.
     */
    await PracticeApplication.createIndexes();
  });

  after(async () => {
    unsubscribe(MAIL_CHANNEL, onMail);
    env.APPLICATION_RATE_LIMIT = realLimit;
    env.ADMIN_JWT_SECRET = realSecret;
    if (realProcessSecret === undefined) delete process.env.ADMIN_JWT_SECRET;
    else process.env.ADMIN_JWT_SECRET = realProcessSecret;
    await shutdown();
    globalThis.fetch = realFetch;
  });

  beforeEach(async () => {
    await wipe();
    mail = [];
    await Department.create([
      { practice: null, key: 'cardiology', names: { en: 'Cardiology' }, isActive: true },
      { practice: null, key: 'nephrology', names: { en: 'Nephrology' }, isActive: true },
    ]);
    const admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });
}

async function submitted(over = {}) {
  const res = await call('POST', '/applications', form(over), anonymous);
  assert.equal(res.status, 201, `the application was refused: ${JSON.stringify(res.body)}`);
  return PracticeApplication.findOne({ reference: res.body.application.reference });
}

describe('a practice applies through the real routes', () => {
  lifecycle();

  test('a code is sent, answered, and spent for a proof that outlives the code', async () => {
    const sent = await call('POST', '/applications/verify/send', { phone: '98123 45611' }, anonymous);
    assert.equal(sent.status, 200);
    // Said out loud, so a form on a server with no SMS can say nothing was sent.
    assert.equal(sent.body.simulated, true, 'a test run claimed to have texted somebody');

    /*
     * Only the code's hash is ever stored, so a known code is planted on the
     * challenge — the same way the email tests plant a known token. What is
     * being tested is the route spending it.
     */
    const planted = await OtpChallenge.updateOne(
      { phone: PHONE, purpose: 'practice' },
      { $set: { codeHash: hashOtp('482913', PHONE, 'practice') } },
    );
    assert.equal(planted.matchedCount, 1, 'the code was not stored against the normalised number');

    const checked = await call(
      'POST',
      '/applications/verify/check',
      { phone: PHONE, code: '482913' },
      anonymous,
    );
    assert.equal(checked.status, 200);

    /*
     * Its own lifetime. The code lives ten minutes because the SMS says so;
     * the proof has to survive the registration numbers and the review screen
     * after it, and dying with the code sent people round in a circle.
     */
    const claims = jwt.decode(checked.body.phoneToken);
    assert.equal(claims.phone, PHONE);
    assert.equal(claims.exp - claims.iat, env.APPLICATION_PHONE_TOKEN_MINUTES * 60);
    assert.ok(env.APPLICATION_PHONE_TOKEN_MINUTES > env.OTP_TTL_MINUTES);

    const res = await call('POST', '/applications', form({ phoneToken: checked.body.phoneToken }), anonymous);
    assert.equal(res.status, 201);
    const row = await PracticeApplication.findOne({}).lean();
    assert.equal(row.contactPhone, PHONE);
  });

  test('a proof that has expired says so by name, and nothing is written', async () => {
    for (const use of ['practice_application', 'phone_verified']) {
      const stale = jwt.sign({ phone: PHONE, use }, env.JWT_ACCESS_SECRET, {
        issuer: 'akd-care',
        expiresIn: -60,
      });
      const res = await call('POST', '/applications', form({ phoneToken: stale }), anonymous);
      assert.equal(res.status, 400);
      assert.equal(res.body.error.code, 'PHONE_TOKEN_EXPIRED', `an expired ${use} proof was not named`);
    }
    assert.equal(await PracticeApplication.countDocuments({}), 0);
  });

  test('a second application from an open number is answered with the reference it has', async () => {
    const first = await call('POST', '/applications', form(), anonymous);
    const again = await call('POST', '/applications', form({ practiceName: 'Meridian, again' }), anonymous);

    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'APPLICATION_OPEN');
    // The sentence promises a reference. It is the thing they most likely lost.
    assert.equal(again.body.error.details.reference, first.body.application.reference);
  });

  test('several submissions at the same moment make one application', async () => {
    // Pressing the button four times on a slow connection. Every one of them
    // reads "nothing open" before any of them has written.
    const results = await Promise.all(
      [1, 2, 3, 4].map((n) =>
        call('POST', '/applications', form({ practiceName: `Meridian ${n}` }), anonymous),
      ),
    );

    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [201, 409, 409, 409],
      JSON.stringify(results.map((r) => r.body)),
    );
    assert.equal(await PracticeApplication.countDocuments({}), 1);

    const reference = results.find((r) => r.status === 201).body.application.reference;
    for (const refused of results.filter((r) => r.status === 409)) {
      assert.equal(refused.body.error.code, 'APPLICATION_OPEN');
      assert.equal(refused.body.error.details.reference, reference);
    }
  });

  test('and the database refuses a second open application whatever path reaches it', async () => {
    const row = {
      practiceName: 'Meridian Heart Centre',
      contactName: 'Dr Priya Nair',
      contactEmail: 'priya@meridian.example',
      contactPhone: PHONE,
      phoneVerifiedAt: new Date(),
    };
    await PracticeApplication.create(row);
    await assert.rejects(
      PracticeApplication.create({ ...row, practiceName: 'Meridian, twice' }),
      (err) => err.code === 11000,
      'two open applications for one number were written',
    );

    // A decided one is not open. A rejection is not a ban.
    await PracticeApplication.updateMany({}, { $set: { status: APPLICATION_STATUS.REJECTED } });
    await PracticeApplication.create({ ...row, practiceName: 'Meridian, with the papers' });
  });

  test('a doctor who already signs in to MedPin may apply for a practice of their own', async () => {
    // One person can run two practices, and approval joins the account that
    // exists rather than making a second Dr Nair.
    await User.create({ name: 'Dr Priya Nair', phone: PHONE, role: ROLES.DOCTOR, isActive: true });

    const sent = await call('POST', '/applications/verify/send', { phone: PHONE }, anonymous);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal((await call('POST', '/applications', form(), anonymous)).status, 201);
  });

  test('but a patient, desk or dietician number is refused, and told why', async () => {
    const roles = [ROLES.PATIENT, ROLES.STAFF, ROLES.DIETICIAN];
    for (const [i, role] of roles.entries()) {
      const phone = `+91981234570${i}`;
      await User.create({ name: `Someone ${i}`, phone, role, isActive: true });

      const sent = await call('POST', '/applications/verify/send', { phone }, anonymous);
      assert.equal(sent.status, 409, `a ${role} number was sent a code`);
      assert.equal(sent.body.error.code, 'ACCOUNT_NOT_ELIGIBLE');
      assert.match(sent.body.error.message, new RegExp(role), 'the refusal does not say what the account is');

      // And a proof obtained some other way does not get round it.
      const res = await call('POST', '/applications', form({ phoneToken: signPhoneToken(phone) }), anonymous);
      assert.equal(res.status, 409, `a ${role} number filed an application`);
      assert.equal(res.body.error.code, 'ACCOUNT_NOT_ELIGIBLE');
    }
    assert.equal(await PracticeApplication.countDocuments({}), 0);
  });
});

describe('an operator’s decision reaches the applicant', () => {
  lifecycle();

  const approve = (a, body = { note: 'Council register checked.' }) =>
    call('POST', `/admin/applications/${a._id}/approve`, body);

  test('approving tells them how to sign in: the app, their number, a texted code', async () => {
    const a = await submitted();
    mail = [];

    const res = await approve(a);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await settle();

    const sent = mail.find((m) => m.to === 'priya@meridian.example');
    assert.ok(sent, 'nothing was written to the applicant');
    assert.match(sent.subject, /approved/i);
    assert.match(sent.text, /MedPin app/);
    assert.ok(sent.text.includes(PHONE), 'the email does not say which number signs in');
    assert.match(sent.text, /code/);
    // The approval note is the platform's, and the console says so.
    assert.ok(!sent.text.includes('Council register checked'), 'the internal note went to the applicant');
  });

  test('a request for more information carries the question', async () => {
    const a = await submitted();
    mail = [];

    const res = await call('POST', `/admin/applications/${a._id}/request-info`, {
      note: 'Send the establishment licence for the Park Street address.',
    });
    assert.equal(res.status, 200);
    await settle();

    const sent = mail.find((m) => m.to === 'priya@meridian.example');
    assert.ok(sent, 'the question never left the console');
    assert.match(sent.text, /establishment licence/);
    assert.ok(sent.text.includes(a.reference));
  });

  test('a rejection carries its reason, and says they may apply again', async () => {
    const a = await submitted();
    mail = [];

    await call('POST', `/admin/applications/${a._id}/reject`, {
      note: 'The registration number belongs to a different organisation.',
    });
    await settle();

    const sent = mail.find((m) => m.to === 'priya@meridian.example');
    assert.ok(sent, 'a rejection was never sent');
    assert.match(sent.text, /different organisation/);
    assert.match(sent.text, /apply again/);
  });

  test('the status page does not show the note an approval was given', async () => {
    const a = await submitted();
    await approve(a);

    const seen = await call('GET', `/applications/${a.reference}`, undefined, anonymous);
    assert.equal(seen.body.application.status, APPLICATION_STATUS.APPROVED);
    assert.ok(
      !JSON.stringify(seen.body).includes('Council register checked'),
      'the applicant can read the note the console says nobody at the practice sees',
    );
  });

  test('two operators approving at the same moment create one practice', async () => {
    /*
     * No registration number and an account that already exists, so neither
     * of the two things that sometimes stopped the second approval by accident
     * — the licence clash, and the unique phone on a second new account — is
     * there to hide the race. Both requests read "undecided", and without a
     * guard both provision a practice and join the same doctor to it.
     */
    await User.create({ name: 'Dr Priya Nair', phone: PHONE, role: ROLES.DOCTOR, isActive: true });
    const a = await submitted({ registrationNo: '' });

    const results = await Promise.all([approve(a), approve(a, { note: 'Also checked.' })]);

    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], JSON.stringify(results.map((r) => r.body)));
    assert.equal(await Practice.countDocuments({}), 1, 'one clinic became two practices');
    assert.equal(await Membership.countDocuments({}), 1);
  });

  test('a membership that cannot be written leaves no account and no practice behind', async () => {
    const a = await submitted();

    const real = Membership.create;
    Membership.create = async () => {
      throw new Error('the membership could not be written');
    };
    let res;
    try {
      res = await approve(a);
    } finally {
      Membership.create = real;
    }

    assert.equal(res.status, 500);
    assert.equal(await Practice.countDocuments({}), 0, 'a practice was left with nobody in it');
    assert.equal(await User.countDocuments({ phone: PHONE }), 0, 'an account was left belonging to nothing');
    const after = await PracticeApplication.findById(a._id).lean();
    assert.equal(after.status, APPLICATION_STATUS.SUBMITTED, 'a failed approval moved the application');

    // And the attempt did not keep hold of it: once the fault is gone it approves.
    assert.equal((await approve(a)).status, 200);
  });

  test('approval keeps what the application said: the address, the department, the email, the proved number', async () => {
    const a = await submitted({
      practiceType: 'polyclinic',
      departments: ['cardiology', 'nephrology'],
      doctorDepartment: 'nephrology',
    });

    const res = await approve(a);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const practice = await Practice.findById(res.body.practice.id).lean();

    const location = await Clinic.findOne({ practice: practice._id }).lean();
    assert.ok(location, 'the address on the application became no location');
    assert.equal(location.name, 'Meridian Heart Centre');
    assert.match(location.addressLine, /14 Park Street/);
    assert.match(location.addressLine, /700016/);
    assert.equal(location.city, 'Kolkata');
    // The applicant's mobile is a person's number, not the clinic's line. It
    // is not handed to patients as "Call clinic".
    assert.ok(!location.phone, 'the applicant’s own mobile was published as the clinic’s number');

    const owner = await Membership.findOne({ practice: practice._id, isOwner: true }).populate('user').lean();
    const nephrology = await Department.findOne({ practice: practice._id, key: 'nephrology' }).lean();
    assert.ok(nephrology, 'the department was not created for the practice');
    assert.equal(String(owner.department), String(nephrology._id), 'the doctor’s department was dropped');
    assert.equal(owner.user.email, 'priya@meridian.example', 'the email the applicant gave was dropped');
    assert.ok(owner.user.phoneVerifiedAt, 'a number proved by a code is recorded as never proved');

    assert.deepEqual(
      { ...practice.limits },
      defaultLimitsFor(PLAN.TRIAL),
      'the practice was created with no limits at all',
    );
  });

  test('with one department, it is the doctor’s', async () => {
    const a = await submitted({ practiceType: 'polyclinic', departments: ['cardiology'] });
    const res = await approve(a);
    const owner = await Membership.findOne({ practice: res.body.practice.id, isOwner: true }).lean();
    const cardiology = await Department.findOne({ practice: res.body.practice.id, key: 'cardiology' }).lean();
    assert.equal(String(owner.department), String(cardiology._id));
  });

  test('an email another account already uses is not copied, and does not stop the approval', async () => {
    await User.create({
      name: 'Somebody Else',
      phone: '+919812345699',
      email: 'priya@meridian.example',
      role: ROLES.DOCTOR,
      isActive: true,
    });
    const a = await submitted();

    const res = await approve(a);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const owner = await User.findOne({ phone: PHONE }).lean();
    assert.equal(owner.email ?? null, null);
  });

  test('a contact who is not the doctor becomes the practice manager, who cannot prescribe', async () => {
    const a = await submitted({
      contactName: 'Rahul Bose',
      contactIsPrimaryDoctor: false,
      doctorName: 'Dr Priya Nair',
      doctorRegistrationNo: 'WBMC-4471',
    });
    mail = [];

    const res = await approve(a);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    await settle();

    const practice = await Practice.findById(res.body.practice.id).lean();
    const owner = await Membership.findOne({ practice: practice._id, isOwner: true }).populate('user').lean();

    assert.equal(owner.role, ROLES.PRACTICE_MANAGER);
    assert.equal(owner.user.role, ROLES.PRACTICE_MANAGER);
    assert.equal(owner.user.name, 'Rahul Bose', 'the manager’s account was named after the doctor');
    assert.ok(!owner.permissions.includes(PERMISSIONS.PRESCRIBE), 'a practice manager can prescribe');
    assert.deepEqual([...owner.permissions].sort(), [...PRESETS.manager].sort());
    assert.ok(!owner.user.registrationNo, 'the doctor’s council number was put on the manager’s account');
    assert.equal(practice.headDoctor ?? null, null, 'a manager was recorded as the head doctor');

    // The doctor they named is kept, so the practice knows who to invite.
    assert.equal(practice.namedDoctor?.name, 'Dr Priya Nair');
    assert.equal(practice.namedDoctor?.registrationNo, 'WBMC-4471');

    const sent = mail.find((m) => /approved/i.test(m.subject));
    assert.ok(sent, 'no approval was sent');
    // The screen the app titles People — its route is /clinician/team, and the
    // word a manager will look for is the one on the screen.
    assert.match(sent.text, /People/);
    assert.match(sent.text, /Dr Priya Nair/);
  });

  test('and that manager can add the practice’s doctor from the People screen', async () => {
    /*
     * The email tells a manager to add their doctor in the app. Hiring was
     * doctor-only, written when every owner was a doctor, so the People screen
     * showed a manager "Add someone" — they hold MANAGE_STAFF — and refused
     * them on pressing it: a practice whose owner could not add its own doctor.
     */
    const a = await submitted({
      contactName: 'Rahul Bose',
      contactIsPrimaryDoctor: false,
      doctorName: 'Dr Priya Nair',
    });
    const res = await approve(a);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const manager = await User.findOne({ phone: PHONE });
    const session = signAccessToken(manager);

    const roster = await callAs(session, 'GET', '/team');
    assert.equal(roster.status, 200);
    assert.equal(roster.body.canManage, true);

    const hired = await callAs(session, 'POST', '/team', {
      role: ROLES.DOCTOR,
      name: 'Dr Priya Nair',
      phoneToken: signPhoneToken('+919812345620'),
    });
    assert.equal(hired.status, 201, JSON.stringify(hired.body));
  });

  test('but a manager who does not own the practice still cannot hire, and is not offered it', async () => {
    // Ownership is what admits the manager above, not the role — so this is no
    // wider than it was for anybody the owner hired.
    const practice = await makePractice('Somewhere Else');
    const hiredManager = await makeMember(practice, {
      name: 'Hired Manager',
      role: ROLES.PRACTICE_MANAGER,
    });

    const roster = await callAs(hiredManager.token, 'GET', '/team');
    assert.equal(roster.body.canManage, false, 'the screen offers a button the route refuses');

    const hired = await callAs(hiredManager.token, 'POST', '/team', {
      role: ROLES.DOCTOR,
      name: 'Dr Somebody',
      phoneToken: signPhoneToken('+919812345621'),
    });
    assert.equal(hired.status, 403);
  });

  test('a doctor who already has an account keeps it, and the log says it was reused', async () => {
    const existing = await User.create({
      name: 'Dr Priya Nair',
      phone: PHONE,
      role: ROLES.DOCTOR,
      isActive: true,
    });
    const a = await submitted();

    const res = await approve(a);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await User.countDocuments({ phone: PHONE }), 1, 'a second account was made for one doctor');

    const owner = await Membership.findOne({ isOwner: true }).lean();
    assert.equal(String(owner.user), String(existing._id));

    const entry = await AdminAuditLog.findOne({ action: 'admin.application.approve' }).lean();
    assert.equal(entry.after.ownerAccount, 'existing');
    assert.equal(res.body.outcome.accountReused, true);
  });
});

describe('the operator is told when applications are waiting', () => {
  lifecycle();

  test('undecided applications are on the attention list, with somewhere to go', async () => {
    await submitted();
    await submitted({
      practiceName: 'Second Clinic',
      registrationNo: 'WB-2',
      phoneToken: signPhoneToken('+919812345612'),
    });
    // Waiting on the applicant, not the operator.
    const third = await submitted({
      practiceName: 'Third Clinic',
      registrationNo: 'WB-3',
      phoneToken: signPhoneToken('+919812345613'),
    });
    await PracticeApplication.updateOne({ _id: third._id }, { $set: { status: APPLICATION_STATUS.MORE_INFO } });

    const res = await call('GET', '/admin/attention');
    assert.equal(res.status, 200);
    const item = res.body.items.find((i) => i.kind === 'applications');
    assert.ok(item, 'applications are waiting and the overview says nothing is');
    assert.equal(item.count, 2);
    assert.equal(item.href, '/signups/');
  });

  test('and says nothing about them when none are', async () => {
    const res = await call('GET', '/admin/attention');
    assert.equal(res.body.items.find((i) => i.kind === 'applications'), undefined);
  });
});

describe('the app does not turn a waiting applicant into a patient', () => {
  lifecycle();

  test('signing in with a number under review says the application is being reviewed', async () => {
    await submitted();

    const res = await call('POST', '/auth/otp/request', { phone: PHONE, purpose: 'login' }, anonymous);
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'APPLICATION_PENDING');
    assert.match(res.body.error.message, /application/i);
  });

  test('and that number cannot be registered as a patient either way in', async () => {
    await submitted();

    const code = await call('POST', '/auth/otp/request', { phone: PHONE, purpose: 'register' }, anonymous);
    assert.equal(code.status, 409);
    assert.equal(code.body.error.code, 'APPLICATION_PENDING');

    const register = await call(
      'POST',
      '/auth/register',
      { name: 'Priya Nair', phoneToken: signPhoneToken(PHONE), language: 'en' },
      anonymous,
    );
    assert.equal(register.status, 409);
    assert.equal(register.body.error.code, 'APPLICATION_PENDING');
    assert.equal(await User.countDocuments({ phone: PHONE }), 0, 'a waiting applicant was made a patient');
  });

  test('once the application is decided against, the number is an ordinary unknown one again', async () => {
    const a = await submitted();
    await PracticeApplication.updateOne({ _id: a._id }, { $set: { status: APPLICATION_STATUS.REJECTED } });

    const res = await call('POST', '/auth/otp/request', { phone: PHONE, purpose: 'login' }, anonymous);
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });
});
