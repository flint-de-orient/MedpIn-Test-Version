import { Subscription, SUBSCRIPTION_STATUS } from '../../models/Subscription.js';
import { Practice, PLAN } from '../../models/Practice.js';
import { Payment, PAYMENT_STATUS } from '../../models/Payment.js';
import { catalogue } from './catalogue.js';
import { inClinicTz } from '../../utils/clinicTime.js';
import { logger } from '../../config/logger.js';

/**
 * The numbers a platform is run on.
 *
 * ---- Unknown is null, never zero --------------------------------------
 *
 * MRR needs a price per plan, and prices come from Razorpay. When that call
 * fails the honest answer is "we do not know", and every figure derived from it
 * is null too.
 *
 * Zero would be worse than useless. A revenue dashboard reading ₹0 the morning
 * Razorpay has an outage is indistinguishable from a business that has lost
 * every customer, and the difference matters most on exactly the day it is
 * hardest to check.
 *
 * ---- Recurring revenue, normalised to a month -------------------------
 *
 * MRR is what an active subscription bills in a month. A yearly plan
 * contributes a twelfth of its amount, a quarterly one a third — the standard
 * definition, stated because the alternative (counting a yearly plan's whole
 * amount in the month it is charged) produces a chart with a spike nobody can
 * explain and a trend line that means nothing.
 *
 * Only `active` counts. A halted subscription is not revenue: it is a customer
 * whose card is failing, and counting it makes the number that is supposed to
 * warn you the last one to move.
 */

/** How many of a period fit in a month. Null for a period we do not know. */
function monthlyFactor(period, interval) {
  const every = interval && interval > 0 ? interval : 1;
  switch (period) {
    case 'daily':
      return 30 / every;
    case 'weekly':
      return 52 / 12 / every;
    case 'monthly':
      return 1 / every;
    case 'yearly':
      return 1 / (12 * every);
    default:
      return null;
  }
}

/**
 * Recurring revenue and the shape of the customer base.
 *
 * Returns paise throughout — converted once, on the screen. Every field that
 * depends on a price is null when the price could not be fetched.
 */
export async function revenueSnapshot() {
  const priced = await catalogue();
  const priceOf = new Map(priced.map((p) => [p.plan, p]));
  // Not "some prices". A partial catalogue would silently under-report MRR by
  // whichever tier happened to fail, which is the kind of wrong that looks
  // right.
  const pricesKnown = priced.every((p) => p.amount !== null);

  const [byStatus, trials, activeSubs] = await Promise.all([
    Subscription.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    Practice.countDocuments({ plan: PLAN.TRIAL }),
    Subscription.find({ status: SUBSCRIPTION_STATUS.ACTIVE }).select('plan').lean(),
  ]);

  const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));

  /* ---- MRR, and revenue by plan ---------------------------------------- */
  let mrr = pricesKnown ? 0 : null;
  const byPlan = new Map();

  if (pricesKnown) {
    for (const sub of activeSubs) {
      const price = priceOf.get(sub.plan);
      const factor = price ? monthlyFactor(price.period, price.interval) : null;
      if (!price || factor === null) {
        // A plan we cannot normalise makes the total a guess. Better to report
        // nothing than a figure that is quietly missing a customer.
        logger.warn({ plan: sub.plan }, 'cannot normalise a plan to a month');
        mrr = null;
        break;
      }
      const monthly = Math.round(price.amount * factor);
      mrr += monthly;
      byPlan.set(sub.plan, (byPlan.get(sub.plan) ?? 0) + monthly);
    }
  }

  const active = activeSubs.length;

  return {
    mrr,
    // Twelve times MRR, and nothing cleverer. An ARR built from actual annual
    // contracts would be a different and larger piece of work; this is the
    // convention, and calling it anything else would overstate what it is.
    arr: mrr === null ? null : mrr * 12,
    // Null rather than a division by zero, and null when MRR is unknown.
    arpu: mrr === null || active === 0 ? null : Math.round(mrr / active),

    subscriptions: {
      active,
      pastDue: counts[SUBSCRIPTION_STATUS.PENDING] ?? 0,
      halted: counts[SUBSCRIPTION_STATUS.HALTED] ?? 0,
      paused: counts[SUBSCRIPTION_STATUS.PAUSED] ?? 0,
      cancelled: counts[SUBSCRIPTION_STATUS.CANCELLED] ?? 0,
      /// Opened checkout and never finished. Not a customer and not a failure.
      notStarted: counts[SUBSCRIPTION_STATUS.CREATED] ?? 0,
    },

    trials,

    revenueByPlan: pricesKnown
      ? [...byPlan.entries()]
          .map(([plan, amount]) => ({ plan, amount }))
          .sort((a, b) => b.amount - a.amount)
      : null,

    // So a dashboard can say why every money figure is blank rather than
    // looking broken or, worse, looking like zero.
    pricesKnown,
  };
}

/**
 * Month by month: what came in, what left, and what was charged.
 *
 * Counted from `createdAt` and the audit of status rather than recomputed from
 * today's rows, so a cancelled subscription still shows in the month it
 * started. A chart built only from current status has no history in it at all.
 */
export async function revenueTrend(months = 12) {
  const start = inClinicTz(new Date())
    .startOf('month')
    .subtract(months - 1, 'month')
    .toDate();

  const [started, cancelled, charged] = await Promise.all([
    Subscription.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$createdAt' } }, n: { $sum: 1 } } },
    ]),
    Subscription.aggregate([
      {
        $match: {
          status: SUBSCRIPTION_STATUS.CANCELLED,
          updatedAt: { $gte: start },
        },
      },
      { $group: { _id: { $dateToString: { format: '%Y-%m', date: '$updatedAt' } }, n: { $sum: 1 } } },
    ]),
    // Real money, from the ledger rather than from a plan price. This is the
    // one series that is a fact rather than a projection.
    Payment.aggregate([
      { $match: { status: PAYMENT_STATUS.CAPTURED, at: { $gte: start } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m', date: '$at' } },
          amount: { $sum: '$amount' },
          n: { $sum: 1 },
        },
      },
    ]),
  ]);

  const key = (rows) => Object.fromEntries(rows.map((r) => [r._id, r]));
  const s = key(started);
  const c = key(cancelled);
  const p = key(charged);

  const out = [];
  for (let i = 0; i < months; i += 1) {
    const m = inClinicTz(start).add(i, 'month').format('YYYY-MM');
    out.push({
      month: m,
      started: s[m]?.n ?? 0,
      cancelled: c[m]?.n ?? 0,
      collected: p[m]?.amount ?? 0,
      charges: p[m]?.n ?? 0,
    });
  }
  return out;
}

/**
 * How many trials became customers.
 *
 * Counted over practices rather than subscriptions: a practice that started
 * three checkouts and finished one converted once, and counting subscriptions
 * would report it as a third.
 *
 * `converted` is a practice that has ever had an active subscription. Not "is
 * on a paid plan now" — somebody who paid for six months and left did convert,
 * and a conversion rate that falls when a customer churns is measuring two
 * things at once.
 */
export async function trialConversion() {
  const [practices, everActive] = await Promise.all([
    Practice.countDocuments({}),
    Subscription.distinct('practice', {
      $or: [
        { status: SUBSCRIPTION_STATUS.ACTIVE },
        { 'events.event': 'subscription.activated' },
        { 'events.event': 'subscription.charged' },
      ],
    }),
  ]);

  const converted = everActive.length;
  return {
    practices,
    converted,
    // Null rather than NaN on an empty platform, which is where this starts.
    rate: practices === 0 ? null : Math.round((converted / practices) * 1000) / 10,
  };
}
