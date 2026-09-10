import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * What this console puts on screen, measured against what is behind it.
 *
 * ---- Five of these shipped ----------------------------------------------
 *
 * Every one was an opacity modifier reaching for a step below the palette's
 * quietest grey, and every one passed review because it looked deliberate:
 *
 *   text-muted-foreground/40  on three chevrons        1.80:1
 *   text-muted-foreground/70  on an 11px form hint     3.24:1
 *   opacity-60                on the filter counts     2.65:1
 *   text-waiting              on "450 / 500"           3.19:1
 *   text-waiting              on "already at 12"       3.19:1
 *
 * The palette has three greys and `--muted-foreground` is the quiet one, at
 * 5.96:1 on the worst ground in either theme. Anything under it is not a
 * quieter grey — it is the same grey, unreadable. The last two are the same
 * mistake in the semantic trio: `--waiting` is an accent, tuned for 3:1 as a
 * bar or an icon, and it was carrying words.
 *
 * Both themes, because a value that works on #f8fafc rarely works on #141719
 * and nobody checks the one they are not looking at.
 */

const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));
const CSS = readFileSync(path.join(WEB, 'app/globals.css'), 'utf8');

/* ------------------------------------------------------------------ colour */

function blockAfter(marker) {
  const i = CSS.indexOf(marker);
  assert.ok(i > 0, `globals.css has no ${marker} block`);
  let depth = 0;
  for (let j = i; j < CSS.length; j += 1) {
    if (CSS[j] === '{') depth += 1;
    else if (CSS[j] === '}') {
      depth -= 1;
      if (depth === 0) return CSS.slice(i, j + 1);
    }
  }
  throw new Error(`unterminated ${marker}`);
}

/** `#aabbcc` and `rgb(1 2 3 / 0.08)` both become [r, g, b, a]. */
function tokensIn(block) {
  const out = new Map();
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const raw = m[2].trim();
    const hex = /^#([0-9a-fA-F]{6})$/.exec(raw);
    if (hex) {
      const n = parseInt(hex[1], 16);
      out.set(m[1], [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1]);
      continue;
    }
    const rgba = /^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)\s*\/\s*([\d.]+)\s*\)$/.exec(raw);
    if (rgba) out.set(m[1], [+rgba[1], +rgba[2], +rgba[3], +rgba[4]]);
  }
  return out;
}

const LIGHT = tokensIn(blockAfter(':root {'));
const DARK_ONLY = tokensIn(blockAfter('.dark {'));
/// Dark redefines colours and inherits the rest, exactly as the cascade does.
const DARK = new Map([...LIGHT, ...DARK_ONLY]);

/** sRGB relative luminance, WCAG 2.1. */
function luminance([r, g, b]) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** src over dst. A ratio against a translucent colour is meaningless. */
function flatten(src, dst, extraAlpha = 1) {
  const a = src[3] * extraAlpha;
  if (a >= 1) return src;
  return [0, 1, 2].map((i) => Math.round(src[i] * a + dst[i] * (1 - a)));
}

function ratio(fg, bg) {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ------------------------------------------------------------------- source */

/**
 * Comments blanked, offsets kept.
 *
 * This file explains itself at length, and a comment saying why `opacity-90`
 * was removed is not an `opacity-90`. Replaced with spaces rather than
 * deleted so every index still points where it did — the class expressions
 * and string literals below are located by offset.
 */
function withoutComments(body) {
  return body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

function sourceUnder(dir) {
  const files = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...sourceUnder(full));
    else if (/\.tsx?$/.test(name)) {
      files.push([full, withoutComments(readFileSync(full, 'utf8'))]);
    }
  }
  return files;
}

const FILES = sourceUnder(WEB);
const rel = (f) => path.relative(WEB, f).replace(/\\/g, '/');

/* ------------------------------------------------------------------- checks */

/**
 * The canvases. Anything drawn in this console is on one of these.
 *
 * A surface an element paints for itself — a chip's fill, a hover row, an
 * alert's tint — is read out of the same class expression as the ink and added
 * to this list for that one use. Checking every ink against every surface
 * instead reported an amber icon against the darkest hover in the console, on
 * a row it has never been drawn on, at 2.91:1 against a 3:1 threshold. A test
 * that fails on a pairing the code cannot produce is a test that gets an
 * exemption written for it, and the exemption is what rots.
 */
const GROUNDS = [
  ['--background', 'the page'],
  ['--card', 'a card'],
  ['--popover', 'a popover'],
  ['--sidebar', 'the sidebar'],
];

/** `bg-secondary/60`, `bg-waiting-tint` — what an element paints under itself. */
const OWN_FILL = /\bbg-([a-z][\w-]*?)(?:\/(\d{1,3}))?(?=["'\s`])/g;

/**
 * Inks that live on a filled surface and nowhere else.
 *
 * Checking `text-primary-foreground` against the page would report 1.03:1 for
 * a colour that only ever appears on `bg-primary`. Each is pinned to what it
 * actually sits on rather than measured against a ground it never touches.
 */
const ON_FILL = new Map([
  ['--primary-foreground', '--primary'],
  ['--accent-foreground', '--accent'],
  ['--secondary-foreground', '--secondary'],
  ['--destructive-foreground', '--destructive'],
  ['--sidebar-primary-foreground', '--sidebar-primary'],
  ['--sidebar-accent-foreground', '--sidebar-accent'],
  ['--card-foreground', '--card'],
  ['--popover-foreground', '--popover'],
  ['--background', '--foreground'],
  ['--ok-ink', '--ok-tint'],
  ['--waiting-ink', '--waiting-tint'],
  ['--stopped-ink', '--stopped-tint'],
]);

/** Names after `text-` that size or align rather than colour. */
const NOT_A_COLOUR =
  /^(left|right|center|start|end|justify|wrap|nowrap|balance|pretty|ellipsis|clip|transparent|current|inherit|micro|caption|body|title|heading|display|metric|xs|sm|base|lg|xl|\dxl)$/;

const INK = /\btext-([a-z][\w-]*?)(?:\/(\d{1,3}))?(?=["'\s`])/g;
const DIMMED_INK = /\btext-([a-z][\w-]*?)\/(\d{1,3})(?=["'\s`])/g;
const BARE_OPACITY = /(?:^|[\s"'`])(opacity-\d{1,3})(?=["'\s`])/gm;

/**
 * Every class expression in a file, so a colour is judged by what it paints
 * rather than on its own.
 *
 * WCAG asks 4.5:1 of words, and 3:1 of large text and of anything non-text
 * that carries meaning — an icon, a bar, a status dot. Holding a 16px warning
 * triangle to the text threshold would be a failing test about a passing icon,
 * and a test that is wrong in the safe direction still gets switched off.
 */
const CLASS_EXPR = /className=(?:"([^"]*)"|\{cn\(([\s\S]*?)\)\})/g;
const TEXT_SIZE = /\btext-(micro|caption|body|title|heading|display|metric)\b/;
const LARGE = /\btext-(display|metric)\b/;
const SIZED = /\bsize-[\d.]+\b/;

/** 4.5 for words; 3 for a mark, or for text large enough to count as one. */
function requiredRatio(context) {
  if (!context) return 4.5;
  if (LARGE.test(context)) return 3;
  if (SIZED.test(context) && !TEXT_SIZE.test(context)) return 3;
  return 4.5;
}

/** Every `text-<colour>` the console asks for, and where. */
function inkUses() {
  const uses = [];
  for (const [file, body] of FILES) {
    // Where each class expression starts and ends, so a match can be placed
    // inside one. A colour outside every className — a tone map, a constant —
    // is held to the text threshold, which is the safe assumption when there
    // is nothing to read the intent from.
    const spans = [];
    for (const m of body.matchAll(CLASS_EXPR)) {
      spans.push([m.index, m.index + m[0].length, m[1] ?? m[2] ?? '']);
    }

    /// Every quoted run of classes, which is the unit that applies together.
    const literals = [];
    for (const m of body.matchAll(/"([^"\n]*)"/g)) {
      literals.push([m.index, m.index + m[0].length, m[1]]);
    }

    for (const m of body.matchAll(INK)) {
      if (NOT_A_COLOUR.test(m[1])) continue;
      const token = `--${m[1]}`;
      if (!DARK.has(token)) continue;
      const span = spans.find(([from, to]) => m.index >= from && m.index < to);
      const context = span?.[2] ?? '';

      /*
       * What this element paints under itself — the hover it lifts to, the
       * tint it sits in.
       *
       * Read from the string literal holding the ink, not from the whole
       * expression. `cn(base, done ? "bg-primary text-primary-foreground" :
       * "bg-muted text-muted-foreground")` puts two fills and two inks in one
       * expression, and only one pairing of each happens; taking the
       * expression reported `text-primary-foreground` on `bg-muted` at 1.06:1,
       * a combination the ternary cannot produce. Classes that apply together
       * are written together.
       */
      const literal = literals.find(([from, to]) => m.index >= from && m.index < to);
      const own = [];
      for (const f of (literal?.[2] ?? '').matchAll(OWN_FILL)) {
        const fillToken = `--${f[1]}`;
        if (!DARK.has(fillToken)) continue;
        own.push([fillToken, f[2] ? Number(f[2]) / 100 : 1, `bg-${f[1]}${f[2] ? `/${f[2]}` : ''}`]);
      }

      uses.push({
        file,
        token,
        alpha: m[2] ? Number(m[2]) / 100 : 1,
        needs: requiredRatio(context),
        own,
      });
    }
  }
  return uses;
}

const USES = inkUses();

describe('the console is readable in both themes', () => {
  test('the scan found the colours it is meant to be reading', () => {
    // Every assertion below passes on an empty list. This is the one that says
    // the parse still matches the file it is meant to be reading.
    assert.ok(LIGHT.size >= 40, `only ${LIGHT.size} light tokens parsed`);
    assert.ok(DARK_ONLY.size >= 40, `only ${DARK_ONLY.size} dark tokens parsed`);
    assert.ok(USES.length >= 40, `only ${USES.length} text colours found; the scan is broken`);
    assert.ok(
      USES.some((u) => u.token === '--muted-foreground'),
      'the commonest ink in the console was not found',
    );

    /*
     * And the classification has not collapsed.
     *
     * `requiredRatio` reading its context wrongly would relax every colour in
     * the console to 3:1 and the suite would go green — a test that passes
     * because it stopped asking. Most of what this console draws is words, so
     * most of what is measured has to be held to 4.5.
     */
    const words = USES.filter((u) => u.needs === 4.5).length;
    const marks = USES.filter((u) => u.needs === 3).length;
    assert.ok(words > marks, `${words} held to 4.5:1 against ${marks} at 3:1 — the reader broke`);
    assert.ok(marks >= 3, 'no icon or large-text use found; the context reader matches nothing');
  });

  test('every colour defined for light is defined for dark', () => {
    // A colour defined once keeps its light value on a dark ground, which is
    // the failure that looks like a hole in the screen. `--radius` is the one
    // token that should not move: a corner is not lighter at night.
    const missing = [...LIGHT.keys()].filter((t) => !DARK_ONLY.has(t) && t !== '--radius');
    assert.deepEqual(missing, [], `light-only colours: ${missing.join(', ')}`);
  });

  for (const [theme, map] of [
    ['light', LIGHT],
    ['dark', DARK],
  ]) {
    test(`every ink clears its threshold on every ground it can sit on — ${theme}`, () => {
      const failures = new Set();

      for (const { file, token, alpha, needs, own } of USES) {
        const ink = map.get(token);
        if (!ink) continue;

        /*
         * What this ink can be on: the canvases, plus anything its own element
         * paints. An ink that only exists on a fill — an alert's tone map, a
         * button's label — is checked against that fill alone, because the
         * page behind it is a ground it never touches.
         */
        const grounds = own.length
          ? own.map(([t, a, label]) => [t, a, label])
          : ON_FILL.has(token)
            ? [[ON_FILL.get(token), 1, ON_FILL.get(token).slice(2)]]
            : GROUNDS.map(([t, label]) => [t, 1, label]);

        for (const [groundToken, groundAlpha, where] of grounds) {
          const rawGround = map.get(groundToken);
          if (!rawGround) continue;
          // A tint or a hover is translucent: it lies on a card before
          // anything lies on it.
          const ground = flatten(
            [rawGround[0], rawGround[1], rawGround[2], rawGround[3] * groundAlpha],
            map.get('--card'),
          );
          const r = ratio(flatten(ink, ground, alpha), ground);
          if (r < needs) {
            const name = `text-${token.slice(2)}${alpha < 1 ? `/${alpha * 100}` : ''}`;
            failures.add(
              `  ${r.toFixed(2)}:1 (needs ${needs}:1)  ${name} on ${where} — ${rel(file)}`,
            );
          }
        }
      }

      assert.deepEqual(
        [...failures].sort(),
        [],
        `\nunder threshold in ${theme}:\n${[...failures].sort().join('\n')}\n`,
      );
    });
  }

  test('and no colour is written outside the palette', () => {
    /*
     * How a 2.77:1 button went unmeasured for months.
     *
     * The confirm button on "Suspend this practice" was `bg-stopped
     * text-white`. Everything above reads tokens, and `white` is not one, so
     * the pair was never looked at: `--stopped` is #f87171 in dark, and white
     * on it is 2.77:1 — the least readable thing in the console, on its most
     * consequential button, in the theme half of people use.
     *
     * A literal cannot be theme-aware. That is the whole objection: whatever
     * it reads against in one theme, it reads against the opposite in the
     * other, and only one of those was ever looked at.
     */
    const literals = new Set();
    for (const [file, body] of FILES) {
      for (const m of body.matchAll(
        /\b(?:text|bg|border|fill|stroke|ring|from|via|to)-(white|black|\[#[0-9a-fA-F]{3,8}\]|\[rgb[^\]]*\])/g,
      )) {
        literals.add(`  ${m[0]} — ${rel(file)}`);
      }
    }
    assert.deepEqual(
      [...literals].sort(),
      [],
      `\ncolour written outside the palette:\n${[...literals].sort().join('\n')}\n` +
        `\nA literal cannot change with the theme, so half its uses are never measured.\n`,
    );
  });

  test('and nothing dims an ink below the palette floor', () => {
    /*
     * The ratchet, and the reason this file exists.
     *
     * The checks above measure what is there; this one refuses the move that
     * produced every failure they have ever caught. `--muted-foreground` is the
     * quietest grey the palette has. `text-muted-foreground/70` is not a
     * quieter grey — it is the same grey at 3.2:1, which is a grey nobody with
     * the screen at half brightness can read.
     *
     * A bare `opacity-*` does the same thing without naming a colour, so it is
     * caught by shape rather than by value: there is nothing to measure until
     * it is rendered. `disabled:opacity-*` and `group-hover:opacity-*` are
     * states rather than colour choices — a control that cannot be used should
     * read as unavailable — so only the unconditional form is refused.
     */
    const dimmed = new Set();
    for (const [file, body] of FILES) {
      for (const m of body.matchAll(DIMMED_INK)) {
        if (NOT_A_COLOUR.test(m[1])) continue;
        if (!DARK.has(`--${m[1]}`)) continue;
        dimmed.add(`  text-${m[1]}/${m[2]} — ${rel(file)}`);
      }
      for (const m of body.matchAll(BARE_OPACITY)) {
        dimmed.add(`  ${m[1]} — ${rel(file)}`);
      }
    }

    assert.deepEqual(
      [...dimmed].sort(),
      [],
      `\nink dimmed below the palette's own floor:\n${[...dimmed].sort().join('\n')}\n` +
        `\nUse the token itself, or carry the hierarchy with weight and size.\n`,
    );
  });
});
