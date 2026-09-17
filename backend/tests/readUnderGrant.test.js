import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ShareGrant, SHARE_CATEGORY } from '../src/models/ShareGrant.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { grantsForRead, readUnderGrant, SHARED_READ_ACTION } from '../src/services/sharing.js';

/**
 * `readUnderGrant`, the one question every widened read asks.
 *
 * ---- Why it is tested on its own ------------------------------------------
 *
 * Today `recordWindow` asks it, to lift the enrolment's lower bound for a
 * category the patient shared. When reads are bounded by who wrote a record
 * instead, the same helper is what lets a practice read records it did not
 * write. So its contract is pinned here directly, not only through the routes
 * that happen to call it now:
 *
 *   - it answers for one category, one practice, and — when the grant names
 *     one — one doctor;
 *   - expired and revoked grants give nothing, at the moment of asking;
 *   - it refuses on anything but a read, whatever grants are loaded;
 *   - a grant under another enrolment of the same practice widens nothing;
 *   - every read it allows is written down, once per grant and category, and
 *     only if the response succeeded.
 */

let practice;
let owner;
let colleague;
let patient;

async function grant(fields = {}) {
  return ShareGrant.create({
    patient: patient.user._id,
    practice: practice._id,
    enrollment: patient.enrollments[0]._id,
    categories: [SHARE_CATEGORY.PRESCRIPTIONS],
    state: 'active',
    origin: 'patient_app',
    createdBy: patient.user._id,
    createdByRole: 'patient',
    grantedBy: patient.user._id,
    grantedAt: new Date(),
    ...fields,
  });
}

/** A request as the gate leaves it: the caller, the enrolment, the grants it loaded. */
async function request({ user = owner.user, method = 'GET' } = {}) {
  const res = new EventEmitter();
  res.statusCode = 200;
  const req = {
    method,
    user,
    ip: '127.0.0.1',
    get: () => 'test',
    route: { path: '/' },
    originalUrl: '/test',
    enrollment: patient.enrollments[0],
    res,
  };
  req.shareGrants = await grantsForRead({ method: 'GET' }, patient.user._id, practice._id);
  return req;
}

async function sharedReads() {
  await new Promise((r) => setTimeout(r, 150));
  return AuditLog.find({ action: SHARED_READ_ACTION }).lean();
}

describe('readUnderGrant', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake');
    owner = await makeMember(practice, { name: 'Dr Owner', isOwner: true });
    colleague = await makeMember(practice, { name: 'Dr Colleague' });
    patient = await makePatient({ name: 'Rahul Bose', practices: [practice] });
  });

  test('answers for the category shared, and not for another', async () => {
    const g = await grant();
    const req = await request();
    assert.equal(String(readUnderGrant(req, SHARE_CATEGORY.PRESCRIPTIONS)?._id), String(g._id));
    assert.equal(readUnderGrant(req, SHARE_CATEGORY.READINGS), null);
    assert.equal(readUnderGrant(req, null), null);
  });

  test('a grant naming one doctor answers for that doctor only', async () => {
    await grant({ doctor: colleague.user._id });
    assert.ok(readUnderGrant(await request({ user: colleague.user }), SHARE_CATEGORY.PRESCRIPTIONS));
    assert.equal(readUnderGrant(await request({ user: owner.user }), SHARE_CATEGORY.PRESCRIPTIONS), null);
  });

  test('expired or revoked is nothing, even when it was loaded while in force', async () => {
    const g = await grant({ expiresAt: new Date(Date.now() + 60_000) });
    const req = await request();
    // It lapses between the gate loading it and the read asking.
    req.shareGrants[0].expiresAt = new Date(Date.now() - 1);
    assert.equal(readUnderGrant(req, SHARE_CATEGORY.PRESCRIPTIONS), null);

    await ShareGrant.updateOne({ _id: g._id }, { $set: { expiresAt: null, state: 'revoked', revokedAt: new Date() } });
    assert.deepEqual((await request()).shareGrants, [], 'a revoked grant was loaded');
  });

  test('refuses anything but a read, whatever was loaded', async () => {
    await grant();
    for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
      const req = await request({ method });
      assert.equal(readUnderGrant(req, SHARE_CATEGORY.PRESCRIPTIONS), null, `${method} was widened`);
    }
    assert.deepEqual(await grantsForRead({ method: 'POST' }, patient.user._id, practice._id), []);
  });

  test('a grant from another enrolment widens nothing', async () => {
    const g = await grant();
    await ShareGrant.updateOne({ _id: g._id }, { $set: { enrollment: owner.membership._id } });
    assert.equal(readUnderGrant(await request(), SHARE_CATEGORY.PRESCRIPTIONS), null);
  });

  test('each read it allows is written down once, with the grant, and only if it succeeded', async () => {
    const g = await grant({ categories: [SHARE_CATEGORY.PRESCRIPTIONS, SHARE_CATEGORY.ECG] });

    const ok = await request();
    readUnderGrant(ok, SHARE_CATEGORY.PRESCRIPTIONS);
    readUnderGrant(ok, SHARE_CATEGORY.PRESCRIPTIONS);
    readUnderGrant(ok, SHARE_CATEGORY.ECG);
    ok.res.emit('finish');

    const failed = await request();
    readUnderGrant(failed, SHARE_CATEGORY.PRESCRIPTIONS);
    failed.res.statusCode = 500;
    failed.res.emit('finish');

    const rows = await sharedReads();
    assert.deepEqual(rows.map((r) => r.meta.category).sort(), ['ecg', 'prescriptions']);
    for (const row of rows) {
      assert.equal(String(row.resourceId), String(g._id));
      assert.equal(String(row.actor), String(owner.user._id));
      assert.equal(String(row.subjectPatient), String(patient.user._id));
      assert.equal(row.meta.practice, String(practice._id));
    }
  });
});
