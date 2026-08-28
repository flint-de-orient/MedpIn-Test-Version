import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

import { meanLuminance, needsDarkChip } from '../src/services/logoLuminance.js';

/** A solid square of one colour, as a PNG. */
function swatch({ r, g, b, alpha = 255, size = 64 }) {
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r, g, b, alpha } },
  })
    .png()
    .toBuffer();
}

test('reads black and white at the ends of the range', async () => {
  assert.ok((await meanLuminance(await swatch({ r: 0, g: 0, b: 0 }))) < 0.02);
  assert.ok((await meanLuminance(await swatch({ r: 255, g: 255, b: 255 }))) > 0.98);
});

test('a white mark is flagged as needing a dark ground', async () => {
  // The case this exists for: artwork drawn for a dark letterhead, which would
  // otherwise be invisible on the app's white cards.
  assert.equal(await needsDarkChip(await swatch({ r: 255, g: 255, b: 255 })), true);
  assert.equal(await needsDarkChip(await swatch({ r: 235, g: 238, b: 240 })), true);
});

test("the clinic's own teal does not get a chip", async () => {
  // #1B6B8C — dark enough to read on white, so leaving it alone is correct.
  assert.equal(await needsDarkChip(await swatch({ r: 27, g: 107, b: 140 })), false);
});

test('fully transparent pixels are not counted as artwork', async () => {
  // A transparent PNG averaged naively reads as black, which would tell every
  // clinic with a cut-out logo that it is dark artwork.
  const clear = await swatch({ r: 0, g: 0, b: 0, alpha: 0 });
  assert.equal(await meanLuminance(clear), null);
  assert.equal(await needsDarkChip(clear), false);
});

test('green weighs more than blue, as the eye sees it', async () => {
  // Rec. 709, not a flat mean: pure green must read as far brighter than pure
  // blue, or a teal mark is judged darker than it looks.
  const green = await meanLuminance(await swatch({ r: 0, g: 255, b: 0 }));
  const blue = await meanLuminance(await swatch({ r: 0, g: 0, b: 255 }));
  assert.ok(green > blue * 5, `green ${green} should dominate blue ${blue}`);
});
