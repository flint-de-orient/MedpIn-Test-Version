/**
 * Remove the second factor from a platform administrator.
 *
 * ---- Why this has to exist ----------------------------------------------
 *
 * Every other door needs the code. Signing in needs it. Turning the factor off
 * needs it, deliberately — a session alone would mean a stolen token can remove
 * the protection on the account, which is the same as not having it. And the
 * password reset needs it too, because a reset that skipped it would make the
 * factor decorative: anyone holding a leaked reset token would be past it.
 *
 * Every one of those is the right decision on its own. Together they mean a
 * lost phone locks an operator out of the platform permanently, with a hand
 * edit of the database as the only way back — and a hand edit is unreviewed,
 * unlogged, and performed under exactly the time pressure that makes people
 * type the wrong filter.
 *
 * ---- So: the shell, like the reset ---------------------------------------
 *
 * Shell access already implies full control of the database, so this grants
 * nothing that was not available anyway. What it adds is a supported path that
 * writes an audit entry, and one that touches a single field on a single
 * account instead of whatever a tired person types into mongosh at 11pm.
 *
 * It does not touch the password. Losing a phone is not losing a password, and
 * a recovery that reset both would be a bigger hole than the one it fills.
 *
 *   node scripts/clearAdminTotp.js you@example.com
 *   node scripts/clearAdminTotp.js you@example.com --apply
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { AdminAuditLog } from '../src/models/AdminAuditLog.js';

const apply = process.argv.includes('--apply');
const email = (process.argv[2] ?? '').trim().toLowerCase();

async function main() {
  if (!email || email.startsWith('--')) {
    console.log('\nUsage: node scripts/clearAdminTotp.js <email> [--apply]\n');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);

  const admin = await PlatformAdmin.findOne({ email });

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  account:      ${admin ? admin.email : 'NOT FOUND'}`);

  if (!admin) {
    console.log('\nNo administrator with that email.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  console.log(`  active:       ${admin.isActive}`);
  console.log(`  two-factor:   ${admin.totpEnabled ? 'ON — will be removed' : 'already off'}`);

  if (!admin.totpEnabled) {
    console.log('\nNothing to do. This account signs in with a password alone.\n');
    await mongoose.disconnect();
    return;
  }

  if (!apply) {
    console.log('\nRe-run with --apply to remove it.\n');
    await mongoose.disconnect();
    return;
  }

  admin.totpEnabled = false;
  // The secret goes with it. Leaving it would let a re-enable silently restore
  // a factor whose codes are on a phone in somebody else's hands.
  admin.totpSecret = null;
  // A lockout goes too: somebody who lost their phone and then locked the
  // account trying should not have to wait out both.
  admin.failedAttempts = 0;
  admin.lockedUntil = null;
  await admin.save();

  await AdminAuditLog.record({
    admin,
    action: 'admin.totp.cleared',
    reason: 'Second factor removed from the server',
  });

  console.log('\n  Two-factor removed. The password is unchanged.\n');
  console.log('  Enrol a new one on the Account screen at the next sign-in — the');
  console.log('  console will say the account has no second factor until you do.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
