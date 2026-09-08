import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PRACTICE_TYPE, RESPONSIBLE_LABEL } from '../src/models/Practice.js';

/**
 * The onboarding wizard, and the two things it must not go back to being.
 *
 * ---- One: a list the client holds its own copy of -----------------------
 *
 * Practice types are an enum and could be hardcoded in the console. Specialties
 * cannot: they are the shared Department rows, an operator can add one, and a
 * list compiled into the client is a rebuild every time somebody opens a
 * practice in a specialty nobody anticipated. Department.js already argues this
 * for the model. It applies to the picker for the same reason.
 *
 * The responsible-person label travels with the type for a sharper version of
 * the same reason: two copies of a mapping drift, and the copy that drifts is
 * the one that renders "Head doctor" above a hospital's phone field.
 *
 * ---- Two: a form that says the same thing on every step -----------------
 *
 * Collapsing the three-way description to a two-way ternary made the review
 * step describe step two — "They will own the practice and sign in with this
 * number", above a summary. It shipped in the same edit that added the types
 * and it was caught by the test below rather than by reading the diff.
 */
const WEB = new URL('../../web/src/', import.meta.url);
const wizard = readFileSync(new URL('components/new-practice.tsx', WEB), 'utf8');
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');
const prose = wizard.replace(/\s+/g, ' ');

describe('the pickers are served, not compiled in', () => {
  test('there is a route that answers what the wizard needs', () => {
    assert.match(routes, /'\/practice-options'/);
    // The shared rows only. A practice's own departments are its business and
    // are not a specialty anybody else can be opened in.
    const at = routes.indexOf("'/practice-options'");
    const body = routes.slice(at, at + 1200);
    assert.match(body, /Department\.find\(\{ practice: null, isActive: true \}\)/);
    assert.match(body, /RESPONSIBLE_LABEL\[key\]/);
  });

  test('and the wizard fetches it rather than holding a list', () => {
    assert.match(wizard, /api<PracticeOptions>\("\/admin\/practice-options"\)/);

    // The tell: a specialty name written into the client.
    for (const specialty of ['diabetology', 'cardiology', 'paediatrics', 'dermatology']) {
      assert.ok(
        !wizard.includes(`"${specialty}"`),
        `${specialty} is hardcoded in the wizard; it belongs to the shared departments`,
      );
    }
  });

  test('a picker that fails to load does not block the wizard', () => {
    // Both fields are optional and a practice can be classified afterwards. A
    // wizard that refuses to open because a dropdown 500'd is a worse failure
    // than one that opens with an empty dropdown.
    assert.match(wizard, /\.catch\(\(\) => setOptions\(\{ types: \[\], specialties: \[\] \}\)\)/);
  });
});

describe('the responsible person is called the right thing', () => {
  test('every type has a label, and it comes from the server', () => {
    for (const type of Object.values(PRACTICE_TYPE)) {
      assert.ok(RESPONSIBLE_LABEL[type], `${type} has no responsible-person label`);
    }
    // A hospital does not have a head doctor, and the point of the field is
    // that the label changes.
    assert.notEqual(RESPONSIBLE_LABEL[PRACTICE_TYPE.HOSPITAL], RESPONSIBLE_LABEL[PRACTICE_TYPE.CLINIC]);
  });

  test('the wizard reads it rather than deciding', () => {
    assert.match(wizard, /chosen\?\.responsibleLabel \?\? "Head doctor"/);
    // Used in the field label, the review row and the closing sentence — all
    // three, or one of them says "head doctor" at a diagnostic centre.
    assert.match(wizard, /label=\{`\$\{responsible\}'s name`\}/);
    assert.match(wizard, /<Row label=\{responsible\}>/);
  });
});

describe('a practice is not created twice', () => {
  test('a licence already in use is refused by the server', () => {
    // Not only warned about in the client. A registration number is a claim
    // about a specific licence and two practices holding one is a mistake.
    const at = routes.indexOf("router.post(\n  '/practices'");
    const body = routes.slice(at, routes.indexOf('Practice.create', at));
    assert.match(body, /Practice\.findOne\(\{ registrationNo: brand\.registrationNo \}\)/);
    assert.match(body, /already belongs to/);
  });

  test('a shared name is not', () => {
    // "City Clinic" is a real name in every city in the country. Refusing the
    // second one is this console deciding a customer may not exist because
    // somebody earlier chose the same two words.
    const at = routes.indexOf("router.post(\n  '/practices'");
    const body = routes.slice(at, routes.indexOf('Practice.create', at));
    assert.ok(
      !/Practice\.findOne\(\{ name:/.test(body),
      'creating a practice now refuses a name somebody else also chose',
    );
    // It is still surfaced, as a warning, before the expensive steps.
    assert.match(routes, /'\/practices\/check'/);
    assert.match(prose, /A practice is already called/);
  });

  test('and the name lookup cannot be broken by a name', () => {
    // "C++ (Salt Lake)" is a pattern, not a string: the parentheses group and
    // the plus signs quantify nothing, so the query throws.
    assert.match(routes, /function escapeRegex\(/);
    assert.match(routes, /new RegExp\(`\^\$\{escapeRegex\(name\)\}\$`, 'i'\)/);
  });
});

describe('each step says what that step is', () => {
  test('three descriptions, not two', () => {
    // The review step described step two for one commit, because the ternary
    // was collapsed when the types were added.
    assert.match(prose, /step === 1 \? .* : step === 2 \? .* : "Confirm the details below/);
  });

  test('and the review step still is not a briefing', () => {
    assert.ok(!prose.includes('There is no delete'), 'the anxious subtitle is back');
    assert.match(prose, /Confirm the details below/);
  });
});

describe('unclassified stays a real answer', () => {
  test('both fields are optional on the server', () => {
    const at = routes.indexOf("router.post(\n  '/practices'");
    const body = routes.slice(at, at + 2500);
    assert.match(body, /practiceType: z\.enum\(Object\.values\(PRACTICE_TYPE\)\)\.optional\(\)/);
    assert.match(body, /specialty: z\.string\(\)\.trim\(\)\.max\(80\)\.optional\(\)/);
  });

  test('and the wizard offers not answering', () => {
    // Requiring them here would be stricter than the resolver, which reads
    // null as unclassified-therefore-unrestricted. The operator creating a
    // practice for a clinic that has not decided would have to guess.
    const both = [...wizard.matchAll(/placeholder="Not saying yet"/g)];
    assert.equal(both.length, 2, 'a picker no longer lets the operator decline');
  });
});
