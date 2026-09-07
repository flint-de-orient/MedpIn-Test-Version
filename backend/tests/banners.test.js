import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The amber boxes, which were paragraphs in a flat fill.
 *
 * ---- What was wrong with them ------------------------------------------
 *
 * Reported as "muddy and unpolished", which was the visible half. Underneath it
 * they were four separate hand-rolled divs with slightly different padding,
 * three different border treatments, and — the actual defect — the problem, its
 * legal consequence and the instructions for fixing it packed into one block of
 * 11px text. Nobody reads that block. It is skipped *because* it looks like the
 * small print it was written as.
 *
 * ---- Two colours, not one ----------------------------------------------
 *
 * The other half was the palette. `--waiting` was doing two jobs: the icon and
 * left edge, which need 3:1 and want to be saturated, and body text on the
 * tint, which needs 4.5:1 and wants to be dark. #b45309 on #fef3c7 is 4.67:1 —
 * it passes and it still reads like effort.
 *
 * So there are three tiers now. `--waiting` is the accent, `--waiting-ink` is
 * text on the tint, and this file is what stops them being confused again.
 */
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));
const css = readFileSync(path.join(WEB, 'app', 'globals.css'), 'utf8');
const primitives = readFileSync(path.join(WEB, 'components', 'primitives.tsx'), 'utf8');

function sourceUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += sourceUnder(full);
    else if (/\.tsx?$/.test(name)) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

const app = sourceUnder(WEB);

describe('the three tiers exist and mean different things', () => {
  for (const family of ['ok', 'waiting', 'stopped']) {
    test(`--${family} has an accent, a tint and an ink`, () => {
      // Two definitions of each: light, then dark.
      for (const role of ['', '-tint', '-ink']) {
        const hits = [...css.matchAll(new RegExp(`--${family}${role}:`, 'g'))].length;
        assert.equal(hits, 2, `--${family}${role} is defined ${hits} times, expected light and dark`);
      }
      assert.match(css, new RegExp(`--color-${family}-ink: var\\(--${family}-ink\\)`));
    });
  }

  test('the amber is the one that was specified', () => {
    // Light: Amber-600 accent on Amber-100, Amber-900 ink.
    assert.match(css, /--waiting: #d97706;/);
    assert.match(css, /--waiting-tint: #fef3c7;/);
    assert.match(css, /--waiting-ink: #78350f;/);

    // Dark: Amber-500 accent, Amber-200 ink.
    assert.match(css, /--waiting: #f59e0b;/);
    assert.match(css, /--waiting-ink: #fde68a;/);
  });

  test('and the dark tints are washes, not flat browns', () => {
    // #3a2a0a is a fixed colour that punches a hole in whatever card it lands
    // on. A wash of the accent sits on the surface instead — which is the
    // argument the phone app already wrote down for mintFillDark.
    for (const dead of ['3a2a0a', '0c2a1e', '3f1414']) {
      // As a token value, not anywhere in the file. The comment above the
      // tokens names these to say why they went, and a test that cannot tell a
      // definition from an explanation forbids explaining anything.
      assert.ok(
        !new RegExp(`--[a-z-]+:\\s*#${dead}`, 'i').test(css),
        `the flat dark tint #${dead} is back as a token value`,
      );
    }
    assert.match(css, /--waiting-tint: rgb\(245 158 11 \/ 0\.08\)/);
  });
});

describe('a banner is a component', () => {
  test('it exists, with an edge, an icon and a title', () => {
    assert.match(primitives, /export function Alert\(/);
    assert.match(primitives, /border-l-waiting/);
    assert.match(primitives, /<IconWarning/);
    assert.match(primitives, /<p className="font-semibold">\{title\}<\/p>/);
  });

  test('and it cannot say very much', () => {
    // The shape is the constraint: a title and one line. Anything that needs a
    // paragraph needs a definition somebody can open, and anything actionable
    // needs the action prop rather than a sentence describing the fix.
    assert.match(primitives, /action\?: React\.ReactNode;/);
    assert.match(primitives, /One line\. Not a paragraph/);
  });

  test('nobody hand-rolls one beside it', () => {
    // A tinted div with its own border and padding is the thing this replaced,
    // four times over, each slightly different from the others.
    // `hover:bg-stopped-tint` on an outline button is a hover state, not a
    // banner: the tint appears only under the cursor and the border is the
    // button's own.
    const rolled = [
      ...app.matchAll(/(?<!hover:)bg-(waiting|stopped|ok)-tint[^"]*\bborder\b(?!-l)/g),
    ].map((m) => m[0]);
    assert.deepEqual(
      rolled,
      [],
      'a tinted box is being built by hand again; use <Alert> or a border-l-2 accent',
    );
  });
});

describe('text on a tint uses the ink, not the accent', () => {
  test('a pill does', () => {
    // 11px on a tint is exactly the case the ink tier exists for.
    assert.match(primitives, /ok: "text-ok-ink bg-ok-tint"/);
    assert.match(primitives, /waiting: "text-waiting-ink bg-waiting-tint"/);
    assert.match(primitives, /stopped: "text-stopped-ink bg-stopped-tint"/);
  });

  test('and so does everything else that pairs the two', () => {
    // `text-waiting` beside `bg-waiting-tint` is the mistake, in one class list.
    for (const family of ['ok', 'waiting', 'stopped']) {
      const bad = new RegExp(
        `text-${family}\\b(?!-ink)[^"]*(?<!hover:)bg-${family}-tint` +
          `|(?<!hover:)bg-${family}-tint[^"]*text-${family}\\b(?!-ink)`,
        'g',
      );
      const hits = [...app.matchAll(bad)].map((m) => m[0]);
      assert.deepEqual(
        hits,
        [],
        `the accent is being used as text on its own tint: ${hits.join(' / ')}`,
      );
    }
  });
});

describe('a definition is a disclosure, not a hover', () => {
  test('Info exists and toggles', () => {
    // Half of this console is read on a phone, where there is no hover, and a
    // tooltip vanishes exactly when somebody wants to keep it open beside the
    // thing it defines.
    assert.match(primitives, /export function Info\(/);
    assert.match(primitives, /aria-expanded=\{open\}/);
    assert.match(primitives, /aria-controls=\{id\}/);
  });

  test('the two words that produced the question carry one', () => {
    // "Why does it show unverified" was asked about the review step, and the
    // answer was three paragraphs below it.
    const wizard = readFileSync(path.join(WEB, 'components', 'new-practice.tsx'), 'utf8');
    assert.match(wizard, /<Info term=\{<span className="text-waiting-ink">onboarding<\/span>\}>/);
    assert.match(wizard, /<Info term=\{<span className="text-muted-foreground">unverified<\/span>\}>/);
  });
});

describe('the review step is a review, not a briefing', () => {
  const wizard = readFileSync(path.join(WEB, 'components', 'new-practice.tsx'), 'utf8');
  const prose = wizard.replace(/\s+/g, ' ');

  test('the subtitle does not read as a threat', () => {
    // "There is no delete" is true and it is dread rather than guidance. The
    // review step is itself the safeguard; saying what is still changeable is
    // the useful half.
    assert.ok(!prose.includes('There is no delete'), 'the anxious subtitle is back');
    assert.match(prose, /Confirm the details below/);
  });

  test('the philosophy is gone from the transactional screen', () => {
    for (const gone of [
      'because the person hiring knows who they are hiring',
      'Creating a practice is not vouching for it',
      'would hand this practice, and every patient in it',
    ]) {
      assert.ok(!prose.includes(gone), `a documentation paragraph is back: "${gone}"`);
    }
  });

  test('and what is left below the summary is short', () => {
    // One sentence. It was ninety words in two paragraphs.
    const tail = prose.slice(prose.indexOf('The head doctor becomes the owner'));
    const sentence = tail.slice(0, tail.indexOf('</p>'));
    assert.ok(
      sentence.split(' ').length < 20,
      `the closing note has grown back to ${sentence.split(' ').length} words`,
    );
  });
});

describe('the decisions card ends in actions', () => {
  const page = readFileSync(path.join(WEB, 'app', 'practices', 'page.tsx'), 'utf8');

  test('the definitions moved onto the words they define', () => {
    const at = page.indexOf('<Panel title="Decisions">');
    assert.ok(at > 0, 'the Decisions panel changed shape');
    const panel = page.slice(at, page.indexOf('</Panel>', at));

    assert.match(panel, /<Info/);
    // The paragraph that used to sit above the buttons.
    assert.ok(
      !panel.includes('They are different facts, and neither implies the other.'),
      'the explanatory paragraph is back above the actions',
    );
  });

  test('the warning is one line with a way to fix it', () => {
    const at = page.indexOf('<Panel title="Decisions">');
    const panel = page.slice(at, page.indexOf('</Panel>', at));
    assert.match(panel, /<Alert\s+title="No registration number"/);
    assert.match(panel, /Add one/);
  });

  test('“Mark verified” is the filled button', () => {
    // It sat at the same weight as Reject and Suspend, so the safe action and
    // the two that stop a clinic working were equally easy to hit.
    const at = page.indexOf('Mark verified');
    const decl = page.lastIndexOf('<Action', at);
    assert.match(page.slice(decl, at), /primary/);
  });

  test('and the two that take something away are destructive', () => {
    for (const label of ['Reject', 'Suspend']) {
      const at = page.indexOf(`>\n                ${label}\n`);
      assert.ok(at > 0, `${label} moved`);
      assert.match(page.slice(page.lastIndexOf('<Action', at), at), /destructive/);
    }
  });
});
