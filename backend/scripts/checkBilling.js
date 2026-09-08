/**
 * Is billing actually configured on this server?
 *
 * Run after filling in the Razorpay keys and before restarting, because every
 * failure this catches is one you would otherwise find from a customer.
 *
 * ---- What it is really looking for --------------------------------------
 *
 * Not "is the variable set" — that is a grep. It asks Razorpay to resolve each
 * plan id with the key and secret from this .env, which is the only thing that
 * proves the three of them belong to the same account. A plan id pasted from a
 * different account, or a live id under test keys, is a 400 at checkout for a
 * doctor with a card in their hand.
 *
 * And it prints each plan's amount, because the expensive mistake here is
 * silent: swap two plan ids and a practice buying Professional is charged for
 * Essential every month, with no error anywhere. Nothing in the code can catch
 * that — only a human reading three numbers in the right order.
 *
 *   node scripts/checkBilling.js
 *
 * Prints no secrets. Exits non-zero if the server would not be able to sell.
 */
import { env } from '../src/config/env.js';
import { PLAN } from '../src/models/Practice.js';

const ok = (m) => console.log(`  ok    ${m}`);
const bad = (m) => {
  console.log(`  FAIL  ${m}`);
  process.exitCode = 1;
};
const warn = (m) => console.log(`  warn  ${m}`);

const rupees = (paise) => `INR ${(paise / 100).toLocaleString('en-IN')}`;

async function main() {
  console.log('\n  Razorpay configuration\n');

  // ---- the credentials --------------------------------------------------
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    bad('no key id or secret — billing is off and nothing below can be checked');
    console.log('\n  That is a valid state: the clinic works, the billing');
    console.log('  surface is simply not there. Stop here if that is intended.\n');
    return;
  }

  const test = env.RAZORPAY_KEY_ID.startsWith('rzp_test_');
  const live = env.RAZORPAY_KEY_ID.startsWith('rzp_live_');
  if (test) ok('key id is a TEST key — no real money will move');
  else if (live) warn('key id is a LIVE key — real cards will be charged');
  else bad('key id is neither rzp_test_ nor rzp_live_ — is it the right value?');

  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    bad('no webhook secret — every callback will be refused, so a paid');
    console.log('        subscription would never activate');
  } else if (env.RAZORPAY_WEBHOOK_SECRET === env.RAZORPAY_KEY_SECRET) {
    // The single commonest way this integration is got wrong.
    bad('the webhook secret is the API secret — they are different values,');
    console.log('        and every genuine callback will fail signature checking');
  } else {
    ok('webhook secret is set and is not the API secret');
  }

  // ---- where the customer comes back to ---------------------------------
  const cb = env.RAZORPAY_CALLBACK_URL;
  if (!cb) warn('no callback url — checkout will not return the customer anywhere');
  else if (!cb.startsWith('https://')) bad(`callback url is not https: ${cb}`);
  else ok(`callback url ${cb}`);

  // ---- the plans --------------------------------------------------------
  console.log('\n  Plans\n');

  const auth = Buffer.from(
    `${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`,
  ).toString('base64');

  const sellable = [PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE];
  const ids = {
    [PLAN.ESSENTIAL]: env.RAZORPAY_PLAN_ESSENTIAL,
    [PLAN.PROFESSIONAL]: env.RAZORPAY_PLAN_PROFESSIONAL,
    [PLAN.ENTERPRISE]: env.RAZORPAY_PLAN_ENTERPRISE,
  };

  const seen = new Map();
  const amounts = [];

  for (const plan of sellable) {
    const id = ids[plan];
    if (!id) {
      warn(`${plan}: no plan id — this tier cannot be bought`);
      amounts.push(null);
      continue;
    }

    // Two ids pointing at one plan means one tier silently bills at another's
    // price. Cheap to check, invisible otherwise.
    if (seen.has(id)) {
      bad(`${plan}: same plan id as ${seen.get(id)} — one of them bills wrong`);
      amounts.push(null);
      continue;
    }
    seen.set(id, plan);

    try {
      const res = await fetch(`https://api.razorpay.com/v1/plans/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      const body = await res.json().catch(() => null);

      if (!res.ok) {
        const why = body?.error?.description ?? `HTTP ${res.status}`;
        bad(`${plan}: Razorpay will not resolve this plan id — ${why}`);
        amounts.push(null);
        continue;
      }

      const item = body.item ?? {};
      amounts.push(item.amount ?? null);
      const every = body.interval > 1 ? `every ${body.interval} ${body.period}s` : `per ${body.period}`;
      ok(`${plan}: ${item.name ?? '(unnamed)'} — ${rupees(item.amount)} ${every}`);

      if (item.currency && item.currency !== 'INR') {
        warn(`${plan}: priced in ${item.currency}, not INR`);
      }
    } catch (err) {
      bad(`${plan}: could not reach Razorpay — ${err.message}`);
      amounts.push(null);
    }
  }

  // ---- the ordering that catches a swap ---------------------------------
  const known = amounts.filter((a) => typeof a === 'number');
  if (known.length === amounts.length && known.length > 1) {
    const ascending = known.every((a, i) => i === 0 || a > known[i - 1]);
    if (ascending) {
      ok('and each tier costs more than the one below it');
    } else {
      bad('the tiers are not in ascending order — two plan ids look swapped');
    }
  }

  console.log(
    process.exitCode
      ? '\n  Something above would stop a sale. Fix it before restarting.\n'
      : '\n  Billing is configured.\n',
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
