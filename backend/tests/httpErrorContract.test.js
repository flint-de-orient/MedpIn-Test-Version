import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';
import { errorHandler } from '../src/middleware/errors.js';
import { env } from '../src/config/env.js';

/**
 * What every failure actually says, over the wire.
 *
 * ---- Why this is its own file ------------------------------------------
 *
 * The app decides what to draw from `error.code`. A status alone is not
 * enough — 404 is both "you typed the wrong URL" and "that belongs to another
 * practice", and those want different screens — so the contract is the pair,
 * and nothing was checking the pair end to end.
 *
 * It matters more since the tenant sweep. Five routes that used to succeed
 * across practices now refuse, and a refusal the app renders as "something
 * went wrong" teaches a clinician that the software is broken rather than that
 * the record is not theirs.
 *
 * ---- And the one thing a 404 must not become ---------------------------
 *
 * The tenant guards answer `notFound` rather than `forbidden` on purpose:
 * confirming that an id exists is itself an answer about another practice's
 * data. That only holds if the two 404s are indistinguishable — same status,
 * same code, same message, same body. A "Feedback not found" that differs by
 * one word from "Resource not found" is an existence oracle with extra steps.
 */

let origin;
let practice;
let doctor;
let patient;

async function setUp() {
  practice = await makePractice('Salt Lake Clinic', {
    practiceType: PRACTICE_TYPE.CLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  doctor = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
  patient = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
}

/** Everything a response says, as one lowercase string. */
const said = (res) => allText(res.body).toLowerCase();

describe('every failure names itself', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('401 for no credential, and it says UNAUTHORIZED', async () => {
    const res = await as(null).get('/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  test('401 for a forged token, with the same code', async () => {
    // Deliberately the same answer. "Your token is malformed" versus "your
    // token has expired" is a distinction useful only to somebody trying
    // tokens.
    const res = await as('not.a.real.token').get('/auth/me');
    assert.equal(res.status, 401);
    assert.equal(res.body.error.code, 'UNAUTHORIZED');
  });

  test('403 for the wrong role, and it says which kind of refusal', async () => {
    /*
     * The status the app most needs to tell apart. A 403 means "you are
     * signed in and this is not yours to do" — a sentence a person can act on,
     * by asking whoever runs their practice. A generic failure is not.
     */
    const desk = await makeMember(practice, { name: 'Sujata Roy', role: ROLES.STAFF });
    const res = await as(desk.token).post(`/doctor/alerts/${patient.user._id}/resolve`, {});

    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'FORBIDDEN');
    assert.ok(res.body.error.message.length > 10, 'a 403 with no explanation');
  });

  test('404 for a route that does not exist', async () => {
    const res = await as(doctor.token).get('/no-such-route');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'NOT_FOUND');
  });

  test('400 VALIDATION_ERROR carries the field, not a stack', async () => {
    // The one error the app can act on precisely: it puts the message under
    // the field rather than in a banner.
    const res = await as(doctor.token).post('/feedback', { about: 'nonsense' });

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'VALIDATION_ERROR');
    assert.ok(Array.isArray(res.body.error.details), 'no field detail to show');
    assert.ok(res.body.error.details[0].path, 'a detail with no field name');
  });

  test('400 INVALID_ID rather than a Mongoose CastError', async () => {
    /*
     * A driver error reaching the client is two failures at once: it names
     * internals, and its `code` is a number where the app matches on names —
     * so it falls through to "an unexpected error occurred", which is the
     * least useful thing it could say.
     */
    const res = await as(doctor.token).del('/uploads/not-an-objectid');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'INVALID_ID');
    assert.ok(!said(res).includes('cast to objectid'), 'a Mongoose message reached the client');
  });

  test('and every error code is a name, never a number', async () => {
    /*
     * Driver errors carry their own numeric `code` — 13 is Unauthorized, 18 is
     * AuthenticationFailed — and passing one through breaks the contract the
     * app matches on. Checked across a spread of failures rather than one.
     */
    const responses = [
      await as(null).get('/auth/me'),
      await as(doctor.token).get('/no-such-route'),
      await as(doctor.token).del('/uploads/not-an-objectid'),
      await as(doctor.token).post('/feedback', {}),
    ];
    for (const res of responses) {
      assert.equal(typeof res.body.error.code, 'string', `${res.status} carried a numeric code`);
      assert.match(res.body.error.code, /^[A-Z_]+$/, `${res.status} code is not a name`);
    }
  });
});

describe('a refusal says nothing it was refusing to say', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('no stack trace, ever', async () => {
    for (const res of [
      await as(null).get('/auth/me'),
      await as(doctor.token).get('/no-such-route'),
      await as(doctor.token).del('/uploads/not-an-objectid'),
    ]) {
      const text = said(res);
      assert.ok(!/\bat\s+\w+\s*\(/.test(text), 'a stack frame reached the client');
      assert.ok(!text.includes('node_modules'), 'a module path reached the client');
      assert.ok(!text.includes('/src/'), 'a source path reached the client');
    }
  });

  test('and no internals in a validation failure', async () => {
    const res = await as(doctor.token).post('/feedback', { about: 'nonsense' });
    const text = said(res);
    for (const leak of ['mongo', 'mongoose', 'schema', 'collection']) {
      assert.ok(!text.includes(leak), `a validation error named ${leak}`);
    }
  });
});

describe('a tenant refusal is indistinguishable from an absence', () => {
  /*
   * The property the whole tenant story rests on, and the one the brief is
   * explicit about: do not turn a secure 404 into a resource-existence leak.
   *
   * Each of these asks for two things — a resource that genuinely does not
   * exist, and one that exists and belongs to somebody else — and asserts the
   * two answers are the same in every respect a caller can observe. A message
   * that differs by one word is an oracle with extra steps: ask for an id,
   * read which sentence comes back, learn whether the row is there.
   */
  let other;

  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();

    const theirPractice = await makePractice('Behala Clinic', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    other = {
      practice: theirPractice,
      patient: await makePatient({ name: 'Sunil Kapadia', practices: [theirPractice] }),
    };
  });

  /** An id in the right shape that nothing has ever been stored under. */
  const ABSENT = '000000000000000000000000';

  test('a file belonging to another practice answers like one that is not there', async () => {
    const theirs = await MediaAsset.create({
      owner: other.patient.user._id,
      uploadedBy: other.patient.user._id,
      kind: 'lab_report',
      storageKey: 'b/lab.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const missing = await as(doctor.token).del(`/uploads/${ABSENT}`);
    const somebodyElses = await as(doctor.token).del(`/uploads/${theirs._id}`);

    assert.equal(somebodyElses.status, missing.status);
    assert.deepEqual(somebodyElses.body, missing.body, 'the two 404s can be told apart');
  });

  test('and a patient belonging to another practice does too', async () => {
    const newLogin = await makePatient({ name: 'Their Own Phone' });
    const body = { phone: newLogin.user.phone };

    const missing = await as(doctor.token).post(`/records/patients/${ABSENT}/detach`, body);
    const somebodyElses = await as(doctor.token).post(
      `/records/patients/${other.patient.patient._id}/detach`,
      body,
    );

    assert.equal(somebodyElses.status, missing.status);
    assert.deepEqual(somebodyElses.body, missing.body, 'the two 404s can be told apart');
  });

  test('and a conversation does too', async () => {
    const { ChatSession } = await import('../src/models/ChatSession.js');
    const { ChatMessage } = await import('../src/models/ChatMessage.js');
    const session = await ChatSession.create({
      patient: other.patient.user._id,
      kind: 'care',
      language: 'en',
    });
    const theirs = await ChatMessage.create({
      session: session._id,
      patient: other.patient.user._id,
      seq: 1,
      role: 'user',
      content: 'Hello.',
    });

    const body = { pinned: true };
    const missing = await as(doctor.token).post(`/chat/messages/${ABSENT}/pin`, body);
    const somebodyElses = await as(doctor.token).post(`/chat/messages/${theirs._id}/pin`, body);

    assert.equal(somebodyElses.status, missing.status);
    assert.deepEqual(somebodyElses.body, missing.body, 'the two 404s can be told apart');
  });

  test('and no refusal ever names the other practice or its people', async () => {
    /*
     * The other half of the same property. Matching statuses are no use if the
     * message reads "that belongs to Behala Clinic".
     */
    const theirs = await MediaAsset.create({
      owner: other.patient.user._id,
      uploadedBy: other.patient.user._id,
      kind: 'lab_report',
      storageKey: 'b/lab.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const res = await as(doctor.token).del(`/uploads/${theirs._id}`);
    const text = said(res);

    assert.ok(!text.includes('behala'), 'the refusal named the other practice');
    assert.ok(!text.includes('sunil'), 'the refusal named the other practice’s patient');
    assert.ok(
      !text.includes(String(other.practice._id).toLowerCase()),
      'the refusal carried the other practice’s id',
    );
    assert.ok(
      !text.includes(String(other.patient.user._id).toLowerCase()),
      'the refusal carried another practice’s patient id',
    );
  });
});

describe('the error handler itself, for the paths a request cannot reach', () => {
  /*
   * Two behaviours the HTTP tests above cannot exercise, tested where they
   * live instead.
   *
   * A 500 sanitised for production needs `NODE_ENV=production`, and the suite
   * runs as `test` — a server booted the other way would be a different
   * application. A numeric driver code needs a database that refuses, which is
   * not a state a test fixture can ask for.
   *
   * `errorHandler` is a pure function of (err, req, res), so both are ordinary
   * unit tests once the response is a stub. A mutation run found both of these
   * unguarded: removing the sanitisation and removing the code normalisation
   * each left every test green.
   */
  /** Just enough of an Express response to capture what was sent. */
  function capture() {
    const out = { status: null, body: null };
    return {
      res: {
        status(code) {
          out.status = code;
          return this;
        },
        json(payload) {
          out.body = payload;
          return this;
        },
      },
      out,
    };
  }

  const req = { originalUrl: '/api/v1/whatever', method: 'POST' };

  test('a driver error’s numeric code never reaches the client', () => {
    /*
     * MongoServerError 13 is Unauthorized and 18 is AuthenticationFailed, and
     * `err.code ?? 'INTERNAL_ERROR'` passes the number straight through. The
     * app matches on names, so a numeric code falls through every branch to a
     * bare "an unexpected error occurred" — the least useful thing it could
     * say about a database that has stopped accepting the credentials.
     */
    const { res, out } = capture();
    const driverError = Object.assign(new Error('not authorized on medpin'), {
      code: 13,
      codeName: 'Unauthorized',
    });

    errorHandler(driverError, req, res, () => {});

    assert.equal(typeof out.body.error.code, 'string');
    assert.equal(out.body.error.code, 'INTERNAL_ERROR');
  });

  test('and a 500 is sanitised when this is production', () => {
    /*
     * Read through `env.NODE_ENV` rather than the `isProd` const, which is
     * computed once at import and cannot be swapped from a test. The const
     * stays for every other caller; this is the one place that has to be able
     * to answer the question twice in one process.
     */
    const before = env.NODE_ENV;
    env.NODE_ENV = 'production';
    try {
      const { res, out } = capture();
      errorHandler(new Error('connect ECONNREFUSED 127.0.0.1:27017'), req, res, () => {});

      assert.equal(out.status, 500);
      assert.ok(
        !out.body.error.message.includes('27017'),
        'an internal address reached the client',
      );
      assert.ok(!out.body.error.message.includes('ECONNREFUSED'));
    } finally {
      env.NODE_ENV = before;
    }
  });

  test('but a 500 says what happened outside production', () => {
    // A developer staring at "Something went wrong" learns nothing, and the
    // sanitisation exists for the patient's device rather than for the person
    // debugging it.
    const { res, out } = capture();
    errorHandler(new Error('connect ECONNREFUSED 127.0.0.1:27017'), req, res, () => {});

    assert.equal(out.status, 500);
    assert.ok(out.body.error.message.includes('ECONNREFUSED'));
  });
});
