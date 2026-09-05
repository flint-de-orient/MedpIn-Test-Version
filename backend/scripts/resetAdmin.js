/**
 * Mint a password reset for a platform administrator.
 *
 * A command rather than an email link, because a link would make the
 * administrator's mailbox the key to every practice on the platform — and a
 * mailbox is protected by somebody else's password policy, somebody else's
 * session handling, and whatever device it happens to be signed into. This
 * account can suspend a clinic; its recovery should not be easier than its
 * login.
 *
 * Running this needs shell access, which already implies control of the
 * database. So it grants nothing that was not available anyway — it makes the
 * recovery a supported path with an audit entry, rather than an ad-hoc Mongo
 * write nobody records.
 *
 * The token prints once. Hand it over out of band; only its hash is kept.
 *
 *   node scripts/resetAdmin.js you@example.com
 *   node scripts/resetAdmin.js you@example.com --apply
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { issueResetToken } from '../src/services/adminReset.js';

const apply = process.argv.includes('--apply');
const email = (process.argv[2] ?? '').trim().toLowerCase();

async function main() {
  if (!email || email.startsWith('--')) {
    console.log('\nUsage: node scripts/resetAdmin.js <email> [--apply]\n');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);

  const admin = await PlatformAdmin.findOne({ email }).lean();

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  account:      ${admin ? admin.email : 'NOT FOUND'}`);
  if (admin) {
    console.log(`  active:       ${admin.isActive}`);
    console.log(`  two-factor:   ${admin.totpEnabled ? 'on — a code is still required' : 'off'}`);
  }

  if (!admin) {
    console.log('\nNo administrator with that email.\n');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!apply) {
    console.log('\nRe-run with --apply to mint a token.\n');
    await mongoose.disconnect();
    return;
  }

  const { token, expiresAt } = await issueResetToken(email);

  console.log('\n  Reset token (shown once, not stored in plain form):\n');
  console.log(`    ${token}\n`);
  console.log(`  Expires: ${expiresAt.toISOString()}`);
  console.log('\n  POST /api/v1/admin/auth/reset with { email, token, newPassword');
  console.log(`  ${admin.totpEnabled ? ', totp }' : ' }'}`);
  if (admin.totpEnabled) {
    console.log('\n  Two-factor is on, so the code is required as well. A reset that');
    console.log('  skipped it would make the second factor decorative.');
  }
  console.log('');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
