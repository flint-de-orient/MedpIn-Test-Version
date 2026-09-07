import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Layout mistakes that render without erroring.
 *
 * ---- The one that got shipped -------------------------------------------
 *
 * The shell was `min-h-full`. That is a percentage, and a percentage height
 * resolves only when every ancestor has a resolved height — `body` had
 * `min-h-full` too, which is not one. So the shell measured itself against
 * nothing, stopped at its content, and left the sidebar and the footer floating
 * in the middle of the viewport with the page background below them.
 *
 * Nothing failed. TypeScript was happy, the build was clean, every test passed,
 * and the screen was obviously wrong to anybody who looked at it.
 *
 * `dvh` is the viewport directly and depends on no ancestor. It is also the
 * dynamic variant, so a phone's address bar sliding away does not leave a strip
 * of background at the bottom.
 */
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...files(full));
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

const sources = files(WEB).map((f) => ({
  rel: path.relative(WEB, f).replace(/\\/g, '/'),
  src: readFileSync(f, 'utf8'),
}));

const all = sources.map((s) => s.src).join('\n');

describe('height is measured against the viewport, not an ancestor', () => {
  test('nothing uses a percentage height utility', () => {
    const offenders = [];
    for (const { rel, src } of sources) {
      src.split('\n').forEach((line, i) => {
        // `h-full` on a leaf inside a sized flex parent is legitimate; these
        // are the two that need an unbroken chain to the root and silently
        // collapse without one.
        if (/\b(min-h-full|h-screen)\b/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 64)}`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      [
        '',
        'A height that needs a resolved ancestor chain:',
        '',
        ...offenders.map((o) => `  ${o}`),
        '',
        'Use min-h-dvh, which is the viewport and depends on nothing above it.',
        '`h-screen` is the static variant and leaves a strip of background under',
        'a phone address bar that has slid away.',
      ].join('\n'),
    );
  });

  test('the document root establishes it once', () => {
    const layout = sources.find((s) => s.rel === 'app/layout.tsx').src;
    assert.match(layout, /<body className="[^"]*min-h-dvh/);
    // And `h-full` is gone from <html>, where it was propping up the chain that
    // did not work anyway.
    assert.ok(!/<html[\s\S]{0,200}h-full/.test(layout), 'html still sets a percentage height');
  });

  test('and everything below it grows rather than re-measuring', () => {
    const shell = sources.find((s) => s.rel === 'components/shell.tsx').src;
    assert.match(shell, /<div className="flex flex-1">/);
    assert.match(shell, /<main className="[^"]*flex-1/);
  });
});

describe('nothing forces the page to scroll sideways', () => {
  /**
   * A wide child inside a container that cannot scroll pushes the whole
   * document, and then every screen scrolls horizontally rather than one
   * element doing it — which on a phone means the status column, the reason
   * anybody opened the register, is off the right-hand edge.
   */
  test('every table sits in a scrolling container', () => {
    const offenders = [];
    for (const { rel, src } of sources) {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        if (!/<table\b/.test(line)) return;
        // The wrapper is within a few lines above; a table is never its own
        // scroll container because the overflow has to be on the parent.
        const above = lines.slice(Math.max(0, i - 4), i).join('\n');
        if (!/overflow-x-auto/.test(above)) {
          offenders.push(`${rel}:${i + 1}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `a table can push the page: ${offenders.join(', ')}`);
  });

  test('every fixed minimum width wide enough to overflow a phone is contained', () => {
    // 22rem is 352px. A 390px screen minus the page padding leaves about 350,
    // so anything at or above this has to be inside something that scrolls.
    const offenders = [];
    for (const { rel, src } of sources) {
      const lines = src.split('\n');
      lines.forEach((line, i) => {
        const m = line.match(/min-w-\[(\d+(?:\.\d+)?)rem\]/);
        if (!m || Number(m[1]) < 22) return;
        const around = lines.slice(Math.max(0, i - 6), i + 3).join('\n');
        if (!/overflow-x-auto/.test(around)) {
          offenders.push(`${rel}:${i + 1}  min-w-[${m[1]}rem]`);
        }
      });
    }
    assert.deepEqual(
      offenders,
      [],
      `a fixed width can push the page:\n  ${offenders.join('\n  ')}`,
    );
  });
});

describe('the register is readable on a phone', () => {
  test('the table and the cards are a matched pair', () => {
    const reg = sources.find((s) => s.rel === 'components/practice-register.tsx').src;
    // One appears exactly where the other disappears. A gap between the two
    // breakpoints shows nothing at all, and an overlap shows both.
    assert.match(reg, /hidden overflow-x-auto md:block/);
    assert.match(reg, /divide-y md:hidden/);
  });

  test('and the status is on the card, not only in the table', () => {
    // It is the reason anybody opened the screen.
    const reg = sources.find((s) => s.rel === 'components/practice-register.tsx').src;
    const card = reg.slice(reg.indexOf('function Card('));
    assert.match(card, /statusTone\(p\.status\)/);
    assert.match(card, /verificationTone\(p\.verification\)/);
  });
});

describe('touch targets and motion', () => {
  test('reduced motion is honoured', () => {
    const css = readFileSync(new URL('../../web/src/app/globals.css', import.meta.url), 'utf8');
    assert.match(css, /prefers-reduced-motion: reduce/);
  });

  test('focus is visible', () => {
    const css = readFileSync(new URL('../../web/src/app/globals.css', import.meta.url), 'utf8');
    assert.match(css, /:focus-visible/);
    assert.match(css, /outline: 2px solid var\(--ring\)/);
  });

  test('every icon-only control names itself', () => {
    // An icon button with no text is a button a screen reader announces as
    // "button". The theme toggle, the bell, the drawer and its close are all
    // icon-only.
    const shell = sources.find((s) => s.rel === 'components/shell.tsx').src;
    const iconOnly = (shell.match(/<button/g) ?? []).length;
    const labelled = (shell.match(/aria-label=/g) ?? []).length;
    assert.ok(labelled >= 4, `only ${labelled} of ${iconOnly} buttons carry a label`);
  });
});

describe('the whole console, not one screen', () => {
  test('there are enough files here that the sweep means something', () => {
    assert.ok(sources.length >= 15, `only found ${sources.length} source files`);
    assert.ok(all.includes('grid-cols'), 'no responsive grid found at all');
  });
});
