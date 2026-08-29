import sharp from 'sharp';

/**
 * Knocks the flat ground out from behind a logo.
 *
 * Clinic artwork almost never arrives as a cut-out. What a clinic has is
 * whatever the printer or the signboard designer sent: the mark on a white
 * rectangle, or the same mark on a black one. Dropped onto a card as-is, the
 * white version lands as a visible box and the black one as a slab — and on a
 * prescription letterhead that box is the first thing a patient sees.
 *
 * Asking the doctor to supply a transparent PNG is not a solution. They have
 * the file they have, and "a PNG with a transparent background works best" is
 * advice, not a feature.
 *
 * ---- Why a flood fill and not "delete every white pixel" -------------------
 *
 * Deleting every pixel that matches the ground destroys the mark. This clinic's
 * logo has white inside the letterforms and a white gap inside the triangle;
 * a global knockout punches holes through all of it. The ground is not "the
 * colour white" — it is *the region connected to the edge of the image*. So the
 * fill starts from the border and spreads inward, and stops the moment it meets
 * ink. Enclosed white stays white.
 *
 * ---- Why it can decline to act --------------------------------------------
 *
 * Every guess here is reversible except a wrong one. Three refusals:
 *
 *  - artwork that already has transparency is left exactly alone; someone who
 *    supplied a cut-out has already answered this question,
 *  - a border that is not one flat colour means there is no ground to remove —
 *    a photograph, a gradient, a full-bleed design,
 *  - a fill that swallows almost everything means the tolerance caught the mark
 *    itself, and the original is kept instead.
 *
 * Refusing leaves the clinic exactly where it was: a logo with a visible box,
 * which is a cosmetic problem. Acting wrongly deletes the logo, which is not.
 */

/** A pixel at or above this alpha is opaque enough to count as artwork. */
const ALPHA_FLOOR = 32;

/**
 * How far a pixel may sit from the sampled ground and still count as ground.
 *
 * Per-channel, 0–255. Generous enough for JPEG ringing and the soft edge a
 * scanner leaves around a mark, tight enough that a pale grey element inside
 * the design is not mistaken for the paper behind it.
 */
const TOLERANCE = 26;

/** The border must be this uniform before there is a ground worth removing. */
const BORDER_AGREEMENT = 0.9;

/** Below this share removed, there was no real ground; above it, we ate the mark. */
const MIN_REMOVED = 0.02;
const MAX_REMOVED = 0.97;

/** True when any pixel is meaningfully transparent already. */
function hasTransparency(data, channels) {
  if (channels < 4) return false;
  for (let i = 3; i < data.length; i += channels) {
    if (data[i] < 255 - ALPHA_FLOOR) return true;
  }
  return false;
}

/**
 * The colour the border agrees on, or null when it does not agree.
 *
 * The median of the border is used rather than one corner: a single corner can
 * be a stray dark pixel or a compression artefact, and one bad sample would
 * either remove nothing or remove the wrong thing.
 */
function sampleGround(data, width, height, channels) {
  const reds = [];
  const greens = [];
  const blues = [];

  const push = (x, y) => {
    const i = (y * width + x) * channels;
    reds.push(data[i]);
    greens.push(data[i + 1]);
    blues.push(data[i + 2]);
  };

  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 1; y < height - 1; y += 1) {
    push(0, y);
    push(width - 1, y);
  }

  const median = (xs) => {
    const sorted = [...xs].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const ground = [median(reds), median(greens), median(blues)];

  // How much of the border actually sits at that colour. A photograph's border
  // has a median too; it just does not agree with itself.
  let agreeing = 0;
  for (let k = 0; k < reds.length; k += 1) {
    if (
      Math.abs(reds[k] - ground[0]) <= TOLERANCE &&
      Math.abs(greens[k] - ground[1]) <= TOLERANCE &&
      Math.abs(blues[k] - ground[2]) <= TOLERANCE
    ) {
      agreeing += 1;
    }
  }

  return agreeing / reds.length >= BORDER_AGREEMENT ? ground : null;
}

/**
 * Removes the flat background from `buffer`, or returns it unchanged.
 *
 * Always resolves — a logo that fails to process is a logo with a box behind
 * it, and that is not worth failing an upload over.
 *
 * @returns {Promise<{buffer: Buffer, changed: boolean}>}
 */
export async function removeFlatBackground(buffer) {
  try {
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const { width, height, channels } = info;
    if (!width || !height) return { buffer, changed: false };

    // Someone who supplied a cut-out has already answered this question.
    if (hasTransparency(data, channels)) return { buffer, changed: false };

    const ground = sampleGround(data, width, height, channels);
    if (!ground) return { buffer, changed: false };

    // Flood fill inward from every border pixel. An explicit stack rather than
    // recursion: a 1200x1200 logo is 1.4M pixels and a recursive fill would
    // blow the call stack on the first large upload.
    const total = width * height;
    const clear = new Uint8Array(total);
    const stack = new Int32Array(total);
    let top = 0;

    const matches = (idx) => {
      const i = idx * channels;
      return (
        Math.abs(data[i] - ground[0]) <= TOLERANCE &&
        Math.abs(data[i + 1] - ground[1]) <= TOLERANCE &&
        Math.abs(data[i + 2] - ground[2]) <= TOLERANCE
      );
    };

    const seed = (idx) => {
      if (clear[idx] || !matches(idx)) return;
      clear[idx] = 1;
      stack[top] = idx;
      top += 1;
    };

    for (let x = 0; x < width; x += 1) {
      seed(x);
      seed((height - 1) * width + x);
    }
    for (let y = 0; y < height; y += 1) {
      seed(y * width);
      seed(y * width + width - 1);
    }

    let removed = top;
    while (top > 0) {
      top -= 1;
      const idx = stack[top];
      const x = idx % width;
      const y = (idx - x) / width;

      const spread = (nx, ny) => {
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
        const n = ny * width + nx;
        if (clear[n] || !matches(n)) return;
        clear[n] = 1;
        stack[top] = n;
        top += 1;
        removed += 1;
      };

      spread(x - 1, y);
      spread(x + 1, y);
      spread(x, y - 1);
      spread(x, y + 1);
    }

    const share = removed / total;
    if (share < MIN_REMOVED || share > MAX_REMOVED) {
      return { buffer, changed: false };
    }

    for (let idx = 0; idx < total; idx += 1) {
      if (clear[idx]) data[idx * channels + 3] = 0;
    }

    // Trim what is now a transparent margin, so the stored mark fills its box
    // instead of floating in the middle of the rectangle it was drawn on.
    const cut = await sharp(data, { raw: { width, height, channels } })
      .png()
      .toBuffer();
    const trimmed = await sharp(cut)
      .trim({ threshold: 1 })
      .png()
      .toBuffer()
      .catch(() => cut);

    return { buffer: trimmed, changed: true };
  } catch {
    // Any failure here means the logo keeps its background. Visible, and
    // entirely survivable — unlike refusing the upload.
    return { buffer, changed: false };
  }
}
