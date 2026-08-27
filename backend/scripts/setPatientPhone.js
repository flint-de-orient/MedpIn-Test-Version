/**
 * Change the phone number on one account.
 *
 * Sign-in is now a code texted to the number on the record, so an account
 * carrying a made-up number cannot be signed into at all — the SMS goes
 * nowhere. This puts a real number on a test account so it can be logged in
 * with, and it is the only supported way to do that: editing the field by hand
 * in a Mongo shell skips the E.164 normalisation the login lookup depends on,
 * and an account stored as bare digits is locked out by every input the login
 * screen allows.
 *
 * Reports by default and writes nothing. Nothing here is guessed:
 *
 *   - the account is found by exact name, and more than one match is an error
 *     rather than a pick, because choosing the wrong one edits the wrong
 *     person's medical record;
 *   - the new number is refused if any other account already holds it, with
 *     the name of the account that does;
 *   - the old number is printed before and after, so the change can be undone
 *     by running this again with it.
 *
 *   node scripts/setPatientPhone.js "Rahul Das" 9749681391
 *   node scripts/setPatientPhone.js "Rahul Das" 9749681391 --apply
 *
 * Run it on the server, from the backend directory, with the same .env the app
 * uses — it connects to whatever MONGODB_URI points at.
 */
import { connectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { toE164 } from '../src/utils/phone.js';
import { logger } from '../src/config/logger.js';

const args = process.argv.slice(2).filter((a) => a !== '--apply');
const apply = process.argv.includes('--apply');
const [nameArg, phoneArg] = args;

async function main() {
  if (!nameArg || !phoneArg) {
    logger.error('usage: node scripts/setPatientPhone.js "<full name>" <phone> [--apply]');
    process.exitCode = 1;
    return;
  }

  const phone = toE164(phoneArg);
  if (!/^\+?[1-9]\d{7,14}$/.test(phone)) {
    logger.error(`"${phoneArg}" is not a valid phone number (normalised to "${phone}")`);
    process.exitCode = 1;
    return;
  }

  await connectDb();

  // Exact name, case-insensitive, anchored. A partial match would happily find
  // "Rahul Das Gupta" when asked for "Rahul Das".
  const escaped = nameArg.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matches = await User.find({
    name: new RegExp(`^${escaped}$`, 'i'),
  })
    .select('name phone role isActive')
    .lean();

  if (matches.length === 0) {
    logger.error(`No account named "${nameArg}".`);
    process.exitCode = 1;
    return;
  }
  if (matches.length > 1) {
    logger.error(`${matches.length} accounts are named "${nameArg}":`);
    for (const m of matches) {
      logger.error(`  ${m.role.padEnd(10)} ${m.phone} ${m.isActive === false ? '(inactive)' : ''}`);
    }
    logger.error('Refusing to guess which one. Rename or deactivate the other, then re-run.');
    process.exitCode = 1;
    return;
  }

  const [user] = matches;

  if (user.phone === phone) {
    logger.info(`${user.name} already has ${phone}. Nothing to do.`);
    return;
  }

  // The unique index would reject this anyway; a name is more use than a
  // duplicate-key stack trace at 11pm.
  const holder = await User.findOne({ phone, _id: { $ne: user._id } })
    .select('name role')
    .lean();
  if (holder) {
    logger.error(
      `${phone} already belongs to ${holder.name} (${holder.role}). ` +
        'One number is one account — free it up or pick another number.',
    );
    process.exitCode = 1;
    return;
  }

  logger.info(`${user.role.padEnd(10)} ${user.name}: ${user.phone} -> ${phone}`);

  if (!apply) {
    logger.info('Report only. Re-run with --apply to write it.');
    return;
  }

  await User.updateOne({ _id: user._id }, { phone });
  logger.info(`Done. ${user.name} now signs in with ${phone}.`);
  logger.info(`To undo: node scripts/setPatientPhone.js "${user.name}" ${user.phone} --apply`);
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((err) => {
    logger.error({ err }, 'setPatientPhone failed');
    process.exit(1);
  });
