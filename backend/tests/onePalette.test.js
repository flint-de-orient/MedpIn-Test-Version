import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The console and the phone app are one product, so they are one palette.
 *
 * ---- Why this is a test and not a comment -------------------------------
 *
 * Two files holding the same colours drift the moment somebody adjusts one. It
 * does not fail, it does not log, and nobody notices until a doctor and an
 * operator are looking at two blues that are almost the same — which reads as
 * carelessness far more loudly than a different blue would.
 *
 * So the console's tokens are the app's hex values verbatim, not converted.
 * A converted value has to be re-derived to check, and re-derivation is where
 * rounding creeps in.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const css = readFileSync(path.join(ROOT, 'web', 'src', 'app', 'globals.css'), 'utf8');

/** Every colour the Flutter theme defines. */
function appColours() {
  const dir = path.join(ROOT, 'mobile', 'lib', 'core', 'theme');
  const found = new Set();
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.dart'))) {
    const src = readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/0x(?:FF)?([0-9A-Fa-f]{6})\b/g)) {
      found.add(m[1].toLowerCase());
    }
  }
  return found;
}

/** Every colour the console's tokens use. */
function consoleColours() {
  const found = new Set();
  for (const m of css.matchAll(/--[a-z-]+:\s*#([0-9a-fA-F]{6})\b/g)) {
    found.add(m[1].toLowerCase());
  }
  return found;
}

describe('one palette, two front ends', () => {
  test('the console defines its colours as hex, not a conversion', () => {
    // OKLCH is a better colour space and the wrong choice here: a converted
    // value cannot be compared to the app's by eye or by this test.
    assert.ok(!css.includes('oklch('), 'a token was converted away from the app value');
    assert.ok(consoleColours().size >= 30, 'the token block looks truncated');
  });

  test('the brand blue is the app’s, in both themes', () => {
    const app = appColours();
    // AppColors.primary and AppColors.primaryDark.
    assert.ok(app.has('003399'), 'the app no longer defines 003399');
    assert.ok(app.has('4da3ff'), 'the app no longer defines 4DA3FF');
    assert.match(css, /--primary:\s*#003399/);
    assert.match(css, /--primary:\s*#4da3ff/i);
  });

  test('every console colour comes from the app', () => {
    /**
     * Pure black and white are not in the Dart file — Flutter writes them as
     * `Colors.white` — and a handful of shades exist only here: the chart ramp
     * between the two brand blues, and one border step for rows inside a table.
     * Each is derived from an app colour rather than introduced beside it.
     */
    const DERIVED = new Set([
      'ffffff', // Colors.white
      '000000',
      'cbd4de', // one step darker than outlineVariant, for in-table hairlines
      '1d6fd0', // chart ramp, between #003399 and #4DA3FF
      '6fbaff',
      '38a3a5',
      '5ec4c6',
      '7d8fa8',
      '8cc2ff', // accent-foreground on the dark accent tint
    ]);

    const app = appColours();
    const strays = [...consoleColours()].filter((c) => !app.has(c) && !DERIVED.has(c));

    assert.deepEqual(
      strays,
      [],
      [
        '',
        'The console uses colours the phone app does not define:',
        '',
        ...strays.map((c) => `  #${c}`),
        '',
        'Either take the value from mobile/lib/core/theme/, or add it to DERIVED',
        'above with a line saying which app colour it comes from. Two palettes',
        'that are almost the same read as carelessness; one different colour',
        'reads as a decision.',
      ].join('\n'),
    );
  });

  test('and the derived list stays short', () => {
    // Nine. It is the escape hatch, and an escape hatch nobody counts becomes
    // the second palette this test exists to prevent.
    assert.ok(css.length > 0);
    const app = appColours();
    const derivedInUse = [...consoleColours()].filter((c) => !app.has(c));
    assert.ok(
      derivedInUse.length <= 9,
      `${derivedInUse.length} colours are not the app's: ${derivedInUse.join(', ')}`,
    );
  });
});
