import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The sign-in screen, which is the only screen some people ever fail on.
 *
 * Everything here is small and every one of them was a real report rather than
 * a preference: a password that could not be read back, a link nobody
 * recognised as the standard one, a button that said nothing while the network
 * was busy, and a layout that moved under the cursor the moment something went
 * wrong.
 */
const src = readFileSync(new URL('../../web/src/components/sign-in.tsx', import.meta.url), 'utf8');
const prose = src.replace(/\s+/g, ' ');
const css = readFileSync(new URL('../../web/src/app/globals.css', import.meta.url), 'utf8');

describe('the password can be read back', () => {
  test('every password field is the one with the toggle', () => {
    // The commonest reason a correct password is refused is that it was
    // mistyped into a row of dots.
    const raw = [...src.matchAll(/type="password"/g)].length;
    assert.equal(raw, 0, 'a password input bypasses PasswordField and has no toggle');
    assert.match(src, /type=\{shown \? "text" : "password"\}/);
  });

  test('the toggle says which state it is in', () => {
    // A button labelled "Hide" that hides is a coin toss every time it is read.
    assert.match(src, /aria-pressed=\{shown\}/);
    assert.match(prose, /Password is visible\. Hide it\./);
  });
});

describe('the words are the ones people look for', () => {
  test('“Forgot password?”, not an invention', () => {
    assert.match(prose, /Forgot password\?/);
    assert.ok(!prose.includes('Lost the password?'), 'the unconventional wording is back');
  });

  test('the sign-in subtitle is not a disclaimer', () => {
    // What the console does and does not hold is true and is not what somebody
    // signing in needs. It still runs along the bottom of every screen inside.
    const head = src.slice(src.indexOf('Sign in</h1>'), src.indexOf('Sign in</h1>') + 400);
    assert.ok(
      !head.includes('holds no patient records'),
      'the disclaimer is back above the password field',
    );
  });
});

describe('nothing moves under the cursor', () => {
  test('the message slot is there whether or not there is a message', () => {
    // Rendering nothing until something goes wrong moves every control below
    // it, so the button being reached for is not where it was.
    assert.match(src, /function Slot\(/);
    assert.match(src, /min-h-\[2\.25rem\]/);
    const inline = [...src.matchAll(/\{error \? <Problem>/g)].length;
    const slotted = [...src.matchAll(/<Slot>\{error \? <Problem>/g)].length;
    assert.equal(inline, slotted, 'an error renders outside the reserved slot');
  });

  test('and it is announced', () => {
    assert.match(src, /aria-live="polite"/);
    assert.match(src, /role="alert"/);
  });
});

describe('the button says whether anything is happening', () => {
  test('a spinner, not only changed text', () => {
    // The label alone says the click registered and says nothing about whether
    // the request is still in flight, which is when somebody clicks again.
    assert.match(src, /function Submit\(/);
    assert.match(src, /<Spinner className="spin size-4" \/>/);
    assert.match(src, /aria-busy=\{busy\}/);
  });

  test('every submit on this screen is that button', () => {
    // Exactly one, and it is Submit's own. Counting them all called the
    // component a violation of the rule it exists to enforce.
    const all = [...src.matchAll(/type="submit"/g)];
    assert.equal(all.length, 1, 'a submit button bypasses Submit and has no busy state');

    const defn = src.indexOf('function Submit(');
    const end = src.indexOf('\nfunction ', defn + 1);
    assert.ok(
      all[0].index > defn && all[0].index < end,
      'the only submit is somewhere other than inside Submit',
    );
  });

  test('disabled looks unclickable, not merely dim', () => {
    // A dimmed button still looks pressable; the cursor is the part that says
    // it is not.
    assert.match(src, /disabled:cursor-not-allowed/);
  });

  test('and the spin stops for anybody who asked for no motion', () => {
    // The label still changes, so the state is still legible without it.
    assert.match(css, /\.spin \{/);
    assert.match(css, /prefers-reduced-motion: reduce/);
  });
});

describe('the layout is balanced on a phone', () => {
  test('the form sits near the top on a small screen', () => {
    // Centring in the remaining height put a short form in the middle of a tall
    // phone with a fold of dead space under it.
    assert.match(src, /items-start justify-center[^"]*sm:items-center/);
  });
});
