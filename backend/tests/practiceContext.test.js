import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../src/models/Membership.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { PRACTICE_HEADER } from '../src/middleware/practiceScope.js';
import { ROLES } from '../src/models/User.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Which practice a request is about, when the person works at two.
 *
 * ---- What this replaces --------------------------------------------------
 *
 * `Membership.findOne(...)` — whichever row the database returned first. With
 * one practice per person that is correct on every request, and it stays
 * correct right up to the first doctor who consults at a polyclinic on
 * Tuesdays and runs their own clinic in the evening. Then it picks one, with
 * no error and no log line: their patients, their diary and their colleagues
 * are whichever practice the index happened to order first that morning.
 *
 * There is no safe default between two practices. The caller says which, and
 * is refused until they do.
 */

let a;
let b;
let patientOfA;

/** One person, a member of both practices. */
async function memberOfBoth(name) {
  const doctor = await makeMember(a.practice, { name, isOwner: true });
  await Membership.create({
    user: doctor.user._id,
    practice: b.practice._id,
    role: ROLES.DOCTOR,
    permissions: presetFor({ role: ROLES.DOCTOR }),
    status: MEMBERSHIP_STATUS.ACTIVE,
  });
  return doctor;
}

describe('a person who works at two practices', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    const mk = async (name) => {
      const practice = await makePractice(name, {
        practiceType: PRACTICE_TYPE.CLINIC,
        plan: PLAN.PROFESSIONAL,
      });
      return { practice };
    };
    a = await mk('Salt Lake');
    b = await mk('Behala');

    const own = await makeMember(a.practice, { name: 'Dr Salt Lake', isOwner: true });
    patientOfA = await makePatient({ name: 'Rahul Bose', practices: [a.practice] });
    await PatientProfile.create({
      user: patientOfA.user._id,
      assignedDoctor: own.user._id,
    });
  });

  test('is asked which one, rather than given one', async () => {
    const both = await memberOfBoth('Dr Both');

    const res = await as(both.token).get('/doctor/patients');

    assert.equal(res.status, 409, 'a practice was chosen for them');
    assert.equal(res.body.error.code, 'PRACTICE_REQUIRED');
  });

  test('and naming one answers for that practice', async () => {
    const both = await memberOfBoth('Dr Both');

    const res = await as(both.token).get('/doctor/patients', {
      [PRACTICE_HEADER]: String(a.practice._id),
    });

    assert.equal(res.status, 200);
    const names = (res.body.items ?? []).map((p) => p.name);
    assert.ok(names.includes('Rahul Bose'), 'Salt Lake’s own patient is missing');
  });

  test('naming the other answers for the other, which has nobody', async () => {
    const both = await memberOfBoth('Dr Both');

    const res = await as(both.token).get('/doctor/patients', {
      [PRACTICE_HEADER]: String(b.practice._id),
    });

    assert.equal(res.status, 200);
    assert.equal((res.body.items ?? []).length, 0, 'Behala was shown Salt Lake’s register');
  });

  test('naming a practice they do not work at is refused', async () => {
    // Otherwise the header is not a choice between their own practices, it is
    // a way to ask about anybody's.
    const both = await memberOfBoth('Dr Both');
    const stranger = await makePractice('Howrah');

    const res = await as(both.token).get('/doctor/patients', {
      [PRACTICE_HEADER]: String(stranger._id),
    });

    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'PRACTICE_REQUIRED');
  });

  test('somebody who works at one is never asked', async () => {
    // The ordinary case, and it must stay silent: a clinic with one practice
    // should never see a question about which practice this is.
    const only = await makeMember(a.practice, { name: 'Dr Only', role: ROLES.DOCTOR });

    const res = await as(only.token).get('/doctor/patients');
    assert.equal(res.status, 200);
  });

  test('and a membership that ended does not count as a second practice', async () => {
    const both = await memberOfBoth('Dr Left');
    await Membership.updateOne(
      { user: both.user._id, practice: b.practice._id },
      { $set: { endedOn: new Date() } },
    );

    const res = await as(both.token).get('/doctor/patients');
    assert.equal(res.status, 200, 'a finished membership still forced a choice');
  });
});
