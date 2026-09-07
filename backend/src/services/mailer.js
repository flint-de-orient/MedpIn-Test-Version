import nodemailer from 'nodemailer';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Sending email, and not sending it when there is nowhere to send from.
 *
 * ---- Unconfigured logs instead of failing -------------------------------
 *
 * The same shape as sms.js: with no SMTP host set, the message is written to
 * the log rather than delivered, so the whole flow — request a reset, follow
 * the link, choose a password — can be exercised on a laptop with no mail
 * server and no account anywhere.
 *
 * The alternative is a reset flow nobody can test until production, which is
 * where it would then be tested.
 *
 * ---- What is deliberately not here --------------------------------------
 *
 * No templating engine, no HTML framework, no tracking pixel. Two messages get
 * sent from this system and both are a link and a sentence explaining it. A
 * reset email that arrives as a designed newsletter is a reset email that looks
 * like every phishing attempt the recipient has been taught to distrust.
 */

let transport = null;

export function mailConfigured() {
  return Boolean(env.SMTP_HOST && env.SMTP_USER);
}

function transporter() {
  if (transport) return transport;
  transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    // 465 is implicit TLS; everything else negotiates STARTTLS, which
    // nodemailer does by default and will refuse to skip.
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return transport;
}

/**
 * Send one message.
 *
 * Throws when a configured transport refuses, so a caller that must know can
 * find out. The reset flow deliberately does not — see the note there about
 * telling a stranger which addresses have accounts.
 */
export async function sendMail({ to, subject, text }) {
  if (!mailConfigured()) {
    // Not a silent no-op: the whole message goes to the log, so a developer can
    // copy the link out of it and carry on.
    logger.warn(
      { to, subject, body: text },
      'SMTP is not configured — email logged instead of sent',
    );
    return { delivered: false, logged: true };
  }

  const info = await transporter().sendMail({
    from: env.SMTP_FROM || env.SMTP_USER,
    to,
    subject,
    text,
  });

  logger.info({ to, subject, messageId: info.messageId }, 'email sent');
  return { delivered: true, logged: false };
}

/**
 * The two messages this system sends.
 *
 * Plain text, no HTML. Every line is either the link or the reason it arrived,
 * and each says plainly what to do if it was not expected — which is the only
 * part of a security email anybody reads when it was not.
 */
export function resetEmail({ link, expiresMinutes }) {
  return {
    subject: 'Reset your MedPin operator password',
    text: [
      'Somebody asked to reset the password on your MedPin operator account.',
      '',
      'Open this link to choose a new one:',
      link,
      '',
      `The link stops working in ${expiresMinutes} minutes and can only be used once.`,
      '',
      'You will still need your passkey or your authenticator code to finish.',
      'This link alone cannot get anybody into the account.',
      '',
      'If this was not you, nothing has changed and you can ignore this message.',
      'Your password still works. It is worth telling whoever else administers',
      'the platform that a reset was requested.',
    ].join('\n'),
  };
}

export function verifyEmail({ link, expiresHours }) {
  return {
    subject: 'Confirm your MedPin operator email',
    text: [
      'Confirm this address so it can be used to recover your account.',
      '',
      link,
      '',
      `The link stops working in ${expiresHours} hours.`,
      '',
      'If you were not expecting this, ignore it — nothing changes until the',
      'link is opened.',
    ].join('\n'),
  };
}
