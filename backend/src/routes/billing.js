import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireDoctor } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, conflict, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Subscription, SUBSCRIPTION_STATUS } from '../models/Subscription.js';
import { Practice, PLAN, defaultLimitsFor } from '../models/Practice.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS } from '../models/Membership.js';
import { Clinic } from '../models/Clinic.js';
import { activePatientCount } from '../services/practiceUsage.js';
import { practiceOf } from '../middleware/practiceScope.js';
import {
  verifyWebhook,
  webhooksConfigured,
  configured,
  isTestMode,
  planIdFor,
  createSubscription,
  fetchSubscription,
  cancelSubscription,
} from '../services/billing/razorpay.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * What Razorpay tells us, and what we do about it.
 *
 * ---- Unauthenticated on purpose, and not unguarded ----------------------
 *
 * Razorpay POSTs from their own servers with no session and no bearer token.
 * The signature *is* the authentication: an HMAC of the exact body, using a
 * secret only they and this server hold.
 *
 * So this route is mounted outside `requireAuth`, and the first thing it does
 * is verify. Everything below that line runs only for a request that proved
 * where it came from.
 *
 * ---- Why it answers 200 to things it ignores ---------------------------
 *
 * A non-2xx tells Razorpay to retry, with backoff, for hours. That is right for
 * "the database was down" and wrong for "we do not handle this event" or "we
 * have seen this one already" — both of which are permanent, and retrying them
 * turns a shrug into a storm.
 *
 * A rejected signature is the exception: 400, no retry, and a log line. If it
 * really was Razorpay then the secret is wrong on one side, and retries would
 * only multiply a configuration error.
 */
const router = Router();

/** Events that mean something here. The rest are acknowledged and dropped. */
const HANDLED = new Set([
  'subscription.activated',
  'subscription.charged',
  'subscription.pending',
  'subscription.halted',
  'subscription.cancelled',
  'subscription.completed',
  'subscription.updated',
]);

/** Razorpay's event name to our status. */
const STATUS_FOR = {
  'subscription.activated': SUBSCRIPTION_STATUS.ACTIVE,
  'subscription.charged': SUBSCRIPTION_STATUS.ACTIVE,
  'subscription.pending': SUBSCRIPTION_STATUS.PENDING,
  'subscription.halted': SUBSCRIPTION_STATUS.HALTED,
  'subscription.cancelled': SUBSCRIPTION_STATUS.CANCELLED,
  'subscription.completed': SUBSCRIPTION_STATUS.COMPLETED,
};

router.post(
  '/webhook',
  // Recorded like every other mutating route. The actor is null — Razorpay has
  // no account here — and that is the point: an entry with no actor and a
  // subscription id is exactly what somebody reconciling a disputed charge is
  // looking for.
  // Only the deliveries that changed something. A dashboard offering ninety
  // checkboxes gets all ninety ticked, and every refund and settlement would
  // otherwise leave an audit row for an event this route read and dropped.
  audit('update', 'Subscription', { when: (req) => req.billingApplied === true }),
  asyncHandler(async (req, res) => {
    // Nothing to verify against means nothing to trust. Answering 200 would
    // tell Razorpay this was handled; 503 says come back once somebody has
    // configured the secret.
    if (!webhooksConfigured()) {
      logger.warn('a billing webhook arrived with no RAZORPAY_WEBHOOK_SECRET set');
      return res.status(503).json({ error: 'Billing is not configured on this server' });
    }

    if (!verifyWebhook(req.rawBody, req.get('x-razorpay-signature'))) {
      // Deliberately terse. An attacker probing this endpoint learns only that
      // it exists, which they knew.
      logger.warn({ ip: req.ip }, 'rejected a billing webhook with a bad signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    const event = req.body?.event;
    const entity = req.body?.payload?.subscription?.entity;
    // Razorpay's own id for the delivery, so a redelivery is recognisable.
    const eventId = req.get('x-razorpay-event-id') ?? null;

    if (!HANDLED.has(event) || !entity?.id) {
      // Acknowledged, not acted on. See the note above on why this is a 200.
      return res.json({ received: true, handled: false });
    }

    const sub = await Subscription.findOne({ providerSubscriptionId: entity.id });
    if (!sub) {
      // A subscription this server did not create. Possible during a migration
      // between environments, and not something to retry into.
      logger.warn({ event, subscription: entity.id }, 'webhook for an unknown subscription');
      return res.json({ received: true, handled: false });
    }

    /*
     * Redelivery.
     *
     * Razorpay retries anything that did not answer 2xx, and delivers at least
     * once rather than exactly once — so the same event arrives twice in normal
     * operation. Recognised by their event id rather than by the status, because
     * two genuine charges a month apart are the same event name and the same
     * resulting status.
     */
    if (eventId && sub.events.some((e) => e.providerEventId === eventId)) {
      return res.json({ received: true, handled: false, duplicate: true });
    }

    const status = STATUS_FOR[event];
    if (status) sub.status = status;
    sub.confirmedAt = new Date();
    if (entity.current_end) sub.currentPeriodEnd = new Date(entity.current_end * 1000);

    // Newest last, and capped here rather than in the schema so the limit is
    // visible where the append happens. Fifty is about four years of monthly
    // billing, which is longer than anybody asks about.
    sub.events.push({ event, at: new Date(), providerEventId: eventId });
    if (sub.events.length > 50) sub.events = sub.events.slice(-50);

    await sub.save();

    /*
     * Paid means they have it.
     *
     * The subscription row was being kept faithfully and the practice was never
     * told, so a doctor could complete checkout, be charged, see `active` in
     * their billing screen, and still be on `trial` with a trial's capabilities.
     * The money moved and the product did not.
     *
     * Only upwards, and only on an active status. The other direction — what a
     * halt or a cancellation does — is the open policy question below, and
     * writing "whatever the subscription says" here would answer it by
     * accident, in the direction that cuts a clinic off mid-week.
     */
    if (sub.status === SUBSCRIPTION_STATUS.ACTIVE) {
      const practice = await Practice.findById(sub.practice);
      if (practice && practice.plan !== sub.plan) {
        const was = practice.plan;
        practice.plan = sub.plan;
        // The tier's numbers come with the tier. An operator who negotiated
        // different ones re-enters them, which is the same rule the console
        // follows.
        const limits = defaultLimitsFor(sub.plan);
        for (const k of ['patients', 'staff', 'locations']) practice.limits[k] = limits[k];
        await practice.save();
        logger.info(
          { practice: String(practice._id), from: was, to: sub.plan },
          'practice plan upgraded by a billing event',
        );
      }
    }

    /*
     * ---- What a lapse does to the practice is not decided here ----------
     *
     * `subscription.halted` means the retries are exhausted, and the honest
     * options are different products: suspend the practice, drop it to the free
     * capability set, or allow a grace period and then drop it.
     *
     * Suspending mid-week means a doctor cannot open a record with a patient in
     * front of them because a card expired. That is a decision with a clinical
     * cost, and it is not one to make implicitly by writing whichever line came
     * to hand while wiring a webhook.
     *
     * So the status is recorded and the practice is untouched. When the policy
     * is chosen it goes here, and this note goes with it.
     */
    logger.info({ event, subscription: entity.id, status: sub.status }, 'billing event applied');

    // Read by the audit middleware above, on `finish`.
    req.billingApplied = true;
    res.json({ received: true, handled: true });
  }),
);

/* -------------------------------------------------- the practice's own view */

// Everything below is the clinic asking about its own billing, so it is behind
// the ordinary guards. The webhook above is the only unauthenticated route in
// this file, and its signature is what stands in for a session.
router.use(requireAuth);

/**
 * What this practice is on, and whether anything is being charged.
 *
 * Readable by any doctor: knowing the clinic is on a trial that ends on the
 * 14th is not privileged, and hiding it until somebody holds a billing
 * permission is how a practice discovers its plan by being cut off.
 */
router.get(
  '/',
  requireDoctor,
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    if (!practiceId) return res.json({ plan: null, subscription: null, canPay: false });

    const [practice, sub, patients, staff, locations] = await Promise.all([
      Practice.findById(practiceId).select('plan limits planRenewsOn').lean(),
      Subscription.findOne({
        practice: practiceId,
        status: { $nin: [SUBSCRIPTION_STATUS.CANCELLED, SUBSCRIPTION_STATUS.EXPIRED] },
      })
        .sort({ createdAt: -1 })
        .lean(),
      // A limit means nothing on screen without the number beside it. "10
      // people" is a fact about the plan; "7 of 10" is the one that tells a
      // practice manager whether to act.
      activePatientCount(practiceId),
      Membership.countDocuments({
        practice: practiceId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        endedOn: null,
      }),
      Clinic.countDocuments({ practice: practiceId }),
    ]);

    res.json({
      plan: practice?.plan ?? null,
      limits: practice?.limits ?? null,
      // Counted the same way the guards count. A screen that measured
      // differently would show room where a hire is about to be refused.
      usage: { patients, staff, locations },
      renewsOn: practice?.planRenewsOn ?? null,
      subscription: sub
        ? {
            id: String(sub._id),
            plan: sub.plan,
            status: sub.status,
            currentPeriodEnd: sub.currentPeriodEnd,
            // How stale the status is. A webhook that never arrived leaves a
            // row looking healthy forever, so the age travels with the answer.
            confirmedAt: sub.confirmedAt,
          }
        : null,
      // Whether this server can take a payment at all, and in which mode. A
      // clinic testing a checkout should be able to see that it is a test.
      canPay: configured(),
      testMode: configured() ? isTestMode() : null,
    });
  }),
);

/**
 * Start paying for a plan.
 *
 * Returns the provider's subscription id, which the client hands to Razorpay's
 * checkout. Nothing about the practice changes here — the plan moves when the
 * provider says the money arrived, which is the webhook's job.
 */
router.post(
  '/subscribe',
  requireDoctor,
  // Committing a practice to a monthly charge is not an ordinary clinical act.
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  // Not TRIAL: a trial is granted, not purchased, and offering it here would
  // be a checkout that takes money for the thing already being given away.
  validate({
    body: z.object({ plan: z.enum([PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE]) }),
  }),
  audit('create', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    if (!practiceId) throw badRequest('This account is not linked to a practice yet.');

    const planId = planIdFor(req.body.plan);
    if (!planId) {
      // A plan we sell with no provider plan behind it. Caught here rather than
      // as a 400 from Razorpay, because the fix is a missing environment
      // variable and the message should say so.
      throw badRequest(`No Razorpay plan is configured for "${req.body.plan}".`);
    }

    // One live subscription at a time. Two would both charge.
    const existing = await Subscription.findOne({
      practice: practiceId,
      status: { $in: [SUBSCRIPTION_STATUS.ACTIVE, SUBSCRIPTION_STATUS.PENDING, SUBSCRIPTION_STATUS.AUTHENTICATED] },
    }).lean();
    if (existing) {
      throw conflict('This practice already has a subscription. Cancel it before starting another.');
    }

    const created = await createSubscription({
      planId,
      notes: { practice: String(practiceId), plan: req.body.plan },
    });

    await Subscription.create({
      practice: practiceId,
      providerSubscriptionId: created.id,
      providerPlanId: planId,
      plan: req.body.plan,
      status: SUBSCRIPTION_STATUS.CREATED,
    });

    res.status(201).json({
      subscriptionId: created.id,
      /*
       * Razorpay's own hosted page for this subscription.
       *
       * Sent because it is the whole checkout: the client opens it and the
       * card, the mandate and the bank's own screens all happen there. The
       * alternative is the native SDK, which for a *subscription* buys almost
       * nothing — the hosted page is what it opens anyway — in exchange for a
       * platform dependency, ProGuard rules and a second thing to keep current
       * in an app that is built split-per-ABI and obfuscated.
       */
      shortUrl: created.short_url ?? null,
      // Still sent: the key id is the public half of the pair, and a client
      // that would rather drive checkout itself needs it.
      keyId: env.RAZORPAY_KEY_ID,
      callbackUrl: env.RAZORPAY_CALLBACK_URL || null,
    });
  }),
);

/**
 * Ask the provider what it thinks, rather than trusting the row.
 *
 * For the case a webhook never arrived — a misconfigured secret, a deploy
 * during a delivery, a URL that changed. Without this the only way to correct a
 * stale row is a shell.
 */
router.post(
  '/refresh',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  audit('update', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    const sub = await Subscription.findOne({ practice: practiceId }).sort({ createdAt: -1 });
    if (!sub) throw notFound('This practice has no subscription.');

    const live = await fetchSubscription(sub.providerSubscriptionId);
    if (live?.status) sub.status = live.status;
    if (live?.current_end) sub.currentPeriodEnd = new Date(live.current_end * 1000);
    sub.confirmedAt = new Date();
    await sub.save();

    res.json({ status: sub.status, currentPeriodEnd: sub.currentPeriodEnd });
  }),
);

/**
 * Stop paying.
 *
 * At the end of the cycle by default: a practice that has paid for this month
 * has bought this month, and cancelling into the middle of it takes something
 * away that was already paid for.
 */
router.post(
  '/cancel',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({ body: z.object({ immediately: z.boolean().default(false) }) }),
  audit('update', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    const sub = await Subscription.findOne({
      practice: practiceId,
      status: { $nin: [SUBSCRIPTION_STATUS.CANCELLED, SUBSCRIPTION_STATUS.EXPIRED] },
    }).sort({ createdAt: -1 });
    if (!sub) throw notFound('This practice has no subscription to cancel.');

    await cancelSubscription(sub.providerSubscriptionId, { atCycleEnd: !req.body.immediately });

    // The provider's webhook will confirm. This is what we asked for, not what
    // has happened — hence the status is left alone until it does.
    res.json({ requested: true, immediately: req.body.immediately });
  }),
);

export default router;
