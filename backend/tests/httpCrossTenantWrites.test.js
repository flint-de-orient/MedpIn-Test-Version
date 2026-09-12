import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { MediaAsset } from '../src/models/MediaAsset.js';
import { ChatMessage } from '../src/models/ChatMessage.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { Patient } from '../src/models/Patient.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Three writes that reached across practices, and one shape between them.
 *
 * ---- The pattern ---------------------------------------------------------
 *
 * Each of these enforced ownership as "unless you are a clinician":
 *
 *     if (asset.owner !== req.user._id && req.user.role === ROLES.PATIENT)
 *     if (req.user.role === ROLES.PATIENT) filter.patient = req.user._id;
 *     Patient.findById(req.params.id)          // nothing at all
 *
 * Every one of those was correct while there was one clinic. "A clinician may
 * act on any patient" was a true sentence about this product, and the check
 * that expressed it only ever had to exclude patients reaching for each
 * other's records.
 *
 * The tenant migration made it false everywhere at once, and quietly: the
 * routes kept working, the tests kept passing, and the same code now means
 * "a clinician at any practice may act on anybody's data".
 *
 * ---- Why these three and not the other twenty-three ---------------------
 *
 * The authorisation sweep classified all 144 mutating routes. Most of the
 * unguarded ones are genuinely fine — self-service on one's own account, a
 * webhook verified by HMAC, a badge counter. These are the three where a
 * request from one practice changes another practice's data, which is the
 * property the whole multi-practice model rests on.
 *
 * Each test names a clinician at practice A reaching into practice B. None of
 * them needs a permission added; they need the scoping the rest of the
 * codebase already applies.
 */

let origin;
let a;
let b;

/** Two practices, each with a doctor and a patient. */
async function twoPractices() {
  const mk = async (name) => {
    const practice = await makePractice(name, {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    const doctor = await makeMember(practice, { name: `Dr ${name}`, isOwner: true });
    const patient = await makePatient({ name: `${name} Patient`, practices: [practice] });
    return { practice, doctor, patient };
  };
  a = await mk('Salt Lake');
  b = await mk('Behala');
}

describe('a clinician cannot delete another practice’s files', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('a lab report belonging to another practice’s patient survives', async () => {
    /*
     * The check read `owner !== me && role === PATIENT`, so it refused a
     * patient reaching for somebody else's file and waved through every
     * clinician on the platform. A soft delete, so the bytes remain — and the
     * scan disappears from the record of a patient this person has never met.
     */
    const asset = await MediaAsset.create({
      owner: b.patient.user._id,
      uploadedBy: b.patient.user._id,
      kind: 'lab_report',
      storageKey: 'b/lab.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const res = await as(a.doctor.token).del(`/uploads/${asset._id}`);

    assert.equal(res.status, 404, 'a doctor at another practice deleted this file');
    const after = await MediaAsset.findById(asset._id).lean();
    // `!after.deletedAt` rather than `=== null`: the field has no default, so
    // an undeleted asset carries `undefined` and strict equality fails on a
    // file nobody touched.
    assert.ok(!after.deletedAt, 'the file was marked deleted');
  });

  test('but their own practice’s file can still be removed', async () => {
    // The half that has to keep working. A fix that locks a clinic out of its
    // own records is not a fix.
    const asset = await MediaAsset.create({
      owner: a.patient.user._id,
      uploadedBy: a.patient.user._id,
      kind: 'lab_report',
      storageKey: 'a/lab.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1024,
    });

    const res = await as(a.doctor.token).del(`/uploads/${asset._id}`);
    assert.equal(res.status, 204);
  });
});

describe('a clinician cannot moderate another practice’s conversations', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  /** One message in a patient's own thread. */
  async function messageFor(who) {
    const session = await ChatSession.create({
      patient: who.user._id,
      kind: 'care',
      language: 'en',
    });
    return ChatMessage.create({
      session: session._id,
      patient: who.user._id,
      seq: 1,
      role: 'user',
      content: 'My foot has been sore since Tuesday.',
    });
  }

  test('pinning', async () => {
    /*
     * `findVisibleMessage` narrowed the filter to `patient: me` for patients
     * and left it as the bare id for everybody else. Pin, hide and unhide all
     * go through it with no second check; edit and delete-for-everyone add
     * `isOwnMessage`, which is why those two were never exposed.
     */
    const message = await messageFor(b.patient);
    // `{ pinned: true }`, not `{}` — the route validates its body, so an empty
    // one answers 400 before any guard runs and the test would pass without
    // ever reaching the thing it names.
    const res = await as(a.doctor.token).post(`/chat/messages/${message._id}/pin`, { pinned: true });
    assert.equal(res.status, 404, 'a doctor at another practice pinned this message');
  });

  test('hiding', async () => {
    const message = await messageFor(b.patient);
    const res = await as(a.doctor.token).post(`/chat/messages/${message._id}/hide`, {});
    assert.equal(res.status, 404);
  });

  test('unhiding', async () => {
    const message = await messageFor(b.patient);
    const res = await as(a.doctor.token).post(`/chat/messages/${message._id}/unhide`, {});
    assert.equal(res.status, 404);
  });

  test('and /flag is not in this list, because it is not a clinician action', () => {
    /*
     * Worth writing down, because it looked like one and a first version of
     * this file tested it here — where it passed, for the wrong reason.
     *
     * `flag` sets `flaggedByPatient` and filters on `patient: req.user._id`
     * unconditionally, so a clinician gets 404 for their *own* patient too.
     * It is a patient reporting a bad answer, not moderation. A test that
     * passes because the route refuses everybody proves nothing about tenant
     * scoping.
     */
    const src = readFileSync(
      fileURLToPath(new URL('../src/routes/chat.js', import.meta.url)),
      'utf8',
    );
    const at = src.indexOf("'/messages/:id/flag'");
    const handler = src.slice(at, src.indexOf('\nrouter.', at));
    assert.match(handler, /patient: req\.user\._id/);
    assert.ok(!/findVisibleMessage/.test(handler), 'flag now shares the clinician path');
  });

  test('and their own practice’s messages are still theirs to moderate', async () => {
    const message = await messageFor(a.patient);
    const res = await as(a.doctor.token).post(`/chat/messages/${message._id}/pin`, { pinned: true });
    assert.notEqual(res.status, 404, 'a doctor lost their own patient’s thread');
  });
});

describe('a clinician cannot move another practice’s patient onto a new login', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('detaching is refused across practices', async () => {
    /*
     * The worst of the three, because of what it changes.
     *
     * Detaching gives a patient their own login — it decides which phone
     * number signs in as that person from then on. `Patient.findById` with no
     * scoping meant a clinician at any practice could point somebody else's
     * patient at a number of their choosing.
     */
    const newLogin = await makePatient({ name: 'Their Own Phone' });
    const theirs = await Patient.findById(b.patient.patient._id).lean();
    assert.ok(theirs, 'fixture: practice B has a patient');

    const res = await as(a.doctor.token).post(`/records/patients/${theirs._id}/detach`, {
      phone: newLogin.user.phone,
    });

    assert.equal(res.status, 404, 'a doctor at another practice detached this patient');
    const after = await Patient.findById(theirs._id).lean();
    assert.equal(after.detachedAt, null, 'the patient was detached');
    assert.equal(String(after.login), String(b.patient.user._id), 'their login was changed');
  });
});

describe('and two more of the same shape, found by finishing the sweep', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await twoPractices();
  });

  test('the owner a clinician names must be their own patient', () => {
    // Asserted on the source, because the route is multipart and a fixture
    // for it would be exercising multer rather than the check.
    const src = readFileSync(
      fileURLToPath(new URL('../src/routes/uploads.js', import.meta.url)),
      'utf8',
    );
    const at = src.indexOf("router.post(\n  '/',");
    const handler = src.slice(at, src.indexOf('\nrouter.', at + 10));
    assert.match(
      handler,
      /practicePatients\(/,
      'a clinician can still name any patient id as the owner',
    );
  });

  test('a clinician cannot mark another practice’s feedback reviewed', async () => {
    /*
     * The read on this collection was scoped with a comment explaining exactly
     * why — "every patient's words on the platform, with their name, phone and
     * photograph attached". The write one route below it was not.
     *
     * That is the shape worth noticing: a fix applied where somebody was
     * looking, and not to its neighbour.
     */
    const { Feedback } = await import('../src/models/Feedback.js');
    const theirs = await Feedback.create({
      patient: b.patient.user._id,
      about: 'clinic',
      rating: 2,
      message: 'The clinic did not call me back.',
    });

    const res = await as(a.doctor.token).post(`/feedback/${theirs._id}/reviewed`, {});

    assert.equal(res.status, 404, 'a doctor at another practice reviewed this feedback');
    const after = await Feedback.findById(theirs._id).lean();
    assert.ok(!after.reviewedAt, 'the feedback was marked reviewed');
  });

  test('but their own practice’s feedback is still theirs to review', async () => {
    const { Feedback } = await import('../src/models/Feedback.js');
    const mine = await Feedback.create({
      patient: a.patient.user._id,
      about: 'clinic',
      rating: 5,
      message: 'Very helpful, thank you.',
    });

    const res = await as(a.doctor.token).post(`/feedback/${mine._id}/reviewed`, {});
    assert.equal(res.status, 204);
  });
});
