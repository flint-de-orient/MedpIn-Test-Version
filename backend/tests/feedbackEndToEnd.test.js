import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ROLES } from '../src/models/User.js';
import { Feedback } from '../src/models/Feedback.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { env } from '../src/config/env.js';
import { revokeEnrolment } from '../src/services/enrollments.js';
import { feedbackReaders } from '../src/services/feedback.js';

/**
 * Feedback, from the patient's form to whoever answers it and back.
 *
 * ---- What was wrong ----------------------------------------------------------
 *
 * A row named a patient and nothing else. Every practice that patient was
 * enrolled at read every word they wrote — about any clinic, and about the app.
 * A patient with no practice wrote into a void. One "reviewed" mark served the
 * whole practice, nobody was told anything had arrived, and the thank-you
 * screen promised a reply there was no way to send or to read.
 *
 * ---- What these pin -----------------------------------------------------------
 *
 * Where each kind goes; that two practices never read each other's; who at a
 * practice reads it; read state per person and the badge that counts it; the
 * reply both ways; the patient's own view; and the platform's handling, which
 * never shows an operator who the patient is.
 */

const ADMIN_SECRET = 'a_test_admin_secret_at_least_32_characters_long';

let salt;
let behala;
let anita; // Salt Lake only
let farida; // Salt Lake and Behala
let admin;
let realAdminSecret;

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return {
    practice: p,
    owner: await makeMember(p, { name: `Dr ${name} Owner`, isOwner: true }),
    colleague: await makeMember(p, { name: `Dr ${name} Colleague` }),
    desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
    labTech: await makeMember(p, { name: `${name} Bench`, role: ROLES.LAB_TECHNICIAN }),
    dietician: await makeMember(p, { name: `${name} Dietician`, role: ROLES.DIETICIAN }),
    manager: await makeMember(p, { name: `${name} Manager`, role: ROLES.PRACTICE_MANAGER }),
  };
}

const send = (who, body, headers) => as(who.token).post('/feedback', body, headers);
const inbox = (who) => as(who.token).get('/feedback');
const unread = async (who) => (await as(who.token).get('/feedback/unread-count')).body.unread;

async function setUp() {
  salt = await practice('Salt Lake');
  behala = await practice('Behala');
  anita = await makePatient({ name: 'Anita Sengupta', practices: [salt.practice] });
  farida = await makePatient({ name: 'Farida Rahman', practices: [salt.practice, behala.practice] });

  const row = await PlatformAdmin.create({ email: 'ops@example.com', name: 'Ops Person', passwordHash: 'x', isActive: true });
  const { signAdminToken } = await import('../src/services/adminTokens.js');
  admin = { token: signAdminToken(row), row };
}

describe('feedback goes where it is about, and nowhere else', () => {
  before(async () => {
    await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });
  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    await shutdown();
  });
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('a patient at two practices writes to one, and the other never reads it', async () => {
    const toBehala = await send(farida, {
      about: 'clinic',
      practiceId: String(behala.practice._id),
      message: 'Behala kept me waiting two hours',
    });
    assert.equal(toBehala.status, 201, JSON.stringify(toBehala.body));
    assert.equal(toBehala.body.routedTo, 'practice');
    assert.equal(toBehala.body.practice.name, 'Behala');

    const toSalt = await send(farida, {
      about: 'clinic',
      practiceId: String(salt.practice._id),
      message: 'Salt Lake explained everything',
    });
    assert.equal(toSalt.status, 201);

    const atBehala = allText((await inbox(behala.owner)).body);
    assert.match(atBehala, /kept me waiting/);
    assert.doesNotMatch(atBehala, /explained everything/, 'Behala read what was written to Salt Lake');

    const atSalt = allText((await inbox(salt.owner)).body);
    assert.match(atSalt, /explained everything/);
    assert.doesNotMatch(atSalt, /kept me waiting/, 'Salt Lake read what was written to Behala');
  });

  test('naming no practice: the one practice if there is one, refused if there are two', async () => {
    const one = await send(anita, { about: 'clinic', rating: 4, message: 'Kind receptionist' });
    assert.equal(one.status, 201);
    assert.equal(one.body.practice.name, 'Salt Lake');

    const two = await send(farida, { about: 'clinic', rating: 2, message: 'Which one is this about' });
    assert.equal(two.status, 400, 'a complaint was routed to a clinic the patient did not name');
    assert.equal(await Feedback.countDocuments({ message: 'Which one is this about' }), 0);
  });

  test('a practice the patient is not registered with cannot be named', async () => {
    const res = await send(anita, { about: 'clinic', practiceId: String(behala.practice._id), message: 'Hello Behala' });
    assert.equal(res.status, 400);
    assert.doesNotMatch(allText((await inbox(behala.owner)).body), /Hello Behala/);
  });

  test('feedback about the app goes to MedPin, not to the patient’s practice', async () => {
    const res = await send(anita, { about: 'app', rating: 2, message: 'The app logs me out every day' });
    assert.equal(res.status, 201);
    assert.equal(res.body.routedTo, 'platform');
    assert.equal(res.body.practice, null);

    assert.doesNotMatch(allText((await inbox(salt.owner)).body), /logs me out/, 'app feedback reached a practice');

    const platform = await as(admin.token).get('/admin/feedback');
    assert.equal(platform.status, 200);
    assert.match(allText(platform.body), /logs me out/);
    const said = JSON.stringify(platform.body);
    for (const identity of ['Anita', anita.user.phone, String(anita.user._id)]) {
      assert.ok(!said.includes(identity), `the platform was shown the patient’s identity (${identity})`);
    }
  });

  test('a patient no practice has taken on reaches MedPin, and no practice', async () => {
    const nobody = await makePatient({ name: 'Unconnected Person', practices: [] });
    const res = await send(nobody, { about: 'clinic', message: 'My clinic is not on the app' });
    assert.equal(res.status, 201);
    assert.equal(res.body.routedTo, 'platform');

    for (const who of [salt.owner, behala.owner]) {
      assert.doesNotMatch(allText((await inbox(who)).body), /not on the app/);
    }
    const platform = await as(admin.token).get('/admin/feedback');
    const item = platform.body.items.find((i) => i.message === 'My clinic is not on the app');
    assert.ok(item, 'the platform never saw it');
    assert.equal(item.fromUnconnectedPatient, true);
    assert.ok(!JSON.stringify(platform.body).includes('Unconnected Person'));
  });

  test('feedback written before it said where it went stays private to its author', async () => {
    await Feedback.collection.insertOne({
      patient: anita.user._id,
      about: 'clinic',
      message: 'An old note from last year',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    assert.doesNotMatch(allText((await inbox(salt.owner)).body), /old note/, 'an unattributed row was given to a practice');
    assert.doesNotMatch(allText((await as(admin.token).get('/admin/feedback')).body), /old note/);

    const mine = await as(anita.token).get('/feedback/mine');
    const row = mine.body.items.find((i) => i.message === 'An old note from last year');
    assert.ok(row, 'the author can no longer see what they wrote');
    assert.equal(row.routedTo, 'private');
  });

  test('once the patient withdraws the practice’s access, it no longer reads their feedback', async () => {
    await send(anita, { about: 'clinic', message: 'Before I left' });
    assert.match(allText((await inbox(salt.owner)).body), /Before I left/);

    await revokeEnrolment({ enrollmentId: anita.enrollments[0]._id, actor: anita.user._id });
    assert.doesNotMatch(allText((await inbox(salt.owner)).body), /Before I left/);
  });

  test('sending twice under one key is one piece of feedback', async () => {
    await Feedback.createIndexes();
    const headers = { 'Idempotency-Key': 'feedback-once-0001' };
    const body = { about: 'clinic', message: 'Only once please' };
    const [one, two] = await Promise.all([send(anita, body, headers), send(anita, body, headers)]);
    assert.equal(one.status, 201);
    assert.equal(two.status, 201);
    assert.equal(one.body.id, two.body.id);
    assert.equal(await Feedback.countDocuments({ message: 'Only once please' }), 1);
  });
});

describe('who at a practice reads it, and what each of them has read', () => {
  before(async () => {
    await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });
  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    await shutdown();
  });
  beforeEach(async () => {
    await wipe();
    await setUp();
    await send(anita, { about: 'clinic', rating: 1, message: 'Nobody called me back' });
  });

  test('a role that opens patients and holds VIEW_PATIENT reads it; the manager and the dietician do not', async () => {
    for (const who of [salt.owner, salt.colleague, salt.desk, salt.labTech]) {
      const res = await inbox(who);
      assert.equal(res.status, 200, `${who.name} was refused`);
      assert.match(allText(res.body), /Nobody called me back/);
    }
    for (const who of [salt.manager, salt.dietician]) {
      const res = await inbox(who);
      assert.equal(res.status, 403, `${who.name} read patient feedback`);
      assert.ok(!allText(res.body).includes('Nobody called me back'));
      assert.equal((await as(who.token).get('/feedback/unread-count')).status, 403);
    }
  });

  test('the push goes to exactly those readers, at that practice', async () => {
    const readers = (await feedbackReaders(salt.practice._id)).map((u) => u.name).sort();
    assert.deepEqual(readers, ['Dr Salt Lake Colleague', 'Dr Salt Lake Owner', 'Salt Lake Bench', 'Salt Lake Desk']);
  });

  test('reading is per person, and each badge counts what that person may see and has not read', async () => {
    assert.equal(await unread(salt.owner), 1);
    assert.equal(await unread(salt.colleague), 1);
    assert.equal(await unread(behala.owner), 0, 'another practice’s badge counted this feedback');

    const [row] = (await inbox(salt.owner)).body.items;
    // Two taps at once.
    const marks = await Promise.all([
      as(salt.owner.token).post(`/feedback/${row.id}/reviewed`, {}),
      as(salt.owner.token).post(`/feedback/${row.id}/reviewed`, {}),
    ]);
    assert.deepEqual(marks.map((m) => m.status), [204, 204]);
    assert.equal((await Feedback.findById(row.id).lean()).readBy.length, 1, 'one reader was recorded twice');

    assert.equal(await unread(salt.owner), 0);
    assert.equal(await unread(salt.colleague), 1, 'one person reading it cleared it for a colleague');

    const colleagueView = (await inbox(salt.colleague)).body.items[0];
    assert.equal(colleagueView.reviewed, false);
    assert.deepEqual(colleagueView.reviewedBy.map((r) => r.name), ['Dr Salt Lake Owner']);
  });

  test('another practice cannot mark it read, or reply to it', async () => {
    const [row] = (await inbox(salt.owner)).body.items;
    assert.equal((await as(behala.owner.token).post(`/feedback/${row.id}/reviewed`, {})).status, 404);
    assert.equal((await as(behala.owner.token).post(`/feedback/${row.id}/reply`, { message: 'From Behala' })).status, 404);
    const stored = await Feedback.findById(row.id).lean();
    assert.equal(stored.readBy.length, 0);
    assert.equal(stored.replies.length, 0);
  });

  test('a reply reaches the patient with the practice’s name on it, and only those who may answer patients may send one', async () => {
    const [row] = (await inbox(salt.owner)).body.items;

    const bench = await as(salt.labTech.token).post(`/feedback/${row.id}/reply`, { message: 'From the bench' });
    assert.equal(bench.status, 403, 'somebody without CHAT_REPLY answered a patient as the clinic');

    const headers = { 'Idempotency-Key': 'reply-once-0001' };
    const reply = await as(salt.owner.token).post(`/feedback/${row.id}/reply`, { message: 'We are sorry — we will call today.' }, headers);
    assert.equal(reply.status, 201, JSON.stringify(reply.body));
    const retry = await as(salt.owner.token).post(`/feedback/${row.id}/reply`, { message: 'We are sorry — we will call today.' }, headers);
    assert.equal(retry.status, 200);
    const reused = await as(salt.owner.token).post(`/feedback/${row.id}/reply`, { message: 'Something else' }, headers);
    assert.equal(reused.status, 409);

    const mine = await as(anita.token).get('/feedback/mine');
    const [sent] = mine.body.items;
    assert.equal(sent.state, 'answered');
    assert.equal(sent.seen, true);
    assert.equal(sent.replies.length, 1, 'a retried reply was stored twice');
    assert.equal(sent.replies[0].fromName, 'Salt Lake');
    assert.equal(sent.replies[0].byName, 'Dr Salt Lake Owner');

    // Answering it is reading it.
    assert.equal(await unread(salt.owner), 0);
  });

  test('a patient sees only their own feedback', async () => {
    const mine = await as(farida.token).get('/feedback/mine');
    assert.equal(mine.status, 200);
    assert.ok(!allText(mine.body).includes('Nobody called me back'));
  });
});

describe('MedPin handles what no practice reads', () => {
  before(async () => {
    await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });
  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    await shutdown();
  });
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('an operator reads and answers it, and the patient reads MedPin’s reply', async () => {
    await send(anita, { about: 'app', message: 'Reminders stopped ringing' });
    const list = await as(admin.token).get('/admin/feedback');
    assert.equal(list.body.unread, 1);
    const [item] = list.body.items;
    assert.ok(item.reference);

    assert.equal((await as(admin.token).post(`/admin/feedback/${item.id}/read`, {})).status, 204);
    const reply = await as(admin.token).post(`/admin/feedback/${item.id}/reply`, { message: 'Fixed in the next update.' });
    assert.equal(reply.status, 201);

    const after = await as(admin.token).get('/admin/feedback');
    assert.equal(after.body.unread, 0);
    assert.equal(after.body.items[0].state, 'answered');

    const mine = await as(anita.token).get('/feedback/mine');
    assert.equal(mine.body.items[0].replies[0].fromName, 'MedPin');
    assert.equal(mine.body.items[0].replies[0].byName, null, 'the patient was told which operator answered');
  });

  test('an operator cannot reach feedback that went to a practice', async () => {
    await send(anita, { about: 'clinic', message: 'For Salt Lake only' });
    const row = await Feedback.findOne({ message: 'For Salt Lake only' }).lean();

    assert.doesNotMatch(allText((await as(admin.token).get('/admin/feedback')).body), /For Salt Lake only/);
    assert.equal((await as(admin.token).post(`/admin/feedback/${row._id}/reply`, { message: 'Hi' })).status, 404);
    assert.equal((await as(admin.token).post(`/admin/feedback/${row._id}/read`, {})).status, 404);
  });

  test('a clinic token is not an operator', async () => {
    const res = await as(salt.owner.token).get('/admin/feedback');
    assert.ok([401, 403, 404].includes(res.status), `answered ${res.status}`);
  });
});
