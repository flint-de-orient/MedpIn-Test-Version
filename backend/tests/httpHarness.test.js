import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';

/**
 * The harness itself.
 *
 * A test suite whose fixtures are quietly broken reports green and proves
 * nothing, which is the failure mode of every "we have integration tests"
 * conversation. So before anything uses this, four things it must actually do.
 */

describe('the harness runs the real app', () => {
  before(async () => {
    await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  test('it is not talking to your database', () => {
    // The one assertion that stops this file being dangerous. If the host is
    // anything but loopback, `wipe()` is emptying somebody's clinic.
    const { host, name } = mongoose.connection;
    assert.ok(
      host === '127.0.0.1' || host === 'localhost',
      `connected to ${host}, which is not the memory server`,
    );
    assert.match(name, /test/i, `database is named ${name}`);
  });

  test('a real request reaches a real route', async () => {
    const res = await as(null).get('/health');
    assert.equal(res.status, 200);
  });

  test('an unauthenticated caller is refused, not served', async () => {
    // The default has to be closed. If this ever returns 200, every isolation
    // assertion below is meaningless.
    const res = await as(null).get('/team');
    assert.equal(res.status, 401);
  });

  test('a signed token authenticates over the wire', async () => {
    const practice = await makePractice('Harness Clinic');
    const doctor = await makeMember(practice, { name: 'Dr Harness' });

    const res = await as(doctor.token).get('/team');
    assert.notEqual(res.status, 401, 'a valid token was rejected');
  });

  test('wipe really empties between tests', async () => {
    // The previous test made a practice. If it is still here, every test after
    // it inherits state and the suite is lying.
    const { Practice } = await import('../src/models/Practice.js');
    assert.equal(await Practice.countDocuments(), 0);
  });
});
