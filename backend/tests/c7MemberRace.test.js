import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { ROLES } from '../src/models/User.js';
import { Membership, MEMBERSHIP_STATUS, PRESETS } from '../src/models/Membership.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Two managers changing one member of staff at the same moment.
 *
 * PATCH /team/:id loaded the membership, changed it and saved the row. The
 * second manager to press Save put back what the first had changed — a
 * suspension reverted by a department change, a role flipped back — and
 * neither was told.
 *
 * ---- Optimistic concurrency, and what the client says ----------------------
 *
 * The write lands only on the version of the row it was made against, and the
 * People screen sends the version it showed, so whichever request reaches the
 * database second is refused with 409 MEMBER_CHANGED — whether the two
 * overlapped inside the server or came from two screens opened at once. Real
 * parallel requests over HTTP.
 *
 * Builds of the app from before this send no version. For them the tests
 * assert what can still be promised: no change reported as saved is lost.
 */

let practice;
let owner;
let manager;
let desk;

/** Waits for audit rows to stop arriving, then returns them. */
async function settledAudit(filter, expected) {
  const until = Date.now() + 3000;
  while (Date.now() < until && (await AuditLog.countDocuments(filter)) < expected) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 150));
  return AuditLog.find(filter).lean();
}

describe('two managers changing one member at once', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    owner = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
    // A second doctor who also manages the People screen.
    manager = await makeMember(practice, { name: 'Dr Das', permissions: [...PRESETS.head] });
    desk = await makeMember(practice, { name: 'Rina Paul', role: ROLES.STAFF });
  });

  const memberUrl = () => `/team/${desk.membership._id}`;

  /** The version the People screen shows for Rina. */
  async function versionOnScreen(who) {
    const roster = await as(who.token).get('/team');
    assert.equal(roster.status, 200);
    const row = roster.body.items.find((m) => m.id === String(desk.membership._id));
    assert.equal(typeof row.version, 'number', 'the roster sends no version to change against');
    return row.version;
  }

  test('the second write fails with 409 instead of silently overwriting the first', async () => {
    const [seenBySen, seenByDas] = await Promise.all([versionOnScreen(owner), versionOnScreen(manager)]);

    const [bySen, byDas] = await Promise.all([
      as(owner.token).patch(memberUrl(), { status: MEMBERSHIP_STATUS.SUSPENDED, version: seenBySen }),
      as(manager.token).patch(memberUrl(), { role: ROLES.DOCTOR_ASSISTANT, version: seenByDas }),
    ]);

    assert.deepEqual([bySen.status, byDas.status].sort(), [200, 409], `answered ${bySen.status} and ${byDas.status}`);
    const [winner, loser] = bySen.status === 200 ? [bySen, byDas] : [byDas, bySen];
    assert.equal(loser.body.error.code, 'MEMBER_CHANGED');
    assert.equal(winner.body.membership.version, seenBySen + 1);

    const row = await Membership.findById(desk.membership._id).lean();
    if (bySen.status === 200) {
      assert.equal(row.status, MEMBERSHIP_STATUS.SUSPENDED);
      assert.equal(row.role, ROLES.STAFF, 'the refused role change was written anyway');
    } else {
      assert.equal(row.role, ROLES.DOCTOR_ASSISTANT);
      assert.equal(row.status, MEMBERSHIP_STATUS.ACTIVE, 'the refused suspension was written anyway');
    }
    assert.equal(row.__v, seenBySen + 1, 'the row was written more than once');

    // Audited once, for the change that was made.
    const rows = await settledAudit({ resource: 'Membership', action: 'update' }, 1);
    assert.equal(rows.length, 1);
  });

  test('a screen showing a version that has since changed is refused', async () => {
    const seen = await versionOnScreen(owner);
    const first = await as(owner.token).patch(memberUrl(), { status: MEMBERSHIP_STATUS.SUSPENDED, version: seen });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.membership.version, seen + 1);

    // Dr Das still has the People screen from before, showing her active.
    const stale = await as(manager.token).patch(memberUrl(), { role: ROLES.DOCTOR_ASSISTANT, version: seen });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.error.code, 'MEMBER_CHANGED');
    const row = await Membership.findById(desk.membership._id).lean();
    assert.equal(row.role, ROLES.STAFF);
    assert.equal(row.status, MEMBERSHIP_STATUS.SUSPENDED);

    // Opened again, the change goes through against what is there now.
    const fresh = await as(manager.token).patch(memberUrl(), {
      role: ROLES.DOCTOR_ASSISTANT,
      version: await versionOnScreen(manager),
    });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
  });

  test('a row written before versions existed is protected the same way', async () => {
    // The backfill wrote memberships through the driver, with no `__v`.
    await Membership.collection.updateOne({ _id: desk.membership._id }, { $unset: { __v: '' } });
    const seen = await versionOnScreen(owner);
    assert.equal(seen, 0);

    const results = await Promise.all([
      as(owner.token).patch(memberUrl(), { status: MEMBERSHIP_STATUS.SUSPENDED, version: seen }),
      as(manager.token).patch(memberUrl(), { role: ROLES.DOCTOR_ASSISTANT, version: seen }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
    assert.equal((await Membership.findById(desk.membership._id).lean()).__v, 1);
  });

  test('older builds, which send no version: no change reported as saved is lost', async () => {
    const [bySen, byDas] = await Promise.all([
      as(owner.token).patch(memberUrl(), { status: MEMBERSHIP_STATUS.SUSPENDED }),
      as(manager.token).patch(memberUrl(), { role: ROLES.DOCTOR_ASSISTANT }),
    ]);
    const row = await Membership.findById(desk.membership._id).lean();

    if (bySen.status === 200) assert.equal(row.status, MEMBERSHIP_STATUS.SUSPENDED, 'a saved suspension was lost');
    else {
      assert.equal(bySen.body.error.code, 'MEMBER_CHANGED');
      assert.equal(row.status, MEMBERSHIP_STATUS.ACTIVE);
    }
    if (byDas.status === 200) assert.equal(row.role, ROLES.DOCTOR_ASSISTANT, 'a saved role change was lost');
    else {
      assert.equal(byDas.body.error.code, 'MEMBER_CHANGED');
      assert.equal(row.role, ROLES.STAFF);
    }
    assert.ok([bySen.status, byDas.status].includes(200));
  });
});
