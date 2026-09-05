import jwt from 'jsonwebtoken';

import { env } from '../config/env.js';
import { unauthorized } from '../middleware/errors.js';

/**
 * Tokens for the platform admin, sharing nothing with the clinic's.
 *
 * ---- Why a different secret and not a different claim -------------------
 *
 * The obvious version adds `isAdmin: true` to the existing token and checks it
 * in a middleware. That works exactly as long as every route remembers to
 * check, and it fails the first time one does not — with the clinic's own
 * signing key able to mint a credential for the whole platform.
 *
 * A separate secret removes the question. A clinic token put in front of the
 * admin verifier does not fail a role check; it fails signature verification,
 * because it was signed with a key this function does not hold. There is no
 * check to forget.
 *
 * The issuer differs too, which catches the one case a shared secret would
 * still admit: an operator who sets both env vars to the same string.
 */
const ISSUER = 'medpin-admin';

/** Short by design. This is the account that can suspend a whole practice. */
const TTL = '2h';

export function signAdminToken(admin) {
  return jwt.sign(
    // No role claim, because there is only one kind of admin. A role here would
    // be a field somebody later branches on, and the branch nobody tests is the
    // one that grants too much.
    { sub: String(admin._id), name: admin.name, email: admin.email },
    env.ADMIN_JWT_SECRET,
    { expiresIn: TTL, issuer: ISSUER },
  );
}

export function verifyAdminToken(token) {
  try {
    return jwt.verify(token, env.ADMIN_JWT_SECRET, { issuer: ISSUER });
  } catch {
    throw unauthorized('Admin session expired. Please sign in again.');
  }
}

/**
 * True when the two secrets are distinct — checked at boot, not per request.
 *
 * An operator who pastes the same value into both env vars gets the shared-key
 * failure this design exists to prevent, and gets it silently. The issuer check
 * would still catch a clinic token, but only because the issuers happen to
 * differ; that is a second line, not the first.
 */
export function secretsAreSeparate() {
  return Boolean(env.ADMIN_JWT_SECRET) && env.ADMIN_JWT_SECRET !== env.JWT_ACCESS_SECRET;
}
