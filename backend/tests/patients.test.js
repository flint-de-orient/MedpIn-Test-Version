import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import mongoose from 'mongoose';
import { Patient, RELATIONSHIP } from '../src/models/Patient.js';

/**
 * A body, separate from the phone number that reaches it.
 *
 * The whole of this step rests on one property: a backfilled patient's `_id` is
 * their `User._id`. Twenty-one collections point at a patient by that id, and
 * reusing it is what turns the largest migration in the project into a
 * one-word ref change per collection, done on whatever day suits.
 *
 * If that property is ever broken, prescriptions point at nothing. So it is
 * asserted here, and the backfill checks it again against the live data.
 */
const backfill = readFileSync(
  new URL('../scripts/backfillPatients.js', import.meta.url),
  'utf8',
);
const service = readFileSync(
  new URL('../src/services/patientsForLogin.js', import.meta.url),
  'utf8',
);

describe('the id is the migration', () => {
  test('the backfill writes the login id as the patient id', () => {
    // `updateOne({ _id: u._id }, ...)` with upsert — the id is chosen, not
    // generated. A `Patient.create({...})` here would mint a fresh ObjectId and
    // silently orphan every clinical row for that person.
    assert.match(backfill, /Patient\.updateOne\(\s*\{ _id: u\._id \}/);
    assert.match(backfill, /login: u\._id/);
    assert.ok(
      !/Patient\.create\(/.test(backfill),
      'create() would generate a new id and orphan the clinical rows',
    );
  });

  test('it verifies the property against the data it wrote', () => {
    // Checked rather than assumed: one row where it does not hold is a patient
    // whose prescriptions vanish the day a ref is re-pointed.
    assert.match(backfill, /\$expr: \{ \$ne: \['\$_id', '\$login'\] \}/);
  });

  test('it never modifies the account', () => {
    assert.ok(!/\$unset/.test(backfill));
    assert.ok(
      !/User\.(updateOne|updateMany|findOneAndUpdate)/.test(backfill),
      'the backfill writes to User',
    );
  });

  test('it is re-runnable', () => {
    assert.match(backfill, /\$setOnInsert/);
    assert.match(backfill, /already have a patient row — left alone/);
  });
});

describe('detach keeps the record still', () => {
  test('only the login moves; the id does not', () => {
    // Aarav turns eighteen. Every reading, enrollment and prescription names
    // this row, so a practice sees no change at all.
    const oldLogin = new mongoose.Types.ObjectId();
    const newLogin = new mongoose.Types.ObjectId();
    const p = new Patient({
      login: oldLogin,
      name: 'Aarav',
      relationship: RELATIONSHIP.CHILD,
    });
    const idBefore = String(p._id);

    p.detachTo(newLogin);

    assert.equal(String(p._id), idBefore, 'detach changed the patient id');
    assert.equal(String(p.login), String(newLogin));
    assert.equal(String(p.detachedFrom), String(oldLogin));
    assert.ok(p.detachedAt instanceof Date);
  });

  test('a detached patient is their own account holder', () => {
    const p = new Patient({
      login: new mongoose.Types.ObjectId(),
      name: 'Aarav',
      relationship: RELATIONSHIP.CHILD,
    });
    p.detachTo(new mongoose.Types.ObjectId());
    assert.equal(p.relationship, RELATIONSHIP.SELF);
  });
});

describe('the model', () => {
  test('a patient always has a login', () => {
    // A record nobody can be contacted about has no way to send a reminder or
    // a result.
    const p = new Patient({ name: 'Renu' });
    assert.ok(p.validateSync()?.errors?.login);
  });

  test('a patient carries their own name', () => {
    // "Aarav", not "Priya's child". A reminder naming the wrong person on a
    // phone carrying three prescriptions is a dose given to the wrong body.
    const p = new Patient({ login: new mongoose.Types.ObjectId(), name: 'Aarav' });
    assert.equal(p.toPublic().name, 'Aarav');
  });

  test('"who does this login look after" is indexed', () => {
    const idx = Patient.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.login === 1 && f.isActive === 1));
  });

  test('removal is soft', () => {
    assert.ok(Patient.schema.path('isActive'));
    assert.equal(Patient.schema.path('isActive').options.default, true);
  });
});

describe('the switcher never branches on count', () => {
  test('the service returns a list, including for one person', () => {
    // "Never branch on count in the data layer. Always fetch the list." A
    // service that returned a single patient would need rewriting by every
    // caller the first time a grandmother is added, and one would be missed.
    assert.match(service, /export async function patientsForLogin/);
    assert.ok(!/return rows\[0\]/.test(service), 'the service returns a single patient');
    assert.match(service, /\.map\(\(p\) => \(\{/);
  });

  test('a login with no rows still gets itself back', () => {
    // Every login until the migration runs. The synthetic row carries the
    // login's own id — the id its clinical rows already hold.
    assert.match(service, /async function fallback\(loginId\)/);
    assert.match(service, /id: String\(loginId\)/);
  });

  test('a login may always act for itself', () => {
    assert.match(service, /if \(String\(loginId\) === String\(patientId\)\) return true;/);
  });
});

describe('a login may act for its household, and nobody else', () => {
  const auth = readFileSync(new URL('../src/middleware/auth.js', import.meta.url), 'utf8');
  const svc = readFileSync(
    new URL('../src/services/patientsForLogin.js', import.meta.url),
    'utf8',
  );

  test('their own record still resolves without a lookup', () => {
    // The overwhelmingly common case, and it must not gain a database round
    // trip because a rarer one now exists.
    assert.match(auth, /const own = !requested \|\| requested === 'me'/);
    const ownBranch = auth.slice(auth.indexOf('const own ='), auth.indexOf('loginMayAccess'));
    assert.ok(!ownBranch.includes('await'), 'the self path now waits on a query');
  });

  test('anyone else is checked against the Patient table', () => {
    // Not assumed from the request. Without this a patient could name any id
    // and be served that record, and the household feature would be a hole.
    assert.match(auth, /await loginMayAccess\(req\.user\._id, requested\)/);
  });

  test('the check itself permits only self or a row that names this login', () => {
    assert.match(svc, /if \(String\(loginId\) === String\(patientId\)\) return true;/);
    assert.match(svc, /Patient\.findOne\(\{ _id: patientId, login: loginId, isActive: true \}\)/);
  });

  test('a refusal is recorded before it is thrown', () => {
    const at = auth.indexOf("reason: 'not_in_household'");
    assert.ok(at > -1, 'a patient reaching outside their household is not recorded');
    assert.ok(
      auth.indexOf('You can only access your own health record', at) > at,
      'it throws before it records',
    );
  });

  test('an inactive household member is not reachable', () => {
    // Somebody removed from a family keeps their record — the row is
    // soft-deleted — but the login that used to look after them does not keep
    // the key to it.
    assert.match(svc, /isActive: true/);
  });
});
