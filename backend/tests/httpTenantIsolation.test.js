import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { ROLES } from '../src/models/User.js';
import { Clinic } from '../src/models/Clinic.js';
import { Department } from '../src/models/Department.js';
import { Feedback } from '../src/models/Feedback.js';
import { Appointment } from '../src/models/Appointment.js';

/**
 * Two practices, over the wire, asking the questions that leaked.
 *
 * ---- Why these particular routes ----------------------------------------
 *
 * They are not chosen for coverage. Each one is a leak that was found in this
 * codebase by reading it, and every one of them looked like correct code:
 *
 *   GET /team          three role-specific routes, none of them filtered
 *   GET /clinics       every location on the platform
 *   GET /departments   and POST, which took the tenant from the request body
 *   GET /feedback      `Feedback.find()`, populated with the patient's name,
 *                      phone and photograph
 *   GET /appointments  the clinician filter was `{}`
 *
 * A reading test would assert that a filter appears in the source. That is
 * exactly the assertion that passed while `countReply` never ran, because the
 * query was built and never awaited. These send a request and read the answer.
 *
 * ---- The shape every test here takes -------------------------------------
 *
 * Both practices get a row. That is the point: a test where only one practice
 * has data passes against a query with no filter at all, so it would have gone
 * green through the entire period all of these were broken.
 *
 * And the assertion is on the other practice's *names*, not on counts. A count
 * says the wrong number came back. `allText` says whose it was — which is the
 * difference between a failing test and a patient's phone number in a response.
 */

let sunrise;
let meridian;
let bose; // doctor at Sunrise
let iyer; // doctor at Meridian
let anita; // patient at Sunrise
let farida; // patient at Meridian

describe('one practice cannot see another', () => {
  before(boot);
  after(shutdown);

  beforeEach(async () => {
    await wipe();

    sunrise = await makePractice('Sunrise Diabetes Care');
    meridian = await makePractice('Meridian Family Clinic');

    bose = await makeMember(sunrise, { name: 'Dr Bose', isOwner: true });
    iyer = await makeMember(meridian, { name: 'Dr Iyer', isOwner: true });

    anita = await makePatient({ name: 'Anita Sengupta', practices: [sunrise] });
    farida = await makePatient({ name: 'Farida Rahman', practices: [meridian] });
  });

  test('the team list is this practice’s team', async () => {
    await makeMember(sunrise, { name: 'Sunita Desk', role: ROLES.STAFF });
    await makeMember(meridian, { name: 'Ravi Desk', role: ROLES.STAFF });

    const res = await as(bose.token).get('/team');
    assert.equal(res.status, 200);

    const text = allText(res.body);
    assert.match(text, /Sunita Desk/, 'the doctor cannot see their own receptionist');
    assert.doesNotMatch(text, /Ravi Desk/, 'another practice’s receptionist leaked');
    assert.doesNotMatch(text, /Dr Iyer/, 'another practice’s doctor leaked');
  });

  test('the locations are this practice’s locations', async () => {
    await Clinic.create({ name: 'Sunrise Salt Lake', practice: sunrise._id });
    await Clinic.create({ name: 'Meridian Ballygunge', practice: meridian._id });

    const res = await as(bose.token).get('/clinics');
    assert.equal(res.status, 200);

    const text = allText(res.body);
    assert.match(text, /Sunrise Salt Lake/);
    assert.doesNotMatch(text, /Meridian Ballygunge/, 'another practice’s address leaked');
  });

  test('the departments are this practice’s departments', async () => {
    await Department.create({
      key: 'sunrise_endo',
      names: { en: 'Sunrise Endocrinology' },
      practice: sunrise._id,
    });
    await Department.create({
      key: 'meridian_paeds',
      names: { en: 'Meridian Paediatrics' },
      practice: meridian._id,
    });

    const res = await as(bose.token).get('/departments');
    assert.equal(res.status, 200);

    const text = allText(res.body);
    assert.doesNotMatch(text, /Meridian Paediatrics/, 'another practice’s department leaked');
  });

  test('the feedback inbox is this practice’s patients', async () => {
    // The worst of the eight. Feedback is attributable by design and the route
    // populated name, phone and photograph onto every row it returned.
    //
    // Sent through the app's own route, so each row names the practice it went
    // to: rows that name none are private to their authors, and a test built on
    // them would pass against an inbox that showed nothing at all.
    assert.equal((await as(anita.token).post('/feedback', { about: 'clinic', rating: 5, message: 'Very good' })).status, 201);
    assert.equal(
      (await as(farida.token).post('/feedback', { about: 'clinic', rating: 2, message: 'Waited two hours' })).status,
      201,
    );
    assert.equal(await Feedback.countDocuments({ route: 'practice' }), 2);

    const res = await as(bose.token).get('/feedback');
    assert.equal(res.status, 200);

    const text = allText(res.body);
    assert.match(text, /Very good/, 'the practice cannot read its own patient’s feedback');
    assert.doesNotMatch(text, /Farida Rahman/, 'another practice’s patient was named');
    assert.doesNotMatch(text, /Waited two hours/, 'another practice’s patient was quoted');
    assert.doesNotMatch(
      text,
      new RegExp(farida.user.phone.replace(/\+/g, '\\+')),
      'another practice’s patient’s phone number leaked',
    );
  });

  test('the appointment list is this practice’s appointments', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    await Appointment.create({
      patient: anita.user._id,
      doctor: bose.user._id,
      scheduledFor: tomorrow,
      reason: 'Sunrise review',
    });
    await Appointment.create({
      patient: farida.user._id,
      doctor: iyer.user._id,
      scheduledFor: tomorrow,
      reason: 'Meridian review',
    });

    const res = await as(bose.token).get('/appointments');
    assert.equal(res.status, 200);

    const text = allText(res.body);
    assert.doesNotMatch(text, /Meridian review/, 'another practice’s appointment leaked');
    assert.doesNotMatch(text, /Farida Rahman/, 'another practice’s patient leaked');
  });

  test('and it reads the same from the other side', async () => {
    // Not symmetry for its own sake. A filter keyed on the *founding* practice
    // passes every test written from that practice's point of view, and this
    // codebase had exactly that bug in `countsFromRoles`.
    await makeMember(sunrise, { name: 'Sunita Desk', role: ROLES.STAFF });
    await makeMember(meridian, { name: 'Ravi Desk', role: ROLES.STAFF });

    const res = await as(iyer.token).get('/team');
    assert.equal(res.status, 200);

    const text = allText(res.body);
    assert.match(text, /Ravi Desk/, 'Meridian cannot see its own receptionist');
    assert.doesNotMatch(text, /Sunita Desk/, 'Sunrise leaked into Meridian');
  });
});

describe('a write cannot choose its own tenant', () => {
  before(boot);
  after(shutdown);

  beforeEach(async () => {
    await wipe();
    sunrise = await makePractice('Sunrise Diabetes Care');
    meridian = await makePractice('Meridian Family Clinic');
    bose = await makeMember(sunrise, { name: 'Dr Bose', isOwner: true });
    iyer = await makeMember(meridian, { name: 'Dr Iyer', isOwner: true });
  });

  test('a department lands in the caller’s practice, not the body’s', async () => {
    // The departments router read `req.body.practice ?? req.user.practice`, and
    // `User.practice` never existed — so it wrote departments belonging to
    // nobody, shared across every practice on the platform. A read leak shows
    // one tenant another's data; this one *created* the shared row.
    const res = await as(bose.token).post('/departments', {
      key: 'planted',
      names: { en: 'Planted Department' },
      practice: String(meridian._id),
    });

    // Whether it is created or refused is a product decision. What is not
    // negotiable is that it must not end up in Meridian.
    if (res.status >= 200 && res.status < 300) {
      const planted = await Department.findOne({ key: 'planted' });
      assert.ok(planted, 'the route reported success and wrote nothing');
      assert.notEqual(
        String(planted.practice),
        String(meridian._id),
        'a doctor wrote a department into another practice',
      );
      assert.equal(
        String(planted.practice),
        String(sunrise._id),
        'the department did not land in the caller’s own practice',
      );
    }

    // Either way, Meridian must not be able to see it.
    const theirs = await as(iyer.token).get('/departments');
    assert.doesNotMatch(allText(theirs.body), /Planted Department/);
  });
});
