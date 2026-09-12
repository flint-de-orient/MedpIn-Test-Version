import { env } from './env.js';

/**
 * What this deployment can actually do, given the configuration it has.
 *
 * ---- The gap this closes ------------------------------------------------
 *
 * `env.js` opens with "Fail fast on misconfiguration. A healthcare service
 * silently starting with a missing JWT secret or no AI key is worse than not
 * starting at all." That is true of the secrets it requires. It is not true of
 * the dozen that default to `''`, and those are the ones that decide whether
 * whole features work.
 *
 * `ADMIN_CONSOLE_URL` is the example that cost real time. Unset, the server
 * boots clean, every test passes, the signup flow works end to end — and the
 * confirmation email goes out without the link in it, because the code that
 * builds it correctly omits the paragraph rather than sending a dead URL. So
 * no applicant can ever confirm their address, `contactEmailVerified` stays
 * false forever, and nothing anywhere says why. It was found by reading the
 * code, which is not a monitoring strategy.
 *
 * These cannot be *required*: a development machine has no SMTP, no Firebase
 * key and no Razorpay account, and a server that refused to start without them
 * would be a server nobody could run locally. The answer is not to fail — it is
 * to stop being quiet.
 *
 * ---- Three states, and "off" is a legitimate one -----------------------
 *
 *   ready     configured and usable
 *   degraded  configured wrongly, or half-configured — the state worth waking
 *             somebody for, because it usually looks like working
 *   off       deliberately not configured. A development box, or a feature
 *             this deployment does not use.
 *
 * The distinction between `off` and `degraded` is the whole point. Missing
 * SMTP on a laptop is `off` and fine; a Razorpay key with no webhook secret is
 * `degraded` and means every forged callback is accepted.
 */

const READY = 'ready';
const DEGRADED = 'degraded';
const OFF = 'off';

/** True when a value is set to something that is not whitespace. */
const set = (v) => typeof v === 'string' && v.trim().length > 0;

/**
 * Every subsystem whose behaviour depends on configuration, and what breaks.
 *
 * `affects` is written for whoever is reading this at 9pm wondering why a
 * customer says they never got an email. It names the user-visible consequence,
 * not the variable.
 */
export function readiness() {
  const checks = [];

  // ---- email --------------------------------------------------------------
  checks.push(
    set(env.SMTP_HOST)
      ? { key: 'email', state: READY, because: `sending through ${env.SMTP_HOST}` }
      : {
          key: 'email',
          state: OFF,
          because: 'SMTP_HOST is not set',
          affects:
            'Mail is written to the log instead of sent. Application confirmations, ' +
            'decisions and admin password resets reach nobody.',
        },
  );

  // ---- the links inside those emails --------------------------------------
  /*
   * Its own check rather than part of email, because the two fail
   * independently and the combination is the confusing one: SMTP configured
   * and this missing sends a real email that cannot do its job.
   */
  checks.push(
    set(env.ADMIN_CONSOLE_URL)
      ? { key: 'consoleLinks', state: READY, because: env.ADMIN_CONSOLE_URL }
      : {
          key: 'consoleLinks',
          state: set(env.SMTP_HOST) ? DEGRADED : OFF,
          because: 'ADMIN_CONSOLE_URL is not set',
          affects:
            'Applicants cannot confirm their email address — the confirmation ' +
            'paragraph is omitted, so contactEmailVerified can never become true. ' +
            'Admin password reset by email is refused outright.',
        },
  );

  // ---- payments -----------------------------------------------------------
  const keys = set(env.RAZORPAY_KEY_ID) && set(env.RAZORPAY_KEY_SECRET);
  const plans = [
    env.RAZORPAY_PLAN_ESSENTIAL,
    env.RAZORPAY_PLAN_PROFESSIONAL,
    env.RAZORPAY_PLAN_ENTERPRISE,
  ].filter(set);

  if (!keys) {
    checks.push({
      key: 'payments',
      state: OFF,
      because: 'RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET are not set',
      affects: 'Nobody can subscribe or change plan.',
    });
  } else if (!set(env.RAZORPAY_WEBHOOK_SECRET)) {
    /*
     * The dangerous one, and the reason this file exists in this shape.
     *
     * Without a webhook secret there is nothing to verify a callback against.
     * It fails open: every forged POST is accepted, including "payment
     * succeeded". A deployment in this state takes payments and hands out
     * subscriptions to anybody who guesses the URL.
     */
    checks.push({
      key: 'payments',
      state: DEGRADED,
      because: 'RAZORPAY_WEBHOOK_SECRET is not set while the API keys are',
      affects:
        'Webhook signatures cannot be verified. A forged callback claiming ' +
        '"payment succeeded" would be accepted.',
    });
  } else if (env.RAZORPAY_WEBHOOK_SECRET === env.RAZORPAY_KEY_SECRET) {
    // The commonest way this integration is got wrong — see env.js.
    checks.push({
      key: 'payments',
      state: DEGRADED,
      because: 'RAZORPAY_WEBHOOK_SECRET is the same value as RAZORPAY_KEY_SECRET',
      affects:
        'These are different secrets in Razorpay. Signature verification will ' +
        'reject every genuine webhook, so paid subscriptions never activate.',
    });
  } else if (plans.length < 3) {
    checks.push({
      key: 'payments',
      state: DEGRADED,
      because: `${plans.length} of 3 RAZORPAY_PLAN_* ids are set`,
      affects: 'Checkout fails for the plans whose id is missing.',
    });
  } else if (!set(env.RAZORPAY_CALLBACK_URL)) {
    checks.push({
      key: 'payments',
      state: DEGRADED,
      because: 'RAZORPAY_CALLBACK_URL is not set',
      affects: 'A customer finishing checkout is not returned anywhere.',
    });
  } else {
    checks.push({ key: 'payments', state: READY, because: `${env.RAZORPAY_KEY_ID}` });
  }

  // ---- the logo Razorpay's checkout fetches -------------------------------
  checks.push(
    set(env.PUBLIC_API_ORIGIN)
      ? { key: 'publicOrigin', state: READY, because: env.PUBLIC_API_ORIGIN }
      : {
          key: 'publicOrigin',
          state: keys ? DEGRADED : OFF,
          because: 'PUBLIC_API_ORIGIN is not set',
          affects:
            'Razorpay checkout fetches the brand logo over the network, so a ' +
            'relative path is useless. Checkout opens unbranded.',
        },
  );

  // ---- push ---------------------------------------------------------------
  checks.push(
    set(env.GOOGLE_APPLICATION_CREDENTIALS)
      ? { key: 'push', state: READY, because: 'service account configured' }
      : {
          key: 'push',
          state: OFF,
          because: 'GOOGLE_APPLICATION_CREDENTIALS is not set',
          affects:
            'Notifications are logged rather than delivered. Medication reminders ' +
            'still fire from the handset; the server backstop does not.',
        },
  );

  // ---- the platform console ----------------------------------------------
  if (!set(env.ADMIN_JWT_SECRET)) {
    checks.push({
      key: 'adminConsole',
      state: OFF,
      because: 'ADMIN_JWT_SECRET is not set',
      affects: 'The platform admin console is switched off — every route under /admin refuses.',
    });
  } else if (env.ADMIN_JWT_SECRET === env.JWT_ACCESS_SECRET) {
    /*
     * Separate keys on purpose: a clinic token put in front of the admin
     * verifier must fail *signature* verification rather than a role check,
     * because there is no role check to forget. Sharing the value defeats the
     * whole arrangement.
     */
    checks.push({
      key: 'adminConsole',
      state: DEGRADED,
      because: 'ADMIN_JWT_SECRET is the same value as JWT_ACCESS_SECRET',
      affects:
        'A clinic access token would verify against the platform admin API. ' +
        'The separation exists so that cannot happen.',
    });
  } else {
    checks.push({ key: 'adminConsole', state: READY, because: 'signing key configured' });
  }

  // ---- staging must not be able to reach a real patient -------------------
  /*
   * The check this whole file was worth writing for.
   *
   * Staging runs NODE_ENV=production on purpose — half of what is worth
   * rehearsing is production-only behaviour. So nothing in the process knows
   * it is not the real thing, and a `.env` copied from production to save five
   * minutes gives a rehearsal environment the ability to text and push real
   * patients.
   *
   * That is not a hypothetical kind of mistake. It is the *expected* one: the
   * fastest way to stand up a second environment is to copy the first one's
   * configuration, and every outward channel here is credential-gated in a way
   * that fails silent-and-safe when omitted — which means omitting them looks
   * exactly like forgetting to set them up.
   *
   * `degraded` rather than fatal, deliberately. There is a legitimate reason
   * to point staging at a live channel: proving an SMS template renders, or
   * that a DLT sender id works, cannot be done any other way. It should be a
   * decision somebody made this morning, not a state the box has been in for
   * three weeks.
   */
  if (env.DEPLOY_ENV === 'staging') {
    const live = [
      set(env.MSG91_AUTH_KEY) && set(env.MSG91_SENDER_ID) && 'SMS (MSG91)',
      set(env.GOOGLE_APPLICATION_CREDENTIALS) && 'push (Firebase)',
      set(env.SMTP_HOST) && 'email (SMTP)',
    ].filter(Boolean);

    checks.push(
      live.length
        ? {
            key: 'stagingIsolation',
            state: DEGRADED,
            because: `staging holds live credentials for ${live.join(', ')}`,
            affects:
              'This deployment can send to real people. If the database holds a ' +
              'copy of production, a test run will text and notify actual patients.',
          }
        : {
            key: 'stagingIsolation',
            state: READY,
            because: 'no outward channel is configured — messages are logged, not sent',
          },
    );
  }

  return checks;
}

/** A one-line summary, safe to publish: counts, never reasons. */
export function readinessSummary() {
  const checks = readiness();
  const degraded = checks.filter((c) => c.state === DEGRADED);
  return {
    config: degraded.length ? DEGRADED : READY,
    /*
     * The count is published and the detail is not.
     *
     * A deploy script needs to know something is wrong without authenticating;
     * an attacker reading "payments: no webhook secret" learns exactly which
     * forged request to send. `off` is excluded from the count deliberately —
     * a development box would otherwise always look broken, and a signal that
     * is always red is one nobody reads.
     */
    degradedCount: degraded.length,
  };
}

export { READY, DEGRADED, OFF };
