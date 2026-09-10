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
import { Payment } from '../models/Payment.js';
import { Invoice } from '../models/Invoice.js';
import { recordPayment, recordInvoice } from '../services/billing/ledger.js';
import { activePatientCount } from '../services/practiceUsage.js';
import { practiceOf } from '../middleware/practiceScope.js';
import {
  verifyWebhook,
  verifyCheckoutSignature,
  fetchPayment,
  updateSubscriptionPlan,
  pauseSubscription,
  resumeSubscription,
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
import { graceEndsFrom } from '../services/billing/lapse.js';
import { catalogue } from '../services/billing/catalogue.js';
import { brandForCheckout } from './brand.js';
import {
  CHANGE,
  describeChange,
  mayChangePlan,
  mayPause,
  mayResume,
} from '../services/billing/lifecycle.js';

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
  'subscription.paused',
  'subscription.resumed',
]);

/** Razorpay's event name to our status. */
const STATUS_FOR = {
  'subscription.activated': SUBSCRIPTION_STATUS.ACTIVE,
  'subscription.charged': SUBSCRIPTION_STATUS.ACTIVE,
  'subscription.pending': SUBSCRIPTION_STATUS.PENDING,
  'subscription.halted': SUBSCRIPTION_STATUS.HALTED,
  'subscription.cancelled': SUBSCRIPTION_STATUS.CANCELLED,
  'subscription.completed': SUBSCRIPTION_STATUS.COMPLETED,
  'subscription.paused': SUBSCRIPTION_STATUS.PAUSED,
  // Back to active rather than to whatever it was before. A paused
  // subscription that resumes is running again by definition.
  'subscription.resumed': SUBSCRIPTION_STATUS.ACTIVE,
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

    /*
     * The grace window opens the moment the retries are exhausted, and is
     * stamped rather than recomputed later — see the note on the field.
     *
     * Only on the transition into `halted`, so a redelivery of the same halt
     * does not push the deadline out. And cleared on the way back to active:
     * a practice that fixed its card is not on a countdown.
     */
    if (status === SUBSCRIPTION_STATUS.HALTED && !sub.graceEndsAt) {
      sub.graceEndsAt = graceEndsFrom();
    }
    if (status === SUBSCRIPTION_STATUS.ACTIVE) sub.graceEndsAt = null;

    /*
     * A scheduled downgrade landing.
     *
     * Razorpay applies a `cycle_end` plan change when the period runs out and
     * tells us in the entity's `plan_id`. Comparing that against the provider
     * id of what was asked for is how we know it has happened — no extra
     * network call, and no clock of our own to drift.
     *
     * Only on the way in to the new plan. A delivery that still names the old
     * plan id means the change has not landed yet, which is the ordinary state
     * for every charge between the request and the period end.
     */
    if (sub.pendingPlan && entity.plan_id) {
      const wanted = planIdFor(sub.pendingPlan);
      if (wanted && entity.plan_id === wanted) {
        logger.info(
          { subscription: entity.id, from: sub.plan, to: sub.pendingPlan },
          'scheduled plan change landed',
        );
        sub.plan = sub.pendingPlan;
        sub.providerPlanId = wanted;
        sub.pendingPlan = null;
      }
    }
    sub.confirmedAt = new Date();
    if (entity.current_end) sub.currentPeriodEnd = new Date(entity.current_end * 1000);

    // Newest last, and capped here rather than in the schema so the limit is
    // visible where the append happens. Fifty is about four years of monthly
    // billing, which is longer than anybody asks about.
    sub.events.push({ event, at: new Date(), providerEventId: eventId });
    if (sub.events.length > 50) sub.events = sub.events.slice(-50);

    await sub.save();

    /*
     * The receipt, filed alongside the status.
     *
     * `subscription.charged` carries the payment that settled it and, on most
     * deliveries, the invoice it settled. Filed here rather than fetched later
     * because the payload already holds every field, and a second network call
     * inside a webhook is a second thing that can make it time out.
     *
     * Neither call throws — see [ledger.js]. Losing a history row is
     * recoverable from Razorpay's dashboard; a 500 here is retried, and the
     * retry would re-apply everything above it.
     */
    const payment = req.body?.payload?.payment?.entity;
    const invoice = req.body?.payload?.invoice?.entity;
    if (payment) {
      await recordPayment({ entity: payment, practiceId: sub.practice, subscriptionId: sub._id });
    }
    if (invoice) {
      await recordInvoice({ entity: invoice, practiceId: sub.practice, subscriptionId: sub._id });
    }

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
    /*
     * Whether there is a practice at all, said out loud.
     *
     * The app used to work this out as `plan != null`, which is true of an
     * account with no membership and equally true of a practice created before
     * the plan field existed — and Dr. Dey's founding practice is exactly
     * that. Mongoose defaults apply on insert, not to documents already
     * written, so the oldest and most important customer on the platform
     * opened Plan and billing and was told "No practice yet".
     *
     * One missing field had three readers and three answers: capabilities.js
     * treats an unknown plan as granting everything, `Practice.toPublic()`
     * reports it to the console as "trial", and this route reported it to the
     * practice as not existing. The absence is real and it is worth reporting
     * honestly — but it is an absence of a *plan*, and nothing about it says
     * anything about whether there is a practice.
     */
    const practiceId = await practiceOf(req);
    if (!practiceId) {
      return res.json({ hasPractice: false, plan: null, subscription: null, canPay: false });
    }

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
      // There is a practice. Whether it has been put on a plan is the next
      // question down, and a separate one.
      hasPractice: true,
      // Not defaulted to trial. A practice predating the field is unrestricted
      // — `capabilities.js` grants an unknown plan everything — and calling
      // that a trial would put an expiry on screen that nothing will enforce.
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
 * What is for sale, and what it costs.
 *
 * Readable by any doctor, like the plan itself: a price is not privileged, and
 * a practice that has to open a checkout to discover what it would be charged
 * has been told nothing before it commits.
 *
 * A plan whose price could not be fetched comes back with a null amount, and
 * the screen says "shown at checkout" rather than inventing a figure.
 */
router.get(
  '/plans',
  requireDoctor,
  asyncHandler(async (req, res) => {
    res.json({ plans: await catalogue(), canPay: configured() });
  }),
);

/**
 * What this practice has been charged.
 *
 * Readable by any doctor. "Why was I charged this" is a question a practice
 * asks us rather than Razorpay — they hold no account there — and a support
 * conversation that begins with "log in to our payment provider" is one nobody
 * can have.
 *
 * Payments and invoices side by side rather than merged: a failed payment has
 * no invoice, and an unpaid invoice has no payment, so a single list would have
 * to invent a row for half of each.
 */
router.get(
  '/history',
  requireDoctor,
  validate({ query: z.object({ limit: z.coerce.number().int().min(1).max(100).default(24) }) }),
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    // Not an error. An account with no practice has no billing history, and
    // the screen renders that rather than failing.
    if (!practiceId) return res.json({ payments: [], invoices: [] });

    const [payments, invoices] = await Promise.all([
      Payment.find({ practice: practiceId }).sort({ at: -1 }).limit(req.query.limit),
      Invoice.find({ practice: practiceId }).sort({ issuedAt: -1 }).limit(req.query.limit),
    ]);

    res.json({
      payments: payments.map((p) => p.toPublic()),
      invoices: invoices.map((i) => i.toPublic()),
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

    /*
     * ---- An abandoned checkout is not a reason to make another -----------
     *
     * A subscription created here is real at Razorpay whether or not anybody
     * finishes paying, and `created` was missing from the guard above — so
     * every abandoned checkout left another live, payable subscription behind.
     * One test practice accumulated five in an afternoon.
     *
     * That is not only clutter. Each of those is a URL that still takes a card,
     * so a customer could return to an old one and authorise a mandate this
     * server has already moved on from — and if two were ever paid, both would
     * charge every month.
     *
     * So: the same plan reuses the open subscription rather than adding to the
     * pile, and a different plan cancels the old one first. Reuse is also
     * simply correct — somebody who opened checkout, thought about it, and came
     * back is continuing, not starting again.
     */
    const open = await Subscription.findOne({
      practice: practiceId,
      status: SUBSCRIPTION_STATUS.CREATED,
    }).sort({ createdAt: -1 });

    if (open && open.plan === req.body.plan) {
      // Fetched rather than remembered: a checkout link has a life of its own
      // at Razorpay, and one that has expired must not be handed back as live.
      try {
        const live = await fetchSubscription(open.providerSubscriptionId);
        if (live?.status === 'created') {
          logger.info(
            { practice: String(practiceId), subscription: open.providerSubscriptionId },
            'reusing an unfinished checkout',
          );
          return res.status(200).json({
            subscriptionId: open.providerSubscriptionId,
            shortUrl: live.short_url ?? null,
            keyId: env.RAZORPAY_KEY_ID,
            callbackUrl: env.RAZORPAY_CALLBACK_URL || null,
            brand: brandForCheckout(),
            reused: true,
          });
        }
      } catch (err) {
        // Their outage is not a reason to refuse a sale. Fall through and make
        // a new one; the stale row is tidied below.
        logger.warn({ err, subscription: open.providerSubscriptionId }, 'could not re-read a checkout');
      }
    }

    if (open) {
      /*
       * Retire the old one before making another.
       *
       * Best-effort at the provider and unconditional here: if their cancel
       * fails we still mark ours expired, because leaving it `created` would
       * put it straight back into the reuse path above and into the console's
       * queue. A logged orphan somebody can cancel by hand beats a row this
       * server keeps offering.
       */
      await cancelSubscription(open.providerSubscriptionId, { atCycleEnd: false }).catch((err) =>
        logger.warn(
          { err, subscription: open.providerSubscriptionId },
          'could not cancel an abandoned checkout at the provider',
        ),
      );
      open.status = SUBSCRIPTION_STATUS.EXPIRED;
      await open.save();
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
       * The hosted page, kept as the fallback.
       *
       * The native SDK is the primary path now: it renders inside the app and
       * takes `name` and `image`, which is what puts MedPin on the screen the
       * customer is typing a card into. The hosted page shows the Razorpay
       * account holder's name and offers no way to change it.
       *
       * Still sent, because the SDK cannot run everywhere — no Play Services,
       * an install that failed, a platform the plugin does not cover — and a
       * checkout that opens in a browser is better than one that does not open.
       */
      shortUrl: created.short_url ?? null,
      // The public half of the pair. The SDK needs it to open checkout.
      keyId: env.RAZORPAY_KEY_ID,
      callbackUrl: env.RAZORPAY_CALLBACK_URL || null,
      /*
       * Who the customer is paying, in their words and their picture.
       *
       * Sent from here rather than compiled into the app: a wrong or missing
       * logo on a payment sheet is fixed by a deploy, not by an app release, an
       * install and a version gate on every phone. Razorpay's hosted page could
       * not be told any of this at all, which is why checkout was showing
       * customers the account holder's personal name.
       */
      brand: brandForCheckout(),
    });
  }),
);

/**
 * The app says checkout succeeded. Decide whether it did.
 *
 * ---- The rule this route exists to enforce -------------------------------
 *
 * A success callback arrives over a channel the app controls, on a device
 * somebody else owns. A patched build can call it with any three strings it
 * likes. So nothing here trusts the fields — it trusts the signature over them,
 * which only Razorpay and this server can produce.
 *
 * ---- Why this does not grant the plan ------------------------------------
 *
 * A verified signature proves a human completed a real checkout and authorised
 * a mandate. It does not prove money moved: on a subscription the first charge
 * can still fail, and on some methods the debit lands a day later. So this
 * moves the row to `authenticated` and the webhook moves it to `active`.
 *
 * The gap between the two is where a failed mandate lives, and collapsing it —
 * activating here because the customer clearly meant to pay — is the same
 * mistake as trusting the callback, one step further in.
 */
router.post(
  '/verify',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      paymentId: z.string().min(4).max(80),
      subscriptionId: z.string().min(4).max(80),
      signature: z.string().min(16).max(256),
    }),
  }),
  audit('update', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    if (!practiceId) throw badRequest('This account is not linked to a practice yet.');

    const { paymentId, subscriptionId, signature } = req.body;

    /*
     * Scoped to the caller's own practice, and looked up before the signature
     * is checked so a valid signature for somebody else's subscription is still
     * a 404. Without the practice in this filter, any doctor holding a genuine
     * receipt could mark another clinic's subscription authenticated.
     */
    const sub = await Subscription.findOne({
      practice: practiceId,
      providerSubscriptionId: subscriptionId,
    });
    if (!sub) throw notFound('No such subscription for this practice.');

    if (!verifyCheckoutSignature({ paymentId, subscriptionId, signature })) {
      logger.warn(
        { practice: String(practiceId), subscriptionId },
        'rejected a checkout callback with a bad signature',
      );
      throw badRequest('That payment could not be verified.');
    }

    /*
     * Idempotent, because the app will retry.
     *
     * A phone that loses its connection between checkout and this call retries
     * on the next launch, and the webhook may well have arrived in between. A
     * second verification must not walk an active subscription backwards to
     * `authenticated`, so the status only moves while it is still ahead of it.
     */
    const early = [SUBSCRIPTION_STATUS.CREATED, SUBSCRIPTION_STATUS.AUTHENTICATED];
    if (early.includes(sub.status)) sub.status = SUBSCRIPTION_STATUS.AUTHENTICATED;

    sub.providerPaymentId = paymentId;
    sub.checkoutVerifiedAt = sub.checkoutVerifiedAt ?? new Date();

    /*
     * The ids checkout does not hand back.
     *
     * The callback carries a payment id and nothing else, so the payer and the
     * invoice — the two references somebody reconciling a disputed charge
     * actually asks for — have to be fetched.
     *
     * Best-effort on purpose. The signature has already been verified and the
     * subscription is authenticated whether or not this call succeeds; failing
     * the request over a missing convenience id would turn a completed payment
     * into an error on the customer's screen. Their outage must not become our
     * refusal.
     */
    try {
      const payment = await fetchPayment(paymentId);
      sub.providerCustomerId = payment?.customer_id ?? sub.providerCustomerId;
      sub.providerInvoiceId = payment?.invoice_id ?? sub.providerInvoiceId;
    } catch (err) {
      logger.warn({ err, paymentId }, 'could not fetch a payment to record its references');
    }

    await sub.save();

    logger.info(
      { practice: String(practiceId), subscriptionId, paymentId },
      'checkout signature verified',
    );

    res.json({
      verified: true,
      status: sub.status,
      // Said plainly, so a client cannot read this as "they are on the plan".
      // The screen shows what is true and the webhook is what makes it true.
      activated: sub.status === SUBSCRIPTION_STATUS.ACTIVE,
    });
  }),
);

/**
 * Move to a different plan.
 *
 * Direction decides the timing, and the policy is that money never moves
 * backwards: an upgrade lands now and gives away the rest of a cheaper period,
 * a downgrade lands at the end of one they have already paid for. Neither owes
 * a refund, which is why there is no proration anywhere in this file.
 *
 * As everywhere else here, this asks the provider and does not touch
 * `practice.plan`. An upgrade Razorpay accepts is still not an upgrade until
 * their webhook says the new amount was charged — the same rule that keeps a
 * checkout callback from granting a plan.
 */
router.post(
  '/change-plan',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      plan: z.enum([PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE]),
    }),
  }),
  audit('update', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    if (!practiceId) throw badRequest('This account is not linked to a practice yet.');

    const sub = await Subscription.findOne({
      practice: practiceId,
      status: { $nin: [SUBSCRIPTION_STATUS.CANCELLED, SUBSCRIPTION_STATUS.EXPIRED] },
    }).sort({ createdAt: -1 });
    if (!sub) throw notFound('This practice has no subscription to change.');

    if (!mayChangePlan(sub.status)) {
      // Named states rather than a generic refusal. "Your payment is
      // outstanding" and "this subscription has ended" need different actions.
      throw conflict(
        sub.status === SUBSCRIPTION_STATUS.HALTED
          ? 'There is a payment outstanding on this subscription. Settle it before changing plan.'
          : `A subscription that is ${sub.status} cannot change plan.`,
      );
    }

    const change = describeChange(sub.plan, req.body.plan);
    // Null means a plan nobody has ranked. Guessing upgrade bills somebody
    // immediately for a tier we do not understand; guessing downgrade gives it
    // away for a month.
    if (!change) throw badRequest('That plan cannot be compared with the current one.');
    if (change.direction === CHANGE.SAME) {
      return res.json({ changed: false, ...change, plan: sub.plan });
    }

    const planId = planIdFor(req.body.plan);
    if (!planId) throw badRequest(`No Razorpay plan is configured for "${req.body.plan}".`);

    await updateSubscriptionPlan(sub.providerSubscriptionId, {
      planId,
      at: change.at,
    });

    /*
     * What was asked for, recorded separately from what is in force.
     *
     * A downgrade scheduled for cycle end is a fact about the future, and
     * writing it into `plan` would tell the practice it had already lost the
     * larger tier. `pendingPlan` is what the console and the app read to say
     * "changing to Essential on 9 October".
     */
    if (change.direction === CHANGE.UPGRADE) {
      sub.plan = req.body.plan;
      sub.providerPlanId = planId;
      sub.pendingPlan = null;
    } else {
      sub.pendingPlan = req.body.plan;
    }
    await sub.save();

    logger.info(
      { practice: String(practiceId), from: sub.plan, to: req.body.plan, at: change.at },
      'subscription plan change requested',
    );

    res.json({ changed: true, plan: req.body.plan, ...change });
  }),
);

/**
 * Stop charging without ending the arrangement.
 *
 * Distinct from cancelling because the mandate stays authorised: resuming needs
 * no second trip through checkout, and a clinic closing for a month should not
 * have to re-authorise a bank debit to come back.
 *
 * Nothing is withheld while paused. A practice that has told us it is pausing
 * is not a practice that has stopped paying, and treating the two the same
 * would make the honest thing to do the expensive one.
 */
router.post(
  '/pause',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  audit('update', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    if (!practiceId) throw badRequest('This account is not linked to a practice yet.');

    const sub = await Subscription.findOne({ practice: practiceId }).sort({ createdAt: -1 });
    if (!sub) throw notFound('This practice has no subscription.');
    if (!mayPause(sub.status)) {
      throw conflict(`A subscription that is ${sub.status} cannot be paused.`);
    }

    await pauseSubscription(sub.providerSubscriptionId);
    // Asked for, not confirmed. The webhook moves it, like everything else.
    logger.info({ practice: String(practiceId) }, 'subscription pause requested');

    res.json({ requested: true, status: sub.status });
  }),
);

router.post(
  '/resume',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  audit('update', 'Subscription'),
  asyncHandler(async (req, res) => {
    if (!configured()) throw badRequest('Payments are not set up on this server.');

    const practiceId = await practiceOf(req);
    if (!practiceId) throw badRequest('This account is not linked to a practice yet.');

    const sub = await Subscription.findOne({ practice: practiceId }).sort({ createdAt: -1 });
    if (!sub) throw notFound('This practice has no subscription.');
    if (!mayResume(sub.status)) {
      throw conflict(`A subscription that is ${sub.status} cannot be resumed.`);
    }

    await resumeSubscription(sub.providerSubscriptionId);
    logger.info({ practice: String(practiceId) }, 'subscription resume requested');

    res.json({ requested: true, status: sub.status });
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
