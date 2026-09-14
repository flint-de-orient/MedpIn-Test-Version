import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

import { removeFlatBackground } from '../src/services/logoBackground.js';

/**
 * The upload path refused every clinic logo with
 *
 *   `clinic_logo` is not a valid enum value for path `kind`
 *
 * because the route's zod enum and the model's mongoose enum were two separate
 * lists, and only one of them learned about clinic logos. The route validated
 * the request happily and the save then failed — so the error surfaced as a
 * red toast on a screen with no obvious connection to a model file.
 *
 * The first test below is the guard for that whole class: any upload kind the
 * API accepts must be a kind the database can store.
 */
describe('every kind the route accepts, the model can store', () => {
  const route = readFileSync(new URL('../src/routes/uploads.js', import.meta.url), 'utf8');
  const model = readFileSync(new URL('../src/models/MediaAsset.js', import.meta.url), 'utf8');

  const kinds = (src, from) => {
    const at = src.indexOf(from);
    assert.notEqual(at, -1, `could not find ${from}`);
    const block = src.slice(at, src.indexOf(']', at));
    return new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
  };

  test('the zod enum is a subset of the mongoose enum', () => {
    const accepted = kinds(route, 'kind: z.enum([');
    const storable = kinds(model, 'enum: [');
    assert.ok(accepted.size > 3, 'did not parse the route enum');

    const orphans = [...accepted].filter((k) => !storable.has(k));
    assert.deepEqual(
      orphans,
      [],
      `these kinds are accepted by the API but cannot be saved: ${orphans.join(', ')}`,
    );
  });

  test('clinic_logo in particular', () => {
    assert.ok(kinds(model, 'enum: [').has('clinic_logo'));
  });
});

/** A `size` square of `bg`, with a `fg` square centred in it. */
async function onGround(bg, fg, size = 120) {
  const inner = Math.round(size / 3);
  const mark = await sharp({
    create: { width: inner, height: inner, channels: 3, background: fg },
  })
    .png()
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 3, background: bg } })
    .composite([{ input: mark, gravity: 'centre' }])
    .png()
    .toBuffer();
}

const alphaAt = async (buffer, x, y) => {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return data[(y * info.width + x) * info.channels + 3];
};

describe('removing the ground behind a logo', () => {
  test('a mark on white loses the white', async () => {
    const input = await onGround({ r: 255, g: 255, b: 255 }, { r: 27, g: 107, b: 140 });
    const out = await removeFlatBackground(input);

    assert.equal(out.changed, true);
    // Trimmed down to the mark itself, so what is left is opaque throughout.
    const meta = await sharp(out.buffer).metadata();
    assert.ok(meta.width < 120, 'the transparent margin was not trimmed');
    assert.equal(await alphaAt(out.buffer, 1, 1), 255);
  });

  test('a mark on black loses the black', async () => {
    // The clinic supplied exactly this: teal artwork on a black rectangle.
    const input = await onGround({ r: 0, g: 0, b: 0 }, { r: 27, g: 107, b: 140 });
    const out = await removeFlatBackground(input);

    assert.equal(out.changed, true);
    const meta = await sharp(out.buffer).metadata();
    assert.ok(meta.width < 120);
  });

  test('white enclosed by the mark survives', async () => {
    // The failure that makes "delete every white pixel" unusable: this logo has
    // white inside the letterforms, and a global knockout punches through them.
    const ring = await sharp({
      create: { width: 120, height: 120, channels: 3, background: { r: 255, g: 255, b: 255 } },
    })
      .composite([
        {
          input: await sharp({
            create: { width: 80, height: 80, channels: 3, background: { r: 27, g: 107, b: 140 } },
          })
            .png()
            .toBuffer(),
          gravity: 'centre',
        },
        {
          // The hole in the middle of the mark — same white as the ground, but
          // not connected to the border.
          input: await sharp({
            create: { width: 20, height: 20, channels: 3, background: { r: 255, g: 255, b: 255 } },
          })
            .png()
            .toBuffer(),
          gravity: 'centre',
        },
      ])
      .png()
      .toBuffer();

    const out = await removeFlatBackground(ring);
    assert.equal(out.changed, true);

    // After trimming, the result is the 80px mark. Its centre is the enclosed
    // white, and it must still be opaque.
    const meta = await sharp(out.buffer).metadata();
    const mid = Math.floor(meta.width / 2);
    assert.equal(await alphaAt(out.buffer, mid, mid), 255, 'the enclosed white was eaten');
  });

  test('artwork that is already cut out is left alone', async () => {
    const transparent = await sharp({
      create: { width: 60, height: 60, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();

    const out = await removeFlatBackground(transparent);
    assert.equal(out.changed, false);
    assert.equal(out.buffer, transparent, 'the original bytes were not returned');
  });

  test('a full-bleed design is left alone', () => {
    // No flat border means no ground to remove. Acting here would delete part
    // of the design.
    return sharp({
      create: { width: 80, height: 80, channels: 3, background: { r: 27, g: 107, b: 140 } },
    })
      .png()
      .toBuffer()
      .then(async (solid) => {
        const out = await removeFlatBackground(solid);
        assert.equal(out.changed, false);
      });
  });

  test('a corrupt file is returned unchanged rather than thrown', async () => {
    const junk = Buffer.from('not an image at all');
    const out = await removeFlatBackground(junk);
    assert.equal(out.changed, false);
    assert.equal(out.buffer, junk);
  });
});

describe('the clinic logo is readable by the people it is for', () => {
  const route = readFileSync(new URL('../src/routes/uploads.js', import.meta.url), 'utf8');

  test('a patient may fetch it', () => {
    // Asset reads are the owner's and their practice's. A clinic logo is owned by the doctor
    // who uploaded it, is in nobody's chat thread and is not an avatar, so
    // every one of those doors is shut to a patient — and the patient's app is
    // the one that most needs to say whose clinic this is.
    const guard = route.slice(
      route.indexOf("'/:id/raw'"),
      route.indexOf('router.delete('),
    );
    assert.ok(guard.length > 0, 'could not find the raw-read guard');
    assert.match(guard, /Clinic\.exists/);
    assert.match(guard, /logoLightAssetId/);
  });

  test('and it is matched on publication, not on a claimed kind', () => {
    // `kind` is what an uploader asked for. Whether a clinic actually uses the
    // asset as its logo is a fact about the clinic.
    const code = route
      .slice(
        route.indexOf("'/:id/raw'"),
        route.indexOf('router.delete('),
      )
      .split(/\r?\n/)
      // The comment above the guard discusses the rejected approach by name,
      // so a naive search finds the prose rather than the code.
      .filter((l) => !l.trim().startsWith('//'))
      .join(' ');
    assert.ok(!/kind === .clinic_logo./.test(code));
  });
});
