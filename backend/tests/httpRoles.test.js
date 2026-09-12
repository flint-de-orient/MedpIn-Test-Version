import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Department } from '../src/models/Department.js';
import { LabReport } from '../src/models/LabReport.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import { ROLES } from '../src/models/User.js';

/**
 * The new roles, over the wire, doing and not doing their jobs.
 *
 * ---- Why unit tests were not enough ------------------------------------
 *
 * `roles.test.js` proves the presets, the exclusions and the dashboards. It
 * says nothing about whether any of those people can reach a route — and that
 * was the actual state of things: the roles existed, held the right
 * permissions, had a dashboard composed for them, and `requireClinician` was
 * `requireRole(DOCTOR, STAFF)`, so all forty routes behind it answered "this
 * action requires a different role".
 *
 * A role that cannot open the application is not a role.
 */

let origin;
let practice;
let laboratory;

async function setUp() {
  practice = await makePractice('Salt Lake Polyclinic', {
    practiceType: PRACTICE_TYPE.POLYCLINIC,
    plan: PLAN.PROFESSIONAL,
  });
  laboratory = await Department.create({
    practice: practice._id,
    key: 'laboratory',
    names: { en: 'Laboratory' },
  });
}

describe('the bench can do its own work now', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('a lab technician opens onto the bench, not a caseload', async () => {
    const tech = await makeMember(practice, {
      name: 'Sujata Roy',
      role: ROLES.LAB_TECHNICIAN,
      department: laboratory._id,
    });

    const res = await as(tech.token).get('/auth/me/capabilities');

    assert.equal(res.status, 200);
    assert.equal(res.body.ui.department, 'laboratory');
    assert.ok(res.body.ui.widgets.includes('CRITICAL_LAB_RESULTS'));
    assert.ok(!res.body.ui.widgets.includes('TRIAGE_QUEUE'));
  });

  test('and gets the bench even when posted to a clinical department', async () => {
    /*
     * The rule that makes roles worth having beside departments: a department
     * says where somebody works and a role says what they do. A technician in
     * cardiology is at a bench.
     */
    const cardiology = await Department.create({
      practice: practice._id,
      key: 'cardiology',
      names: { en: 'Cardiology' },
    });
    const tech = await makeMember(practice, {
      name: 'Sujata Roy',
      role: ROLES.LAB_TECHNICIAN,
      department: cardiology._id,
    });

    const res = await as(tech.token).get('/auth/me/capabilities');
    assert.ok(res.body.ui.widgets.includes('CRITICAL_LAB_RESULTS'));
    assert.equal(res.body.ui.source, 'role');
  });

  test('they can read the lab overview their screen is made of', async () => {
    /*
     * The whole point, and the thing that was broken. Filed as `staff` they
     * lost LAB_ORDER; refused by requireClinician they could not reach the
     * route at all. Either failure alone made the dashboard decoration.
     */
    const tech = await makeMember(practice, {
      name: 'Sujata Roy',
      role: ROLES.LAB_TECHNICIAN,
      department: laboratory._id,
    });
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    await LabReport.create({
      patient: anita.user._id,
      title: 'Renal panel',
      testedOn: new Date(),
      values: [{ code: 'CREAT', label: 'Creatinine', value: 6.2, flag: 'critical' }],
    });

    const res = await as(tech.token).get('/doctor/labs/overview');

    assert.equal(res.status, 200, 'the bench cannot reach its own screen');
    assert.equal(res.body.critical.length, 1);
  });

  test('and cannot prescribe', async () => {
    // Reporting a result is not treating anybody, and this is the line that
    // makes the role safe to hand out.
    const tech = await makeMember(practice, {
      name: 'Sujata Roy',
      role: ROLES.LAB_TECHNICIAN,
      department: laboratory._id,
    });

    const res = await as(tech.token).get('/auth/me/capabilities');
    assert.ok(!res.body.effective.includes('PRESCRIPTION'));
    assert.ok(!res.body.ui.quickActions.includes('WRITE_PRESCRIPTION'));
  });

  test('the manager rosters, the technician does not', async () => {
    const manager = await makeMember(practice, {
      name: 'Dr Iyer',
      role: ROLES.LAB_MANAGER,
      department: laboratory._id,
    });
    const tech = await makeMember(practice, {
      name: 'Sujata Roy',
      role: ROLES.LAB_TECHNICIAN,
      department: laboratory._id,
    });

    assert.ok(
      (await as(manager.token).get('/auth/me/capabilities')).body.ui.quickActions.includes(
        'MANAGE_TEAM',
      ),
    );
    assert.ok(
      !(await as(tech.token).get('/auth/me/capabilities')).body.ui.quickActions.includes(
        'MANAGE_TEAM',
      ),
    );
  });
});

describe('a practice manager administers and sees no patient', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('their screen has no clinical panel on it', async () => {
    const manager = await makeMember(practice, {
      name: 'Priya Nair',
      role: ROLES.PRACTICE_MANAGER,
    });

    const res = await as(manager.token).get('/auth/me/capabilities');

    assert.equal(res.status, 200);
    assert.ok(res.body.ui.quickActions.includes('MANAGE_TEAM'));
    for (const id of ['TRIAGE_QUEUE', 'TODAYS_CLINIC', 'OPEN_ALERTS', 'CRITICAL_LAB_RESULTS']) {
      assert.ok(!res.body.ui.widgets.includes(id), `a practice manager sees ${id}`);
    }
  });

  test('and the server refuses the record, not just the tab', async () => {
    /*
     * Hiding a panel is a courtesy. This is the control.
     *
     * `resolvePatientScope` keeps an allow-list of who may open a record by
     * id, and a practice manager is deliberately not on it — they roster
     * people and handle billing. Before the roles existed the only way to
     * employ one was to file them as `staff`, which hands them every patient
     * in the building.
     */
    const manager = await makeMember(practice, {
      name: 'Priya Nair',
      role: ROLES.PRACTICE_MANAGER,
    });
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });

    const res = await as(manager.token).get(
      `/patients/${anita.user._id}/medications`,
    );
    assert.equal(res.status, 403, 'a practice manager opened a clinical record');
  });
});

describe("an assistant works the record and does not sign", () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('they can open a patient record', async () => {
    // The half that has to work. An assistant who cannot reach the record is
    // not assisting anybody.
    const assistant = await makeMember(practice, {
      name: 'Rahul Das',
      role: ROLES.DOCTOR_ASSISTANT,
    });
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });

    const res = await as(assistant.token).get(`/patients/${anita.user._id}/medications`);
    assert.equal(res.status, 200);
  });

  test('and are offered no prescription pad', async () => {
    const assistant = await makeMember(practice, {
      name: 'Rahul Das',
      role: ROLES.DOCTOR_ASSISTANT,
    });

    const res = await as(assistant.token).get('/auth/me/capabilities');
    assert.ok(!res.body.effective.includes('PRESCRIPTION'));
    assert.ok(!res.body.ui.quickActions.includes('WRITE_PRESCRIPTION'));
    // But the rest of the clinical day is theirs.
    assert.ok(res.body.ui.widgets.includes('TRIAGE_QUEUE'));
  });
});

describe('a practice can actually hire these people', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    await setUp();
  });

  test('the team route offers every role the platform defines', async () => {
    /*
     * The gap that made the rest of this decorative for one commit: the roles
     * existed, held the right permissions, had their own dashboards — and
     * `HIREABLE` was its own list of three, so nobody could be given one.
     *
     * Asked of the running server rather than the source, because a schema
     * that accepts a value the handler rejects is the same failure wearing a
     * different hat.
     */
    const head = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
    const res = await as(head.token).post('/team', {
      name: 'Sujata Roy',
      role: ROLES.LAB_TECHNICIAN,
      phoneToken: 'not-a-real-token-but-long-enough-to-pass',
    });

    // The phone token is rejected, not the role — which is what this asserts.
    // A refused role answers 400 with a Zod error naming `role`.
    assert.equal(res.status, 400);
    assert.ok(
      !JSON.stringify(res.body).includes('"role"'),
      `the role was refused, not the token: ${JSON.stringify(res.body)}`,
    );
  });
});
