import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { generateOtp, hashOtp } from '../src/models/OtpChallenge.js';

/**
 * The parts of the OTP scheme that are testable without a database.
 *
 * The interesting properties are all in how a code is generated and stored,
 * and each of these is a way the scheme could be quietly weakened by a later
 * edit that still looks correct.
 */
describe('one-time passcodes', () => {
  test('a code is always six digits, including the ones that start with zero', () => {
    // Padding a smaller random range is the usual mistake: it makes "000000"
    // through "099999" impossible and hands an attacker the first digit.
    let sawLeadingZero = false;
    for (let i = 0; i < 4000; i += 1) {
      const code = generateOtp();
      assert.match(code, /^\d{6}$/);
      if (code.startsWith('0')) sawLeadingZero = true;
    }
    assert.ok(sawLeadingZero, 'no code in 4000 started with 0 — is the range padded?');
  });

  test('codes are not repeated in a short run', () => {
    // Not a randomness proof; a tripwire for someone swapping randomInt for a
    // seeded or time-derived source.
    const seen = new Set();
    for (let i = 0; i < 500; i += 1) seen.add(generateOtp());
    assert.ok(seen.size > 450, `only ${seen.size} distinct codes in 500`);
  });

  test('the stored hash is not the code', () => {
    const hash = hashOtp('123456', '+919000000000', 'login');
    assert.notEqual(hash, '123456');
    assert.doesNotMatch(hash, /123456/);
    assert.match(hash, /^[a-f0-9]{64}$/);
  });

  test('the same code hashes differently per purpose', () => {
    // A code texted to prove a new number must not open an existing account,
    // and the salt is what makes that structural rather than a check some
    // handler has to remember.
    const phone = '+919000000000';
    assert.notEqual(hashOtp('123456', phone, 'login'), hashOtp('123456', phone, 'register'));
  });

  test('the same code hashes differently per number', () => {
    assert.notEqual(
      hashOtp('123456', '+919000000000', 'login'),
      hashOtp('123456', '+919000000001', 'login'),
    );
  });

  test('the same code, number and purpose hash the same way', () => {
    // Verification is a hash comparison; if this drifts nobody can log in.
    assert.equal(
      hashOtp('654321', '+919000000000', 'register'),
      hashOtp('654321', '+919000000000', 'register'),
    );
  });
});
