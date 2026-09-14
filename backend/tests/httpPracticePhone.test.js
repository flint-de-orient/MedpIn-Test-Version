import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { env } from '../src/config/env.js';
import { Practice } from '../src/models/Practice.js';
import { Clinic } from '../src/models/Clinic.js';
import { User, ROLES } from '../src/models/User.js';
import { signAccessToken } from '../src/services/tokens.js';

/**
 * The number a patient rings is their own practice's.
 *
 * ---- What the screen showed ----------------------------------------------
 *
 * The doctor's profile had a "Clinic phone number" card whose Edit button
 * changed whichever location the list happened to return first — or created a
 * location called "Clinic" when there was none. And on the patient's side every
 * "Call clinic" button, the emergency card's included, dialled that first
 * location's number, or a placeholder written into the app ('+913322345678')
 * whenever it had not loaded.
 *
 * ---- What it is now ----------------------------------------------------------
 *
 * One field on the practice, set by whoever administers it, and served to the
 * patient from the practice they are enrolled at. Without it: the practice's
 * only location's number, or no number — never a first location, never another
 * practice's, never a configured one.
 */

const ABSENT = '000000000000000000000000';

async function owned(name, extra = {}) {
  const practice = await makePractice(name, extra);
  const owner = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
  return { practice, owner };
}

describe('a practice sets the number its patients ring', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('its owner saves it, normalised to a number a phone can dial', async () => {
    const { practice, owner } = await owned('Salt Lake Diabetes Care');

    const res = await as(owner.token).patch(`/practices/${practice._id}`, { emergencyPhone: '98301 23456' });

    assert.equal(res.status, 200);
    assert.equal(res.body.practice.emergencyPhone, '+919830123456');
  });

  test('a placeholder or a word is refused, and nothing is saved', async () => {
    const { practice, owner } = await owned('Salt Lake Diabetes Care');

    for (const bad of ['+91-0000000000', 'ring the desk', '12345']) {
      const res = await as(owner.token).patch(`/practices/${practice._id}`, { emergencyPhone: bad });
      assert.equal(res.status, 400, `"${bad}" was accepted as a phone number`);
    }
    assert.equal((await Practice.findById(practice._id).lean()).emergencyPhone, null);
  });

  test('and clearing it is allowed', async () => {
    const { practice, owner } = await owned('Salt Lake Diabetes Care', { emergencyPhone: '+919830123456' });

    const res = await as(owner.token).patch(`/practices/${practice._id}`, { emergencyPhone: '' });

    assert.equal(res.status, 200);
    assert.equal(res.body.practice.emergencyPhone, null);
  });

  test('another practice cannot set it', async () => {
    const a = await owned('Salt Lake Diabetes Care');
    const b = await owned('Behala Family Clinic');

    const res = await as(b.owner.token).patch(`/practices/${a.practice._id}`, { emergencyPhone: '+919830123456' });
    const absent = await as(b.owner.token).patch(`/practices/${ABSENT}`, { emergencyPhone: '+919830123456' });

    assert.notEqual(res.status, 200, 'one practice rewrote the number another practice’s patients ring');
    assert.notEqual(absent.status, 200);
    assert.equal((await Practice.findById(a.practice._id).lean()).emergencyPhone, null);
  });
});

describe('a patient is given their own practice’s number', () => {
  const CONFIGURED = '+918981540690';
  let saved;

  before(async () => {
    await boot();
    saved = env.CLINIC_EMERGENCY_PHONE;
    env.CLINIC_EMERGENCY_PHONE = CONFIGURED;
  });
  after(async () => {
    env.CLINIC_EMERGENCY_PHONE = saved;
    await shutdown();
  });
  beforeEach(wipe);

  test('each practice’s patient hears their own practice’s number', async () => {
    const a = await makePractice('Salt Lake Diabetes Care', { emergencyPhone: '+919830111111' });
    const b = await makePractice('Behala Family Clinic', { emergencyPhone: '+919830222222' });
    const pa = await makePatient({ name: 'Anita Sengupta', practices: [a] });
    const pb = await makePatient({ name: 'Rahul Bose', practices: [b] });

    const ra = await as(pa.token).get('/auth/me/contact');
    const rb = await as(pb.token).get('/auth/me/contact');

    assert.equal(ra.status, 200);
    assert.equal(ra.body.phone, '+919830111111');
    assert.equal(ra.body.practice.name, 'Salt Lake Diabetes Care');
    assert.equal(rb.body.phone, '+919830222222');
    assert.ok(!allText(ra.body).includes('+919830222222'), 'a patient was given another practice’s number');
  });

  test('without a number of its own, the practice’s only location’s', async () => {
    const a = await makePractice('Salt Lake Diabetes Care');
    await Clinic.create({ name: 'Salt Lake', practice: a._id, phone: '+913324001234', isActive: true });
    const pa = await makePatient({ name: 'Anita Sengupta', practices: [a] });

    const res = await as(pa.token).get('/auth/me/contact');
    assert.equal(res.body.phone, '+913324001234');
  });

  test('two locations and no number of its own is no number — never whichever came first', async () => {
    const a = await makePractice('Salt Lake Diabetes Care');
    await Clinic.create({ name: 'Salt Lake', practice: a._id, phone: '+913324001234', isActive: true, sortIndex: 0 });
    await Clinic.create({ name: 'New Town', practice: a._id, phone: '+913324005678', isActive: true, sortIndex: 1 });
    const pa = await makePatient({ name: 'Anita Sengupta', practices: [a] });

    const res = await as(pa.token).get('/auth/me/contact');
    assert.equal(res.body.phone, null);
  });

  test('the founding practice is given no number it did not set', async () => {
    const dey = await makePractice('Dey Diabetes Care', { isFounding: true });
    const patient = await makePatient({ name: 'Anita Sengupta', practices: [dey] });

    const res = await as(patient.token).get('/auth/me/contact');

    assert.equal(res.status, 200);
    assert.equal(res.body.phone, null, 'the deployment’s configured number was handed out as a practice’s');
  });

  test('a patient enrolled nowhere is given no practice and no number', async () => {
    await makePractice('Dey Diabetes Care', { emergencyPhone: CONFIGURED });
    const patient = await makePatient({ name: 'Anita Sengupta', practices: [] });

    const res = await as(patient.token).get('/auth/me/contact');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { practice: null, phone: null });
  });
});

describe('my practice is the one I belong to', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  test('an account with no membership is shown no practice, not the first clinic’s', async () => {
    const dey = await makePractice('Dey Diabetes Care');
    await Clinic.create({ name: 'Salt Lake', practice: dey._id, isActive: true });
    const orphan = await User.create({
      name: 'Former Desk',
      phone: '+919800000123',
      role: ROLES.STAFF,
      isActive: true,
    });

    const res = await as(signAccessToken(orphan)).get('/practices/mine');

    assert.equal(res.status, 200);
    assert.equal(res.body.practice, null);
    assert.ok(!allText(res.body).includes('Dey Diabetes Care'), 'another practice was shown as theirs');
  });

  test('and a member is shown their own, with the number patients ring', async () => {
    const { practice, owner } = await owned('Salt Lake Diabetes Care', { emergencyPhone: '+919830123456' });

    const res = await as(owner.token).get('/practices/mine');

    assert.equal(res.status, 200);
    assert.equal(res.body.practice.id, String(practice._id));
    assert.equal(res.body.practice.emergencyPhone, '+919830123456');
  });
});
