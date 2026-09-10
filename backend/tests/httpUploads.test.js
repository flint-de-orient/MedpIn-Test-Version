import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { env } from '../src/config/env.js';

/**
 * Uploads, over real HTTP and real multipart.
 *
 * ---- Why this exists now -----------------------------------------------
 *
 * `npm audit` reported four advisories against multer, one of them a file size
 * limit bypass, and one against sharp's HEIF decoder. Both sit directly under
 * this route: every avatar, clinic logo, lab report, signature and voice note a
 * clinic sends goes through them.
 *
 * The upgrade was applied and 1298 tests passed — which proved nothing about
 * uploads, because not one of them exercised an upload. That is a poor reason
 * to feel safe about a dependency change, so the coverage came with it.
 *
 * The size assertion in particular is the advisory made concrete: a limit that
 * can be bypassed is a limit only in the documentation.
 */

let origin;

/** A real multipart body. No library — this is the wire format the fix touched. */
function multipart({ filename, contentType, bytes, fields = {} }) {
  const boundary = `----medpin${Date.now().toString(16)}`;
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
      ),
    );
  }

  parts.push(
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
        `Content-Type: ${contentType}\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  );

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/** The smallest thing sharp will accept as a PNG. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function send(token, part) {
  const res = await fetch(`${origin}/uploads`, {
    method: 'POST',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': part.contentType,
    },
    body: part.body,
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

describe('a clinic can upload, and only what it should', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  async function doctor() {
    const practice = await makePractice('Sunrise Diabetes Care');
    return { practice, ...(await makeMember(practice, { name: 'Dr Bose', isOwner: true })) };
  }

  test('a real multipart image is accepted', async () => {
    // The whole path: multer parses, the filter admits, sharp handles it. This
    // is the assertion that the dependency bump did not break the product.
    const bose = await doctor();
    const res = await send(
      bose.token,
      multipart({
        filename: 'foot.png',
        contentType: 'image/png',
        bytes: PNG,
        fields: { kind: 'foot_photo' },
      }),
    );

    assert.ok(res.status < 400, `upload refused: ${JSON.stringify(res.body)}`);
    assert.ok(res.body?.id || res.body?.asset?.id, 'no asset id came back');
  });

  test('an oversized file is refused, not truncated', async () => {
    /*
     * The advisory, made concrete.
     *
     * A size limit that can be bypassed is a limit only in the documentation,
     * and the failure is quiet: the request succeeds and the disk fills. So
     * this sends one byte over and requires a refusal rather than a smaller
     * file stored.
     */
    const bose = await doctor();
    const tooBig = Buffer.alloc(env.MAX_UPLOAD_MB * 1024 * 1024 + 1, 0x41);

    const res = await send(
      bose.token,
      multipart({
        filename: 'huge.pdf',
        contentType: 'application/pdf',
        bytes: tooBig,
        fields: { kind: 'lab_report' },
      }),
    );

    assert.ok(res.status >= 400, `a file over the cap was accepted (${res.status})`);
  });

  test('an unsupported type is refused by name', async () => {
    // The message tells somebody what to do instead, because "unsupported" on
    // its own sends a receptionist back to the doctor.
    const bose = await doctor();
    const res = await send(
      bose.token,
      multipart({
        filename: 'payload.exe',
        contentType: 'application/x-msdownload',
        bytes: Buffer.from('MZ'),
        fields: { kind: 'other' },
      }),
    );

    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /Unsupported file type/);
  });

  test('an unauthenticated upload is refused', async () => {
    const res = await send(
      null,
      multipart({
        filename: 'foot.png',
        contentType: 'image/png',
        bytes: PNG,
        fields: { kind: 'foot_photo' },
      }),
    );
    assert.equal(res.status, 401);
  });

  test('a kind nobody defined is refused', async () => {
    // The enum is the whole of what an upload may claim to be. A free-text kind
    // would put a lab report and a meal photo in one bucket.
    const bose = await doctor();
    const res = await send(
      bose.token,
      multipart({
        filename: 'foot.png',
        contentType: 'image/png',
        bytes: PNG,
        fields: { kind: 'whatever' },
      }),
    );
    assert.equal(res.status, 400);
  });

  test('a patient cannot upload on somebody else’s behalf', async () => {
    /*
     * The route lets a clinician name a patient and a patient only ever
     * themselves. Worth a test over the wire because the check is one line in
     * the handler — `req.user.role !== ROLES.PATIENT` — and reads as a
     * convenience rather than the boundary it is.
     */
    const practice = await makePractice('Sunrise Diabetes Care');
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    const farida = await makePatient({ name: 'Farida Rahman', practices: [practice] });

    const res = await send(
      anita.token,
      multipart({
        filename: 'foot.png',
        contentType: 'image/png',
        bytes: PNG,
        fields: { kind: 'foot_photo', patientId: String(farida.user._id) },
      }),
    );

    if (res.status < 400) {
      const { MediaAsset } = await import('../src/models/MediaAsset.js');
      const asset = await MediaAsset.findOne().sort({ createdAt: -1 }).lean();
      assert.notEqual(
        String(asset.owner),
        String(farida.user._id),
        'a patient filed a photo against another patient',
      );
    }
  });
});
