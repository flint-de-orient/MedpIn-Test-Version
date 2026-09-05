/**
 * Creates the first platform administrator.
 *
 * A script and not a route, deliberately. A "create the first admin" endpoint
 * has to be open until it is used and closed afterwards, and the closing is a
 * thing somebody has to remember on a day nobody is thinking about it. A
 * command that needs shell access to the server needs no such discipline.
 *
 * The password is read from the environment rather than an argument, because
 * arguments end up in shell history and in `ps` output on a shared box.
 *
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' node scripts/createAdmin.js
 *   ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='...' node scripts/createAdmin.js --apply
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { PlatformAdmin } from '../src/models/PlatformAdmin.js';
import { secretsAreSeparate } from '../src/services/adminTokens.js';

const apply = process.argv.includes('--apply');
const email = (process.env.ADMIN_EMAIL ?? '').trim().toLowerCase();
const password = process.env.ADMIN_PASSWORD ?? '';

async function main() {
  if (!email || !password) {
    console.log('\nSet ADMIN_EMAIL and ADMIN_PASSWORD in the environment.\n');
    process.exit(1);
  }
  if (password.length < 12) {
    // This account can suspend every practice on the platform.
    console.log('\nADMIN_PASSWORD must be at least 12 characters.\n');
    process.exit(1);
  }

  await mongoose.connect(env.MONGODB_URI);

  const existing = await PlatformAdmin.findOne({ email }).lean();

  console.log(`\n${apply ? 'WRITING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  email:            ${email}`);
  console.log(`  already exists:   ${existing ? 'yes — password will be reset' : 'no'}`);
  console.log(`  ADMIN_JWT_SECRET: ${env.ADMIN_JWT_SECRET ? 'set' : 'NOT SET — the panel stays 404'}`);
  if (env.ADMIN_JWT_SECRET && !secretsAreSeparate()) {
    console.log('  ⚠ ADMIN_JWT_SECRET matches the clinic key. The panel will refuse to run.');
  }

  if (!apply) {
    console.log('\nRe-run with --apply.\n');
    await mongoose.disconnect();
    return;
  }

  const passwordHash = await PlatformAdmin.hashPassword(password);
  await PlatformAdmin.updateOne(
    { email },
    {
      $set: { passwordHash, isActive: true },
      $setOnInsert: { name: email.split('@')[0], email },
    },
    { upsert: true },
  );

  console.log('\n  Done. Sign in at POST /api/v1/admin/auth/login\n');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
