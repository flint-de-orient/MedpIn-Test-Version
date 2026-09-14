import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { outboundBlocked } from '../config/outbound.js';

/**
 * Sending one-time passcodes over MSG91.
 *
 * Two approved templates, one per purpose, registered with India's DLT
 * registry against the clinic's sender ID. The wording lives at MSG91 and
 * cannot be changed from here — this file only fills the variable in.
 */

const FLOW_URL = 'https://control.msg91.com/api/v5/flow/';

/** Whether real SMS can be sent at all. */
export function smsConfigured() {
  return Boolean(env.MSG91_AUTH_KEY && env.MSG91_SENDER_ID);
}

function templateFor(purpose) {
  if (purpose === 'login') return env.MSG91_TEMPLATE_LOGIN;
  // `enrol` falls back to the registration template until one of its own is
  // registered with DLT. India requires every template to be pre-approved, so
  // this cannot simply be worded differently in code — see MSG91_TEMPLATE_ENROL
  // in the env config. Falling back keeps enrolment working meanwhile; the
  // wording is merely less precise than it should be.
  if (purpose === 'enrol') return env.MSG91_TEMPLATE_ENROL || env.MSG91_TEMPLATE_REGISTER;
  return env.MSG91_TEMPLATE_REGISTER;
}

/**
 * MSG91 wants the number without a leading `+`.
 *
 * A bare ten-digit Indian number is also accepted here and given 91, because
 * that is what a patient types and what `toE164` may leave alone on a number
 * that never had a country code.
 */
function toMobiles(phone) {
  const digits = String(phone).replace(/\D/g, '');
  return digits.length === 10 ? `91${digits}` : digits;
}

/**
 * Text a one-time passcode.
 *
 * Resolves when the message is accepted by MSG91, throws when it is not — the
 * caller must not tell a patient to check their phone for a message that was
 * never sent.
 */
export async function sendOtpSms({ phone, code, purpose }) {
  // A test run texts nobody, whatever this machine's .env holds — see
  // config/outbound.js. Asked before the credentials, because credentials
  // being present is precisely the case this exists for.
  if (outboundBlocked()) {
    logger.debug({ phone: maskPhone(phone), purpose }, 'test run — OTP not sent');
    return { delivered: false, simulated: true };
  }

  const templateId = templateFor(purpose);

  // No credentials: log the code and carry on, so the whole flow can be walked
  // through in development without an SMS budget or a handset. Never in
  // production — a clinic that deploys without credentials has to find out at
  // the first request, not by discovering patients' codes in the server log.
  if (!smsConfigured() || !templateId) {
    if (env.NODE_ENV === 'production') {
      throw new Error('SMS is not configured: set MSG91_AUTH_KEY, MSG91_SENDER_ID and the template IDs');
    }
    logger.warn({ phone: maskPhone(phone), purpose, code }, 'SMS not configured — OTP logged instead of sent');
    return { delivered: false, simulated: true };
  }

  // The two approved templates name their variable differently — `##OTP##` in
  // medpin_login, `##otp##` in medpin_register. Both keys go on every request
  // rather than mapping purpose to case: MSG91 ignores a variable a template
  // does not use, and a template re-registered with the other spelling would
  // otherwise start sending blanks.
  const body = {
    template_id: templateId,
    sender: env.MSG91_SENDER_ID,
    short_url: '0',
    recipients: [{ mobiles: toMobiles(phone), OTP: code, otp: code }],
  };

  // A patient staring at a spinner is worse than a patient told it failed.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);

  let res;
  let payload;
  try {
    res = await fetch(FLOW_URL, {
      method: 'POST',
      headers: {
        authkey: env.MSG91_AUTH_KEY,
        'Content-Type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    payload = await res.json().catch(() => ({}));
  } catch (err) {
    logger.error({ err, phone: maskPhone(phone), purpose }, 'MSG91 request failed');
    throw new Error('Could not send the SMS');
  } finally {
    clearTimeout(timeout);
  }

  // MSG91 answers 200 with `{type: 'error'}` for a rejected template or a bad
  // number, so the status code alone does not mean it was accepted.
  const ok = res.ok && payload?.type !== 'error';
  if (!ok) {
    logger.error(
      { status: res.status, payload, phone: maskPhone(phone), purpose },
      'MSG91 rejected the message',
    );
    throw new Error('Could not send the SMS');
  }

  logger.info({ phone: maskPhone(phone), purpose, requestId: payload?.message }, 'OTP sent');
  return { delivered: true, simulated: false };
}

/** Last four digits only. A phone number is identifying on its own. */
export function maskPhone(phone) {
  const s = String(phone);
  return s.length <= 4 ? '****' : `***${s.slice(-4)}`;
}
