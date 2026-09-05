import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PlatformAdmin } from '../src/models/PlatformAdmin.js';

/**
 * Getting back in after losing the admin password.
 *
 * The obvious flow mails a link, which makes the administrator's mailbox the
 * key to every practice on the platform — protected by somebody else's password
 * policy, somebody else's session handling, and whatever device it is signed
 * into. This account can suspend a clinic. Its recovery must not be easier than
 * its login.
 */
const svc = readFileSync(new URL('../src/services/adminReset.js', import.meta.url), 'utf8');
const route = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const script = readFileSync(new URL('../scripts/resetAdmin.js', import.meta.url), 'utf8');

describe('the token is not a second password', () => {
  test('only its hash is stored', () => {
    // A database dump must not hand somebody a working reset, which is the same
    // reason the password itself is not stored.
    assert.match(svc, /admin\.resetTokenHash = hash\(token\)/);
    assert.equal(PlatformAdmin.schema.path('resetTokenHash').options.select, false);
  });

  test('it expires', () => {
    assert.match(svc, /TTL_MINUTES = 30/);
    assert.match(svc, /admin\.resetTokenExpiresAt < new Date\(\)/);
  });

  test('it is spent on use', () => {
    // A token that still worked afterwards would be a second password nobody
    // knew they had.
    assert.match(svc, /admin\.resetTokenHash = null;/);
  });

  test('it is compared in constant time', () => {
    // A plain === leaks the prefix through timing, and this one is worth the
    // effort of extracting.
    assert.match(svc, /crypto\.timingSafeEqual/);
    assert.ok(!/=== admin\.resetTokenHash/.test(svc));
  });

  test('it is long enough that guessing is pointless', () => {
    assert.match(svc, /TOKEN_BYTES = 32/);
    assert.match(svc, /crypto\.randomBytes\(TOKEN_BYTES\)/);
  });
});

describe('the second factor survives the reset', () => {
  test('a reset on a 2FA account still needs a code', () => {
    // Otherwise anyone holding a leaked token is past the factor entirely, and
    // the factor is decorative.
    assert.match(svc, /if \(admin\.totpEnabled\) \{/);
    assert.match(svc, /verifyTotp\(admin\.totpSecret, totp\)/);
  });

  test('and a missing code is told apart from a wrong one', () => {
    // The password half already succeeded; asking for the code is not a
    // failure, and treating it as one would count against the lockout.
    assert.match(svc, /Enter the code from your authenticator app/);
  });
});

describe('failures say one thing and log another', () => {
  test('every refusal returns the same message', () => {
    // Distinguishing "no such account" from "wrong token" says which half to
    // keep working on.
    assert.match(svc, /const REFUSED = 'That reset link is not valid\.'/);
    assert.equal((svc.match(/That reset link is not valid/g) ?? []).length, 1);
  });

  test('but the log distinguishes them', () => {
    for (const a of ['admin.reset.issued', 'admin.reset.failed', 'admin.reset.failed_totp', 'admin.reset.completed']) {
      assert.ok(svc.includes(a), `${a} is not recorded`);
    }
  });
});

describe('the route', () => {
  test('is rate-limited like the login', () => {
    const block = route.slice(route.indexOf("'/auth/reset'"));
    assert.match(block.slice(0, 200), /loginLimiter/);
  });

  test('returns no session', () => {
    // Choosing a new password is not signing in. Handing back a token would
    // let a stolen reset skip the login it just re-enabled.
    const block = route.slice(route.indexOf("'/auth/reset'"), route.indexOf('// Everything below'));
    assert.ok(!/signAdminToken/.test(block), 'the reset hands back a session');
    assert.match(block, /res\.json\(\{ ok: true \}\)/);
  });

  test('is 404 when the panel is switched off, like everything else here', () => {
    const block = route.slice(route.indexOf("'/auth/reset'"), route.indexOf('// Everything below'));
    assert.match(block, /ADMIN_JWT_SECRET/);
    assert.match(block, /status\(404\)/);
  });
});

describe('minting one needs the server, not an inbox', () => {
  test('the token comes from a script', () => {
    // Shell access already implies control of the database, so this grants
    // nothing new — it makes the recovery supported and audited rather than an
    // ad-hoc Mongo write.
    assert.match(script, /issueResetToken\(email\)/);
    assert.match(script, /shown once/);
  });

  test('it does not write unless asked', () => {
    assert.match(script, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(script, /if \(!apply\)/);
  });

  test('a reset clears a lockout', () => {
    // Somebody who forgot their password and then locked themselves out trying
    // should not have to wait out both.
    assert.match(svc, /admin\.failedAttempts = 0;/);
    assert.match(svc, /admin\.lockedUntil = null;/);
  });
});
