import crypto from 'node:crypto';

/**
 * Time-based one-time passwords, RFC 6238.
 *
 * ---- Why this is written out rather than installed ----------------------
 *
 * It is about forty lines of HMAC and arithmetic, and the alternative is a
 * dependency — with its own transitive tree — inside the authentication path of
 * the account that can suspend every practice on the platform. A supply-chain
 * compromise there is not a bug, it is a breach, and the code below is short
 * enough to read in one sitting and verify against the RFC.
 *
 * Interoperable with Google Authenticator, Authy and 1Password: SHA-1, six
 * digits, thirty-second step. SHA-1 is not a weakness here — HMAC-SHA1 has no
 * practical break, and the alternatives are not what the authenticator apps
 * implement.
 */

const DIGITS = 6;
const STEP_SECONDS = 30;

/**
 * A window of one step either side of now.
 *
 * Phone clocks drift and people finish typing late. Zero tolerance rejects
 * honest codes; a wide window extends how long a shoulder-surfed code stays
 * usable. One step each way is the usual compromise and gives a code a life of
 * roughly ninety seconds.
 */
const DRIFT_STEPS = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A fresh secret, base32 so an authenticator app can accept it. */
export function generateSecret(bytes = 20) {
  const buf = crypto.randomBytes(bytes);
  let bits = '';
  for (const b of buf) bits += b.toString(2).padStart(8, '0');

  let out = '';
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    out += B32[parseInt(bits.slice(i, i + 5), 2)];
  }
  return out;
}

function base32Decode(secret) {
  const clean = secret.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = '';
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 in TOTP secret');
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}

/** The code for one time step. */
function codeFor(secret, counter) {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Whether a typed code is valid now.
 *
 * Compared with `timingSafeEqual`. A plain `===` on a six-digit string leaks
 * how many leading digits matched through how long the comparison took, which
 * over enough attempts is the difference between a million guesses and ten.
 */
export function verifyTotp(secret, token) {
  if (!secret || !/^\d{6}$/.test(String(token ?? '').trim())) return false;

  const typed = Buffer.from(String(token).trim());
  const now = Math.floor(Date.now() / 1000 / STEP_SECONDS);

  for (let drift = -DRIFT_STEPS; drift <= DRIFT_STEPS; drift += 1) {
    const expected = Buffer.from(codeFor(secret, now + drift));
    if (expected.length === typed.length && crypto.timingSafeEqual(expected, typed)) return true;
  }
  return false;
}

/**
 * The `otpauth://` URI an authenticator app scans.
 *
 * The label carries the issuer twice — once as a prefix and once as a
 * parameter — which is what the apps expect and what makes the entry read
 * "MedPin Admin (you@example.com)" rather than a bare email among thirty.
 */
export function otpauthUri({ secret, email, issuer = 'MedPin Admin' }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
