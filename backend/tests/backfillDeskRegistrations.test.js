import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { User, ROLES } from '../src/models/User.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { Patient } from '../src/models/Patient.js';
import { planDeskRegistrations, applyDeskRegistrations } from '../scripts/backfillDeskRegistrations.js';

/**
 * Patients a desk added before a new number was given an enrolment.
 *
 * They exist, with profiles and readings, and no list shows them. The script
 * enrols each one at the practice whose desk added them — and only those:
 *
 *   - a self sign-up also has no enrolment, and is unaffiliated by decision
 *     until a practice enrols them, so it is left alone;
 *   - the desk route's own audit row is the evidence, matched by time and by
 *     its 201, because a known number answered 200 and made no account;
 *   - a registration that cannot be told apart from another is reported rather
 *     than guessed, since a wrong guess hands a patient to the wrong practice.
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

  test('each is enrolled at the practice whose desk added them, and a self sign-up is left alone', async () => {
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
      plan.toEnrol.map((e) => [e.name, String(e.practiceId)]).sort(),
      [
        ['Anita', String(saltLake._id)],
        ['Bina', String(behala._id)],
      ],
    );
    assert.equal(await Enrollment.countDocuments({ patient: { $in: [anita._id, bina._id] } }), 0, 'working out the plan wrote something');

    const written = await applyDeskRegistrations(plan);
    assert.equal(written, 2);

    const a = await Enrollment.findOne({ patient: anita._id }).lean();
    assert.equal(String(a.practice), String(saltLake._id));
    assert.equal(a.status, ENROLLMENT_STATUS.ACTIVE);
    assert.equal(
      new Date(a.enrolledOn).getTime(),
      t,
      'dated today, the practice would lose everything recorded since it registered her',
    );
    assert.ok(await Patient.exists({ _id: anita._id }), 'no patient row, so the enrolment points at nothing');
    assert.equal(await Enrollment.countDocuments({ patient: chitra._id }), 0, 'a self sign-up was handed to a practice');

    const again = await planDeskRegistrations();
    assert.equal(again.toEnrol.length, 0, 'a second run would enrol them again');
  });

  test('registrations that cannot be told apart are reported, not guessed', async () => {
    const saltLake = await makePractice('Salt Lake');
    const behala = await makePractice('Behala');
    const saltDesk = await makeMember(saltLake, { name: 'Salt Lake Desk', role: ROLES.STAFF });
    const behalaDesk = await makeMember(behala, { name: 'Behala Desk', role: ROLES.STAFF });

    // Two patients made in the same moment, by two desks at two practices.
    const at = new Date(Date.now() - 3600e3);
    await deskAdded(saltDesk, 'One', '+919876500061', at);
    await deskAdded(behalaDesk, 'Two', '+919876500062', at);

    const plan = await planDeskRegistrations();
    assert.equal(plan.toEnrol.length, 0, 'a patient was given to a practice on a guess');
    assert.equal(plan.skipped.length, 2);
    assert.ok(plan.skipped.every((s) => /more than one/i.test(s.reason)), JSON.stringify(plan.skipped));
  });
});
