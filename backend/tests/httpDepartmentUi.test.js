import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember } from './helpers/factories.js';
import { Department } from '../src/models/Department.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';

/**
 * The same app, composed two ways, over the wire.
 *
 * ---- Why a unit test was not enough -------------------------------------
 *
 * `uiConfig.test.js` proves the resolver. It says nothing about whether the
 * department is ever loaded, whether the capability set reaching it is the
 * effective one or the practice's, or whether any of it is on the response the
 * app actually reads. Every one of those has been wrong somewhere in this
 * codebase before — a guard mounted on nothing, a field recorded and never
 * shown, a resolver called with the wrong set.
 *
 * So these are two real people at one real practice, on one plan, in the same
 * role, differing only in which department they belong to. If the two answers
 * come back the same, the configuration layer is decoration.
 */

let origin;
let practice;
let cardiology;
let laboratory;

async function setUp() {
  practice = await makePractice('Salt Lake Polyclinic', {
    practiceType: PRACTICE_TYPE.POLYCLINIC,
    plan: PLAN.PROFESSIONAL,
  });

  [cardiology, laboratory] = await Department.create([
    { practice: practice._id, key: 'cardiology', names: { en: 'Cardiology' } },
    { practice: practice._id, key: 'laboratory', names: { en: 'Laboratory' } },
  ]);
}

describe('two doctors, one practice, two different home screens', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('the cardiologist opens a caseload', async () => {
    const doctor = await makeMember(practice, { name: 'Dr Ghosh', department: cardiology._id });
    const res = await as(doctor.token).get('/auth/me/capabilities');

    assert.equal(res.status, 200);
    assert.equal(res.body.ui.department, 'cardiology');
    assert.ok(res.body.ui.widgets.includes('TRIAGE_QUEUE'));
    assert.ok(res.body.ui.widgets.includes('TODAYS_CLINIC'));
    assert.ok(res.body.ui.quickActions.includes('START_CONSULTATION'));
  });

  test('the doctor in the laboratory opens a set of results', async () => {
    const doctor = await makeMember(practice, { name: 'Dr Iyer', department: laboratory._id });
    const res = await as(doctor.token).get('/auth/me/capabilities');

    assert.equal(res.body.ui.department, 'laboratory');
    assert.ok(res.body.ui.widgets.includes('CRITICAL_LAB_RESULTS'));
    assert.ok(res.body.ui.widgets.includes('LAB_FLAG_SUMMARY'));
    assert.ok(res.body.ui.quickActions.includes('VIEW_LAB_REPORTS'));
    // And nobody on the bench is offered a prescription pad.
    assert.ok(!res.body.ui.quickActions.includes('WRITE_PRESCRIPTION'));
  });

  test('and nothing but the department separates them', async () => {
    /*
     * The assertion the whole engine exists to satisfy.
     *
     * One practice, one plan, one practice type, one role, one permission set.
     * Two screens with nothing in common. Every other difference has been held
     * constant deliberately — if this ever passes because the two members
     * differ in some other way, it has stopped testing the thing it names.
     */
    const heart = await makeMember(practice, { name: 'Dr Ghosh', department: cardiology._id });
    const bench = await makeMember(practice, { name: 'Dr Iyer', department: laboratory._id });

    const a = (await as(heart.token).get('/auth/me/capabilities')).body;
    const b = (await as(bench.token).get('/auth/me/capabilities')).body;

    assert.deepEqual(a.effective, b.effective, 'the two differ in capabilities, not department');
    assert.deepEqual(
      a.membership.permissions,
      b.membership.permissions,
      'the two differ in permissions, not department',
    );

    // The overlap is one component, deliberately: a cardiologist reads their
    // own patients' lab reports. Everything else about the two screens differs.
    const shared = b.ui.widgets.filter((id) => a.ui.widgets.includes(id));
    assert.deepEqual(shared, ['RECENT_LAB_REPORTS']);
    for (const id of ['TODAYS_CLINIC', 'TRIAGE_QUEUE', 'ACTION_QUEUE']) {
      assert.ok(!b.ui.widgets.includes(id), `the laboratory screen shows ${id}`);
    }
  });

  test('the department is named, so the screen can say where it is', async () => {
    const doctor = await makeMember(practice, { name: 'Dr Ghosh', department: cardiology._id });
    const res = await as(doctor.token).get('/auth/me/capabilities');

    assert.deepEqual(res.body.membership.department, { key: 'cardiology', name: 'Cardiology' });
  });
});

describe('what an operator configures is what arrives', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('a configured dashboard replaces the default', async () => {
    // The whole promise of the engine: a practice shapes its own cardiology
    // screen without a release, and without anybody writing cardiology code.
    await Department.updateOne(
      { _id: cardiology._id },
      { widgets: ['ACTION_QUEUE', 'OPEN_ALERTS'], quickActions: ['VIEW_ALERTS'] },
    );

    const doctor = await makeMember(practice, { name: 'Dr Ghosh', department: cardiology._id });
    const res = await as(doctor.token).get('/auth/me/capabilities');

    assert.deepEqual(res.body.ui.widgets, ['ACTION_QUEUE', 'OPEN_ALERTS']);
    assert.deepEqual(res.body.ui.quickActions, ['VIEW_ALERTS']);
  });

  test('a component nobody has written never reaches the app', async () => {
    /*
     * `widgets` is an array of free strings an operator edits. That is safe
     * only because the server drops what it does not recognise — otherwise a
     * typo in a console field is a home screen the app cannot draw, for every
     * clinician in that department at once.
     */
    await Department.updateOne(
      { _id: cardiology._id },
      { widgets: ['ACTION_QUEUE', 'MAGIC_BOX', '../../etc/passwd', ''] },
    );

    const doctor = await makeMember(practice, { name: 'Dr Ghosh', department: cardiology._id });
    const res = await as(doctor.token).get('/auth/me/capabilities');

    assert.deepEqual(res.body.ui.widgets, ['ACTION_QUEUE']);
  });
});

describe('and the practice that has no departments still has a screen', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  test('a solo clinic gets the general clinical set', async () => {
    // Dr Dey's clinic, and every practice on the platform today. If this ever
    // fails, the deploy that makes it fail gives a working clinic a blank home
    // screen on a Monday morning.
    const clinic = await makePractice('Dr Dey Diabetes Care', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.ESSENTIAL,
    });
    const doctor = await makeMember(clinic, { name: 'Dr Dey', isOwner: true });

    const res = await as(doctor.token).get('/auth/me/capabilities');

    assert.equal(res.body.ui.department, null);
    assert.ok(res.body.ui.widgets.includes('TODAYS_CLINIC'));
    assert.ok(res.body.ui.quickActions.includes('WRITE_PRESCRIPTION'));
  });

  test('and Essential is not offered what Essential does not include', async () => {
    const clinic = await makePractice('Dr Dey Diabetes Care', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.ESSENTIAL,
    });
    const doctor = await makeMember(clinic, { name: 'Dr Dey', isOwner: true });

    const res = await as(doctor.token).get('/auth/me/capabilities');

    // ADVANCED_ANALYTICS is Professional and above. The screen must not offer
    // a panel whose route would refuse it.
    assert.ok(!res.body.ui.widgets.includes('ANALYTICS_SUMMARY'));
    // But the clinical baseline is untouched — a plan is not a reason to stop
    // showing a doctor who is in front of them.
    assert.ok(res.body.ui.widgets.includes('TODAYS_CLINIC'));
  });

  test('a patient is sent no dashboard at all', async () => {
    /*
     * Null, not an empty one, and not a clinician's.
     *
     * A patient has no membership, and a missing membership everywhere else
     * in this codebase means "unknown, do not narrow" — which read
     * unqualified would compose a full clinician dashboard and send it to
     * somebody who is not a clinician. Harmless, since the routes refuse
     * them; wrong, because the honest answer is that there is no clinician
     * home screen for a patient.
     */
    const { makePatient } = await import('./helpers/factories.js');
    const patient = await makePatient({ name: 'Anita Sengupta' });

    const res = await as(patient.token).get('/auth/me/capabilities');

    assert.equal(res.status, 200);
    assert.equal(res.body.ui, null);
    assert.equal(res.body.membership, null);
  });
});

describe('the laboratory dashboard has somebody to give it to', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('the front desk in a laboratory is still not the bench', async () => {
    /*
     * This test used to be called "the desk in a laboratory can read results
     * it cannot order", and it documented a symptom rather than a rule: a lab
     * technician had to be filed as `staff`, and ROLE_EXCLUDES strips
     * LAB_ORDER from the desk, so the bench could see what came back abnormal
     * and could not begin the work that produced it.
     *
     * The rule was never wrong — a receptionist must not order clinical
     * investigations. It was being asked of the wrong job. Now that
     * LAB_TECHNICIAN and LAB_MANAGER exist (see roles.test.js and
     * httpRoles.test.js), this asserts what it always meant to: the desk is
     * the desk, wherever it is sitting.
     */
    const desk = await makeMember(practice, {
      name: 'Sujata Roy',
      role: ROLES.STAFF,
      department: laboratory._id,
    });

    const res = await as(desk.token).get('/auth/me/capabilities');

    assert.ok(!res.body.effective.includes('LAB_ORDER'), 'the front desk can order a test');
    // And they are not given a bench to sit at either — the laboratory
    // department's dashboard is what the department shows, and what survives
    // filtering is what this person may actually use.
    assert.ok(!res.body.ui.quickActions.includes('WRITE_PRESCRIPTION'));
  });
});
