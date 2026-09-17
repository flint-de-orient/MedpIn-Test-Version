import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Membership, PERMISSIONS as P } from '../src/models/Membership.js';
import { ChatSession } from '../src/models/ChatSession.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';
import {
  planFor,
  planChatPermissions,
  applyChatPermissions,
  CHAT_GRANTS,
} from '../scripts/backfillChatPermissions.js';

/**
 * Members written before the chat grants existed were refused every patient
 * conversation: "Could not load the conversation" and "Could not send".
 */

// What each role was given before 16 September.
const OLD = {
  doctor: [P.VIEW_PATIENT, P.EDIT_RECORD, P.PRESCRIBE],
  staff: [P.VIEW_PATIENT, P.EDIT_RECORD],
  owner: [P.VIEW_PATIENT, P.EDIT_RECORD, P.PRESCRIBE, P.MANAGE_STAFF, P.MANAGE_DEPARTMENT, P.VIEW_AUDIT, P.SHARE_RECORDS],
};

describe('which members the backfill changes', () => {
  test('a doctor, a desk and an owner exactly as the platform wrote them get both chat grants', () => {
    assert.equal(planFor({ role: ROLES.DOCTOR, permissions: OLD.doctor }).action, 'add');
    assert.equal(planFor({ role: ROLES.STAFF, permissions: OLD.staff }).action, 'add');
    assert.equal(planFor({ role: ROLES.DOCTOR, isOwner: true, permissions: OLD.owner }).action, 'add');
    assert.deepEqual(planFor({ role: ROLES.DOCTOR, permissions: OLD.doctor }).permissions, [...OLD.doctor, ...CHAT_GRANTS]);
  });

  test('grants set by hand are listed for an operator, never changed', () => {
    const plan = planFor({ role: ROLES.DOCTOR, permissions: [P.VIEW_PATIENT] });
    assert.equal(plan.action, 'review');
  });

  test('the laboratory and a practice manager do not read conversations, and get nothing', () => {
    assert.equal(planFor({ role: ROLES.LAB_TECHNICIAN, permissions: [P.VIEW_PATIENT, P.EDIT_RECORD] }).action, 'skip');
    assert.equal(planFor({ role: ROLES.PRACTICE_MANAGER, permissions: [P.MANAGE_STAFF, P.MANAGE_DEPARTMENT, P.VIEW_AUDIT] }).action, 'skip');
  });

  test('an empty list, and one that already has a chat grant, are left alone', () => {
    assert.equal(planFor({ role: ROLES.DOCTOR, permissions: [] }).action, 'skip');
    assert.equal(planFor({ role: ROLES.DOCTOR, permissions: [...OLD.doctor, P.CHAT_READ] }).action, 'skip');
  });
});

describe('a doctor written before the chat grants', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  async function setUp() {
    const practice = await makePractice('Salt Lake', { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL });
    const doctor = await makeMember(practice, { name: 'Dr Before', permissions: OLD.doctor });
    const patient = await makePatient({ name: 'Arshad', practices: [practice] });
    await ChatSession.create({
      patient: patient.user._id,
      kind: 'care',
      language: 'en',
      enrollment: patient.enrollments[0]._id,
    });
    return { practice, doctor, patient };
  }

  test('is refused the conversation, and after the backfill reads and replies to it', async () => {
    const { doctor, patient } = await setUp();
    const thread = () => as(doctor.token).get(`/chat/patients/${patient.user._id}/thread`);

    assert.equal((await thread()).status, 403, 'the outage did not reproduce');

    const plans = await planChatPermissions();
    assert.equal(plans.filter((p) => p.action === 'add').length, 1);
    assert.equal(await applyChatPermissions(plans), 1);

    const res = await thread();
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const reply = await as(doctor.token).post(`/chat/patients/${patient.user._id}/clinician-message`, {
      content: 'Please take your evening dose after food.',
    });
    assert.ok([200, 201].includes(reply.status), `reply refused: ${reply.status} ${JSON.stringify(reply.body)}`);
  });

  test('a second run writes nothing, and a list changed in the console after the report is kept', async () => {
    const { doctor } = await setUp();
    const plans = await planChatPermissions();

    // An operator narrows this doctor between the report and the apply.
    await Membership.updateOne({ _id: doctor.membership._id }, { $set: { permissions: [P.VIEW_PATIENT] } });
    assert.equal(await applyChatPermissions(plans), 0, 'the operator’s change was overwritten');
    assert.deepEqual((await Membership.findById(doctor.membership._id).lean()).permissions, [P.VIEW_PATIENT]);

    // And with nothing changed, a second run finds nothing to add.
    await Membership.updateOne({ _id: doctor.membership._id }, { $set: { permissions: OLD.doctor } });
    assert.equal(await applyChatPermissions(await planChatPermissions()), 1);
    assert.equal(await applyChatPermissions(await planChatPermissions()), 0);
  });
});
