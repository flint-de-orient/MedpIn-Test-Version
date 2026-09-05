import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { generateSecret, verifyTotp, otpauthUri } from '../src/services/totp.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';

/**
 * The hardening on the account that can suspend every practice.
 *
 * The separate signing key and separate origin are the wall. These are the
 * locks on the one door through it.
 */
const route = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const totpSrc = readFileSync(new URL('../src/services/totp.js', import.meta.url), 'utf8');

describe('TOTP is correct, not merely present', () => {
  // RFC 6238 appendix B: the ASCII secret "12345678901234567890" in base32,
  // which at T=59 yields 94287082 for eight digits — so 287082 for six.
  const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

  test('it matches the RFC test vector', () => {
    // The direction that actually matters and the one a smoke test skips:
    // rejecting garbage proves nothing if valid codes are rejected too.
    const clock = mock.method(Date, 'now', () => 59_000);
    try {
      assert.equal(verifyTotp(RFC_SECRET, '287082'), true);
    } finally {
      clock.mock.restore();
    }
  });

  test('a second vector, to rule out a coincidence', () => {
    // T=1111111109 → 07081804 for eight digits.
    const clock = mock.method(Date, 'now', () => 1_111_111_109_000);
    try {
      assert.equal(verifyTotp(RFC_SECRET, '081804'), true);
    } finally {
      clock.mock.restore();
    }
  });

  test('a code from four minutes ago is refused', () => {
    // The drift window is one step either way — about ninety seconds. Wider
    // and a shoulder-surfed code stays usable far too long.
    const clock = mock.method(Date, 'now', () => 59_000 + 240_000);
    try {
      assert.equal(verifyTotp(RFC_SECRET, '287082'), false);
    } finally {
      clock.mock.restore();
    }
  });

  test('malformed input is refused without throwing', () => {
    for (const bad of ['', '12345', '1234567', 'abcdef', null, undefined, '12 34 56']) {
      assert.equal(verifyTotp(RFC_SECRET, bad), false, String(bad));
    }
  });

  test('comparison is timing-safe', () => {
    // A plain === on a six-digit string leaks how many leading digits matched
    // through how long it took, which over enough attempts is the difference
    // between a million guesses and ten.
    assert.match(totpSrc, /crypto\.timingSafeEqual/);
    assert.ok(!/expected === typed|token === /.test(totpSrc));
  });

  test('secrets are random and base32', () => {
    const a = generateSecret();
    const b = generateSecret();
    assert.notEqual(a, b);
    assert.match(a, /^[A-Z2-7]{32}$/);
    assert.match(otpauthUri({ secret: a, email: 'x@y.co' }), /^otpauth:\/\/totp\/.+secret=/);
  });

  test('no dependency sits in the authentication path', () => {
    // A supply-chain compromise here is not a bug, it is a breach.
    const imports = totpSrc.match(/^import .+$/gm) ?? [];
    assert.deepEqual(imports, ["import crypto from 'node:crypto';"]);
  });
});

describe('the account locks, not just the address', () => {
  const admin = () =>
    new PlatformAdmin({ email: 'a@b.co', name: 'A', passwordHash: 'x' });

  test('five failures shut it', () => {
    const a = admin();
    a.save = async () => a; // no database in these tests
    for (let i = 0; i < 4; i += 1) a.noteFailure();
    assert.equal(a.isLocked(), false, 'locked too early');
    a.noteFailure();
    assert.equal(a.isLocked(), true, 'five failures did not lock it');
  });

  test('a success clears the count', () => {
    // Four failures then a correct password is somebody who mistyped, not an
    // attacker who got lucky.
    const a = admin();
    a.save = async () => a;
    a.noteFailure();
    a.noteFailure();
    a.noteSuccess();
    assert.equal(a.failedAttempts, 0);
    assert.equal(a.lockedUntil, null);
  });

  test('the lock is checked before the password', () => {
    // So a locked account costs an attacker a request and tells them nothing.
    const lock = route.indexOf('admin?.isLocked()');
    const check = route.indexOf('await admin.checkPassword');
    assert.ok(lock > -1 && check > lock, 'the password is checked before the lock');
  });

  test('a failure on an unknown email counts against nobody', () => {
    // Otherwise anyone who can name an administrator can lock them out.
    assert.match(route, /if \(admin\) \{\s*\n\s*await admin\.noteFailure\(\)/);
  });
});

describe('failures are told apart internally and never to the caller', () => {
  test('one message for every kind of refusal', () => {
    // "Wrong code" rather than "wrong password" tells whoever is guessing which
    // half of the pair to keep working on.
    assert.match(route, /const REFUSED = 'Those details do not match an account\.'/);
    assert.equal((route.match(/Those details do not match an account/g) ?? []).length, 1);
  });

  test('but the log distinguishes them', () => {
    for (const action of [
      'admin.login.failed',
      'admin.login.failed_totp',
      'admin.login.locked',
    ]) {
      assert.ok(route.includes(action), `${action} is not recorded`);
    }
  });

  test('a missing code is not a failed attempt', () => {
    // The password was right. Counting it would lock out an operator whose app
    // took a moment to open.
    assert.match(route, /code: 'TOTP_REQUIRED'/);

    // Exactly the branch that returns TOTP_REQUIRED, not a fixed number of
    // characters after it — the *next* branch legitimately does count a
    // failure, and a wider window catches that one instead.
    const start = route.indexOf('if (!req.body.totp) {');
    const end = route.indexOf('if (!verifyTotp', start);
    assert.ok(start > -1 && end > start, 'the branches have moved');
    assert.ok(
      !route.slice(start, end).includes('noteFailure'),
      'a missing code is counted as a failed attempt',
    );
  });
});

describe('the second factor cannot be removed by a stolen session', () => {
  test('disabling needs a current code', () => {
    // A session alone would mean a stolen token removes the factor protecting
    // the account, which is the same as not having one.
    const disable = route.slice(route.indexOf("'/me/totp/disable'"));
    assert.match(disable.slice(0, 800), /verifyTotp\(admin\.totpSecret, req\.body\.totp\)/);
  });

  test('setup does not switch it on by itself', () => {
    // A secret written to the account without a verified code locks an operator
    // out the moment they mistype it into their app.
    const setup = route.slice(route.indexOf("'/me/totp/setup'"));
    assert.match(setup.slice(0, 900), /admin\.totpEnabled = false;/);
  });

  test('the secret is never selected by a later read', () => {
    assert.equal(PlatformAdmin.schema.path('totpSecret').options.select, false);
  });
});
