import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { signPhoneToken, phoneFromToken } from '../src/services/otp.js';
import { signAccessToken } from '../src/services/tokens.js';

/**
 * Registering a patient at the desk.
 *
 * The receptionist types the number, the patient reads the texted code back,
 * and the token that comes out of that is what the create-patient call carries.
 * The dangerous mistake is treating that token and the phone field as two
 * independent pieces of information: verify one number, register another, and
 * the account is created against a number nobody proved.
 *
 * The route reads the phone OUT of the token and compares. These cover the
 * token itself — the part that decides whether that comparison can be trusted.
 */
describe('the phone token a desk registration carries', () => {
  test('a token vouches for exactly the number it was issued for', () => {
    const token = signPhoneToken('+919749681391');
    assert.equal(phoneFromToken(token), '+919749681391');
  });

  test('two numbers get two different tokens', () => {
    // If these ever collided, verifying one number would register another.
    assert.notEqual(
      signPhoneToken('+919749681391'),
      signPhoneToken('+918731807899'),
    );
  });

  test('a token for another number does not vouch for this one', () => {
    // The exact swap the route guards against.
    const token = signPhoneToken('+918731807899');
    assert.notEqual(phoneFromToken(token), '+919749681391');
  });

  test('a made-up token is refused rather than believed', () => {
    assert.throws(() => phoneFromToken('not-a-token'), /verification expired/i);
    assert.throws(() => phoneFromToken(''), /verification expired/i);
  });

  test('an access token cannot be passed off as a phone token', () => {
    // Both are signed with the same secret, so the signature alone proves
    // nothing — only the `use` claim separates them. Without that check, any
    // signed-in user's own access token would verify any number they liked.
    const access = signAccessToken({
      _id: { toString: () => '507f1f77bcf86cd799439011' },
      role: 'patient',
      name: 'Someone',
    });
    assert.throws(() => phoneFromToken(access), /verification expired/i);
  });

  test('a token carries no password and no role', () => {
    // It says one thing: this number was proved. Anything else in it would be
    // something the client could try to influence.
    const [, payload] = signPhoneToken('+919749681391').split('.');
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    assert.equal(claims.phone, '+919749681391');
    assert.equal(claims.use, 'phone_verified');
    assert.equal(claims.role, undefined);
    assert.equal(claims.sub, undefined);
  });
});
