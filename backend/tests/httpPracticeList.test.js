import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { PLAN, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { Clinic } from '../src/models/Clinic.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { env } from '../src/config/env.js';

/**
 * The practice register, filtered and paged on the server.
 *
 * ---- What changed and why ----------------------------------------------
 *
 * This route returned every practice on the platform, unbounded, and the
 * console filtered and sorted in the browser. A correct trade at two practices
 * and a failure mode that arrives silently: the payload and the table grow
 * together until one day the page is unusable, with nothing before then to say
 * it is coming.
 *
 * So these hold the two halves. The behaviour the console already relied on
 * must be identical — same filters, same sorts, same counts — and the payload
 * must now be bounded whatever anybody asks for.
 */

const ADMIN_SECRET = 'a_test_admin_secret_for_the_practice_register';
let origin;
let realAdminSecret;
let token;

async function get(path) {
  const res = await fetch(origin + path, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describe('the practice register', () => {
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
    const admin = await PlatformAdmin.create({
      email: 'ops@example.com',
      name: 'Ops',
      passwordHash: 'x',
      isActive: true,
    });
    const { signAdminToken } = await import('../src/services/adminTokens.js');
    token = signAdminToken(admin);
  });

  test('a page is bounded, whatever the platform holds', async () => {
    // The failure this exists to prevent. Thirty practices, a default page,
    // and the answer must not be thirty.
    for (let i = 0; i < 30; i += 1) {
      await makePractice(`Clinic ${String(i).padStart(2, '0')}`, { plan: PLAN.TRIAL });
    }

    const res = await get('/admin/practices?limit=10');
    assert.equal(res.status, 200);
    assert.equal(res.body.items.length, 10);
    assert.equal(res.body.total, 30, 'the console cannot say "10 of 30" without the total');
    assert.equal(res.body.page, 1);
  });

  test('and a limit nobody should be able to ask for is refused', async () => {
    // `?limit=100000` would put the unbounded query back through the front
    // door. The validator caps it rather than trusting the caller.
    const res = await get('/admin/practices?limit=100000');
    assert.equal(res.status, 400);
  });

  test('the second page is different practices, not the same ones', async () => {
    for (let i = 0; i < 12; i += 1) {
      await makePractice(`Clinic ${String(i).padStart(2, '0')}`);
    }

    const first = await get('/admin/practices?limit=5&sort=name');
    const second = await get('/admin/practices?limit=5&page=2&sort=name');

    const a = first.body.items.map((p) => p.name);
    const b = second.body.items.map((p) => p.name);
    assert.equal(a.length, 5);
    assert.equal(b.length, 5);
    assert.equal(new Set([...a, ...b]).size, 10, 'a page repeated a practice');
  });

  test('text search matches a name, a registration number or the doctor', async () => {
    // All three were searched client-side, and all three have to keep working.
    await makePractice('Sunrise Diabetes Care', { registrationNo: 'WB-11223' });
    await makePractice('Meridian Family Clinic', { doctorDisplayName: 'Dr Anjali Bose' });
    await makePractice('Riverside Polyclinic');

    for (const [term, expected] of [
      ['sunrise', 'Sunrise Diabetes Care'],
      ['WB-112', 'Sunrise Diabetes Care'],
      ['anjali', 'Meridian Family Clinic'],
    ]) {
      const res = await get(`/admin/practices?q=${encodeURIComponent(term)}`);
      assert.equal(res.body.items.length, 1, `"${term}" matched ${res.body.items.length}`);
      assert.equal(res.body.items[0].name, expected);
    }
  });

  test('search is case-insensitive and matches a fragment', async () => {
    await makePractice('Sunrise Diabetes Care');
    const res = await get('/admin/practices?q=DIABET');
    assert.equal(res.body.items.length, 1);
  });

  test('a search that is regex syntax finds nothing rather than everything', async () => {
    /*
     * `.*` typed into a search box must be three characters, not a pattern.
     * Unescaped it matches every practice, which is the difference between a
     * search that found nothing and a search that quietly returned the whole
     * register.
     */
    await makePractice('Sunrise Diabetes Care');
    await makePractice('Meridian Family Clinic');

    const res = await get('/admin/practices?q=' + encodeURIComponent('.*'));
    assert.equal(res.body.items.length, 0, 'a regex in the search box matched everything');
    assert.equal(res.body.total, 0);
  });

  test('filters compose rather than replacing each other', async () => {
    await makePractice('A', { plan: PLAN.PROFESSIONAL, status: PRACTICE_STATUS.ACTIVE });
    await makePractice('B', { plan: PLAN.PROFESSIONAL, status: PRACTICE_STATUS.ONBOARDING });
    await makePractice('C', { plan: PLAN.ESSENTIAL, status: PRACTICE_STATUS.ACTIVE });

    const res = await get(`/admin/practices?plan=${PLAN.PROFESSIONAL}&status=${PRACTICE_STATUS.ACTIVE}`);
    assert.equal(res.body.items.length, 1);
    assert.equal(res.body.items[0].name, 'A');
  });

  test('the counts are counts, and the ids they came from are not sent', async () => {
    // The boundary this whole surface rests on: the platform console may know
    // how many people a practice has and never who.
    const practice = await makePractice('Sunrise Diabetes Care');
    await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    await makeMember(practice, { name: 'Sunita Desk' });
    await Clinic.create({ name: 'Salt Lake', practice: practice._id });

    const res = await get('/admin/practices');
    const row = res.body.items[0];
    assert.equal(row.staff, 2);
    assert.equal(row.locations, 1);
    assert.doesNotMatch(JSON.stringify(res.body), /Dr Bose|Sunita Desk/);
    // The lookup arrays are dropped, not merely unused.
    assert.ok(!('m' in row) && !('c' in row));
  });

  test('undecided practices come first by default', async () => {
    // The console is opened to find out what needs doing, not to browse an
    // alphabet — so this is the default and it has to survive the move.
    await makePractice('Settled', {
      status: PRACTICE_STATUS.ACTIVE,
      verification: VERIFICATION.VERIFIED,
    });
    await makePractice('Waiting', {
      status: PRACTICE_STATUS.ACTIVE,
      verification: VERIFICATION.PENDING,
    });

    const res = await get('/admin/practices');
    assert.equal(res.body.items[0].name, 'Waiting');
  });

  test('and onboarding counts as undecided too', async () => {
    await makePractice('Settled', {
      status: PRACTICE_STATUS.ACTIVE,
      verification: VERIFICATION.VERIFIED,
    });
    await makePractice('New', {
      status: PRACTICE_STATUS.ONBOARDING,
      verification: VERIFICATION.VERIFIED,
    });

    const res = await get('/admin/practices');
    assert.equal(res.body.items[0].name, 'New');
  });

  test('sorting by staff uses the count, not a field on the practice', async () => {
    // The reason this is an aggregation. `staff` does not exist on a Practice
    // — it is counted from memberships, and the count has to exist before the
    // page is chosen or the wrong practices end up on page one.
    const small = await makePractice('Small');
    const large = await makePractice('Large');
    await makeMember(small, { name: 'Only One', isOwner: true });
    for (const n of ['One', 'Two', 'Three']) {
      await makeMember(large, { name: `Dr ${n}` });
    }

    const res = await get('/admin/practices?sort=staff');
    assert.equal(res.body.items[0].name, 'Large');
    assert.equal(res.body.items[0].staff, 3);
  });

  test('by name, and by newest', async () => {
    await makePractice('Zebra');
    await makePractice('Alpha');

    const byName = await get('/admin/practices?sort=name');
    assert.equal(byName.body.items[0].name, 'Alpha');

    const byNew = await get('/admin/practices?sort=newest');
    assert.equal(byNew.body.items[0].name, 'Alpha', 'Alpha was created last');
  });

  test('a sort nobody has heard of is refused, not silently ignored', async () => {
    const res = await get('/admin/practices?sort=whatever');
    assert.equal(res.status, 400);
  });

  test('an empty register answers rather than failing', async () => {
    const res = await get('/admin/practices');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    assert.equal(res.body.total, 0);
  });

  test('a page past the end is empty, not an error', async () => {
    await makePractice('Only One');
    const res = await get('/admin/practices?page=9');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.items, []);
    // And the total still says how many there are, so the console can send
    // somebody back rather than showing them an empty register.
    assert.equal(res.body.total, 1);
  });
});
