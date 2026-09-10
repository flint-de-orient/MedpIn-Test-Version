/**
 * Retire the checkouts nobody finished.
 *
 * A subscription created for a checkout is real at Razorpay whether or not
 * anybody pays, and until `10fff48` the guard on /subscribe did not count
 * `created` — so every abandoned checkout left another one behind. One test
 * practice accumulated five.
 *
 * That fix stops new ones. It does not retire the ones already there, and each
 * of those is still a URL that takes a card: somebody returning to an old link
 * could authorise a mandate this server has moved on from, and two of them paid
 * would charge every month.
 *
 * ---- What it will not touch --------------------------------------------
 *
 * Only `created`. Not authenticated, not active, not pending, not halted — a
 * subscription anybody has ever paid against is somebody's arrangement, and a
 * cleanup script is the last thing that should be allowed to cancel one.
 *
 * The newest per practice is also kept, because it is the one the app is
 * currently offering. Cancelling it would break a checkout somebody has open.
 *
 *   node scripts/retireAbandonedCheckouts.js          # report
 *   node scripts/retireAbandonedCheckouts.js --apply  # cancel and mark expired
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../src/models/Subscription.js';
import { Practice } from '../src/models/Practice.js';
import { configured, cancelSubscription } from '../src/services/billing/razorpay.js';

const apply = process.argv.includes('--apply');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  const rows = await Subscription.find({ status: SUBSCRIPTION_STATUS.CREATED })
    .sort({ createdAt: -1 })
    .lean();

  console.log(`\n  ${rows.length} unfinished checkout(s) in total\n`);
  if (rows.length === 0) {
    console.log('  Nothing to do.\n');
    return;
  }

  // Keep the newest per practice: that is the one the app is offering right now.
  const seen = new Set();
  const keep = [];
  const retire = [];
  for (const r of rows) {
    const key = String(r.practice);
    if (!seen.has(key)) {
      seen.add(key);
      keep.push(r);
    } else {
      retire.push(r);
    }
  }

  const names = new Map(
    (await Practice.find({ _id: { $in: [...seen] } }).select('name').lean()).map((p) => [
      String(p._id),
      p.name,
    ]),
  );

  console.log(`  Keeping ${keep.length} — the newest for each practice:\n`);
  for (const r of keep) {
    console.log(`    ${names.get(String(r.practice)) ?? '(unknown)'}  ${r.providerSubscriptionId}  ${r.plan}`);
  }

  console.log(`\n  Retiring ${retire.length}:\n`);
  for (const r of retire) {
    console.log(`    ${names.get(String(r.practice)) ?? '(unknown)'}  ${r.providerSubscriptionId}  ${r.plan}`);
  }

  if (!apply) {
    console.log('\n  Re-run with --apply.\n');
    return;
  }

  if (!configured()) {
    console.error('\n  Razorpay is not configured on this server, so nothing can be');
    console.error('  cancelled at their end. Marking rows expired here alone would');
    console.error('  hide live checkouts rather than retire them.\n');
    process.exitCode = 1;
    return;
  }

  let cancelled = 0;
  let orphaned = 0;

  for (const r of retire) {
    try {
      await cancelSubscription(r.providerSubscriptionId, { atCycleEnd: false });
      cancelled += 1;
    } catch (err) {
      // Their refusal is logged and the row is still expired: leaving it
      // `created` would feed it back into the reuse path on the next checkout.
      // An orphan somebody cancels by hand beats a row this server keeps
      // offering — but it is named here so it can be cancelled by hand.
      orphaned += 1;
      console.error(`    ! ${r.providerSubscriptionId}: ${err.message}`);
    }
    await Subscription.updateOne(
      { _id: r._id },
      { $set: { status: SUBSCRIPTION_STATUS.EXPIRED } },
    ).exec();
  }

  console.log(`\n  Cancelled ${cancelled} at Razorpay, marked ${retire.length} expired here.`);
  if (orphaned > 0) {
    console.log(`  ${orphaned} could not be cancelled and are listed above — cancel those`);
    console.log('  in the Razorpay dashboard so they stop taking cards.');
  }

  const left = await Subscription.countDocuments({ status: SUBSCRIPTION_STATUS.CREATED });
  console.log(`  ${left} unfinished checkout(s) remain, one per practice.\n`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
