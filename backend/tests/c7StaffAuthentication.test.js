import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { Membership } from '../src/models/Membership.js';
import { OtpChallenge, hashOtp } from '../src/models/OtpChallenge.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { signPhoneToken } from '../src/services/otp.js';
import { planStaffPasswordReport } from '../scripts/reportStaffPasswords.js';

/**
 * §30: staff sign in with a texted code, and nobody sets a colleague's password.
 *
 * ---- What there was --------------------------------------------------------
 *
 * The hire sheet had a "Set a password" switch, and `POST /team` took a
 * `password` and hashed it onto the new account — offered for "a handset that
 * lives on a counter with no personal phone". So the person adding a colleague
 * chose that colleague's credential and knew it, and it travelled by word of
 * mouth to the counter. Run against that code, the first test here failed: the
 * account was created, holding the password its manager had typed.
 *
 * ---- The migration policy these tests hold ---------------------------------
 *
 * New staff: no password, by anybody. Existing staff who already hold one keep
 * signing in with it — a counter handset signed in that way must not stop
 * working on the morning this deploys — until the product owner approves a
 * retirement date. That later step is a data change with its own runbook
 * (deploy/STAGING.md), not something this release does quietly.
 */

let seq = 0;
const freshPhone = () => `+9197${String(Date.now()).slice(-6)}${String((seq += 1)).padStart(2, '0')}`;

let practice;
let owner;

async function world() {
  practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  owner = await makeMember(practice, { name: 'Dr Owner', isOwner: true });
}

/** A code-based sign-in, with the code planted: only its hash is ever stored. */
async function signInWithCode(phone) {
  const sent = await as(null).post('/auth/otp/request', { phone, purpose: 'login' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  await OtpChallenge.updateOne({ phone, purpose: 'login' }, { $set: { codeHash: hashOtp('482913', phone, 'login') } });
  return as(null).post('/auth/otp/verify', { phone, purpose: 'login', code: '482913' });
}

describe('§30 a new member of staff has no password, whoever adds them', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('a hire that carries a password is refused, and no account is made', async () => {
    const phone = freshPhone();
    const res = await as(owner.token).post('/team', {
      role: ROLES.STAFF,
      name: 'Counter Desk',
      phoneToken: signPhoneToken(phone),
      password: 'Counter@2026',
    });

    assert.equal(res.status, 400, `answered ${res.status}: a manager set a colleague’s password`);
    assert.equal(res.body.error.code, 'PASSWORD_NOT_ALLOWED');
    assert.equal(await User.countDocuments({ phone }), 0, 'the account was made anyway');

    // And nothing could sign in with it.
    const login = await as(null).post('/auth/login', { phone, password: 'Counter@2026' });
    assert.equal(login.status, 401);
  });

  test('the same hire without one makes an account with no password, which signs in by code', async () => {
    const phone = freshPhone();
    const res = await as(owner.token).post('/team', {
      role: ROLES.STAFF,
      name: 'Counter Desk',
      phoneToken: signPhoneToken(phone),
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const made = await User.findById(res.body.userId).select('+passwordHash').lean();
    assert.equal(made.passwordHash ?? null, null);

    const signedIn = await signInWithCode(phone);
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));
    assert.ok(signedIn.body.accessToken);
    assert.equal(signedIn.body.user.role, ROLES.STAFF);
  });

  test('every role, not only the desk', async () => {
    for (const role of [ROLES.DOCTOR, ROLES.DIETICIAN, ROLES.PRACTICE_MANAGER]) {
      const phone = freshPhone();
      const res = await as(owner.token).post('/team', {
        role,
        name: `New ${role}`,
        phoneToken: signPhoneToken(phone),
        password: 'Chosen@ForThem1',
      });
      assert.equal(res.status, 400, `${role}: answered ${res.status}`);
      assert.equal(await User.countDocuments({ phone }), 0, `${role}: the account was made`);
    }
  });
});

describe('§30 existing passwords keep working until they are retired', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  /** A desk account made by the old hire sheet, password and all. */
  async function legacyCounter() {
    const desk = await makeMember(practice, { name: 'Counter Handset', role: ROLES.STAFF });
    const user = await User.findById(desk.user._id);
    await user.setPassword('Counter@2024');
    await user.save();
    return desk;
  }

  test('the counter signs in with the password it already has, and registers a walk-in', async () => {
    const desk = await legacyCounter();

    const login = await as(null).post('/auth/login', { phone: desk.user.phone, password: 'Counter@2024' });
    assert.equal(login.status, 200, JSON.stringify(login.body));

    const walkIn = await as(login.body.accessToken).post('/doctor/patients', {
      name: 'Walked In',
      phone: freshPhone(),
    });
    assert.equal(walkIn.status, 201, `the counter’s workflow broke: ${JSON.stringify(walkIn.body)}`);
  });

  test('a wrong password is still refused, with the same words as an unknown number', async () => {
    const desk = await legacyCounter();
    const wrong = await as(null).post('/auth/login', { phone: desk.user.phone, password: 'not-it' });
    const unknown = await as(null).post('/auth/login', { phone: freshPhone(), password: 'not-it' });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
  });

  test('adding them at another practice neither resets nor removes it', async () => {
    const desk = await legacyCounter();
    const other = await makePractice('Behala', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const otherOwner = await makeMember(other, { name: 'Dr Behala', isOwner: true });

    const joined = await as(otherOwner.token).post('/team', {
      role: ROLES.STAFF,
      name: 'Counter Handset',
      phoneToken: signPhoneToken(desk.user.phone),
    });
    assert.equal(joined.status, 201, JSON.stringify(joined.body));
    assert.equal(joined.body.existing, true);
    assert.ok(await Membership.exists({ user: desk.user._id, practice: other._id }));

    const login = await as(null).post('/auth/login', { phone: desk.user.phone, password: 'Counter@2024' });
    assert.equal(login.status, 200, 'joining a second practice broke the password they had');
  });
});

describe('§30 the report that comes before retiring existing passwords', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('lists staff who hold a password, and which of them still rely on it, and writes nothing', async () => {
    const counter = await makeMember(practice, { name: 'Counter Handset', role: ROLES.STAFF });
    const moved = await makeMember(practice, { name: 'Moved To Codes', role: ROLES.STAFF });
    for (const who of [counter, moved]) {
      const user = await User.findById(who.user._id);
      await user.setPassword('Counter@2024');
      await user.save();
    }
    // A patient the demo seed gave a password: counted, never named.
    const patient = await User.create({ name: 'Seeded Patient', phone: freshPhone(), role: ROLES.PATIENT });
    await patient.setPassword('Patient@1234');
    await patient.save();

    assert.equal((await as(null).post('/auth/login', { phone: counter.user.phone, password: 'Counter@2024' })).status, 200);
    assert.equal((await as(null).post('/auth/login', { phone: moved.user.phone, password: 'Counter@2024' })).status, 200);
    assert.equal((await signInWithCode(moved.user.phone)).status, 200);
    // The sign-in audit rows are written without being awaited; under load
    // they can land well after the response.
    const until = Date.now() + 5000;
    while (
      Date.now() < until &&
      ((await AuditLog.countDocuments({ action: 'login' })) < 2 || (await AuditLog.countDocuments({ action: 'login_otp' })) < 1)
    ) {
      await new Promise((r) => setTimeout(r, 50));
    }

    const before = await User.find({}).select('+passwordHash').lean();
    const report = await planStaffPasswordReport();

    assert.deepEqual(report.staff.map((s) => s.name).sort(), ['Counter Handset', 'Moved To Codes']);
    assert.equal(report.patients, 1);
    assert.ok(!JSON.stringify(report).includes('Seeded Patient'), 'a patient was named in a staff report');
    const byName = Object.fromEntries(report.staff.map((s) => [s.name, s]));
    assert.equal(byName['Counter Handset'].reliesOnPassword, true);
    assert.equal(byName['Moved To Codes'].reliesOnPassword, false);
    assert.deepEqual(byName['Counter Handset'].practices, [{ name: 'Salt Lake', current: true }]);

    const after = await User.find({}).select('+passwordHash').lean();
    assert.deepEqual(after, before, 'the report changed an account');
  });
});

describe('§30 the counter works without a shared password', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await world();
  });

  test('a handset signed in once by code stays signed in, and keeps registering walk-ins', async () => {
    /*
     * The migration plan for the counter, proved: nobody types a password
     * each morning and nobody shares one. The handset answers a code once and
     * then renews its own session, as the app does in the background.
     */
    const desk = await makeMember(practice, { name: 'Counter', role: ROLES.STAFF });
    const signedIn = await signInWithCode(desk.user.phone);
    assert.equal(signedIn.status, 200, JSON.stringify(signedIn.body));

    let { refreshToken } = signedIn.body;
    let accessToken;
    for (let day = 0; day < 3; day += 1) {
      const renewed = await as(null).post('/auth/refresh', { refreshToken });
      assert.equal(renewed.status, 200, `day ${day}: ${JSON.stringify(renewed.body)}`);
      ({ accessToken, refreshToken } = renewed.body);
    }

    const walkIn = await as(accessToken).post('/doctor/patients', { name: 'Walked In', phone: freshPhone() });
    assert.equal(walkIn.status, 201, JSON.stringify(walkIn.body));
  });

  test('a desk with a second line signs in to the same account from either number', async () => {
    // `altPhones`, set by scripts/addLoginNumber.js: one desk, two lines, one
    // account — the replacement for a password written on the counter.
    const desk = await makeMember(practice, { name: 'Two Lines', role: ROLES.STAFF });
    const secondLine = freshPhone();
    await User.updateOne({ _id: desk.user._id }, { $set: { altPhones: [secondLine] } });

    const res = await signInWithCode(secondLine);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(String(res.body.user.id ?? res.body.user._id), String(desk.user._id));
  });
});

describe('§30 no route sets or resets somebody’s password', () => {
  /*
   * Read from the source, because what matters is a line that must not come
   * back — a request nobody makes cannot prove a route does not exist.
   * Comments are blanked first: the notes explaining why there is no password
   * mention the word.
   */
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const code = (file) =>
    readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
  const files = ['routes', 'services', 'middleware'].flatMap((dir) =>
    readdirSync(path.join(SRC, dir), { recursive: true })
      .filter((f) => String(f).endsWith('.js'))
      .map((f) => path.join(SRC, dir, String(f))),
  );

  test('nothing in the app calls setPassword or writes a password hash', () => {
    const offenders = files.filter((f) => /\.setPassword\(|passwordHash\s*[:=]\s*[^=]/.test(code(f)))
      // The operator console's own accounts are a different model, with
      // their own reset flow and second factor; they are not clinic staff.
      .filter((f) => !/routes[\\/]admin|services[\\/]adminReset/.test(f));
    assert.deepEqual(
      offenders.map((f) => path.relative(SRC, f)),
      [],
      'a route or service sets a password on a clinic account',
    );
  });

  test('the hire route names the refusal, rather than quietly dropping the field', () => {
    const team = code(path.join(SRC, 'routes', 'team.js'));
    assert.match(team, /PASSWORD_NOT_ALLOWED/);
    assert.ok(!/setPassword/.test(team));
  });
});
