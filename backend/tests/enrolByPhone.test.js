import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import mongoose from 'mongoose';
import { ConsentEvent, CONSENT_ACTION, CONSENT_METHOD } from '../src/models/ConsentEvent.js';
import { OtpChallenge } from '../src/models/OtpChallenge.js';

/**
 * The join working at the desk, and the consent that gates it.
 *
 * Priya at Dr. Dey's desk and Amit at Dr. Sen's, both typing Rahul's number,
 * are not a collision — they are two practices each needing a link to one
 * person. The old code called it a conflict and refused.
 */
const src = readFileSync(new URL('../src/services/enrolByPhone.js', import.meta.url), 'utf8');
const desk = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');

describe('an existing number is a link, not an error', () => {
  test('the service never rejects a number it has seen', () => {
    // The whole point. `conflict` appears only for a withdrawn enrolment being
    // reused, which is a different thing entirely.
    const conflicts = [...src.matchAll(/throw conflict\(([^)]*)\)/g)].map((m) => m[1]);
    assert.equal(conflicts.length, 1, conflicts.join(' | '));
    assert.match(conflicts[0], /withdrawn/);
  });

  test('a login that exists is reused, never duplicated', () => {
    assert.match(src, /let login = await User\.findByLoginPhone\(e164\);/);
    assert.match(src, /const isNewLogin = !login;/);
  });

  test('a self-patient reuses the login id', () => {
    // What keeps every clinical collection pointing at the right value.
    assert.match(src, /_id: login\._id,\s*\n\s*login: login\._id,/);
  });

  test('returning after a withdrawal reactivates the row', () => {
    // So the original enrolledOn and the consent history stay attached to it,
    // rather than a second row pretending the first never happened.
    assert.match(src, /already\.status = ENROLLMENT_STATUS\.PENDING;/);
    assert.match(src, /already\.revokedAt = null;/);
  });
});

describe('consent is asked when a practice reaches, not when it starts', () => {
  test('a number with no account needs no code; every account that exists does', () => {
    // There is no history to reach for when the desk makes the account. The
    // record about to exist is the one they are writing, and asking the
    // patient to approve the clinic they are standing in protects nothing.
    //
    // This was `!isNewLogin && elsewhere > 0`, so an account nobody else held —
    // somebody who signed themselves up and kept their readings in the app —
    // was joined to whichever desk typed the number, with no code. See
    // deskConsent.test.js for the behaviour over HTTP.
    assert.match(src, /const consentRequired = !isNewLogin;/);
  });

  test('an account that exists is sent a code', () => {
    // A typo at the counter must not silently attach a practice to a stranger.
    assert.match(src, /if \(consentRequired\) \{[\s\S]{0,300}requestOtp\(\{ phone: e164, purpose: ENROL_PURPOSE \}\)/);
  });

  test('a pending enrolment starts inert', () => {
    assert.match(src, /status: consentRequired \? ENROLLMENT_STATUS\.PENDING : ENROLLMENT_STATUS\.ACTIVE/);
  });

  test('the code is checked against a number on the login, never a supplied one', () => {
    // Taking a number and a code together and trusting them to match would let
    // a desk verify one number and enrol another. The number checked is the
    // one the latest request texted — only if the account still signs in with
    // it — and otherwise the account's own.
    assert.match(src, /const login = await User\.findById\(patient\?\.login\)\.select\('phone altPhones'\)/);
    assert.match(src, /signsInWith\.includes\(lastRequest\?\.requestedPhone\) \? lastRequest\.requestedPhone : login\.phone/);
    assert.match(src, /verifyOtp\(\{ phone: sentTo, purpose: ENROL_PURPOSE, code \}\)/);
    assert.doesNotMatch(
      src.slice(src.indexOf('export async function confirmEnrolment')).split('\n')[0],
      /phone/,
      'the confirmation accepts a phone number from its caller',
    );
  });

  test('the window opens at consent, unless the patient is returning', () => {
    // The practice's access begins when the patient says so. A patient coming
    // back keeps the original date — see wasActiveBefore — and the return is
    // recorded as its own consent rather than by moving the date.
    assert.match(src, /const returning = await wasActiveBefore\(enrollment\._id\);/);
    assert.match(src, /if \(!returning\) set\.enrolledOn = new Date\(\);/);
    assert.match(src, /reconsent: true/);
  });

  test('enrol is its own OTP purpose', () => {
    // One live code per number per purpose: an enrolment code arriving would
    // otherwise burn a registration the patient was part-way through.
    assert.deepEqual(
      [...OtpChallenge.schema.path('purpose').enumValues].sort(),
      // `practice` joined them when self-registration landed: somebody applying
      // to open a clinic proves their number the same way, and a shared purpose
      // would let an enrolment code burn an application half-filled in. `hire`
      // joined when a practice could add somebody who already has an account:
      // the registration code refuses those numbers, and a shared purpose would
      // let a hiring code burn somebody's login or registration.
      ['enrol', 'hire', 'login', 'practice', 'register'],
    );
  });
});

describe('consent is a log, not a field', () => {
  test('every transition writes an event', () => {
    // A request or a new desk-made account, a re-request after a withdrawal,
    // a fresh code sent to a request still waiting, and the confirmation. Four.
    assert.equal((src.match(/ConsentEvent\.record\(/g) ?? []).length, 4);
  });

  test('a first-practice enrolment is logged too', () => {
    // The one case that needed no code is the one nobody could otherwise
    // account for later.
    assert.match(src, /action: consentRequired \? CONSENT_ACTION\.REQUESTED : CONSENT_ACTION\.GRANTED/);
  });

  test('the wording version is recorded', () => {
    // Consent to a sentence you later rewrite is not consent to the rewrite.
    assert.match(src, /export const CONSENT_WORDING/);
    assert.match(src, /wording: CONSENT_WORDING/);
  });

  test('there is no way to edit or delete an event', () => {
    // The absence of the method is the guardrail: somebody would have to write
    // the mutation themselves and explain why.
    const model = readFileSync(new URL('../src/models/ConsentEvent.js', import.meta.url), 'utf8');
    assert.match(model, /statics\.record/);
    assert.ok(!/statics\.(update|remove|delete)/.test(model));
    assert.match(model, /updatedAt: false/);
  });

  test('a migration is not recorded as a person', () => {
    assert.ok(Object.values(CONSENT_METHOD).includes('migration'));
  });

  test('the history is ordered oldest first', () => {
    const svc = readFileSync(new URL('../src/services/enrollments.js', import.meta.url), 'utf8');
    assert.match(svc, /consentHistory[\s\S]{0,300}\.sort\(\{ at: 1 \}\)/);
  });
});

describe('revocation ends access and deletes nothing', () => {
  const svc = readFileSync(new URL('../src/services/enrollments.js', import.meta.url), 'utf8');

  test('it sets a status and a date, and removes no record', () => {
    assert.match(svc, /status = ENROLLMENT_STATUS\.REVOKED/);
    assert.ok(!/deleteOne|deleteMany|remove\(/.test(svc), 'revocation deletes something');
  });

  test('it is logged as the patient acting, by default', () => {
    // Revocable by the patient, never by the practice that holds the access —
    // a clinic that could revoke on a patient's behalf could also decline to.
    assert.match(svc, /inApp = true/);
    assert.match(svc, /action: CONSENT_ACTION\.REVOKED/);
  });
});

describe('the model', () => {
  test('a consent event is append-only in shape', () => {
    const e = new ConsentEvent({
      enrollment: new mongoose.Types.ObjectId(),
      action: CONSENT_ACTION.GRANTED,
      method: CONSENT_METHOD.OTP_DESK,
    });
    assert.ok(e.at instanceof Date);
    assert.equal(e.validateSync(), undefined);
  });

  test('the consent history for one relationship is indexed', () => {
    const idx = ConsentEvent.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.enrollment === 1 && f.at === 1));
  });
});

describe('the desk route still exists to be migrated', () => {
  test('it is the one that used to refuse a known number', () => {
    // Recorded so the next step — pointing the route at the service — has an
    // anchor, and so this test fails if somebody removes the route instead.
    assert.match(desk, /An account with this phone number already exists/);
  });
});
