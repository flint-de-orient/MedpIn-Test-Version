import crypto from 'node:crypto';

import { PlatformAdmin } from '../models/PlatformAdmin.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { badRequest, unauthorized } from '../middleware/errors.js';
import { logger } from '../config/logger.js';
import { sendMail, resetEmail, verifyEmail } from './mailer.js';

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

/* -------------------------------------------------------------------------- */

/**
 * A reset requested by the person who lost the password, not minted by somebody
 * with a shell.
 *
 * ---- Reversing an earlier decision, and why ------------------------------
 *
 * This flow originally refused to send email at all. The argument was that a
 * link makes the administrator's mailbox the key to every practice on the
 * platform — protected by somebody else's password policy and whatever device
 * it is signed into.
 *
 * That argument was against a reset the link *completes*. This one does not:
 * the second factor is still required, so a stranger holding the mailbox has a
 * link that stops at the passkey prompt. Mailbox access alone gets them
 * nothing.
 *
 * What the original design actually chose was a recovery that needs SSH, and
 * that is not a recovery. It is an outage with a runbook, performed at whatever
 * hour the password was lost.
 *
 * The honest weak case is an account with no second factor at all — there, the
 * mailbox is the whole thing. That is exactly the account the console nags
 * about on every screen, and a passkey now takes ten seconds.
 *
 * ---- It never says whether the address exists ---------------------------
 *
 * Always the same answer. "No account with that email" is a free membership
 * check for anybody who wants to know which addresses are worth attacking.
 */
export async function requestResetByEmail(email, { consoleUrl }) {
  const admin = await PlatformAdmin.findOne({
    email: String(email).toLowerCase().trim(),
    isActive: true,
  });

  // Deliberately silent. The caller returns ok either way.
  if (!admin) {
    logger.info({ email }, 'reset requested for an address with no account');
    return { sent: false };
  }

  const { token, expiresAt } = await issueResetToken(admin.email);

  const link = `${consoleUrl.replace(/\/+$/, '')}/?reset=${encodeURIComponent(
    token,
  )}&email=${encodeURIComponent(admin.email)}`;

  const message = resetEmail({
    link,
    expiresMinutes: Math.round((expiresAt - Date.now()) / 60000),
  });

  try {
    await sendMail({ to: admin.email, ...message });
  } catch (err) {
    // Logged, not thrown. A transport failure must not become a different
    // response from the one an unknown address gets, or the difference is the
    // membership check this was written to avoid.
    logger.error({ err, email: admin.email }, 'reset email could not be sent');
  }

  await AdminAuditLog.record({
    admin,
    action: 'admin.reset.emailed',
    reason: 'Reset link requested from the sign-in screen',
  });

  return { sent: true };
}

/* -------------------------------------------------------------- verification */

const VERIFY_TTL_HOURS = 24;

/** Send a confirmation link to the address on an account. */
export async function sendEmailVerification(admin, { consoleUrl }) {
  const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');

  admin.emailVerifyTokenHash = hash(token);
  admin.emailVerifyExpiresAt = new Date(Date.now() + VERIFY_TTL_HOURS * 3_600_000);
  await admin.save();

  const link = `${consoleUrl.replace(/\/+$/, '')}/?verify=${encodeURIComponent(
    token,
  )}&email=${encodeURIComponent(admin.email)}`;

  await sendMail({ to: admin.email, ...verifyEmail({ link, expiresHours: VERIFY_TTL_HOURS }) });

  // Not recorded here. The route holds `req`, so recording there captures the
  // address and the browser it was asked from — an audit entry without those is
  // a timestamp and a name.
  return { expiresAt: admin.emailVerifyExpiresAt };
}

/**
 * Spend a verification token.
 *
 * Unauthenticated, because the link is opened wherever the mail was read and
 * that is rarely the browser holding the session. It confirms an address on an
 * account that already had it; it grants nothing and changes no credential.
 */
export async function completeEmailVerification({ email, token }) {
  const admin = await PlatformAdmin.findOne({
    email: String(email).toLowerCase().trim(),
  }).select('+emailVerifyTokenHash');

  const REFUSED = 'That confirmation link is not valid.';
  if (!admin?.emailVerifyTokenHash || !admin.emailVerifyExpiresAt) throw badRequest(REFUSED);
  if (admin.emailVerifyExpiresAt < new Date()) throw badRequest(REFUSED);

  const supplied = Buffer.from(hash(String(token ?? '')));
  const stored = Buffer.from(admin.emailVerifyTokenHash);
  if (supplied.length !== stored.length || !crypto.timingSafeEqual(supplied, stored)) {
    throw badRequest(REFUSED);
  }

  admin.emailVerifiedAt = new Date();
  admin.emailVerifyTokenHash = null;
  admin.emailVerifyExpiresAt = null;
  await admin.save();

  // Returned rather than recorded, for the same reason as above: the route can
  // log where this was opened from, and that is the interesting part of
  // somebody confirming an address.
  return admin;
}
