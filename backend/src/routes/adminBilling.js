import { Router } from 'express';
import { z } from 'zod';

import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, conflict, notFound } from '../middleware/errors.js';
import { Practice, PLAN, PLAN_LIMITS, defaultLimitsFor } from '../models/Practice.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../models/Subscription.js';
import { Payment } from '../models/Payment.js';
import { Invoice } from '../models/Invoice.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import { capabilitiesOfPractice } from '../services/capabilities.js';
import { catalogue, SELLABLE } from '../services/billing/catalogue.js';
import { configured, pauseSubscription, resumeSubscription } from '../services/billing/razorpay.js';
import { mayPause, mayResume } from '../services/billing/lifecycle.js';
import {
  revenueSnapshot,
  revenueTrend,
  trialConversion,
} from '../services/billing/revenue.js';
import { logger } from '../config/logger.js';

/**
 * The platform's view of money.
 *
 * ---- Why there is no "create plan" here ---------------------------------
 *
 * A tier is an entry in an enum that gates capabilities, and its price is an
 * immutable object in Razorpay. Neither can be edited from a web form, and a
 * console offering "New plan" would be a button that either does nothing or
 * writes a row the resolver has never heard of — a practice on `platinum` gets
 * every capability, because unknown means unrestricted everywhere in this
 * codebase.
 *
 * So `GET /plans` is a reading. It answers the question support actually gets —
 * "what does Professional include, and what does it cost?" — from the same
 * tables the guards use, so it cannot drift from what a customer experiences.
 * Changing a tier is a deploy, and changing a price is a new Razorpay plan.
 *
 * ---- Every action here demands a reason ---------------------------------
 *
 * An operator reaching into a practice's billing is doing something the
 * customer did not ask for, and the entry that records it is worth nothing
 * without why. So `reason` is required by the validator rather than encouraged
 * by a placeholder, and it lands in `AdminAuditLog` beside the before and after.
 */
const router = Router();

/* ------------------------------------------------------------------ plans */

/**
 * What each tier is, what it costs, and what it lets a practice do.
 *
 * Composed from the live tables rather than restated: capabilities come from
 * the resolver the guards use, limits from the same map assignment writes, and
 * the price from Razorpay. A page that restated any of them would be right on
 * the day it was written.
 */
router.get(
  '/plans',
  asyncHandler(async (req, res) => {
    const priced = await catalogue();
    const priceOf = new Map(priced.map((p) => [p.plan, p]));

    const rows = Object.values(PLAN).map((plan) => {
      const price = priceOf.get(plan) ?? null;
      return {
        plan,
        sellable: SELLABLE.includes(plan),
        // From the resolver, so this is what a practice on the plan actually
        // gets — not a marketing list somebody kept in step by hand.
        capabilities: [...capabilitiesOfPractice({ plan })].sort(),
        limits: defaultLimitsFor(plan),
        // Null where the plan has no configured provider id, or where Razorpay
        // could not be reached. Never a guess.
        amount: price?.amount ?? null,
        currency: price?.currency ?? null,
        period: price?.period ?? null,
        interval: price?.interval ?? null,
        providerPlanId: price?.providerPlanId ?? null,
      };
    });

    res.json({
      plans: rows,
      // So the page can say why every price is blank, rather than looking broken.
      canPrice: configured(),
      // Stated for the same reason: an operator comparing this against the
      // customer's screen needs to know these are the numbers in force.
      source: 'razorpay',
      limitsSource: Object.keys(PLAN_LIMITS).length > 0 ? 'PLAN_LIMITS' : null,
    });
  }),
);

/* ---------------------------------------------------------- subscriptions */

/**
 * Every subscription on the platform, newest first.
 *
 * Filterable by status because the useful views are narrow: "who is halted"
 * is a support queue, and "who is active" is a revenue figure. An unfiltered
 * list of everything is neither.
 */
router.get(
  '/subscriptions',
  validate({
    query: z.object({
      status: z.enum(Object.values(SUBSCRIPTION_STATUS)).optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const filter = req.query.status ? { status: req.query.status } : {};

    const rows = await Subscription.find(filter)
      .sort({ createdAt: -1 })
      .limit(req.query.limit)
      // The practice's name, because a list of provider ids is a list nobody
      // can act on. Not a clinical model — see the note in admin.js.
      .populate('practice', 'name plan status')
      .lean();

    res.json({
      subscriptions: rows.map((s) => ({
        id: String(s._id),
        practice: s.practice
          ? { id: String(s.practice._id), name: s.practice.name, plan: s.practice.plan }
          : null,
        plan: s.plan,
        pendingPlan: s.pendingPlan ?? null,
        status: s.status,
        providerSubscriptionId: s.providerSubscriptionId,
        currentPeriodEnd: s.currentPeriodEnd ?? null,
        confirmedAt: s.confirmedAt ?? null,
        graceEndsAt: s.graceEndsAt ?? null,
        createdAt: s.createdAt,
        // The disagreement worth surfacing, computed the same way the practice
        // detail computes it so two screens cannot answer differently.
        disagrees:
          s.status === SUBSCRIPTION_STATUS.ACTIVE &&
          Boolean(s.practice) &&
          s.plan !== s.practice.plan,
      })),
    });
  }),
);

/** One practice's charges and bills, for a support conversation. */
router.get(
  '/practices/:id',
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id).select('name plan').lean();
    if (!practice) throw notFound('Practice not found');

    const [payments, invoices] = await Promise.all([
      Payment.find({ practice: practice._id }).sort({ at: -1 }).limit(50),
      Invoice.find({ practice: practice._id }).sort({ issuedAt: -1 }).limit(50),
    ]);

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.practice.billing.read',
      practice: practice._id,
      req,
    });

    res.json({
      payments: payments.map((p) => p.toPublic()),
      invoices: invoices.map((i) => i.toPublic()),
    });
  }),
);

/* --------------------------------------------------------------- revenue */

/**
 * What the platform earns, and the shape of the customer base.
 *
 * Every money figure is null rather than zero when the prices could not be
 * fetched. A revenue dashboard reading zero the morning Razorpay has an outage
 * is indistinguishable from a business that has lost every customer, and the
 * difference matters most on the day it is hardest to check.
 */
router.get(
  '/revenue',
  validate({ query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }) }),
  asyncHandler(async (req, res) => {
    const [snapshot, trend, conversion] = await Promise.all([
      revenueSnapshot(),
      revenueTrend(req.query.months),
      trialConversion(),
    ]);

    res.json({ ...snapshot, trend, conversion });
  }),
);

/* ---------------------------------------------------------- manual action */

/** Every write below takes one. */
const withReason = z.object({
  reason: z
    .string()
    .trim()
    .min(4, 'Say why. An entry with no stated reason is one nobody can review.')
    .max(500),
});

/**
 * Move a trial's end date.
 *
 * The commonest manual billing act there is — somebody is evaluating over a
 * holiday, or an onboarding slipped — and the one most worth recording, because
 * it is invisible from outside and costs money.
 */
router.post(
  '/practices/:id/extend-trial',
  validate({
    body: withReason.extend({
      until: z.coerce.date(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    const until = req.body.until;
    if (until.getTime() < Date.now()) {
      // A date in the past does not end a trial today — it ended it whenever
      // that was, silently, and the practice finds out by being cut off.
      throw badRequest('That date has passed. Pick one in the future.');
    }

    const before = { plan: practice.plan, planRenewsOn: practice.planRenewsOn ?? null };

    // Only the date. Extending a trial does not put a paying practice back onto
    // one, and a console that could do that by accident would take away
    // capabilities somebody is paying for.
    if (practice.plan !== PLAN.TRIAL) {
      throw conflict(`This practice is on ${practice.plan}, not a trial.`);
    }
    practice.planRenewsOn = until;
    await practice.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.practice.trial.extend',
      practice: practice._id,
      reason: req.body.reason,
      before,
      after: { plan: practice.plan, planRenewsOn: practice.planRenewsOn },
      req,
    });

    res.json({ practice: practice.toPublic() });
  }),
);

async function subscriptionFor(practiceId) {
  const sub = await Subscription.findOne({ practice: practiceId }).sort({ createdAt: -1 });
  if (!sub) throw notFound('This practice has no subscription.');
  return sub;
}

/**
 * Pause or resume on a practice's behalf.
 *
 * Asked of the provider and not written here. An operator marking a row paused
 * without telling Razorpay produces a practice that believes it is not being
 * billed and is — the worst possible disagreement between two systems, and one
 * the customer discovers on their statement.
 */
router.post(
  '/practices/:id/subscription/pause',
  validate({ body: withReason }),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const sub = await subscriptionFor(req.params.id);
    if (!mayPause(sub.status)) {
      throw conflict(`A subscription that is ${sub.status} cannot be paused.`);
    }

    await pauseSubscription(sub.providerSubscriptionId);

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.subscription.pause',
      practice: sub.practice,
      reason: req.body.reason,
      before: { status: sub.status },
      // Requested, not applied. The webhook moves the status, like everywhere
      // else, so recording `paused` here would be a claim about the future.
      after: { status: sub.status, requested: 'pause' },
      req,
    });

    logger.info({ practice: String(sub.practice) }, 'admin requested a subscription pause');
    res.json({ requested: true, status: sub.status });
  }),
);

router.post(
  '/practices/:id/subscription/resume',
  validate({ body: withReason }),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const sub = await subscriptionFor(req.params.id);
    if (!mayResume(sub.status)) {
      throw conflict(`A subscription that is ${sub.status} cannot be resumed.`);
    }

    await resumeSubscription(sub.providerSubscriptionId);

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.subscription.resume',
      practice: sub.practice,
      reason: req.body.reason,
      before: { status: sub.status },
      after: { status: sub.status, requested: 'resume' },
      req,
    });

    logger.info({ practice: String(sub.practice) }, 'admin requested a subscription resume');
    res.json({ requested: true, status: sub.status });
  }),
);

/**
 * Move the grace deadline by hand.
 *
 * The override that exists because a policy cannot know that a clinic's manager
 * is in hospital. Bounded rather than free: clearing it entirely would leave a
 * halted practice in grace for ever with nothing on any screen saying so.
 */
router.post(
  '/practices/:id/subscription/grace',
  validate({ body: withReason.extend({ until: z.coerce.date() }) }),
  asyncHandler(async (req, res) => {
    const sub = await subscriptionFor(req.params.id);
    if (sub.status !== SUBSCRIPTION_STATUS.HALTED) {
      throw conflict('Only a halted subscription has a grace window.');
    }

    const before = { graceEndsAt: sub.graceEndsAt ?? null };
    sub.graceEndsAt = req.body.until;
    await sub.save();

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.subscription.grace',
      practice: sub.practice,
      reason: req.body.reason,
      before,
      after: { graceEndsAt: sub.graceEndsAt },
      req,
    });

    res.json({ graceEndsAt: sub.graceEndsAt });
  }),
);

export default router;
