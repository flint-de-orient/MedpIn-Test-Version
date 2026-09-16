import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

import { badRequest } from '../middleware/errors.js';
import { allowedOrigins } from '../config/env.js';

/**
 * A passkey instead of a code typed off a phone.
 *
 * ---- Why this exists when TOTP already worked ---------------------------
 *
 * TOTP is sound and it asks a lot: install a third-party app, paste a secret
 * into it, then read six digits off a screen and type them within thirty
 * seconds, every sign-in. For one operator on one laptop that is friction with
 * a real cost — the most likely outcome of asking for it is an account that
 * never turns the second factor on at all, which protects nothing.
 *
 * A passkey is the platform's own prompt: Windows Hello, Touch ID, or a
 * security key. No app, no phone, nothing typed.
 *
 * ---- And it is stronger, not merely easier ------------------------------
 *
 * A six-digit code can be phished in real time. A convincing fake login page
 * asks for the code, forwards it to the real site within its thirty seconds,
 * and is in. That attack works against every TOTP deployment ever built.
 *
 * A passkey signature is bound to the origin by the browser. A page on
 * medpin-admin-login.example cannot obtain a signature that admin.medpin.in
 * will accept, because the browser refuses to produce one. The phishing attack
 * is not made harder, it is made impossible.
 *
 * ---- Why a library here, and not for TOTP -------------------------------
 *
 * TOTP is an HMAC and a modulo — thirty lines, and writing them is how you know
 * what they do. WebAuthn verification is CBOR decoding, COSE key parsing,
 * attestation formats and signature checks across several algorithms, where a
 * subtle mistake is a silent acceptance of a forged assertion. This is the
 * shape of problem a well-maintained library exists for.
 */

/** Two minutes. Long enough to find a fingerprint reader, short enough to matter. */
const CHALLENGE_TTL_MS = 2 * 60 * 1000;

/**
 * Which domain the credential is bound to.
 *
 * The relying-party id is an effective domain, not an origin: no scheme, no
 * port. A credential registered against `admin.medpin.in` is unusable anywhere
 * else, which is the property that makes phishing impossible — and also means
 * getting this wrong produces a credential that cannot be used at all.
 *
 * Configured rather than derived from the request, because deriving it means a
 * request with a forged Host header can decide what a credential is bound to.
 */
export function relyingParty(req) {
  const configured = process.env.ADMIN_RP_ID;
  if (configured) return configured;

  // Development only. `localhost` and `127.0.0.1` are secure contexts, so the
  // ceremony works over plain http there and nowhere else.
  const host = (req.get('origin') ?? '').replace(/^https?:\/\//, '').split(':')[0];
  if (host === 'localhost' || host === '127.0.0.1') return host;

  throw badRequest(
    'Passkeys are not configured on this server. Set ADMIN_RP_ID to the console’s domain.',
  );
}

/**
 * The origin the assertion must have come from.
 *
 * Checked against the allowlist rather than trusted, because this is the value
 * that decides whether a signature made for somebody else's site is accepted.
 */
export function expectedOrigin(req) {
  const origin = req.get('origin');
  if (!origin) throw badRequest('This request did not come from a browser.');

  // The same parsed list CORS uses. Two copies of one `split(',')` is how an
  // origin ends up permitted for a signature and refused for a fetch.
  const allowed = allowedOrigins();

  const dev = ['http://localhost:8144', 'http://127.0.0.1:8144', 'http://localhost:3000'];
  const permitted = allowed.length ? allowed : dev;

  if (!permitted.includes(origin) && !dev.includes(origin)) {
    throw badRequest('This origin is not allowed to use a passkey here.');
  }
  return origin;
}

/* ------------------------------------------------------------ registration */

export async function registrationOptions(req, admin) {
  const options = await generateRegistrationOptions({
    rpName: 'MedPin operator console',
    rpID: relyingParty(req),
    // The account's own id, as bytes. Not the email: a user handle is stored on
    // the authenticator and an email is a thing that changes.
    userID: Buffer.from(String(admin._id)),
    userName: admin.email,
    userDisplayName: admin.name || admin.email,
    // The account has a password; this is the second factor, so the platform
    // authenticator does not need to collect a PIN of its own on top.
    attestationType: 'none',
    // Already-registered keys, so a second attempt on the same laptop replaces
    // rather than silently creating a duplicate nobody can tell apart.
    excludeCredentials: (admin.passkeys ?? []).map((p) => ({
      id: p.credentialId,
      transports: p.transports?.length ? p.transports : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  return options;
}

export async function verifyRegistration(req, admin, response) {
  const expected = admin.passkeyChallenge;
  if (!expected || !admin.passkeyChallengeExpiresAt) {
    throw badRequest('Start the passkey setup again.');
  }
  if (admin.passkeyChallengeExpiresAt < new Date()) {
    throw badRequest('That took too long. Start the passkey setup again.');
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: expected,
      expectedOrigin: expectedOrigin(req),
      expectedRPID: relyingParty(req),
      requireUserVerification: false,
    });
  } catch (err) {
    throw badRequest(`That passkey could not be registered: ${err.message}`);
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw badRequest('That passkey could not be registered.');
  }

  const { credential } = verification.registrationInfo;
  return {
    credentialId: credential.id,
    // base64 rather than a Buffer: this round-trips through JSON and through
    // whatever a future export looks like, and a Buffer in Mongo is a Binary
    // that reads back differently depending on the driver.
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter ?? 0,
    transports: response.response?.transports ?? [],
  };
}

/* ---------------------------------------------------------- authentication */

export async function authenticationOptions(req, admin) {
  return generateAuthenticationOptions({
    rpID: relyingParty(req),
    // Only this account's keys. The password has already been checked, so the
    // account is known and there is no reason to let the browser offer others.
    allowCredentials: (admin.passkeys ?? []).map((p) => ({
      id: p.credentialId,
      transports: p.transports?.length ? p.transports : undefined,
    })),
    userVerification: 'preferred',
  });
}

export async function verifyAuthentication(req, admin, response) {
  if (!admin.passkeyChallenge || !admin.passkeyChallengeExpiresAt) {
    throw badRequest('Start signing in again.');
  }
  if (admin.passkeyChallengeExpiresAt < new Date()) {
    throw badRequest('That took too long. Start signing in again.');
  }

  const stored = (admin.passkeys ?? []).find((p) => p.credentialId === response.id);
  if (!stored) throw badRequest('That passkey is not registered to this account.');

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: admin.passkeyChallenge,
      expectedOrigin: expectedOrigin(req),
      expectedRPID: relyingParty(req),
      credential: {
        id: stored.credentialId,
        publicKey: Buffer.from(stored.publicKey, 'base64url'),
        counter: stored.counter ?? 0,
        transports: stored.transports?.length ? stored.transports : undefined,
      },
      requireUserVerification: false,
    });
  } catch (err) {
    throw badRequest(`That passkey was not accepted: ${err.message}`);
  }

  if (!verification.verified) throw badRequest('That passkey was not accepted.');

  return {
    credentialId: stored.credentialId,
    /**
     * The signature counter, which some authenticators increment and others
     * leave at zero.
     *
     * A counter that goes backwards is the documented signal of a cloned
     * authenticator. It is not enforced here because the platform ones — Windows
     * Hello, Touch ID — report zero forever, so a rule would refuse every
     * ordinary sign-in while catching a clone of a hardware key nobody is using
     * yet. Recorded so the check can be added when it would mean something.
     */
    counter: verification.authenticationInfo.newCounter,
  };
}

export const CHALLENGE_MS = CHALLENGE_TTL_MS;
