import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

import { boot, shutdown } from './helpers/httpHarness.js';
import { brandForCheckout } from '../src/routes/brand.js';
import { env } from '../src/config/env.js';

/**
 * Who the customer thinks they are paying.
 *
 * Checkout was showing them the Razorpay account holder's personal name,
 * because the hosted page prints that and takes no override. The SDK takes a
 * `name` and an `image`, and both come from here rather than from a constant in
 * the app — a wrong logo on a payment sheet should be fixed by a deploy, not by
 * an app release, an install and a version gate on every handset.
 */

const MARK = new URL('../src/assets/medpin-mark.png', import.meta.url);

describe('the mark itself', () => {
  test('the file the route serves actually exists', () => {
    // A route that sendFile()s a missing path answers 500 on a payment screen,
    // which reads as a broken checkout rather than a missing asset.
    assert.ok(existsSync(MARK), 'src/assets/medpin-mark.png is not in the tree');
  });

  test('and it is a PNG', () => {
    const magic = readFileSync(MARK).subarray(0, 8);
    assert.deepEqual([...magic], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test('square, because the badge that holds it is', () => {
    // Razorpay draws this in a square. A 700x256 wordmark dropped in there is
    // letterboxed to illegibility, which is how the emblem came to be used
    // rather than the logo.
    const buf = readFileSync(MARK);
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    assert.equal(width, height, `the mark is ${width}x${height}, not square`);
    assert.ok(width >= 256, `${width}px is small for a checkout badge`);
  });

  test('and small enough to load on a bad connection', () => {
    // It is fetched while somebody is waiting to type a card number.
    const bytes = readFileSync(MARK).length;
    assert.ok(bytes < 200_000, `the mark is ${bytes} bytes`);
  });
});

describe('what the client is told', () => {
  let realOrigin;
  let realName;

  before(async () => {
    await boot();
    realOrigin = env.PUBLIC_API_ORIGIN;
    realName = env.BRAND_NAME;
  });

  after(async () => {
    env.PUBLIC_API_ORIGIN = realOrigin;
    env.BRAND_NAME = realName;
    await shutdown();
  });

  test('an absolute url, because Razorpay fetches it from the handset', () => {
    env.PUBLIC_API_ORIGIN = 'https://clinq.example.in';
    const brand = brandForCheckout();
    assert.equal(brand.logoUrl, 'https://clinq.example.in/api/v1/brand/logo.png');
    assert.match(brand.logoUrl, /^https:\/\//, 'a relative path is useless to their SDK');
  });

  test('a trailing slash does not produce a double one', () => {
    // `//api/v1/...` is a 404 on most proxies and a silently missing logo.
    env.PUBLIC_API_ORIGIN = 'https://clinq.example.in/';
    assert.equal(brandForCheckout().logoUrl, 'https://clinq.example.in/api/v1/brand/logo.png');
  });

  test('with no origin configured it sends null, not a broken path', () => {
    // The client then omits `image` entirely and Razorpay falls back to the
    // first letter of the name — which is what it was already doing, and far
    // better than a broken image on a checkout sheet.
    env.PUBLIC_API_ORIGIN = '';
    assert.equal(brandForCheckout().logoUrl, null);
    assert.equal(brandForCheckout().name, 'MedPin');
  });

  test('the name is configurable and never empty', () => {
    env.BRAND_NAME = '';
    assert.equal(brandForCheckout().name, 'MedPin', 'an empty merchant name reached checkout');
  });
});

describe('the route', () => {
  let origin;

  before(async () => {
    origin = await boot();
  });
  after(shutdown);

  test('serves the png without a session', async () => {
    // Razorpay's fetch carries no cookie and no bearer token. Behind the auth
    // wall this would be a broken image and nothing else.
    const res = await fetch(`${origin}/brand/logo.png`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /image\/png/);
  });

  test('and the bytes are the mark, not an error page', async () => {
    const res = await fetch(`${origin}/brand/logo.png`);
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual([...buf.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    assert.equal(buf.length, readFileSync(MARK).length);
  });

  test('it is cacheable, because it changes only on a deploy', async () => {
    const res = await fetch(`${origin}/brand/logo.png`);
    assert.match(res.headers.get('cache-control') ?? '', /max-age=\d+/);
  });

  test('and the brand is readable as json too', async () => {
    const res = await fetch(`${origin}/brand`);
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.name, env.BRAND_NAME || 'MedPin');
  });
});
