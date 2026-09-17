import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ROLES } from '../src/models/User.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { Prescription } from '../src/models/Prescription.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { ShareGrant } from '../src/models/ShareGrant.js';
import { PERMISSIONS, presetFor } from '../src/models/Membership.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * What SHARE_RECORDS is for: a practice asking, and the patient deciding.
 *
 * ---- The permission that granted nothing ----------------------------------
 *
 * "Share records outside the practice" was in every head's preset and the lab
 * manager's, shown ticked in the console, and asked for by no route. A practice
 * cannot share a patient's record — that is the patient's decision — so the
 * thing a practice can be permitted to do is ask. Asking writes a request that
 * grants nothing; the patient approves it (all of it or less) or declines it,
 * in their own app.
 */

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY);

let salt;
let behala;
let rahul;

async function practice(name) {
  const p = await makePractice(name, { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
  return {
    practice: p,
    owner: await makeMember(p, { name: `Dr ${name} Owner`, isOwner: true }),
    doctor: await makeMember(p, { name: `Dr ${name} Colleague` }),
    desk: await makeMember(p, { name: `${name} Desk`, role: ROLES.STAFF }),
    labManager: await makeMember(p, { name: `${name} Lab Manager`, role: ROLES.LAB_MANAGER }),
  };
}

function ask(who, body = { categories: ['prescriptions', 'readings'], note: 'For his diabetes review' }) {
  return as(who.token).post(`/sharing/patients/${rahul.user._id}/requests`, body);
}

describe('a practice asks to see earlier records', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    salt = await practice('Salt Lake');
    behala = await practice('Behala');
    rahul = await makePatient({ name: 'Rahul Bose', practices: [salt.practice] });
    await Enrollment.updateOne({ _id: rahul.enrollments[0]._id }, { $set: { enrolledOn: ago(10) } });
    await Prescription.create({
      patient: rahul.user._id,
      doctor: salt.owner.user._id,
      referenceNo: 'REQ-BEFORE-000001',
      issuedOn: ago(40),
      items: [{ name: 'Glimepiride' }],
    });
    await GlucoseReading.create({ patient: rahul.user._id, valueMgDl: 301, measuredAt: ago(40) });
  });

  test('the presets that hold SHARE_RECORDS are the ones that may ask', () => {
    assert.ok(presetFor({ role: ROLES.DOCTOR, isOwner: true }).includes(PERMISSIONS.SHARE_RECORDS));
    assert.ok(presetFor({ role: ROLES.LAB_MANAGER }).includes(PERMISSIONS.SHARE_RECORDS));
    assert.ok(!presetFor({ role: ROLES.DOCTOR }).includes(PERMISSIONS.SHARE_RECORDS));
    assert.ok(!presetFor({ role: ROLES.STAFF }).includes(PERMISSIONS.SHARE_RECORDS));
  });

  test('asking grants nothing until the patient approves, and approving grants what they chose', async () => {
    const asked = await ask(salt.owner);
    assert.equal(asked.status, 201, JSON.stringify(asked.body));
    assert.equal(asked.body.request.state, 'requested');

    const before = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.deepEqual(before.body.items.map((p) => p.referenceNo), [], 'a request widened the read before anybody said yes');

    const overview = await as(rahul.token).get('/sharing');
    const [request] = overview.body.connected[0].requests;
    assert.equal(request.requestNote, 'For his diabetes review');
    assert.equal(request.requestedBy, 'Dr Salt Lake Owner');

    // Approves prescriptions only.
    const approved = await as(rahul.token).post(`/sharing/requests/${request.id}/approve`, { categories: ['prescriptions'] });
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(approved.body.grant.status, 'active');

    const rx = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.deepEqual(rx.body.items.map((p) => p.referenceNo), ['REQ-BEFORE-000001']);
    const glucose = await as(salt.owner.token).get(`/patients/${rahul.user._id}/glucose`);
    assert.deepEqual(glucose.body.items.map((g) => g.valueMgDl), [], 'readings were asked for and not approved');

    const grant = await ShareGrant.findById(request.id).lean();
    assert.equal(String(grant.grantedBy), String(rahul.user._id), 'the grant does not name the patient as granting it');
    assert.equal(String(grant.createdBy), String(salt.owner.user._id));
  });

  test('approving cannot widen what was asked for', async () => {
    const asked = await ask(salt.owner, { categories: ['prescriptions'] });
    const res = await as(rahul.token).post(`/sharing/requests/${asked.body.request.id}/approve`, {
      categories: ['prescriptions', 'readings'],
    });
    assert.equal(res.status, 400);
    assert.equal((await ShareGrant.findById(asked.body.request.id).lean()).state, 'requested');
  });

  test('a lab manager may ask; a doctor, the desk and another practice may not', async () => {
    assert.equal((await ask(salt.labManager)).status, 201);
    await ShareGrant.deleteMany({});

    for (const who of [salt.doctor, salt.desk]) {
      const res = await ask(who);
      assert.equal(res.status, 403, `${who.name} asked without SHARE_RECORDS`);
    }
    const other = await ask(behala.owner);
    assert.equal(other.status, 403, 'another practice asked for a patient it has never enrolled');
    assert.ok(!allText(other.body).includes('Rahul'));
    assert.equal(await ShareGrant.countDocuments(), 0);
  });

  test('one open request at a time, even when two are sent at once', async () => {
    await ShareGrant.createIndexes();
    const [one, two] = await Promise.all([ask(salt.owner), ask(salt.labManager)]);
    assert.deepEqual([one.status, two.status].sort(), [201, 409]);
    assert.equal(await ShareGrant.countDocuments({ state: 'requested' }), 1);
  });

  test('declined is nothing, and cannot then be approved', async () => {
    const asked = await ask(salt.owner);
    const declined = await as(rahul.token).post(`/sharing/requests/${asked.body.request.id}/decline`, {});
    assert.equal(declined.status, 200);
    assert.equal(declined.body.grant.status, 'declined');

    const late = await as(rahul.token).post(`/sharing/requests/${asked.body.request.id}/approve`, {});
    assert.equal(late.status, 409);
    const rx = await as(salt.owner.token).get(`/patients/${rahul.user._id}/prescriptions`);
    assert.deepEqual(rx.body.items, []);

    // And the practice may ask again once answered.
    assert.equal((await ask(salt.owner)).status, 201);
  });

  test('only the patient answers: not the practice, not another patient', async () => {
    const asked = await ask(salt.owner);
    const byPractice = await as(salt.owner.token).post(`/sharing/requests/${asked.body.request.id}/approve`, {});
    assert.equal(byPractice.status, 403, 'a practice approved its own request');

    const stranger = await makePatient({ name: 'Someone Else', practices: [salt.practice] });
    const byStranger = await as(stranger.token).post(`/sharing/requests/${asked.body.request.id}/approve`, {});
    assert.equal(byStranger.status, 404);
    assert.equal((await ShareGrant.findById(asked.body.request.id).lean()).state, 'requested');
  });

  test('the practice sees its own request and what was approved', async () => {
    const asked = await ask(salt.owner);
    let mine = await as(salt.doctor.token).get(`/sharing/patients/${rahul.user._id}`);
    assert.equal(mine.status, 200);
    assert.equal(mine.body.request.id, asked.body.request.id);

    await as(rahul.token).post(`/sharing/requests/${asked.body.request.id}/approve`, {});
    mine = await as(salt.doctor.token).get(`/sharing/patients/${rahul.user._id}`);
    assert.equal(mine.body.request, null);
    assert.equal(mine.body.shared.length, 1);
  });
});
