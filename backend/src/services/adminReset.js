import crypto from 'node:crypto';

import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { badRequest, unauthorized } from '../middleware/errors.js';
import { logger } from '../config/logger.js';

/**
 * Getting back into the admin panel after losing the password.
 *
 * ---- Why this is not an email link ---------------------------------------
 *
 * The obvious reset flow mails a link. That makes the administrator's mailbox
 * the key to every practice on the platform — and a mailbox is protected by
 * somebody else's password policy, somebody else's session handling, and
 * whatever device it is signed into.
 *
 * This account can suspend a clinic. Its recovery should not be easier than its
 * login.
 *
 * ---- So: a token from the server, and the second factor still applies -----
 *
 * A reset is minted by a person with shell access, printed once, and handed
 * over out of band. Shell access already implies full control of the database,
 * so this grants nothing that was not already available — it just makes the
 * recovery a supported path rather than an ad-hoc Mongo write.
 *
 * And the token alone is not enough. An account with two-factor still needs a
 * current code, because a leaked reset token that bypassed 2FA would make the
 * second factor decorative.
 */

/** Long enough that guessing is hopeless; short-lived either way. */
const TOKEN_BYTES = 32;
const TTL_MINUTES = 30;

/**
 * Mint a reset token for an administrator.
 *
 * Returns the plaintext once. Only its hash is stored, so a database dump does
 * not hand somebody a working reset — the same reasoning as a password.
 */
export async function issueResetToken(email) {
  const admin = await PlatformAdmin.findOne({ email: String(email).toLowerCase().trim() });
  if (!admin) throw badRequest('No administrator with that email.');

  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');

  admin.resetTokenHash = hash(token);
  admin.resetTokenExpiresAt = new Date(Date.now() + TTL_MINUTES * 60_000);
  // A reset in flight clears any lockout: an administrator who forgot their
  // password and then locked themselves out trying should not have to wait out
  // both.
  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  await admin.save();

  await AdminAuditLog.record({
    admin,
    action: 'admin.reset.issued',
    reason: 'Reset token minted from the server',
  });

  return { token, expiresAt: admin.resetTokenExpiresAt, admin };
}

/**
 * Spend a reset token and set a new password.
 *
 * `totp` is required when the account has a second factor. Without that, a
 * reset would be a way around it.
 */
export async function completeReset({ email, token, newPassword, totp = null, verifyTotp }) {
  const admin = await PlatformAdmin.findOne({
    email: String(email).toLowerCase().trim(),
  }).select('+passwordHash +totpSecret +resetTokenHash');

  // One message for every failure. Distinguishing "no such account" from "wrong
  // token" tells whoever is guessing which half to keep working on.
  const REFUSED = 'That reset link is not valid.';

  if (!admin?.resetTokenHash || !admin.resetTokenExpiresAt) throw unauthorized(REFUSED);
  if (admin.resetTokenExpiresAt < new Date()) throw unauthorized(REFUSED);

  // Constant-time. A plain === on a token leaks its prefix through timing, and
  // this one is worth the effort of extracting.
  const supplied = Buffer.from(hash(String(token ?? '')));
  const stored = Buffer.from(admin.resetTokenHash);
  if (supplied.length !== stored.length || !crypto.timingSafeEqual(supplied, stored)) {
    await AdminAuditLog.record({ admin, action: 'admin.reset.failed' });
    throw unauthorized(REFUSED);
  }

  if (admin.totpEnabled) {
    if (!totp) {
      throw badRequest('Enter the code from your authenticator app to finish the reset.');
    }
    if (!verifyTotp(admin.totpSecret, totp)) {
      await AdminAuditLog.record({ admin, action: 'admin.reset.failed_totp' });
      throw unauthorized(REFUSED);
    }
  }

  if (String(newPassword ?? '').length < 12) {
    throw badRequest('Choose a password of at least 12 characters.');
  }

  admin.passwordHash = await PlatformAdmin.hashPassword(newPassword);
  // Spent. A token that still worked afterwards would be a second password
  // nobody knew they had.
  admin.resetTokenHash = null;
  admin.resetTokenExpiresAt = null;
  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  await admin.save();

  await AdminAuditLog.record({ admin, action: 'admin.reset.completed' });
  logger.warn({ email: admin.email }, 'platform admin password was reset');

  return admin;
}

/** SHA-256 is right here: the input is 32 random bytes, not a human password. */
function hash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
