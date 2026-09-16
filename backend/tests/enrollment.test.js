import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import mongoose from 'mongoose';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';

/**
 * A patient at a practice, and the two rules that make multi-tenancy real.
 *
 * Everything clinical hangs off an enrollment, which names a patient and a
 * practice — so no clinical row can exist without saying whose it is. And
 * access is not retroactive: a practice reads from `enrolledOn` forward, so
 * joining a second clinic does not hand them the first one's history.
 */
const service = readFileSync(new URL('../src/services/enrollments.js', import.meta.url), 'utf8');
const backfill = readFileSync(
  new URL('../scripts/backfillEnrollments.js', import.meta.url),
  'utf8',
);

const row = (over = {}) =>
  new Enrollment({
    patient: new mongoose.Types.ObjectId(),
    practice: new mongoose.Types.ObjectId(),
    ...over,
  });

describe('an enrollment grants access, or does not', () => {
  test('pending is not access', () => {
    // The patient has been added at a desk and has not answered the code on
    // their own handset. Treating pending as active is exactly the failure the
    // OTP step exists to prevent — a typo at the counter attaching a practice
    // to a stranger's record.
    assert.equal(row({ status: ENROLLMENT_STATUS.PENDING }).isCurrent(), false);
  });

  test('pending is the default, so a half-written row grants nothing', () => {
    assert.equal(row().status, ENROLLMENT_STATUS.PENDING);
    assert.equal(row().isCurrent(), false);
  });

  test('revoked is not access, and a revoked date overrides an active status', () => {
    assert.equal(row({ status: ENROLLMENT_STATUS.REVOKED }).isCurrent(), false);
    assert.equal(
      row({ status: ENROLLMENT_STATUS.ACTIVE, revokedAt: new Date() }).isCurrent(),
      false,
    );
  });

  test('active and unrevoked is access', () => {
    assert.equal(row({ status: ENROLLMENT_STATUS.ACTIVE }).isCurrent(), true);
  });
});

describe('access is not retroactive', () => {
  const june = new Date('2026-06-01');
  const active = row({ status: ENROLLMENT_STATUS.ACTIVE, enrolledOn: june });

  test('a record from before the enrollment is out of reach', () => {
    // Rahul walking into a second clinic today does not hand them four years of
    // the first clinic's notes.
    assert.equal(active.covers(new Date('2026-05-31')), false);
  });

  test('a record from the day itself, or after, is covered', () => {
    assert.equal(active.covers(june), true);
    assert.equal(active.covers(new Date('2026-09-01')), true);
  });

  test('no date given checks only the enrollment', () => {
    // Right for "may they open this patient at all", and the reason routes
    // fetching a dated row should pass one.
    assert.equal(active.covers(null), true);
  });

  test('a revoked enrollment covers nothing, whatever the date', () => {
    const dead = row({ status: ENROLLMENT_STATUS.REVOKED, enrolledOn: june });
    assert.equal(dead.covers(new Date('2026-09-01')), false);
  });
});

describe('the model', () => {
  test('one enrollment per patient per practice', () => {
    // Somebody returning after revoking reactivates this row, so the original
    // enrolledOn and the consent history stay attached to it.
    const idx = Enrollment.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find((i) => i.f.patient === 1 && i.f.practice === 1);
    assert.ok(unique, 'no patient+practice index');
    assert.equal(unique.o.unique, true);
  });

  test('the two hot queries are indexed', () => {
    // The patient's chat list, and the practice's roll.
    const idx = Enrollment.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.patient === 1 && f.status === 1), 'no patient+status');
    assert.ok(idx.some((f) => f.practice === 1 && f.status === 1), 'no practice+status');
  });

  test('it names the body, not the login', () => {
    // A mother and her child at one practice are two enrollments under one
    // phone number.
    assert.equal(Enrollment.schema.path('patient').options.ref, 'Patient');
  });
});

describe('absence denies', () => {
  test('a patient with no enrollments at all is refused, not permitted', () => {
    /*
     * This asserted the opposite until the migration finished.
     *
     * The rule was: before a patient has been enrolled anywhere, absence means
     * "the backfill has not reached them" rather than "nobody has taken them
     * on", and a guard that denied would have locked the working clinic out of
     * its own records the hour it shipped.
     *
     * The backfill has run, desk registration creates an enrolment, and
     * `checkRecordWindow.js` gates the deploy on no active patient being
     * without one. What is left with no enrolment is somebody who signed up
     * and has not been taken on — and permitting handed them to whichever
     * practice asked first.
     */
    assert.match(service, /reason: 'not_connected'/);
    assert.match(service, /elsewhere\s*\n?\s*\? \{ allowed: false, reason: 'not_enrolled' \}/);
    assert.doesNotMatch(service, /\{ allowed: true, reason: 'unknown' \}\s*;?\s*\n\s*\}/);
  });

  test('and still says which of the two it is', () => {
    // "Somebody else has this patient" and "nobody has them yet" lead a
    // clinician to different next actions: one is a wall, the other is an
    // invitation to enrol them.
    assert.match(service, /export async function hasAnyEnrollment/);
    assert.match(service, /Enrollment\.exists\(\{ patient: patientId \}\)/);
  });

  test('each refusal says which of the five things went wrong', () => {
    const auth = readFileSync(new URL('../src/middleware/authorise.js', import.meta.url), 'utf8');
    for (const reason of [
      'not_enrolled',
      'not_connected',
      'consent_pending',
      'revoked',
      'before_enrolment',
    ]) {
      assert.match(auth, new RegExp(reason), `no message for ${reason}`);
    }
  });
});

describe('the migration keeps this clinic its own history', () => {
  test('existing patients are enrolled ACTIVE without a consent code', () => {
    // They have been patients for months. Asking them to re-consent to a clinic
    // they already attend would be the migration inventing a doubt nobody had.
    assert.match(backfill, /status: ENROLLMENT_STATUS\.ACTIVE/);
    assert.match(backfill, /No consent code is sent/);
  });

  test('enrolledOn is backdated, or the clinic loses its own past', () => {
    // Dated today, Dr. Dey could not read a prescription he wrote last week —
    // "access is not retroactive" applied naively erases the practice that
    // already exists.
    assert.match(backfill, /firstSeen\.get\(String\(p\._id\)\) \?\? p\.createdAt/);
  });

  test('it works whether or not backfillPatients has run', () => {
    // The ids are the same values either way, which is the point of how the
    // patient rows were written.
    assert.match(backfill, /backfillPatients has not run/);
  });

  test('it refuses to run before the practice exists', () => {
    assert.match(backfill, /Run backfillPractices\.js first/);
  });

  test('the migration does not sign the enrollment', () => {
    // Nobody enrolled these people; they were already patients when practices
    // came into being.
    assert.match(backfill, /enrolledBy: null/);
  });
});
