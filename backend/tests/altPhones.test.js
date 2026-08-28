import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { byLoginPhone } from '../src/models/User.js';

/**
 * One account, more than one number that signs into it.
 *
 * A clinic reception desk is one identity with two lines. Two accounts would
 * have worked — staff data is clinic-wide, so both would see the same thing —
 * but a patient would then get replies from "Clinic Reception" and "Clinic
 * Reception 2" and reasonably wonder how many receptions there are.
 *
 * These tests guard the part that is easy to get wrong: EVERY lookup in the
 * sign-in path has to know about alternates. One that does not is a number
 * that receives a code and then cannot spend it — or, far worse, a number two
 * accounts can both claim.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

describe('alternate sign-in numbers', () => {
  test('the filter matches a primary or an alternate', () => {
    const f = byLoginPhone('+919674999327');
    assert.deepEqual(f, {
      $or: [{ phone: '+919674999327' }, { altPhones: '+919674999327' }],
    });
  });

  test('no lookup in the sign-in path still asks for the primary alone', () => {
    // The real risk is not the code that was changed, it is the one that was
    // missed. Eight places asked `{ phone }` directly; a ninth added later
    // would silently fail to find a desk's second line.
    const auth = read('../src/routes/auth.js');
    assert.doesNotMatch(
      auth,
      /findOne\(\{ phone \}/,
      'auth must find accounts through findByLoginPhone',
    );
    assert.doesNotMatch(
      auth,
      /exists\(\{ phone \}/,
      'auth must test numbers through phoneTaken',
    );
  });

  test('every place that assigns a number checks both fields', () => {
    // A number already serving as one account's alternate is just as taken as
    // one that is another's primary. Two accounts claiming a number means a
    // code sent to it signs somebody into whichever document came back first.
    for (const f of ['../src/routes/auth.js', '../src/routes/doctor.js']) {
      const src = read(f);
      const guards = src.match(/phoneTaken\(/g) ?? [];
      assert.ok(guards.length > 0, `${f} must guard with phoneTaken`);
    }
    const script = read('../scripts/setAccountPhone.js');
    assert.match(script, /byLoginPhone\(/, 'the phone-swap script must check alternates');
  });

  test('the model exposes alternates so the app can manage them', () => {
    const src = read('../src/models/User.js');
    assert.match(src, /altPhones: this\.altPhones/, 'toPublic must expose them');
    assert.match(src, /statics\.phoneTaken/);
    assert.match(src, /statics\.findByLoginPhone/);
  });
});
