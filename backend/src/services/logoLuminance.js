import sharp from 'sharp';

/**
 * Whether a logo was drawn for a dark background.
 *
 * The app renders on light surfaces only. A mark drawn in white or pale grey
 * for a dark letterhead disappears on a white card, and the obvious remedy —
 * inverting it — is worse than the disease: inversion is a per-channel
 * complement, so this clinic's teal (#1B6B8C) comes back as a muddy orange.
 * The brand is the one thing a logo carries; a legible logo in the wrong colour
 * has failed at its only job.
 *
 * So the artwork is never altered. It is measured, and a mark that needs a dark
 * ground is given one: the app paints it on a dark rounded chip. Colours
 * survive, contrast is correct, and nothing about the file changes.
 *
 * The measurement only considers pixels that are actually part of the mark —
 * fully transparent ones are background, and averaging them in would make every
 * transparent PNG look dark.
 */

/** Below this, a pixel counts as transparent and is not part of the artwork. */
const ALPHA_FLOOR = 32;

/**
 * Mean perceived luminance of the visible pixels, 0 (black) to 1 (white),
 * or null when there is nothing solid enough to judge.
 */
export async function meanLuminance(buffer) {
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    // Small enough to be quick, large enough to be representative. This is a
    // measurement, not a rendering.
    .resize(64, 64, { fit: 'inside' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels;
  let total = 0;
  let counted = 0;

  for (let i = 0; i < data.length; i += channels) {
    const alpha = channels === 4 ? data[i + 3] : 255;
    if (alpha < ALPHA_FLOOR) continue;
    // Rec. 709 luma: the eye is far more sensitive to green than to blue, and a
    // flat mean would call this clinic's teal darker than it looks.
    const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
    total += luma;
    counted += 1;
  }

  if (counted === 0) return null;
  return total / counted / 255;
}

/**
 * True when the artwork is light enough that it needs a dark ground.
 *
 * The threshold is deliberately high. Getting it wrong in one direction puts a
 * dark chip behind a logo that did not need one — visible, a bit odd, harmless.
 * Getting it wrong in the other direction leaves a white mark on a white card,
 * which is a clinic whose logo has vanished. So the benefit of the doubt goes
 * to legibility.
 */
export async function needsDarkChip(buffer) {
  const luma = await meanLuminance(buffer);
  if (luma == null) return false;
  return luma >= 0.62;
}
