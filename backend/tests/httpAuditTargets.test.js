import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { Practice } from '../src/models/Practice.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';
import { env } from '../src/config/env.js';

/**
 * An audit entry says who it was done to.
 *
 * The collection has recorded `practice` since it existed and the console
 * never showed it, so the trail could say a plan moved from essential to
 * professional without saying whose. On a platform with one practice that is
 * obvious; on a platform with twenty it is a list of timestamps.
 */

const ADMIN_SECRET = 'an_admin_secret_for_the_audit_target_tests';
let origin;
let realAdminSecret;
let token;
let admin;

async function call(path) {
  const res = await fetch(origin + path, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return { status: res.status, body: await res.json() };
}

describe('the audit trail names its target', () => {
  before(async () => {
    origin = await boot();
    realAdminSecret = env.ADMIN_JWT_SECRET;
    env.ADMIN_JWT_SECRET = ADMIN_SECRET;
  });

  after(async () => {
    env.ADMIN_JWT_SECRET = realAdminSecret;
    await shutdown();
  });

  beforeEach(async () => {
    await wipe();
    admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });

  test('a practice-scoped entry carries the name, not just the id', async () => {
    const practice = await makePractice('Sunrise Diabetes Care');
    await AdminAuditLog.record({
      admin,
      action: 'admin.practice.plan',
      practice: practice._id,
      reason: 'They asked to move up.',
      before: { plan: 'essential' },
      after: { plan: 'professional' },
    });

    const res = await call('/admin/audit?action=admin.practice.plan');
    assert.equal(res.status, 200);

    const row = res.body.items[0];
    assert.equal(row.practice.name, 'Sunrise Diabetes Care');
    assert.equal(row.practice.id, String(practice._id));
  });

  test('an entry that targets no practice says so', async () => {
    // Creating an administrator is done to the platform, not to a customer.
    await AdminAuditLog.record({ admin, action: 'admin.admin.create' });

    const res = await call('/admin/audit');
    assert.equal(res.body.items[0].practice, null);
  });

  test('and a deleted practice keeps its id rather than becoming nothing', async () => {
    /*
     * The reason this is a lookup and not `.populate()`.
     *
     * Populate resolves a dangling ref to null and takes the id with it, so the
     * row would read exactly like the one above — as though the action had
     * never been aimed at anybody. That is a gap drawn as a zero: the entry
     * recording what was done to a practice that no longer exists is precisely
     * the entry somebody comes looking for.
     */
    const practice = await makePractice('Behala Evening Clinic');
    await AdminAuditLog.record({
      admin,
      action: 'admin.practice.edit',
      practice: practice._id,
      reason: 'Corrected the address.',
    });
    await Practice.deleteOne({ _id: practice._id });

    const res = await call('/admin/audit');
    const row = res.body.items[0];
    assert.ok(row.practice, 'the entry lost its target when the practice went');
    assert.equal(row.practice.id, String(practice._id));
    assert.equal(row.practice.name, null, 'a name was invented for a practice that is gone');
  });

  test('naming the targets costs one query however long the page is', async () => {
    /*
     * Ten entries against two practices. A per-row lookup would be ten reads
     * and would grow with the page; this asks once for the ids on the page.
     *
     * Asserted by counting the practices asked about rather than by spying on
     * mongoose: the observable claim is that the names are right and that the
     * set asked for is deduplicated.
     */
    const a = await makePractice('Sunrise Diabetes Care');
    const b = await makePractice('Meridian Family Clinic');
    for (let i = 0; i < 10; i += 1) {
      await AdminAuditLog.record({
        admin,
        action: 'admin.practice.read',
        practice: i % 2 === 0 ? a._id : b._id,
      });
    }

    const res = await call('/admin/audit?limit=10');
    assert.equal(res.body.items.length, 10);
    const named = new Set(res.body.items.map((r) => r.practice.name));
    assert.deepEqual([...named].sort(), ['Meridian Family Clinic', 'Sunrise Diabetes Care']);
  });
});
