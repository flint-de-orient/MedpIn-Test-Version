import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Explanatory copy goes stale silently.
 *
 * ---- Two of these shipped -----------------------------------------------
 *
 * The Account screen said the session was "held in memory only" and that
 * closing the tab signed you out, for several days after the session became a
 * cookie that survives a refresh. It was written when it was true and nothing
 * connected it to the change that made it false.
 *
 * The reject dialog said "the applicant sees this" of a reason that goes only
 * to the audit log — an audience that has never existed.
 *
 * This console explains itself more than most software does, which is the point
 * of it and also the exposure: prose that is confidently wrong is worse than no
 * prose, because somebody acts on it. A reader who is told the tab closing
 * signs them out leaves one open on a shared machine believing otherwise.
 *
 * So the claims that would be dangerous to get wrong are pinned to the code
 * that makes them true.
 */
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));

function sourceUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += sourceUnder(full);
    else if (/\.tsx?$/.test(name)) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

const prose = sourceUnder(WEB).replace(/\s+/g, ' ');
const session = readFileSync(new URL('../src/services/adminSession.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');

describe('what the console says about the session is true', () => {
  test('it does not claim the session lives in memory', () => {
    // It has not since the cookie landed. Somebody told the tab closing signs
    // them out leaves one open on a shared machine believing otherwise.
    for (const stale of [
      'Held in memory only',
      'held in memory only',
      'Closing the tab signs you out',
      'signing in again after a refresh',
      'there is no “remember me”',
    ]) {
      assert.ok(!prose.includes(stale), `stale claim on screen: "${stale}"`);
    }
  });

  test('and the cookie it describes is the one that is set', () => {
    assert.match(prose, /cookie your browser will not let this page read/);
    assert.match(session, /httpOnly: true/);
  });

  test('two hours, in the copy and in the token', () => {
    const tokens = readFileSync(new URL('../src/services/adminTokens.js', import.meta.url), 'utf8');
    assert.match(tokens, /const TTL = '2h'/);
    assert.match(session, /MAX_AGE_MS = 2 \* 60 \* 60 \* 1000/);
    assert.match(prose, /lasts two hours/);
  });

  test('“no sign out everywhere” is still the truth', () => {
    // The moment a token store exists this becomes false, and the sentence has
    // to go with it rather than sitting there reassuring nobody.
    assert.ok(
      !/RefreshToken|tokenStore|revokedTokens/.test(routes),
      'the admin routes now track tokens; the copy promising no revocation is stale',
    );
    assert.match(prose, /There is no “sign out everywhere”/);
  });
});

describe('what the console says about a rejection is true', () => {
  test('it does not claim the practice is told', () => {
    // Nothing shows a rejection reason to anybody outside this console.
    assert.ok(
      !prose.includes('The applicant sees this'),
      'the reject dialog promises the applicant sees the reason',
    );
    assert.match(prose, /Nobody at the practice sees this/);
  });

  test('and the reason really does reach the audit log', () => {
    assert.match(routes, /action: 'admin\.practice\.verification'|reason: req\.body\.reason/);
  });
});

describe('what the console says about the setup key is true', () => {
  test('it says no message will arrive, because none does', () => {
    // The question that produced this was "where do I get the 6 digit code?",
    // asked by somebody waiting for a text on a screen that had explained why
    // SMS is a bad idea without saying where the code does come from.
    assert.match(prose, /Nothing will be sent to you/);
    assert.ok(
      !/sendSms|msg91|twilio/i.test(routes),
      'the admin routes now send a message; the copy saying none arrives is stale',
    );
  });

  test('and that the factor stays off until a code is verified', () => {
    assert.match(prose, /a mistyped key cannot lock you out/);
    // The route is what makes that true: setup stores a secret and leaves the
    // flag alone.
    const setup = routes.slice(routes.indexOf("'/me/totp/setup'"));
    assert.match(setup.slice(0, 900), /admin\.totpEnabled = false;/);
  });
});
