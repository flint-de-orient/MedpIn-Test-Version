/**
 * What the assistant would actually say to somebody having an emergency.
 *
 * ---- Why not just send a test message -----------------------------------
 *
 * Because an urgent-sounding message to a live server is not a read. Before any
 * model call, [ai/assistant.js] escalates: a ClinicalAlert is created, staff get
 * a push notification, and the session is flagged for review. So the test costs
 * a doctor's phone buzzing about an emergency that is not happening, an open
 * alert somebody has to acknowledge, and a reply out of the month's allowance.
 *
 * And it checks one of nine places. The number is interpolated into three
 * languages across the emergency instruction, the urgent instruction, the
 * scripted emergency fallback and the scripted unavailable fallback. An English
 * message exercises English. A patient reading the Bengali emergency script is
 * exactly who this matters for, and no single message reaches them.
 *
 * ---- What this does instead ---------------------------------------------
 *
 * Imports the real prompt module with the real environment and prints every
 * composed string, built the way a reply is built: `fallbackReply` fills the
 * number in per reply, and with no practice given it is the configured one —
 * the founding practice's, and what a patient whose practice is not known is
 * given. Another practice's patients are offered their own location's number
 * instead (see clinicIdentity.js), which this does not check.
 *
 *   node scripts/checkEmergencyContact.js
 *   node scripts/checkEmergencyContact.js --expect +918981540690
 *
 * `--expect` is the part worth typing. The server refuses to boot on a
 * placeholder, so a healthy server already proves the number is real — it does
 * not prove it is the right one. A transposed digit boots perfectly.
 */
import { clinicEmergencyPhone, orCallClinic } from '../src/services/clinicContact.js';
import { fallbackReply } from '../src/services/ai/prompts.js';

const LANGS = ['en', 'bn', 'hi'];

const at = process.argv.indexOf('--expect');
const expected = at > -1 ? process.argv[at + 1] : null;

const bad = (m) => {
  console.log(`\n  FAIL  ${m}`);
  process.exitCode = 1;
};

const digits = (s) => String(s ?? '').replace(/\D/g, '');

function main() {
  const phone = clinicEmergencyPhone();

  console.log('\n  The number the assistant reads out\n');

  if (!phone) {
    bad('no usable number — every "or call ..." clause is dropped.');
    console.log('        That is the safe failure and the advice stays correct,');
    console.log('        but nobody is being given a number to ring.\n');
    return;
  }

  console.log(`    ${phone}`);

  if (expected) {
    // Compared on digits, so +91 8981 540690 and +918981540690 agree. A
    // formatting difference is not a wrong number.
    if (digits(phone) === digits(expected)) {
      console.log(`    matches --expect ${expected}`);
    } else {
      bad(`this is not ${expected} — the server booted, so it is a real number,`);
      console.log('        but it is not the one you meant.');
    }
  } else {
    console.log('    (pass --expect <number> to check it is the right one)');
  }

  // ---- the clause, per language -----------------------------------------
  console.log('\n  The clause, in each language\n');
  for (const lang of LANGS) {
    const clause = orCallClinic(lang);
    if (!clause) bad(`${lang}: empty clause with a valid number set`);
    else if (!clause.includes(phone)) bad(`${lang}: clause does not contain the number`);
    else console.log(`    ${lang}  ...${clause.trim()}`);
  }

  // ---- the scripted replies ---------------------------------------------
  //
  // These go out when generation fails, which is when the model is down and a
  // patient is least able to wait. They are the highest-stakes strings here.
  console.log('\n  The scripted emergency reply\n');
  for (const lang of LANGS) {
    const text = fallbackReply('emergency', lang);
    if (!text) {
      bad(`emergency fallback missing for ${lang}`);
      continue;
    }
    if (!text.includes(phone)) {
      bad(`the ${lang} emergency script does not carry the number`);
      continue;
    }
    const line = text.split('\n').find((l) => l.includes(phone));
    console.log(`    ${lang}  ${line.trim()}`);
  }

  console.log('\n  The scripted unavailable reply\n');
  for (const lang of LANGS) {
    const text = fallbackReply('unavailable', lang);
    if (!text?.includes(phone)) {
      bad(`the ${lang} unavailable script does not carry the number`);
      continue;
    }
    const line = text.split('\n').find((l) => l.includes(phone));
    console.log(`    ${lang}  ${line.trim()}`);
  }

  // ---- and nothing anywhere still says the old one ----------------------
  const every = [
    ...LANGS.map((l) => orCallClinic(l)),
    ...LANGS.flatMap((l) => [fallbackReply('emergency', l), fallbackReply('unavailable', l)]),
  ].join('\n');

  const others = [...every.matchAll(/\+?\d[\d\s-]{7,}\d/g)]
    .map((m) => m[0].trim())
    .filter((n) => digits(n) !== digits(phone));

  if (others.length) {
    bad(`another number appears in these strings: ${[...new Set(others)].join(', ')}`);
  }

  console.log(
    process.exitCode
      ? '\n  Something above would reach a patient wrong.\n'
      : '\n  Every emergency path carries this number, in all three languages.\n',
  );
}

main();
