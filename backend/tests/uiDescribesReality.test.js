import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Explanatory copy goes stale silently.
 *
 * ---- Two of these shipped -----------------------------------------------
 *
 * The Account screen said the session was "held in memory only" and that
 * closing the tab signed you out, for several days after the session became a
 * cookie that survives a refresh. It was written when it was true and nothing
 * connected it to the change that made it false.
 *
 * The reject dialog said "the applicant sees this" of a reason that goes only
 * to the audit log — an audience that has never existed.
 *
 * This console explains itself more than most software does, which is the point
 * of it and also the exposure: prose that is confidently wrong is worse than no
 * prose, because somebody acts on it. A reader who is told the tab closing
 * signs them out leaves one open on a shared machine believing otherwise.
 *
 * So the claims that would be dangerous to get wrong are pinned to the code
 * that makes them true.
 */
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));

/**
 * Comments blanked, line numbers kept.
 *
 * Three assertions in this repository have now failed on the prose written to
 * document the rule they enforce — a layout scanner reading the comment that
 * explains why `min-h-full` is wrong, a contrast scanner reading the one about
 * `opacity-90`, and the tenant check below reading a docblock that names
 * `provisionPractice` to say it is not called there. Anything scanning for code
 * strips comments first.
 */
function withoutComments(body) {
  return body.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

function sourceUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += sourceUnder(full);
    else if (/\.tsx?$/.test(name)) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

const prose = sourceUnder(WEB).replace(/\s+/g, ' ');
const session = readFileSync(new URL('../src/services/adminSession.js', import.meta.url), 'utf8');
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');

describe('what the console says about the session is true', () => {
  test('it does not claim the session lives in memory', () => {
    // It has not since the cookie landed. Somebody told the tab closing signs
    // them out leaves one open on a shared machine believing otherwise.
    for (const stale of [
      'Held in memory only',
      'held in memory only',
      'Closing the tab signs you out',
      'signing in again after a refresh',
      'there is no “remember me”',
    ]) {
      assert.ok(!prose.includes(stale), `stale claim on screen: "${stale}"`);
    }
  });

  test('and the cookie it describes is the one that is set', () => {
    assert.match(prose, /cookie your browser will not let this page read/);
    assert.match(session, /httpOnly: true/);
  });

  test('two hours, in the copy and in the token', () => {
    const tokens = readFileSync(new URL('../src/services/adminTokens.js', import.meta.url), 'utf8');
    assert.match(tokens, /const TTL = '2h'/);
    assert.match(session, /MAX_AGE_MS = 2 \* 60 \* 60 \* 1000/);
    assert.match(prose, /lasts two hours/);
  });

  test('“no sign out everywhere” is still the truth', () => {
    // The moment a token store exists this becomes false, and the sentence has
    // to go with it rather than sitting there reassuring nobody.
    assert.ok(
      !/RefreshToken|tokenStore|revokedTokens/.test(routes),
      'the admin routes now track tokens; the copy promising no revocation is stale',
    );
    assert.match(prose, /There is no “sign out everywhere”/);
  });
});

describe('what the console says about a rejection is true', () => {
  test('it does not claim the practice is told', () => {
    // Nothing shows a rejection reason to anybody outside this console.
    assert.ok(
      !prose.includes('The applicant sees this'),
      'the reject dialog promises the applicant sees the reason',
    );
    assert.match(prose, /Nobody at the practice sees this/);
  });

  test('and the reason really does reach the audit log', () => {
    assert.match(routes, /action: 'admin\.practice\.verification'|reason: req\.body\.reason/);
  });
});

describe('what the console says about the setup key is true', () => {
  test('it says no message will arrive, because none does', () => {
    // The question that produced this was "where do I get the 6 digit code?",
    // asked by somebody waiting for a text on a screen that had explained why
    // SMS is a bad idea without saying where the code does come from.
    assert.match(prose, /Nothing will be sent to you/);

    // Scoped to the second-factor routes, not the whole file. The console does
    // text a code elsewhere — verifying a head doctor's phone number — and that
    // is a different claim about a different thing. An assertion that read the
    // whole file called the copy stale because an unrelated route gained an
    // SMS, which is the test being wrong rather than the sentence.
    const factor = routes.slice(
      routes.indexOf("'/me/totp/setup'"),
      routes.indexOf("'/me/totp/disable'"),
    );
    assert.ok(factor.length > 200, 'the second-factor routes moved');
    assert.ok(
      !/sendSms|requestOtp|msg91|twilio/i.test(factor),
      'enrolling a second factor now sends a message; the copy saying none arrives is stale',
    );
  });

  test('and that the factor stays off until a code is verified', () => {
    assert.match(prose, /a mistyped key cannot lock you out/);
    // The route is what makes that true: setup stores a secret and leaves the
    // flag alone.
    const setup = routes.slice(routes.indexOf("'/me/totp/setup'"));
    assert.match(setup.slice(0, 900), /admin\.totpEnabled = false;/);
  });
});


describe('what the console says about verification is true', () => {
  /** The body of the route that records a verification decision. */
  const decision = routes.slice(
    routes.indexOf("'/practices/:id/verification'"),
    routes.indexOf("'/practices/:id/status'"),
  );

  test('the route it belongs to is still there', () => {
    assert.ok(decision.length > 400, 'the verification route moved; the slice below reads nothing');
  });

  test('“nothing to verify” is a refusal, not only a sentence on screen', () => {
    // The wizard tells an operator creating a practice with no registration
    // number that it cannot be marked verified. That was written as an
    // explanation of a rule that did not exist: the route stamped verified on
    // anything, so the copy was describing a restraint nobody was under.
    // The wording moved when the paragraph became a banner with a title and one
    // line. What is pinned is the claim, not the sentence it was first made in:
    // somewhere on screen it says a practice with no number cannot be verified.
    assert.match(prose, /No registration number/);
    assert.match(prose, /Nothing to check against a register, so this cannot be verified/);
    assert.match(decision, /VERIFICATION\.VERIFIED &&[\s\S]{0,80}registrationOnFile/);
  });

  test('and it refuses before it writes', () => {
    // A guard after the save records the decision and then complains about it.
    const guard = decision.indexOf('registrationOnFile(practice)');
    const write = decision.indexOf('await practice.save()');
    assert.ok(guard > 0 && write > 0, 'the guard or the save is gone');
    assert.ok(guard < write, 'the practice is saved before the number is checked for');
  });

  test('all three places a number can live are looked in', () => {
    // A solo practice normally has it on the doctor and nowhere else — the
    // person is the practice. Looking only at Practice.registrationNo would
    // refuse to verify the commonest kind of customer there is.
    const helper = routes.slice(
      routes.indexOf('async function registrationOnFile('),
      routes.indexOf('Record that the registration has been checked'),
    );
    assert.match(helper, /practice\.registrationNo/);
    assert.match(helper, /membersOf\(/);
    assert.match(helper, /Clinic\.findOne\(/);
  });

  test('only “verified” is refused', () => {
    // Pending and rejected are both honest things to say about a practice that
    // has produced no paperwork, and rejected is the one you actually want to
    // reach when it never produces any.
    assert.ok(
      !/VERIFICATION\.(PENDING|REJECTED)[^\n]*registrationOnFile/.test(decision),
      'a practice with no number cannot even be marked pending or rejected',
    );
  });
});

/**
 * What the console says protects an account.
 *
 * The administrators page counted "protected by a password alone" as
 * `!totpEnabled`, which is false: sign-in offers a passkey *before* it asks for
 * a code, and an account holding one never reaches the TOTP branch at all. So a
 * passkey-only operator was told, in a banner, that their account had no second
 * factor — a warning about something they had already done better than the
 * accounts the check approved.
 *
 * The overview's attention panel asked the server, which derives it from both
 * fields. Two screens, two answers, same account.
 */
describe('the console agrees with the server about what a second factor is', () => {
  const admins = readFileSync(new URL('../../web/src/app/admins/page.tsx', import.meta.url), 'utf8');

  test('the server derives it from both factors', () => {
    const model = readFileSync(new URL('../src/models/PlatformAdmin.js', import.meta.url), 'utf8');
    const derived = model.slice(model.indexOf('hasSecondFactor'));
    assert.match(derived.slice(0, 200), /totpEnabled/);
    assert.match(derived.slice(0, 200), /passkeys/);
  });

  test('and a passkey really is checked before a code is asked for', () => {
    // The reason `!totpEnabled` is wrong rather than merely pessimistic. If
    // this order ever reversed, a passkey would stop being sufficient on its
    // own and the page's old test would become right again.
    const passkeyBranch = routes.indexOf("code: 'PASSKEY_REQUIRED'");
    const totpBranch = routes.indexOf("code: 'TOTP_REQUIRED'");
    assert.ok(passkeyBranch > 0 && totpBranch > 0, 'a sign-in branch is gone');
    assert.ok(passkeyBranch < totpBranch, 'a code is now asked for before a passkey');
  });

  test('so the page counts unprotected accounts with hasSecondFactor', () => {
    assert.match(admins, /a\.isActive && !a\.hasSecondFactor/);
  });

  test('and never decides it from totpEnabled alone', () => {
    /*
     * Pinned as a pattern rather than a line, because the bug is not one
     * expression — it is any place that treats the authenticator app as the
     * only factor there is. `totpEnabled` may still be read to say *which*
     * factor an account holds; it may not be read to say *whether* it holds
     * one.
     */
    assert.ok(
      !/!\s*a\.totpEnabled|!\s*admin\.totpEnabled\s*\)\s*return <Pill tone="waiting"/.test(admins),
      'the administrators page is back to treating TOTP as the only second factor',
    );
  });
});

/**
 * What the Edit details dialog says prints.
 *
 * It said "these appear on the practice's letterhead and on every prescription
 * it issues" over five fields, one of which was labelled "not shown to the
 * practice" three lines below — two sentences on one screen saying opposite
 * things about the same box.
 *
 * The subtler half: two of the four that do print are fallbacks. The PDF
 * prefers the prescribing doctor's own name and council number, so an operator
 * correcting a registration number on a practice whose doctor has their own was
 * editing a field that changes nothing on any prescription, having been told it
 * appears on all of them. That is worse than a typo — it is a correction
 * somebody believes they have made.
 */
describe('the letterhead dialog describes the letterhead', () => {
  const dialog = readFileSync(
    new URL('../../web/src/components/edit-practice.tsx', import.meta.url),
    'utf8',
  );
  const pdf = readFileSync(new URL('../src/services/prescriptionPdf.js', import.meta.url), 'utf8');

  test('the doctor name and registration really are fallbacks', () => {
    // If these ever became the first choice, the hints below would be wrong in
    // the other direction and this test should fail so they get rewritten.
    // `||` or `??`: an empty name on the account falls through as well now.
    assert.match(pdf, /doctor\?\.name (\?\?|\|\|) identity\?\.doctorName/);
    assert.match(pdf, /doctor\?\.registrationNo \|\| identity\?\.registrationNo/);
  });

  test('and the dialog says so rather than promising they print', () => {
    assert.match(dialog, /used only when the prescribing doctor has no name on file/);
    assert.match(dialog, /a doctor's own council number wins on the page/);
  });

  test('notes are not described as printed', () => {
    assert.ok(
      !/These appear on the practice's letterhead and on every prescription/.test(dialog),
      'the header claims every field on the form reaches a prescription',
    );
    assert.match(dialog, /never printed, never shown to the practice/);
  });

  test('and the letterhead the page is built from cannot carry them', () => {
    /*
     * The claim is only worth making because the snapshot has no room for it.
     *
     * Asserted against the snapshot rather than against the word "notes"
     * anywhere in the file — the first version of this test did that and failed
     * on a comment describing a *medicine's* notes, which is a different field
     * on a different model. A test that cannot tell two things called notes
     * apart fails on refactors and passes on regressions.
     */
    const from = pdf.indexOf('letterheadToPersist');
    // `lastIndexOf`, because the builder's own definition destructures the same
    // shape and comes first in the file.
    const snapshot = pdf.slice(from, pdf.lastIndexOf('buildPrescriptionPdf({'));
    assert.ok(snapshot.length > 100, 'the letterhead snapshot moved');
    assert.ok(!/\bnotes\b/.test(snapshot), 'the letterhead snapshot now carries notes');
    assert.ok(
      !/identity\??\.notes|practice\??\.notes/.test(pdf),
      'the prescription builder now reads a practice note',
    );
  });
});

/**
 * What the entry screen tells a practice about signing in.
 *
 * The console is reached at a bare domain by two audiences, and the practice
 * half of the door is entirely explanatory: there is no practice login here and
 * no self-registration behind it. Every sentence on that panel is therefore a
 * claim about a product somebody is about to go and use, made on the screen
 * where they have least patience for being sent the wrong way.
 *
 * The first draft said a practice signs in "with a phone number and a code —
 * there is no password to remember". There is one. `doctor_password_login_screen.dart`
 * posts to `/auth/login` with a phone and a password, and a doctor who has set
 * one would have been sent looking for a code they never arranged.
 */
describe('the entry screen is right about how a practice signs in', () => {
  const entry = readFileSync(
    new URL('../../web/src/components/sign-in.tsx', import.meta.url),
    'utf8',
  );
  const auth = readFileSync(new URL('../src/routes/auth.js', import.meta.url), 'utf8');

  test('both ways in still exist', () => {
    // If either disappeared, the panel would be describing a door that is not
    // there — and this test is the only thing connecting the two.
    assert.match(auth, /'\/otp\/request'/);
    assert.match(auth, /'\/login'/);
  });

  test('and the app really does identify a clinician by phone, not email', () => {
    // The claim the panel leads with, and the reason it refuses to draw an
    // email-and-password form for a practice.
    const login = auth.slice(auth.indexOf("'/login'"), auth.indexOf("'/login'") + 400);
    assert.match(login, /phone: phoneSchema/);
    assert.ok(!/email/.test(login), 'the clinician login now takes an email');
  });

  test('the panel says both, not just the code', () => {
    assert.match(entry, /by a code sent to that number, or by a password/);
  });

  test('and does not offer a practice login this product does not have', () => {
    /*
     * The failure this panel exists to avoid. A form here would post to
     * nothing: there is no practice session, no practice password reset, and
     * no email identity for a clinic anywhere in the product.
     */
    const panel = entry.slice(entry.indexOf('function PracticePanel'));
    assert.ok(
      !/type="password"/.test(panel),
      'the practice panel has grown a password field with nothing behind it',
    );
  });

  test('and the registration it offers has somewhere to post to', () => {
    /*
     * This assertion used to say the opposite.
     *
     * The panel said "self-registration is not open yet", which was true: there
     * was no application record, no review queue and no provisioning, so a
     * five-step form would have ended in a POST to a route that did not exist.
     *
     * All three exist now, so the claim had to change — and this test failing
     * on the day the copy did is the whole point of the file. What it pins now
     * is that the button leads somewhere real.
     */
    assert.ok(
      !/Self-registration is not open yet/.test(entry),
      'the panel still says registration is closed',
    );
    assert.match(entry, /Register your practice/);

    const routes = readFileSync(
      new URL('../src/routes/applications.js', import.meta.url),
      'utf8',
    );
    assert.match(routes, /router\.post\(\s*'\/'/, 'nothing accepts an application');
  });

  test('and approving one is what creates the practice, not the form', () => {
    // The line the whole surface is drawn around. A Practice is a tenant, and
    // the public route must not be able to make one.
    /*
     * Comments stripped before the scan.
     *
     * The first version matched the docblock in that very file explaining that
     * provisioning happens elsewhere — the third assertion in this repository
     * to fail on the prose written to document the rule it enforces. A scanner
     * reading for code has no business reading comments.
     */
    const publicRoutes = withoutComments(
      readFileSync(new URL('../src/routes/applications.js', import.meta.url), 'utf8'),
    );
    assert.ok(
      !/Practice\.create|provisionPractice/.test(publicRoutes),
      'the public application route can create a tenant',
    );

    const review = readFileSync(
      new URL('../src/routes/adminApplications.js', import.meta.url),
      'utf8',
    );
    assert.match(review, /provisionPractice\(/);
  });

  test('and the form does not collect a password for a login that does not exist', () => {
    // A practice has no email identity anywhere in this product. Collecting a
    // password would be a credential with nothing to unlock.
    const signup = readFileSync(
      new URL('../../web/src/components/practice-signup.tsx', import.meta.url),
      'utf8',
    );
    assert.ok(!/type="password"/.test(signup), 'the signup form collects a password');
    assert.match(signup, /No password to choose/);
  });
});
