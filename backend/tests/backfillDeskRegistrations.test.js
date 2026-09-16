import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { OtpChallenge, hashOtp } from '../src/models/OtpChallenge.js';
import * as script from '../scripts/backfillDeskRegistrations.js';

const { planDeskRegistrations } = script;

/**
 * Patients a desk added before a new number was given an enrolment.
 *
 * They exist, with profiles and readings, and no list shows them. The script
 * used to enrol each one in bulk at the practice whose desk added them. It now
 * only says who they are — each is enrolled one at a time, by the desk
 * registering them again and the patient reading back their code:
 *
 *   - a self sign-up also has no enrolment, and is unaffiliated by decision
 *     until a practice enrols them, so it is left off the list;
 *   - the desk route's own audit row is the evidence, matched by time and by
 *     its 201, because a known number answered 200 and made no account;
 *   - a registration that cannot be told apart from another is reported as
 *     unresolved rather than guessed.
 */

describe('patients a desk added without an enrolment', () => {
  before(boot);
  after(shutdown);
  beforeEach(wipe);

  async function deskAdded(member, name, phone, at, { status = 201 } = {}) {
    const user = await User.create({ name, phone, role: ROLES.PATIENT, isActive: true });
    // Through the driver: Mongoose treats `createdAt` as immutable and silently
    // drops a change to it, which would leave every account made "now".
    await User.collection.updateOne({ _id: user._id }, { $set: { createdAt: at } });
    await PatientProfile.create({ user: user._id });
    await AuditLog.create({
      actor: member.user._id,
      actorRole: member.user.role,
      action: 'create',
      resource: 'User',
      meta: { method: 'POST', path: '/patients', status },
      at: new Date(at.getTime() + 150),
    });
    return user;
  }

  test('each is listed against the practice whose desk added them, a self sign-up is left alone, and nothing is written', async () => {
    const saltLake = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const saltDesk = await makeMember(saltLake, { name: 'Salt Lake Desk', role: ROLES.STAFF });
    const behalaDesk = await makeMember(behala, { name: 'Behala Desk', role: ROLES.STAFF });
    const doctor = await makeMember(saltLake, { name: 'Dr Salt Lake', isOwner: true });

    const t = Date.now() - 86400e3;
    const anita = await deskAdded(saltDesk, 'Anita', '+919876500051', new Date(t));
    const bina = await deskAdded(behalaDesk, 'Bina', '+919876500052', new Date(t + 60_000));

    // Signed herself up and was assigned a doctor; no desk registered her. A
    // desk's registration of a known number moments later answered 200 and
    // must not be taken for hers.
    const chitra = await User.create({ name: 'Chitra', phone: '+919876500053', role: ROLES.PATIENT, isActive: true });
    await PatientProfile.create({ user: chitra._id, assignedDoctor: doctor.user._id });
    await AuditLog.create({
      actor: saltDesk.user._id,
      actorRole: ROLES.STAFF,
      action: 'create',
      resource: 'User',
      meta: { method: 'POST', path: '/patients', status: 200 },
      at: new Date(chitra.createdAt.getTime() + 100),
    });

    // Already enrolled, and left as it is.
    await makePatient({ name: 'Dipa', practices: [saltLake] });

    const plan = await planDeskRegistrations();
    assert.deepEqual(
      plan.toEnrol.map((e) => [e.name, String(e.practiceId), e.phone]).sort(),
      [
        ['Anita', String(saltLake._id), '+919876500051'],
        ['Bina', String(behala._id), '+919876500052'],
      ],
    );
    assert.equal(plan.unmatched, 1, 'the self sign-up was not left alone');
    assert.equal(
      await Enrollment.countDocuments({ patient: { $in: [anita._id, bina._id, chitra._id] } }),
      0,
      'working out the list enrolled somebody',
    );
  });

  test('there is no bulk enrolment left in the script to run', () => {
    // The spec: no bulk backfill of real patients; one-by-one, approved.
    assert.equal(script.applyDeskRegistrations, undefined, 'the bulk writer is still exported');
    const src = readFileSync(new URL('../scripts/backfillDeskRegistrations.js', import.meta.url), 'utf8');
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(!/Enrollment\.(create|updateOne|updateMany|insertMany|bulkWrite)\(/.test(code), 'the script can still write an enrolment');
    assert.ok(!/ConsentEvent/.test(code), 'the script can still record a consent nobody gave');
  });

  test('and the one-at-a-time route works for a patient on the list', async () => {
    const saltLake = await makePractice('Salt Lake');
    const saltDesk = await makeMember(saltLake, { name: 'Salt Lake Desk', role: ROLES.STAFF });
    const anita = await deskAdded(saltDesk, 'Anita', '+919876500061', new Date(Date.now() - 86400e3));
    const [listed] = (await planDeskRegistrations()).toEnrol;
    assert.equal(String(listed.patientId), String(anita._id));

    const res = await as(saltDesk.token).post('/doctor/patients', { name: 'Anita', phone: listed.phone });
    assert.equal(res.body.consentRequired, true, 'an existing account was enrolled without the patient’s code');

    await OtpChallenge.updateOne(
      { phone: listed.phone, purpose: 'enrol' },
      { $set: { codeHash: hashOtp('135790', listed.phone, 'enrol') } },
    );
    const ok = await as(saltDesk.token).post(`/enrolments/${res.body.enrollmentId}/confirm`, { code: '135790' });
    assert.equal(ok.status, 200);
    assert.equal((await Enrollment.findOne({ patient: anita._id }).lean()).status, ENROLLMENT_STATUS.ACTIVE);
    assert.equal((await planDeskRegistrations()).toEnrol.length, 0, 'an enrolled patient is still listed');
  });

  test('registrations that cannot be told apart are reported, not guessed', async () => {
    const saltLake = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const saltDesk = await makeMember(saltLake, { name: 'Salt Lake Desk', role: ROLES.STAFF });
    const behalaDesk = await makeMember(behala, { name: 'Behala Desk', role: ROLES.STAFF });

    // Two patients made in the same moment, by two desks at two practices.
    const at = new Date(Date.now() - 3600e3);
    await deskAdded(saltDesk, 'One', '+919876500071', at);
    await deskAdded(behalaDesk, 'Two', '+919876500072', at);

    const plan = await planDeskRegistrations();
    assert.equal(plan.toEnrol.length, 0, 'a patient was listed against a practice on a guess');
    assert.equal(plan.skipped.length, 2);
    assert.ok(plan.skipped.every((s) => /more than one/i.test(s.reason)), JSON.stringify(plan.skipped));
  });
});
