import nodemailer from 'nodemailer';
import { channel } from 'node:diagnostics_channel';

import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { outboundBlocked } from '../config/outbound.js';

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

/**
 * What a send that was not allowed would have been, for whoever is listening.
 *
 * A test run emails nobody — see config/outbound.js — and until now that also
 * meant no test could tell whether a message was composed at all. "The
 * applicant is told" was a promise on three screens that nothing could hold
 * the code to. So a blocked send is announced on a diagnostics channel: no
 * export for a test to reach into, nothing spent when nobody subscribes, and
 * nothing subscribes outside a test.
 */
const blocked = channel('medpin:mail');

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
    /*
     * Give up rather than hold whoever is waiting.
     *
     * nodemailer's defaults are two minutes to connect, thirty seconds for the
     * greeting and ten minutes of silence on the socket. A mail host that took
     * the connection and then said nothing held an applicant on "Submitting…"
     * for as long as that, over an application already written. Nothing waits
     * on a send any more, but a hung one still holds a socket and a promise, so
     * it is bounded as well.
     */
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
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
  // A test run emails nobody, whatever this machine's .env holds — see
  // config/outbound.js.
  if (outboundBlocked()) {
    if (blocked.hasSubscribers) blocked.publish({ to, subject, text });
    logger.debug({ to, subject }, 'test run — email not sent');
    return { delivered: false, logged: true };
  }

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

/**
 * What an applicant is told when an operator decides.
 *
 * ---- Promised three times, and never sent -------------------------------
 *
 * The confirmation email says "we will write to you either way". The status
 * page says a request for information should be answered by reply. The console
 * tells an operator the applicant reads the reason for a rejection. None of it
 * was ever written to anybody: the decision sat on a status page the applicant
 * had no reason to reopen.
 *
 * ---- What each one has to say -------------------------------------------
 *
 * An approval says how to get in, because that is all the reader needs next:
 * the MedPin app, the number they proved, a code texted to it. There is no
 * password to send and no link that signs anybody in. When the person applying
 * was not the doctor, it says the doctor is still to be added and where.
 *
 * The note an operator writes on an approval is not in it. That note is the
 * platform's record, and the console tells the operator writing it that nobody
 * at the practice reads it. The other two carry their note, because the note
 * is the whole of the message.
 */
export function applicationDecisionEmail({
  decision,
  application,
  note = null,
  outcome = null,
  statusLink = null,
}) {
  const ref = application.reference;
  const name = application.practiceName;
  const check = statusLink ? ['', 'See where it has got to at any time:', statusLink] : [];

  if (decision === 'approved') {
    const managing = Boolean(outcome?.managesOnly);
    const doctor = outcome?.doctorToAdd ?? null;
    return {
      subject: `${name} is approved on MedPin`,
      text: [
        managing
          ? `Your application for ${name} is approved. The practice now exists on MedPin, with you as its practice manager.`
          : `Your application for ${name} is approved, and the practice now exists on MedPin.`,
        '',
        'To sign in, open the MedPin app and sign in with the mobile number you verified',
        `when you applied: ${application.contactPhone}. We text a one-time code to that number`,
        'each time. There is no password to set up.',
        ...(outcome?.accountReused
          ? ['', 'That number already signs in to MedPin, so the practice has been added to the account you have.']
          : []),
        ...(managing
          ? [
              '',
              'As practice manager you run the practice — its people, departments and settings.',
              'You do not see patient records or prescribe.',
            ]
          : []),
        ...(doctor || managing
          ? [
              '',
              `The practice's doctor${doctor ? `, ${doctor},` : ''} still has to be added. In the app, open More,`,
              'then People, and add them with their own mobile number. They sign in with a code',
              'sent to that number.',
            ]
          : []),
        ...check,
        '',
        `Your reference was ${ref}.`,
      ].join('\n'),
    };
  }

  if (decision === 'more_info') {
    return {
      subject: `MedPin needs more about ${name} (${ref})`,
      text: [
        `Before your application for ${name} can be decided, MedPin needs something more:`,
        '',
        note,
        '',
        `Reply to this email with it, and quote your reference ${ref}.`,
        ...check,
      ].join('\n'),
    };
  }

  return {
    subject: `Your MedPin application for ${name} (${ref})`,
    text: [
      `Your application for ${name} has not been approved.`,
      '',
      'The reason given:',
      note,
      '',
      'This is not a ban. If it is something you can put right — a missing paper, a number',
      'that did not match — you are welcome to apply again.',
      ...check,
    ].join('\n'),
  };
}

/**
 * What the owner of a practice an operator made is told.
 *
 * The console path's counterpart to an approval's email, for the same reason:
 * the person who will run the practice should hear it from MedPin rather than
 * only from whoever typed it in. It says how to get in — the app, the number
 * that was verified, a code texted to it — and that there is no password,
 * because nobody set one on their behalf and a message implying otherwise is a
 * message somebody could imitate.
 */
export function practiceReadyEmail({ practiceName, ownerName, phone, managesOnly = false }) {
  return {
    subject: `${practiceName} is set up on MedPin`,
    text: [
      `${ownerName ? `${ownerName}, ` : ''}${practiceName} now exists on MedPin${managesOnly ? ', with you as its practice manager' : ', with you as its head doctor'}.`,
      '',
      'To sign in, open the MedPin app and sign in with this mobile number:',
      `${phone}. We text a one-time code to that number each time. There is no password to set up.`,
      '',
      managesOnly
        ? 'From there you can add the practice’s doctors and staff, and check its locations and hours.'
        : 'From there you can check your locations and opening hours, and add your staff.',
      '',
      'If you were not expecting this, reply to this email and we will look into it.',
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
