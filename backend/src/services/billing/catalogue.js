import { PLAN } from '../../models/Practice.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { configured, planIdFor, fetchPlan } from './razorpay.js';

/**
 * What each plan costs, from the only place that knows.
 *
 * ---- Why the price is not in this codebase ------------------------------
 *
 * It is in Razorpay, because that is what the customer is actually charged. A
 * number kept here as well would be a second source of truth for money, and the
 * failure mode of two prices is showing somebody one and taking the other.
 *
 * ---- Why the cache never expires ----------------------------------------
 *
 * A Razorpay plan is immutable: its amount, period and currency cannot be
 * edited after creation, and changing a price means creating a new plan and
 * pointing the environment variable at it. So a plan id resolved once is
 * correct for the lifetime of the process, and a TTL would only add a way to be
 * briefly wrong.
 *
 * The one thing that *can* invalidate an entry is pointing this server at a
 * different Razorpay account — test to live, say — where the same plan name
 * means a different price. So the account is part of the key, and switching it
 * simply misses every old entry rather than needing anybody to remember to
 * clear anything.
 *
 * ---- Fails soft -------------------------------------------------------
 *
 * A plan whose price cannot be fetched comes back with `amount: null`, and the
 * screen says "shown at checkout" rather than inventing a figure. A billing
 * page that cannot reach Razorpay is a worse page; a billing page that guesses
 * at a price is a worse product.
 */

/** The tiers somebody can buy. A trial is granted, not purchased. */
export const SELLABLE = Object.freeze([PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE]);

const cache = new Map();

/** One plan, priced. Never throws. */
async function priced(plan) {
  // Keyed on the account as well as the plan: the same tier under test keys and
  // live keys is two different prices.
  const key = `${env.RAZORPAY_KEY_ID}:${plan}`;
  if (cache.has(key)) return cache.get(key);

  const providerPlanId = planIdFor(plan);
  const unknown = {
    plan,
    providerPlanId: providerPlanId ?? null,
    amount: null,
    currency: null,
    period: null,
    interval: null,
  };

  if (!configured() || !providerPlanId) return unknown;

  try {
    const row = await fetchPlan(providerPlanId);
    const entry = {
      plan,
      providerPlanId,
      // Paise, as Razorpay stores it. Converted once, on the screen that shows
      // it — a rupee value passed between three layers is a rounding bug
      // waiting for a plan that is not a whole number of rupees.
      amount: row?.item?.amount ?? null,
      currency: row?.item?.currency ?? null,
      period: row?.period ?? null,
      interval: row?.interval ?? null,
    };

    // Only a real answer is cached. A failed fetch must be retried on the next
    // request rather than remembered for the life of the process.
    if (entry.amount !== null) cache.set(key, entry);
    return entry;
  } catch (err) {
    logger.warn({ err, plan }, 'could not fetch a plan price');
    return unknown;
  }
}

/** Every purchasable plan, priced where the price is knowable. */
export async function catalogue() {
  return Promise.all(SELLABLE.map(priced));
}
