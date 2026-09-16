import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import mongoose from 'mongoose';
import { practiceMaySee } from '../src/services/enrollments.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';

/**
 * Two practices, one shared patient, and the guarantee that neither can read
 * the other's records.
 *
 * The specification calls this "the test that is the product", to be written
 * before the second practice exists. Nothing ships to a real second customer
 * until it is green.
 *
 * ---- Why this runs without a database -----------------------------------
 *
 * `practiceMaySee` is the one function every clinical read passes through, and
 * what it does is decide. That decision is what this pins. Stubbing the two
 * queries it makes keeps the test fast enough to run on every commit, which is
 * the difference between a guarantee and a document — a suite that needs Mongo
 * up gets skipped, and the skipped test is the one that was protecting this.
 *
 * The queries themselves are covered by `enrollment.test.js`; what is here is
 * the rule they feed.
 */

const DEY = new mongoose.Types.ObjectId();
const SEN = new mongoose.Types.ObjectId();
const RAHUL = new mongoose.Types.ObjectId();

/** Rahul as he actually is: enrolled at both, on different dates. */
const MARCH = new Date('2026-03-01');
const SEPTEMBER = new Date('2026-09-01');

function enrolment({ practice, enrolledOn, status = ENROLLMENT_STATUS.ACTIVE, revokedAt = null }) {
  return new Enrollment({ patient: RAHUL, practice, enrolledOn, status, revokedAt });
}

/**
 * Stand in for the two lookups `practiceMaySee` performs.
 *
 * `rows` is the world: every enrolment that exists for this patient.
 */
function withWorld(rows, fn) {
  const findOne = Enrollment.findOne;
  const exists = Enrollment.exists;

  Enrollment.findOne = (q) =>
    Promise.resolve(rows.find((r) => String(r.practice) === String(q.practice)) ?? null);
  Enrollment.exists = (q) =>
    Promise.resolve(rows.some((r) => String(r.patient) === String(q.patient)) ? {} : null);

  return fn().finally(() => {
    Enrollment.findOne = findOne;
    Enrollment.exists = exists;
  });
}

describe('two practices, one patient', () => {
  // Rahul saw Dr. Dey in March and Dr. Sen in September.
  const world = [
    enrolment({ practice: DEY, enrolledOn: MARCH }),
    enrolment({ practice: SEN, enrolledOn: SEPTEMBER }),
  ];

  test('each practice may see the patient', () =>
    withWorld(world, async () => {
      for (const [name, practice] of [['Dey', DEY], ['Sen', SEN]]) {
        const v = await practiceMaySee(practice, RAHUL);
        assert.equal(v.allowed, true, `${name} cannot see their own patient`);
      }
    }));

  test('a third practice may see nothing', () =>
    withWorld(world, async () => {
      // The core of it. A clinic that has never enrolled Rahul is refused, and
      // refused with a reason that says why rather than a generic denial.
      const v = await practiceMaySee(new mongoose.Types.ObjectId(), RAHUL);
      assert.equal(v.allowed, false);
      assert.equal(v.reason, 'not_enrolled');
    }));

  test('Sen cannot read what Dey wrote before September', () =>
    withWorld(world, async () => {
      // Access is not retroactive. Rahul walking into a second clinic does not
      // hand them six months of the first one's notes — he shares those
      // deliberately, through a share grant, or not at all.
      const v = await practiceMaySee(SEN, RAHUL, { recordDate: new Date('2026-05-01') });
      assert.equal(v.allowed, false);
      assert.equal(v.reason, 'before_enrolment');
    }));

  test('but Dey can, because it is theirs', () =>
    withWorld(world, async () => {
      const v = await practiceMaySee(DEY, RAHUL, { recordDate: new Date('2026-05-01') });
      assert.equal(v.allowed, true);
    }));

  test('Sen can read what was written after they were given access', () =>
    withWorld(world, async () => {
      const v = await practiceMaySee(SEN, RAHUL, { recordDate: new Date('2026-09-15') });
      assert.equal(v.allowed, true);
    }));
});

describe('consent is the gate, and it swings both ways', () => {
  test('a pending enrolment reads nothing', () =>
    withWorld(
      [enrolment({ practice: SEN, enrolledOn: SEPTEMBER, status: ENROLLMENT_STATUS.PENDING })],
      async () => {
        // The desk typed the number; the patient has not answered the code. A
        // typo at the counter must not attach a practice to a stranger.
        const v = await practiceMaySee(SEN, RAHUL);
        assert.equal(v.allowed, false);
        assert.equal(v.reason, 'consent_pending');
      },
    ));

  test('a revoked enrolment stops reading immediately', () =>
    withWorld(
      [
        enrolment({
          practice: SEN,
          enrolledOn: SEPTEMBER,
          status: ENROLLMENT_STATUS.REVOKED,
          revokedAt: new Date(),
        }),
      ],
      async () => {
        const v = await practiceMaySee(SEN, RAHUL);
        assert.equal(v.allowed, false);
        assert.equal(v.reason, 'revoked');
      },
    ));

  test('revoking one practice does not touch the other', () =>
    withWorld(
      [
        enrolment({ practice: DEY, enrolledOn: MARCH }),
        enrolment({
          practice: SEN,
          enrolledOn: SEPTEMBER,
          status: ENROLLMENT_STATUS.REVOKED,
          revokedAt: new Date(),
        }),
      ],
      async () => {
        // Rahul withdrawing from Dr. Sen must not cost him his own doctor.
        assert.equal((await practiceMaySee(DEY, RAHUL)).allowed, true);
        assert.equal((await practiceMaySee(SEN, RAHUL)).allowed, false);
      },
    ));
});

describe('a patient nobody has taken on', () => {
  test('is nobody’s patient, and is refused to everybody', () =>
    withWorld([], async () => {
      /*
       * This permitted until the migration was done.
       *
       * The reasoning was sound while it lasted: every patient on the live
       * deployment had no enrolment until the backfill ran, and a guard that
       * denied on absence would have locked the working clinic out of its own
       * records the hour it deployed. So absence meant "not migrated yet".
       *
       * It cannot mean that any more. The backfill has run, desk registration
       * creates an enrolment, and `checkRecordWindow.js` gates the deploy on
       * no active patient being without one. What is left with no enrolment is
       * somebody who signed up and has not been taken on — and the permissive
       * answer handed them to whichever practice asked for them first.
       */
      const v = await practiceMaySee(DEY, RAHUL);
      assert.equal(v.allowed, false);
      assert.equal(v.reason, 'not_connected');
    }));

  test('and the refusal says which of the two it is', () =>
    withWorld([enrolment({ practice: SEN, enrolledOn: MARCH })], async () => {
      // "Somebody else has this patient" and "nobody has them yet" read very
      // differently to a clinician: one is a wall, the other is an invitation
      // to enrol them.
      const v = await practiceMaySee(DEY, RAHUL);
      assert.equal(v.allowed, false);
      assert.equal(v.reason, 'not_enrolled');
    }));

  test('but the moment they are enrolled anywhere, absence denies', () =>
    withWorld([enrolment({ practice: DEY, enrolledOn: MARCH })], async () => {
      // The switch, per patient. Once Rahul has one enrolment, the absence of
      // one for another practice is evidence rather than ignorance.
      const v = await practiceMaySee(SEN, RAHUL);
      assert.equal(v.allowed, false);
      assert.equal(v.reason, 'not_enrolled');
    }));

  test('an unknown practice or patient permits rather than throwing', () =>
    withWorld([], async () => {
      // Internal callers with nothing to check should get out of the way, not
      // crash a clinical read.
      assert.equal((await practiceMaySee(null, RAHUL)).allowed, true);
      assert.equal((await practiceMaySee(DEY, null)).allowed, true);
    }));
});
