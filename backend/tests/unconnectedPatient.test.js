import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { signPhoneToken } from '../src/services/otp.js';
import { PatientProfile } from '../src/models/PatientProfile.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * Somebody who has an account and no clinic.
 *
 * ---- Two halves of one mistake -------------------------------------------
 *
 * Registration asked the doctor resolver with no context, which falls through
 * to "the only active doctor" — so on a one-doctor deployment every person who
 * downloaded the app and signed up was attached to that doctor. And the enrolment gate
 * permitted any practice to open a patient who had no enrolment anywhere,
 * because before the migration that meant "not backfilled yet".
 *
 * Together they meant an unconnected patient was, in practice, the founding
 * practice's patient: named against its doctor, readable by its staff, with no
 * consent anywhere in the story.
 *
 * Both are now closed. Signing up asks for an account, not for a doctor, and a
 * patient with no enrolment is nobody's patient until a practice enrols them —
 * which is the moment there is both an answer and consent to support it.
 */

let practice;
let doctor;

/** Tomorrow morning. */
const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
};

describe('a patient nobody has taken on', () => {
  before(boot);
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake', {
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Sen', isOwner: true });
  });

  test('signing up attaches no doctor', async () => {
    const res = await as(null).post('/auth/register', {
      name: 'Rahul Bose',
      phoneToken: signPhoneToken('+919812345699'),
    });
    assert.equal(res.status, 201);

    const profile = await PatientProfile.findOne({ user: res.body.user.id }).lean();
    assert.ok(profile, 'no profile was created');
    assert.equal(
      profile.assignedDoctor ?? null,
      null,
      'a self sign-up was attached to a doctor nobody chose',
    );
  });

  test('is refused to a practice that has not enrolled them', async () => {
    const stranger = await makePatient({ name: 'Nobody’s Patient', practices: [] });

    const res = await as(doctor.token).get(`/patients/${stranger.user._id}/prescriptions`);

    assert.equal(res.status, 403, 'an unenrolled patient was readable');
    assert.match(
      res.body.error.message,
      /not connected to any practice/i,
      'the refusal does not say which of the two states this is',
    );
  });

  test('and the refusal distinguishes them from somebody else’s patient', async () => {
    /*
     * Two refusals, two next actions. "Belongs to a different practice" says
     * another clinic has this person; "not connected to any practice yet" says
     * nobody does, and the answer is to enrol them.
     *
     * They come from different guards — the cross-practice one from
     * `assertSamePractice`, which now asks the enrolment rather than the
     * assigned doctor, and the other from `enrollmentGate` immediately after.
     * What matters is that a clinician can tell them apart.
     */
    const elsewhere = await makePractice('Behala');
    const theirs = await makePatient({ name: 'Their Patient', practices: [elsewhere] });

    const res = await as(doctor.token).get(`/patients/${theirs.user._id}/prescriptions`);

    assert.equal(res.status, 403);
    assert.match(res.body.error.message, /belongs to a different practice/i);
    assert.doesNotMatch(res.body.error.message, /not connected/i);
  });

  test('can still read their own record', async () => {
    // The half that must keep working. Somebody with no clinic still has an
    // app, their own readings, and their own medicines.
    const stranger = await makePatient({ name: 'On Their Own', practices: [] });

    const res = await as(stranger.token).get(`/patients/${stranger.user._id}/prescriptions`);
    assert.equal(res.status, 200);
  });

  test('is told there is nobody to ask rather than booked with whoever answers', async () => {
    const stranger = await makePatient({ name: 'Unbooked', practices: [] });

    const res = await as(stranger.token).post('/appointments/request', {
      preferredFor: tomorrow(),
    });

    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /not with a clinic yet/i);
  });

  test('and once a practice enrols them, everything opens', async () => {
    // The state this is all for: enrolment is what turns a person with an
    // account into a practice's patient, and nothing else does.
    const joined = await makePatient({ name: 'Enrolled', practices: [practice] });

    const res = await as(doctor.token).get(`/patients/${joined.user._id}/prescriptions`);
    assert.equal(res.status, 200);
  });
});
