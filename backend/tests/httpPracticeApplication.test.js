import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { Membership } from '../src/models/Membership.js';
import { PracticeApplication, APPLICATION_STATUS } from '../src/models/PracticeApplication.js';
import { signPhoneToken } from '../src/services/otp.js';
import { createHash } from 'node:crypto';
import { Department } from '../src/models/Department.js';
import { OtpChallenge } from '../src/models/OtpChallenge.js';
import { User, ROLES } from '../src/models/User.js';
import { env } from '../src/config/env.js';

/**
 * A practice asking to exist, and an operator deciding.
 *
 * ---- The line this whole surface is drawn around ------------------------
 *
 * A Practice is a tenant. Capability resolution, billing, enrolment scoping
 * and the audit trail all point at one, so a web form that created a Practice
 * would make anybody who filled it in a tenant on this platform.
 *
 * An application therefore creates nothing. It is a row that grants nothing,
 * and the first moment a tenant exists is when an operator approves it — down
 * the same code path they use to create one by hand.
 */

const ADMIN_SECRET = 'an_admin_secret_for_the_application_tests';
const PHONE = '+919812345601';

let origin;
let realAdminSecret;
let realLimit;
let token;

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

/** What a completed form posts: details, plus proof of the number. */
const form = (over = {}) => ({
  practiceName: 'Meridian Heart Centre',
  practiceType: 'specialty_centre',
  specialty: 'cardiology',
  addressLine: '14 Park Street',
  city: 'Kolkata',
  state: 'West Bengal',
  postalCode: '700016',
  contactName: 'Dr Priya Nair',
  contactEmail: 'priya@meridian.example',
  phoneToken: signPhoneToken(PHONE),
  registrationNo: 'WB-99001',
  doctorName: 'Dr Priya Nair',
  doctorRegistrationNo: 'WBMC-4471',
  ...over,
});

/**
 * The ceiling the two suites below raise.
 *
 * They set it to a thousand so twenty applications can come from one address,
 * and a limiter switched off for a suite is a limiter nobody has watched work.
 * This one lowers it instead.
 *
 * First in the file on purpose. `express-rate-limit` keeps its counter in the
 * process, not the database, so `wipe()` does not touch it — a suite that ran
 * after the others would start with their twenty requests already counted and
 * refuse its own first one.
 */
describe('a public write has a ceiling', () => {
  before(async () => {
    origin = await boot();
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 2;
  });

  after(async () => {
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });

  beforeEach(wipe);

  test('and refuses past it, without writing', async () => {
    // Distinct numbers, so the one-open-application rule is not what refuses.
    const post = (n) =>
      call(
        'POST',
        '/applications',
        form({
          practiceName: `Clinic ${n}`,
          phoneToken: signPhoneToken(`+91981234560${n}`),
          registrationNo: `WB-${n}0000`,
        }),
        { anonymous: true },
      );

    assert.equal((await post(1)).status, 201);
    assert.equal((await post(2)).status, 201);

    const third = await post(3);
    assert.equal(third.status, 429, 'the limiter let a third through');
    assert.equal(third.body.error.code, 'RATE_LIMITED');

    // Refused before the handler, so nothing was written.
    assert.equal(await PracticeApplication.countDocuments({}), 2);
  });
});

describe('a practice applies', () => {
  before(async () => {
    origin = await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;

    /*
     * The submit limiter is six an hour per address, and this whole file is
     * one address. Raised rather than switched off: the middleware still runs
     * on every request, and the last test in the file lowers it to prove it
     * refuses.
     */
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 1000;
  });

  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
    const admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });

  test('and nothing becomes a tenant', async () => {
    // The claim the whole surface rests on. An application is a row that
    // grants nothing: no practice, nobody in one, no membership anywhere.
    const res = await call('POST', '/applications', form(), { anonymous: true });
    assert.equal(res.status, 201);

    assert.equal(await Practice.countDocuments({}), 0, 'a web form created a tenant');
    assert.equal(await Membership.countDocuments({}), 0, 'a web form created a membership');
  });

  test('the applicant gets a reference and nothing else to guess with', async () => {
    const res = await call('POST', '/applications', form(), { anonymous: true });

    assert.match(res.body.application.status, /submitted/);
    // Long and random. A sequential id would let anybody read a stranger's
    // contact details and licence number by counting upwards.
    assert.ok(res.body.application.reference.length >= 10);
    assert.equal(res.body.application.id, undefined, 'the row id reached the applicant');
  });

  test('the number stored is the one that was proved', async () => {
    /*
     * The submission carries a token, not a phone field. Taking both and
     * trusting them to agree is how somebody verifies one number and submits
     * another — the same mistake the practice wizard guards against.
     */
    await call(
      'POST',
      '/applications',
      { ...form(), contactPhone: '+919800000000' },
      { anonymous: true },
    );

    const row = await PracticeApplication.findOne({}).lean();
    assert.equal(row.contactPhone, PHONE);
  });

  test('and an unproved number is refused outright', async () => {
    const res = await call(
      'POST',
      '/applications',
      { ...form(), phoneToken: 'not-a-token' },
      { anonymous: true },
    );
    assert.equal(res.status, 400);
    assert.equal(await PracticeApplication.countDocuments({}), 0);
  });

  test('pressing submit twice does not make two queues of one clinic', async () => {
    await call('POST', '/applications', form(), { anonymous: true });
    const again = await call('POST', '/applications', form(), { anonymous: true });

    assert.equal(again.status, 400);
    assert.equal(await PracticeApplication.countDocuments({}), 1);
  });

  test('but a decided application does not bar a second attempt', async () => {
    // A rejection is not a ban. A practice turned down for missing papers
    // should be able to come back with them.
    await call('POST', '/applications', form(), { anonymous: true });
    await PracticeApplication.updateOne({}, { $set: { status: APPLICATION_STATUS.REJECTED } });

    const again = await call('POST', '/applications', form(), { anonymous: true });
    assert.equal(again.status, 201);
  });

  test('the applicant can read their own status without an account', async () => {
    const made = await call('POST', '/applications', form(), { anonymous: true });
    const ref = made.body.application.reference;

    const res = await call('GET', `/applications/${ref}`, undefined, { anonymous: true });
    assert.equal(res.status, 200);
    assert.equal(res.body.application.practiceName, 'Meridian Heart Centre');
  });

  test('and a wrong reference says nothing at all', async () => {
    const res = await call('GET', '/applications/aaaaaaaaaaaa', undefined, { anonymous: true });
    assert.equal(res.status, 404);
  });
});

describe('an operator decides', () => {
  before(async () => {
    origin = await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;

    /*
     * The submit limiter is six an hour per address, and this whole file is
     * one address. Raised rather than switched off: the middleware still runs
     * on every request, and the last test in the file lowers it to prove it
     * refuses.
     */
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 1000;
  });

  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
    const admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });

  async function submitted(over = {}) {
    const res = await call('POST', '/applications', form(over), { anonymous: true });
    const row = await PracticeApplication.findOne({ reference: res.body.application.reference });
    return row;
  }

  test('the queue is closed to anybody without an operator session', async () => {
    // The one surface on this platform that turns a web form into a tenant.
    await submitted();
    const res = await call('GET', '/admin/applications', undefined, { anonymous: true });
    assert.equal(res.status, 401);
  });

  test('and approving is closed to them too', async () => {
    const a = await submitted();
    const res = await call(
      'POST',
      `/admin/applications/${a._id}/approve`,
      { note: 'Looks fine' },
      { anonymous: true },
    );
    assert.equal(res.status, 401);
    assert.equal(await Practice.countDocuments({}), 0);
  });

  test('every decision needs a reason', async () => {
    // Including approval. "Approved" with nothing beside it is a decision
    // nobody can review, and the applicant reads the note on the other two.
    const a = await submitted();
    for (const action of ['approve', 'reject', 'request-info']) {
      const res = await call('POST', `/admin/applications/${a._id}/${action}`, {});
      assert.equal(res.status, 400, `${action} was allowed with no reason`);
    }
  });

  test('approving creates the practice, with somebody in it', async () => {
    /*
     * Down the same path an operator uses by hand. The alternative is an
     * "approved" application somebody then has to turn into a practice, which
     * is the same shape as "I will add the doctor next" — a second step that
     * does not reliably happen.
     */
    const a = await submitted();
    const res = await call('POST', `/admin/applications/${a._id}/approve`, {
      note: 'Council register checked.',
    });
    assert.equal(res.status, 200);

    const practice = await Practice.findOne({ name: 'Meridian Heart Centre' }).lean();
    assert.ok(practice, 'approval did not produce a practice');
    assert.equal(practice.status, PRACTICE_STATUS.ONBOARDING);
    assert.equal(practice.verification, VERIFICATION.UNVERIFIED, 'approval vouched for the papers');

    // And the head doctor, immediately — a practice with nobody in it is one
    // somebody can navigate to and find empty.
    const owner = await Membership.findOne({ practice: practice._id, isOwner: true }).lean();
    assert.ok(owner, 'the practice was created with nobody in it');
  });

  test('the head doctor is the number the applicant proved', async () => {
    // It has been theirs since before the application existed. Taking a fresh
    // number at approval would accept an unverified one where it matters most.
    const a = await submitted();
    await call('POST', `/admin/applications/${a._id}/approve`, { note: 'Checked.' });

    const practice = await Practice.findOne({}).lean();
    const owner = await Membership.findOne({ practice: practice._id, isOwner: true })
      .populate('user', 'phone')
      .lean();
    assert.equal(owner.user.phone, PHONE);
  });

  test('and the application points at what it became', async () => {
    const a = await submitted();
    await call('POST', `/admin/applications/${a._id}/approve`, { note: 'Checked.' });

    const after = await PracticeApplication.findById(a._id).lean();
    assert.equal(after.status, APPLICATION_STATUS.APPROVED);
    assert.ok(after.practice, 'the application does not say what practice it produced');
  });

  test('a decided application cannot be decided again', async () => {
    // Approving twice would create a second practice for one clinic.
    const a = await submitted();
    await call('POST', `/admin/applications/${a._id}/approve`, { note: 'Checked.' });

    const again = await call('POST', `/admin/applications/${a._id}/approve`, { note: 'Again.' });
    assert.equal(again.status, 400);
    assert.equal(await Practice.countDocuments({}), 1);
  });

  test('a duplicate licence is refused, and leaves nothing behind', async () => {
    /*
     * The compensation in provisionPractice, reached from this side. The
     * practice row is created before the head doctor can be attached, so a
     * failure part-way must not leave a tenant with nobody in it.
     */
    await makePractice('Existing Clinic', { registrationNo: 'WB-99001' });
    const a = await submitted();

    const res = await call('POST', `/admin/applications/${a._id}/approve`, { note: 'Checked.' });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /already belongs to/);

    assert.equal(await Practice.countDocuments({}), 1, 'a half-made practice was left behind');
    const after = await PracticeApplication.findById(a._id).lean();
    assert.equal(after.status, APPLICATION_STATUS.SUBMITTED, 'the application moved on a failure');
  });

  test('asking for more information sends it back with the question', async () => {
    const a = await submitted();
    const res = await call('POST', `/admin/applications/${a._id}/request-info`, {
      note: 'Send the establishment licence for the Park Street address.',
    });
    assert.equal(res.status, 200);

    // The note is the only thing that reaches the applicant, and it is the
    // whole point of this action.
    const seen = await call('GET', `/applications/${a.reference}`, undefined, { anonymous: true });
    assert.equal(seen.body.application.status, APPLICATION_STATUS.MORE_INFO);
    assert.match(seen.body.application.latestNote, /establishment licence/);
  });

  test('a rejection reaches them too, with its reason', async () => {
    const a = await submitted();
    await call('POST', `/admin/applications/${a._id}/reject`, {
      note: 'The registration number belongs to a different organisation.',
    });

    const seen = await call('GET', `/applications/${a.reference}`, undefined, { anonymous: true });
    assert.equal(seen.body.application.status, APPLICATION_STATUS.REJECTED);
    assert.match(seen.body.application.latestNote, /different organisation/);
  });

  test('and the applicant is never shown who decided', async () => {
    // The trail is the platform's. What the applicant needs is the question or
    // the reason, not the name of the operator who asked it.
    const a = await submitted();
    await call('POST', `/admin/applications/${a._id}/reject`, { note: 'No.' });

    const seen = await call('GET', `/applications/${a.reference}`, undefined, { anonymous: true });
    assert.equal(JSON.stringify(seen.body).includes('ops@example.com'), false);
  });

  test('every decision is in the platform log', async () => {
    const a = await submitted();
    await call('POST', `/admin/applications/${a._id}/approve`, { note: 'Council checked.' });

    const entry = await AdminAuditLog.findOne({ action: 'admin.application.approve' }).lean();
    assert.ok(entry, 'an approval was not recorded');
    assert.match(entry.reason, /Council checked/);
    // Both ends: the trail reads from the application and from the practice.
    assert.ok(entry.practice, 'the approval does not name the practice it created');
  });

  test('the counts describe the queue, not the current filter', async () => {
    await submitted();
    await PracticeApplication.updateOne({}, { $set: { status: APPLICATION_STATUS.REJECTED } });
    await submitted({ practiceName: 'Second Clinic' });

    const res = await call('GET', '/admin/applications?open=true');
    assert.equal(res.body.items.length, 1, 'a decided application is in the open queue');
    assert.equal(res.body.counts.all, 2);
    assert.equal(res.body.counts.open, 1);
    assert.equal(res.body.counts.rejected, 1);
  });
});

/**
 * What an application has to contain, and where the number is proved.
 *
 * ---- Two things a review found ------------------------------------------
 *
 * The form marked six of its seven practice fields "optional", so an
 * application could arrive as a name and a phone number. An operator reviewing
 * one is deciding whether a real clinic exists at a real address, and there is
 * nothing to decide on the evidence of a name. Checked here and not only on the
 * form: a client is a convenience, the route is the rule.
 *
 * And the form proved the number against `/auth/otp/request`, which 404ed in
 * production and nowhere else. The console is served from its own host and
 * reverse-proxies `/api/v1/admin/` and `/api/v1/applications/` — not
 * `/api/v1/auth/`. Widening the proxy would put the clinic's patient-facing
 * API on the operator origin to gain one endpoint, so the public flow owns its
 * verification and everything an applicant touches is under one prefix.
 */
describe('an application says where the practice is', () => {
  // `origin` is module-scoped and `call` reads it; `before(boot)` alone boots
  // the harness and leaves it undefined, which fails as "fetch failed".
  //
  // The limit is raised because these tests assert on validation, and six
  // submissions an hour is a rule about a queue somebody works rather than
  // about the shape of a request. Left at its real value, the third assertion
  // in a loop reads a 429 and reports the field as accepted.
  before(async () => {
    origin = await boot();
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 500;
  });
  after(async () => {
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });
  beforeEach(wipe);

  for (const [field, value] of [
    ['addressLine', ''],
    ['city', ''],
    ['state', ''],
  ]) {
    test(`${field} is required`, async () => {
      const res = await call('POST', '/applications', form({ [field]: value }), { anonymous: true });
      assert.equal(res.status, 400, `an application with no ${field} was accepted`);
    });
  }

  test('and a PIN has to be six digits', async () => {
    // A reviewer looking one up can do nothing with five.
    for (const bad of ['70001', '7000166', 'abc123', '']) {
      const res = await call('POST', '/applications', form({ postalCode: bad }), { anonymous: true });
      assert.equal(res.status, 400, `"${bad}" was accepted as a PIN`);
    }
    assert.equal((await call('POST', '/applications', form(), { anonymous: true })).status, 201);
  });

  test('the type and the specialty stay optional', async () => {
    /*
     * Deliberately not tightened with the rest. The model permits null for both
     * and the capability resolver reads null as unclassified, so requiring them
     * would be a stricter rule than anything else in the system enforces — and
     * a clinic that has not decided what to call itself would be unable to
     * apply.
     */
    const res = await call(
      'POST',
      '/applications',
      { ...form(), practiceType: undefined, specialty: undefined },
      { anonymous: true },
    );
    assert.equal(res.status, 201);
  });
});

describe('the number is proved inside the application namespace', () => {
  // `origin` is module-scoped and `call` reads it; `before(boot)` alone boots
  // the harness and leaves it undefined, which fails as "fetch failed".
  //
  // The limit is raised because these tests assert on validation, and six
  // submissions an hour is a rule about a queue somebody works rather than
  // about the shape of a request. Left at its real value, the third assertion
  // in a loop reads a 429 and reports the field as accepted.
  before(async () => {
    origin = await boot();
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 500;
  });
  after(async () => {
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });
  beforeEach(wipe);

  const NEW_PHONE = '+919812345699';

  test('a code is sent, and spends for a token', async () => {
    const sent = await call('POST', '/applications/verify/send', { phone: NEW_PHONE }, { anonymous: true });
    assert.equal(sent.status, 200);

    const challenge = await OtpChallenge.findOne({ phone: NEW_PHONE, purpose: 'practice' }).lean();
    assert.ok(challenge, 'no code was stored against the practice purpose');

    // Its own purpose, so a login or an enrolment code arriving mid-application
    // cannot burn the one being waited on.
    assert.equal(challenge.purpose, 'practice');
  });

  test('and a number that already signs in somewhere is refused', async () => {
    /*
     * Applying is for a practice that is not on the platform. Somebody who can
     * already sign in is either an existing customer — whose practice should be
     * edited rather than created again — or is about to be sent a code that
     * would let an application claim their number.
     */
    await User.create({ name: 'Dr Sen', phone: NEW_PHONE, role: ROLES.DOCTOR, isActive: true });

    const res = await call('POST', '/applications/verify/send', { phone: NEW_PHONE }, { anonymous: true });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /already has a MedPin account/);
  });

  test('a wrong code buys nothing', async () => {
    await call('POST', '/applications/verify/send', { phone: NEW_PHONE }, { anonymous: true });
    const res = await call(
      'POST',
      '/applications/verify/check',
      { phone: NEW_PHONE, code: '000000' },
      { anonymous: true },
    );
    assert.equal(res.status, 401);
    assert.ok(!res.body.phoneToken, 'a token was issued for a code that was not right');
  });

  test('and the token carries the number, not the form', async () => {
    // The submission reads the phone out of the token. A separate field beside
    // the proof is a field somebody can disagree with it about.
    await call('POST', '/applications/verify/send', { phone: NEW_PHONE }, { anonymous: true });
    const challenge = await OtpChallenge.findOne({ phone: NEW_PHONE, purpose: 'practice' }).lean();
    assert.ok(challenge.codeHash, 'nothing to spend');

    const res = await call(
      'POST',
      '/applications/verify/check',
      { phone: NEW_PHONE, code: '999999' },
      { anonymous: true },
    );
    assert.equal(res.status, 401);
  });
});

/**
 * The address the decision has to reach.
 *
 * ---- Why this is confirmed after submitting, not before -----------------
 *
 * The phone is proved first because it becomes the sign-in for the practice.
 * The email is different: it is where the answer goes, and the answer is days
 * away. Sending somebody out of a part-filled form to fetch a code from an
 * inbox is friction paid at the worst moment for a check that matters later.
 *
 * So one email goes out on submission carrying the reference and the
 * confirmation together. It has to be sent anyway — the reference is otherwise
 * shown once, on a screen people close — and the operator gains the signal
 * worth having: an unconfirmed address means a decision that will not arrive.
 */
/**
 * A token this test knows, planted on the row.
 *
 * The real one is minted inside `sendConfirmation` and only its SHA-256 is
 * kept, which is the point — so a test cannot read one back and must supply
 * its own. What is being checked here is the verification path: the hash
 * comparison, the expiry, the single use. That submission mints a token at all
 * is asserted separately, against the field rather than its value.
 */
async function tokenFor(application) {
  const token = 'a-known-token-for-this-test-only';
  await PracticeApplication.updateOne(
    { _id: application._id },
    {
      $set: {
        emailTokenHash: createHash('sha256').update(token).digest('hex'),
        emailTokenExpiresAt: new Date(Date.now() + 60_000),
      },
    },
  );
  return token;
}

describe('the applicant confirms the address the decision goes to', () => {
  before(async () => {
    origin = await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 500;
  });
  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });

  // The last test here reads the operator's queue, which needs one.
  beforeEach(async () => {
    await wipe();
    const admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });

  async function apply() {
    const res = await call('POST', '/applications', form(), { anonymous: true });
    assert.equal(res.status, 201);
    return PracticeApplication.findOne({ reference: res.body.application.reference }).select(
      '+emailTokenHash',
    );
  }

  test('submitting mints a token and leaves the address unconfirmed', async () => {
    const app = await apply();
    assert.ok(app.emailTokenHash, 'no confirmation token was minted');
    assert.ok(app.emailTokenExpiresAt > new Date(), 'the token is already expired');
    assert.equal(app.contactEmailVerifiedAt, null);
  });

  test('and the raw token is never stored or returned', async () => {
    // A leaked collection must hold nothing replayable, and the status page
    // hands out references — it must not also hand out the proof.
    const res = await call('POST', '/applications', form(), { anonymous: true });
    assert.ok(!JSON.stringify(res.body).includes('emailToken'), 'a token reached the applicant');

    const app = await PracticeApplication.findOne({
      reference: res.body.application.reference,
    }).lean();
    assert.equal(app.emailTokenHash, undefined, 'the hash is selected by default');
  });

  test('the right token confirms it, once', async () => {
    const app = await apply();
    const token = await tokenFor(app);

    const first = await call(
      'POST',
      `/applications/${app.reference}/confirm-email`,
      { token },
      { anonymous: true },
    );
    assert.equal(first.status, 200);
    assert.equal(first.body.confirmed, true);

    const after = await PracticeApplication.findById(app._id).select('+emailTokenHash').lean();
    assert.ok(after.contactEmailVerifiedAt, 'the address was not marked confirmed');
    // Spent: the link in the inbox stops working, which is what one-time means.
    assert.equal(after.emailTokenHash, null);
  });

  test('and clicking it twice is not an error', async () => {
    // Mail clients prefetch links. Somebody who used the link correctly should
    // not be told off for it.
    const app = await apply();
    const token = await tokenFor(app);
    const url = `/applications/${app.reference}/confirm-email`;

    await call('POST', url, { token }, { anonymous: true });
    const again = await call('POST', url, { token }, { anonymous: true });
    assert.equal(again.status, 200);
    assert.equal(again.body.alreadyConfirmed, true);
  });

  test('a reference alone confirms nothing', async () => {
    /*
     * The whole safety argument. The status page hands references out, so if
     * knowing one were enough to confirm an address, an unconfirmed address
     * would mean nothing at all.
     */
    const app = await apply();
    const res = await call(
      'POST',
      `/applications/${app.reference}/confirm-email`,
      { token: 'not-the-token-at-all' },
      { anonymous: true },
    );
    assert.equal(res.status, 400);

    const after = await PracticeApplication.findById(app._id).lean();
    assert.equal(after.contactEmailVerifiedAt, null);
  });

  test('and an expired token is refused', async () => {
    const app = await apply();
    const token = await tokenFor(app);
    await PracticeApplication.updateOne(
      { _id: app._id },
      { $set: { emailTokenExpiresAt: new Date(Date.now() - 1000) } },
    );

    const res = await call(
      'POST',
      `/applications/${app.reference}/confirm-email`,
      { token },
      { anonymous: true },
    );
    assert.equal(res.status, 400);
  });

  test('a resend goes to the address on file, not one supplied', async () => {
    /*
     * A route that accepted an address would let anybody holding a reference
     * redirect the decision to themselves — and the reference is printed on a
     * confirmation screen.
     */
    const app = await apply();
    const before = (
      await PracticeApplication.findById(app._id).select('+emailTokenHash').lean()
    ).emailTokenHash;

    const res = await call(
      'POST',
      `/applications/${app.reference}/resend-email`,
      { email: 'attacker@example.com' },
      { anonymous: true },
    );
    assert.equal(res.status, 200);

    const after = await PracticeApplication.findById(app._id).select('+emailTokenHash').lean();
    assert.notEqual(after.emailTokenHash, before, 'a resend did not mint a fresh token');
    assert.equal(after.contactEmail, form().contactEmail, 'the address on file changed');
  });

  test('the operator sees whether the address answered', async () => {
    // The signal worth having: an unconfirmed address means a decision that
    // will not arrive, and they can chase the phone number instead.
    const app = await apply();
    const list = await call('GET', '/admin/applications');
    assert.equal(list.body.items[0].contactEmailVerified, false);

    await call(
      'POST',
      `/applications/${app.reference}/confirm-email`,
      { token: await tokenFor(app) },
      { anonymous: true },
    );

    const after = await call('GET', '/admin/applications');
    assert.equal(after.body.items[0].contactEmailVerified, true);
  });
});

/**
 * Departments, and the practice types that can have them.
 *
 * ---- Where the answer comes from ----------------------------------------
 *
 * `BY_TYPE` in capabilities.js is what actually grants DEPARTMENT, and a clinic
 * never has one on any plan — that is what a solo practice is. So the form asks
 * about departments only for the types that can hold them, and it learns which
 * those are from the same table rather than from a list kept beside the form.
 *
 * The plan is deliberately not consulted. An applicant has no plan yet; an
 * operator approving a polyclinic onto Essential will find DEPARTMENT withheld
 * later, which is a sale rather than a fault in the application.
 */
describe('a practice says which specialties it runs, when it can have any', () => {
  before(async () => {
    origin = await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
    realLimit = env.APPLICATION_RATE_LIMIT;
    env.APPLICATION_RATE_LIMIT = 500;
  });
  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    env.APPLICATION_RATE_LIMIT = realLimit;
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
    // The shared catalogue: `practice: null` rows every practice sees.
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

  test('the options say which types have departments, from the capability table', async () => {
    const res = await call('GET', '/applications/options', undefined, { anonymous: true });
    const by = Object.fromEntries(res.body.types.map((t) => [t.key, t.hasDepartments]));

    assert.equal(by.clinic, false, 'a clinic was offered departments');
    assert.equal(by.polyclinic, true);
    assert.equal(by.hospital, true);
    assert.equal(by.specialty_centre, true);
  });

  test('and offer the shared catalogue rather than free text', async () => {
    const res = await call('GET', '/applications/options', undefined, { anonymous: true });
    assert.deepEqual(res.body.departments.map((d) => d.key).sort(), ['cardiology', 'nephrology']);
  });

  test('a polyclinic keeps what it asked for', async () => {
    const res = await call(
      'POST',
      '/applications',
      form({
        practiceType: 'polyclinic',
        departments: ['cardiology', 'nephrology'],
        doctorDepartment: 'cardiology',
      }),
      { anonymous: true },
    );
    assert.equal(res.status, 201);

    const saved = await PracticeApplication.findOne({
      reference: res.body.application.reference,
    }).lean();
    assert.deepEqual([...saved.departments].sort(), ['cardiology', 'nephrology']);
    assert.equal(saved.doctorDepartment, 'cardiology');
  });

  test('a clinic keeps none, whatever it posts', async () => {
    /*
     * The form never asks a clinic, so this only arrives by hand or from a
     * stale page. Dropped rather than refused: the application is fine and the
     * answer is simply not one a clinic has.
     */
    const res = await call(
      'POST',
      '/applications',
      form({ practiceType: 'clinic', departments: ['cardiology'], doctorDepartment: 'cardiology' }),
      { anonymous: true },
    );
    assert.equal(res.status, 201);

    const saved = await PracticeApplication.findOne({
      reference: res.body.application.reference,
    }).lean();
    assert.deepEqual(saved.departments, []);
    assert.equal(saved.doctorDepartment, null);
  });

  test('and a specialty the platform has never defined is dropped', async () => {
    // On approval these become real rows. An applicant cannot invent one.
    const res = await call(
      'POST',
      '/applications',
      form({ practiceType: 'polyclinic', departments: ['cardiology', 'astrology'] }),
      { anonymous: true },
    );
    const saved = await PracticeApplication.findOne({
      reference: res.body.application.reference,
    }).lean();
    assert.deepEqual(saved.departments, ['cardiology']);
  });

  test('the doctor is only assigned a department the practice actually runs', async () => {
    const res = await call(
      'POST',
      '/applications',
      form({
        practiceType: 'polyclinic',
        departments: ['cardiology'],
        doctorDepartment: 'nephrology',
      }),
      { anonymous: true },
    );
    const saved = await PracticeApplication.findOne({
      reference: res.body.application.reference,
    }).lean();
    assert.equal(saved.doctorDepartment, null);
  });

  test('approving creates them, owned by the new practice', async () => {
    /*
     * Copied, not referenced. A practice renaming its own Cardiology must not
     * rename everybody's — which is why the shared rows and a practice's own
     * live in one table separated by `practice`.
     */
    const submitted = await call(
      'POST',
      '/applications',
      form({ practiceType: 'polyclinic', departments: ['cardiology', 'nephrology'] }),
      { anonymous: true },
    );
    const app = await PracticeApplication.findOne({
      reference: submitted.body.application.reference,
    });

    const res = await call('POST', `/admin/applications/${app._id}/approve`, {
      note: 'Registration checked against the council register.',
    });
    assert.equal(res.status, 200);

    const after = await PracticeApplication.findById(app._id).lean();
    const theirs = await Department.find({ practice: after.practice }).select('key').lean();
    assert.deepEqual(theirs.map((d) => d.key).sort(), ['cardiology', 'nephrology']);

    // And the shared rows are untouched — still owned by nobody.
    assert.equal(await Department.countDocuments({ practice: null }), 2);
  });

  test('and a clinic is approved with none', async () => {
    const submitted = await call('POST', '/applications', form({ practiceType: 'clinic' }), {
      anonymous: true,
    });
    const app = await PracticeApplication.findOne({
      reference: submitted.body.application.reference,
    });

    await call('POST', `/admin/applications/${app._id}/approve`, {
      note: 'Solo practice, registration verified.',
    });

    const after = await PracticeApplication.findById(app._id).lean();
    assert.equal(await Department.countDocuments({ practice: after.practice }), 0);
  });
});
