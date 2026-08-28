/**
 * Add (or remove) a second number that signs into an existing account.
 *
 * For a clinic reception desk with two lines. Both numbers reach the SAME
 * account, so both see the same data and every action is recorded against one
 * identity — a patient gets replies from "Clinic Reception", not from
 * "Clinic Reception" and "Clinic Reception 2".
 *
 * These are sign-in credentials, not contact details. The numbers patients ring
 * live on the Clinic record (setClinicProfile.js). A number here can receive a
 * one-time code and open the panel, so only put a handset on it that the people
 * who should have access actually hold.
 *
 * Reports by default and writes nothing:
 *
 *   node scripts/addLoginNumber.js "Clinic Reception" 9674999327
 *   node scripts/addLoginNumber.js "Clinic Reception" 9674999327 --apply
 *   node scripts/addLoginNumber.js "Clinic Reception" 9674999327 --remove --apply
 *
 * The account is found by its current number or its exact name. More than one
 * match is an error rather than a pick — choosing wrong would hand somebody
 * else's account a way in.
 */
import { connectDb, disconnectDb } from '../src/config/db.js';
import { User, byLoginPhone } from '../src/models/User.js';
import { toE164 } from '../src/utils/phone.js';
import { logger } from '../src/config/logger.js';

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const remove = argv.includes('--remove');
const positional = argv.filter((a) => !a.startsWith('--'));
const [who, rawNumber] = positional;

async function main() {
  if (!who || !rawNumber) {
    console.log('');
    console.log('  Usage: node scripts/addLoginNumber.js "<name or current number>" <number> [--remove] [--apply]');
    console.log('');
    process.exitCode = 1;
    return;
  }

  const phone = toE164(rawNumber);
  if (!phone) {
    console.log(`\n  "${rawNumber}" is not a number this app can store. Give ten digits, or +91 and ten digits.\n`);
    process.exitCode = 1;
    return;
  }

  await connectDb();

  // By current number first, then by exact name — the same order, and the same
  // refusal to guess, as setAccountPhone.js.
  const asPhone = toE164(who);
  const matches = asPhone
    ? await User.find(byLoginPhone(asPhone))
    : await User.find({ name: who });

  if (matches.length === 0) {
    console.log(`\n  No account matches "${who}".\n`);
    process.exitCode = 1;
    return;
  }
  if (matches.length > 1) {
    console.log(`\n  "${who}" matches ${matches.length} accounts. Use the exact phone number instead:`);
    for (const m of matches) console.log(`    - ${m.name}  ${m.phone}  (${m.role})`);
    console.log('');
    process.exitCode = 1;
    return;
  }

  const user = matches[0];
  const already = (user.altPhones ?? []).includes(phone);
  const isPrimary = user.phone === phone;

  console.log('');
  console.log('  Account   :', user.name, `(${user.role})`);
  console.log('  Primary   :', user.phone);
  console.log('  Alternates:', (user.altPhones ?? []).join(', ') || '(none)');
  console.log('');

  if (remove) {
    if (!already) {
      console.log(`  ${phone} is not an alternate on this account. Nothing to do.\n`);
      return;
    }
    console.log(`  Will REMOVE ${phone} as a sign-in number.`);
  } else {
    if (isPrimary) {
      console.log(`  ${phone} is already this account's primary number. Nothing to do.\n`);
      return;
    }
    if (already) {
      console.log(`  ${phone} is already an alternate on this account. Nothing to do.\n`);
      return;
    }
    // Anyone else, on either field. A number two accounts can claim is a
    // number whose code signs you into whichever one the query returned.
    if (await User.phoneTaken(phone, user._id)) {
      const holder = await User.findOne({ ...byLoginPhone(phone), _id: { $ne: user._id } })
        .select('name role')
        .lean();
      console.log(`  REFUSED: ${phone} already signs into "${holder?.name}" (${holder?.role}).`);
      console.log('  Free it there first, or use a different number.\n');
      process.exitCode = 1;
      return;
    }
    console.log(`  Will ADD ${phone} as a second sign-in number for this account.`);
    console.log('  Both numbers will reach the same account and the same data.');
  }

  if (!apply) {
    console.log('\n  Nothing written. Re-run with --apply.\n');
    return;
  }

  user.altPhones = remove
    ? (user.altPhones ?? []).filter((p) => p !== phone)
    : [...(user.altPhones ?? []), phone];
  await user.save();

  console.log('');
  console.log('  Done. Alternates now:', user.altPhones.join(', ') || '(none)');
  console.log('');
}

main()
  .catch((err) => {
    logger.error({ err: err.message }, 'addLoginNumber failed');
    process.exitCode = 1;
  })
  .finally(() => disconnectDb());
