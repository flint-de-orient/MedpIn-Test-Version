import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

/**
 * The practice self-signup, read as source.
 *
 * ---- Why a form needs a test that reads it ------------------------------
 *
 * The public form had four steps and a verification that jumped to the fourth.
 * Verify used to be a step of its own; when it was folded into Contact, the
 * step list lost an entry and `checkCode` kept calling `setStep(3)`, which was
 * Review now rather than Registration. Every applicant who typed the code
 * skipped the page where a reviewer's evidence is collected, and nothing
 * failed: the index was a number, and a number is still valid after the thing
 * it counted has changed.
 *
 * The subtitles were a second copy of the same count, five sentences for four
 * steps, and they drifted the same way. So did the transport underneath: the
 * error the form most needed — "this number already has an application, here
 * is its reference" — was thrown away before the form ever saw it.
 *
 * None of this can be run from here; the console has no test runner. What can
 * be pinned is the shape that makes those failures impossible, the same way
 * uiDescribesReality.test.js pins the copy.
 */

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

/**
 * Comments blanked, line numbers kept — but only real comments.
 *
 * The house `withoutComments` blanks from any `//` to the end of the line, which
 * is right for route files and wrong for these: `http://` inside a template
 * string would take the host name with it, and an assertion about how the
 * address is built would be reading half a line. So a line comment only counts
 * when it starts the line.
 */
function stripComments(body) {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/^\s*\/\/[^\n]*/gm, (m) => m.replace(/[^\n]/g, ' '));
}

/** The body of a function, from its declaration to the next one at the same depth. */
function bodyOf(src, declaration) {
  const start = src.indexOf(declaration);
  assert.ok(start >= 0, `${declaration} is gone; this test is reading the wrong file`);
  const ends = ['\n  async function ', '\n  function ', '\n  /* ---', '\nfunction ', '\nexport function ']
    .map((marker) => src.indexOf(marker, start + declaration.length))
    .filter((i) => i > 0);
  return src.slice(start, ends.length ? Math.min(...ends) : undefined);
}

const signup = read('../../web/src/components/practice-signup.tsx');
const signupCode = stripComments(signup);

describe('the signup form moves one step at a time', () => {
  test('verifying the code does not move the applicant to another step', () => {
    // The bug itself. Proving the number happens on Contact, and what follows
    // Contact is whatever its own Continue decides — not a jump from inside the
    // verification, to an index that meant something else once.
    const check = stripComments(bodyOf(signup, 'async function checkCode'));
    assert.ok(!/setStep\(|goTo\(/.test(check), 'verifying the code changes the step');
  });

  test('every step carries exactly one subtitle, beside its own name', () => {
    const at = signupCode.indexOf('const STEPS');
    assert.ok(at >= 0, 'the step list is gone');
    const list = signupCode.slice(at, signupCode.indexOf('] as const', at));
    const labels = [...list.matchAll(/\blabel:/g)].length;
    const blurbs = [...list.matchAll(/\bblurb:/g)].length;

    assert.ok(labels >= 4, `only ${labels} steps found; the list is not the shape this test reads`);
    assert.equal(blurbs, labels, `${labels} steps and ${blurbs} subtitles`);

    // And no second list indexed by position. That is how five sentences came
    // to describe four steps.
    assert.ok(!/\]\s*\[\s*step\s*\]/.test(signupCode), 'a list is still indexed by the step number');
  });

  test('no step is reached, or recognised, by its number', () => {
    assert.ok(!/setStep\(\s*\d/.test(signupCode), 'a step is set by a literal index');
    assert.ok(!/step\s*===\s*\d/.test(signupCode), 'a step is recognised by a literal index');
  });
});

describe('the form refuses what the server refuses, and hears what it says', () => {
  const routes = read('../src/routes/applications.js');

  test('an email address is checked with the same pattern the server uses', () => {
    /*
     * Looser than the server is a round trip that ends in "Request validation
     * failed" after somebody has filled in four screens. The server's rule is
     * zod's, so the client carries zod's pattern, character for character.
     */
    const candidates = ['../node_modules/zod/v3/types.js', '../node_modules/zod/lib/types.js'];
    const found = candidates.map((rel) => new URL(rel, import.meta.url)).find((u) => existsSync(u));
    assert.ok(found, 'zod is not where this test looks for it');
    const zod = readFileSync(found, 'utf8');
    const pattern = zod.match(/^const emailRegex = (\/.+\/i);$/m)?.[1];
    assert.ok(pattern, "zod's email pattern moved");
    assert.match(routes, /contactEmail: z\.string\(\)[^\n]*\.email\(\)/, 'the server no longer uses zod for the email');
    assert.ok(signup.includes(pattern), 'the form checks email with a different pattern from the server');
  });

  test('the department cap is the server’s', () => {
    const cap = routes.match(/departments: z\.array\([^\n]*\.max\((\d+)\)/)?.[1];
    assert.ok(cap, 'the server no longer caps departments');
    assert.match(signupCode, new RegExp(`MAX_DEPARTMENTS = ${cap}\\b`));
  });

  test('a number is normalised the way the server normalises it', () => {
    // Ten bare digits, a 91 without its plus and a 0 trunk prefix are all one
    // number to the server. A form that disagrees shows one number and texts
    // another, or refuses a number the server would have taken.
    const server = read('../src/utils/phone.js') + routes;
    const anchored = [...new Set(server.match(/\/\^[^\n/]*\$\//g) ?? [])];
    assert.ok(anchored.length >= 4, `only ${anchored.length} phone patterns found on the server`);
    for (const pattern of anchored) {
      assert.ok(signup.includes(pattern), `the form does not know the server's ${pattern}`);
    }
  });

  test('an expired proof sends them back to verify rather than round again', () => {
    const at = signupCode.indexOf('"PHONE_TOKEN_EXPIRED"');
    assert.ok(at >= 0, 'the form does not recognise an expired proof');
    const branch = signupCode.slice(at, at + 600);
    assert.match(branch, /setPhoneToken\(null\)/, 'the expired token is kept and sent again');
    assert.match(branch, /setSent\(null\)/, 'the form still thinks a code is on its way');
  });

  test('an application already open is shown by its reference, not as an error', () => {
    const at = signupCode.indexOf('"APPLICATION_OPEN"');
    assert.ok(at >= 0, 'the form does not recognise an application that is already open');
    assert.match(signupCode.slice(at, at + 400), /onExisting\(/);
  });

  test('a field the server names gets the server’s message', () => {
    assert.match(signupCode, /"VALIDATION_ERROR"/);
    assert.match(signupCode, /\.details/);
  });

  test('a code that was never texted says so', () => {
    assert.match(signupCode, /simulated/);
  });

  test('an empty department list is not reported as a list that failed to load', () => {
    const at = signupCode.indexOf('could not load the list');
    assert.ok(at >= 0, 'the failure copy is gone');
    assert.match(signupCode.slice(Math.max(0, at - 400), at), /optionsFailed/);
  });

  test('the form asks whether the contact is the practice’s doctor', () => {
    assert.match(signupCode, /contactIsPrimaryDoctor/);
    assert.match(routes, /contactIsPrimaryDoctor: z\.boolean\(\)/);
  });
});

describe('the console talks to the API it was served beside', () => {
  const api = read('../../web/src/lib/api.ts');
  const apiCode = stripComments(api);

  test('in development the API is addressed by the page’s own host name', () => {
    /*
     * `localhost` and `127.0.0.1` are different sites. A console on
     * http://localhost:3000 calling http://127.0.0.1:4000 never sends the
     * SameSite=Strict session and cannot read the CSRF cookie the API sets, so
     * every write is refused as a forgery on a laptop and nowhere else.
     */
    assert.ok(!apiCode.includes('127.0.0.1:4000'), 'the development API host is fixed again');
    const base = bodyOf(apiCode, 'export function apiBase');
    assert.match(base, /window\.location\.hostname/);
  });

  test('a thrown error keeps its code, its details and its status', () => {
    assert.match(apiCode, /details\??: /, 'ApiError has nowhere to keep details');
    assert.match(apiCode, /err\?\.error\?\.details/, 'the details are dropped when the error is thrown');
  });

  test('a 404 is "switched off" only when the body is not the API’s own', () => {
    const guard = read('../src/middleware/requireAdmin.js');
    assert.match(guard, /message: 'Not found'/, 'the switched-off answer changed shape');
    const parsed = apiCode.indexOf('await res.json()');
    const off = apiCode.indexOf('"PANEL_OFF"');
    assert.ok(parsed > 0 && off > parsed, 'a 404 is called switched-off before its body is read');
    assert.match(apiCode, /"Not found"/);
  });

  test('the comments about development describe development', () => {
    const session = read('../src/services/adminSession.js');
    for (const [name, src] of [['api.ts', api], ['adminSession.js', session]]) {
      assert.ok(!src.includes(':8144'), `${name} still describes a console port nothing uses`);
      assert.match(src, /localhost/, `${name} does not say which host name development uses`);
    }
  });
});

describe('a link from an email works whether or not somebody is signed in', () => {
  const signIn = stripComments(read('../../web/src/components/sign-in.tsx'));
  const providers = stripComments(read('../../web/src/app/providers.tsx'));
  const arrivalUrl = new URL('../../web/src/lib/arrival.ts', import.meta.url);

  test('the sign-in screen does not read the address bar itself', () => {
    // It is mounted only when nobody is signed in, so a link it read was a link
    // that did nothing for anybody who was.
    assert.ok(!signIn.includes('window.location.search'), 'sign-in.tsx still reads the links');
  });

  test('the links are read above the gate', () => {
    assert.ok(existsSync(arrivalUrl), 'there is no module that reads the links');
    const arrival = stripComments(readFileSync(arrivalUrl, 'utf8'));
    for (const key of ['application', 'confirm', 'verify', 'reset']) {
      assert.match(arrival, new RegExp(`get\\("${key}"\\)`), `the ${key} link is not read`);
    }

    const gate = bodyOf(providers, 'function Gate');
    const reads = gate.indexOf('useArrival()');
    const signedOut = gate.indexOf('if (!admin)');
    assert.ok(reads >= 0, 'the gate does not read the links');
    assert.ok(signedOut > reads, 'the links are read only after the signed-out branch');
    assert.match(gate, /admin && arrival/, 'a signed-in operator following a link is not handled');
  });
});

describe('the operator console follows an application through', () => {
  const page = stripComments(read('../../web/src/app/signups/page.tsx'));

  test('opening an undecided application claims it', () => {
    assert.match(page, /\/claim`/);
  });

  test('after approving, the operator is told how the practice gets in', () => {
    assert.match(page, /outcome/);
    assert.match(page, /signs in/);
  });
});

describe('nobody is held waiting on email', () => {
  test('a submission is answered before its confirmation is sent', () => {
    const routes = stripComments(read('../src/routes/applications.js'));
    const at = routes.indexOf("router.post(\n  '/',");
    assert.ok(at >= 0, 'the submission route moved');
    const block = routes.slice(at, routes.indexOf('\nrouter.', at + 10));
    const answered = block.indexOf('res.status(201)');
    const sent = block.search(/deliverConfirmation\(/);
    assert.ok(answered > 0, 'the submission no longer answers 201');
    assert.ok(sent > answered, 'the confirmation is sent before the applicant is answered');
    assert.ok(!/await deliverConfirmation\(|await sendConfirmation\(/.test(block), 'the answer waits on the email');
  });

  test('the mail transport gives up rather than hanging a request', () => {
    const mailer = read('../src/services/mailer.js');
    for (const option of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) {
      assert.match(mailer, new RegExp(`${option}:`), `no ${option} on the transport`);
    }
  });
});

describe('the configuration a signup depends on is written down', () => {
  const example = read('../.env.example');

  test('every key the flow reads is in the example', () => {
    for (const key of [
      'ADMIN_CONSOLE_URL',
      'ADMIN_JWT_SECRET',
      'ALLOWED_ORIGINS',
      'SMTP_HOST',
      'SMTP_PORT',
      'SMTP_USER',
      'SMTP_PASS',
      'SMTP_FROM',
      'APPLICATION_RATE_LIMIT',
      'APPLICATION_PHONE_TOKEN_MINUTES',
      'DEPLOY_ENV',
    ]) {
      assert.match(example, new RegExp(`^#? ?${key}=`, 'm'), `${key} is not in .env.example`);
    }
  });

  test('and none whose blank value would stop the server is left blank', () => {
    /*
     * The example's own warning, enforced: `KEY=` is present and empty, not
     * absent, so the schema's default no longer applies. An empty port coerces
     * to zero, an empty rate limit fails its minimum and an empty DEPLOY_ENV is
     * not in its enum — the last two refuse to boot.
     */
    for (const key of ['SMTP_PORT', 'APPLICATION_RATE_LIMIT', 'APPLICATION_PHONE_TOKEN_MINUTES', 'DEPLOY_ENV']) {
      assert.ok(!new RegExp(`^${key}=\\s*$`, 'm').test(example), `${key}= is blank and would break boot`);
    }
  });
});

describe('the app knows what a waiting application is', () => {
  test('the login screen and the error copy both recognise it', () => {
    const errors = read('../../mobile/lib/shared/widgets/error_view.dart');
    const login = read('../../mobile/lib/features/auth/presentation/login_screen.dart');
    assert.match(errors, /'APPLICATION_PENDING'/);
    assert.match(login, /'APPLICATION_PENDING'/);
    for (const lang of ['en', 'bn', 'hi']) {
      assert.match(read(`../../mobile/lib/l10n/app_${lang}.arb`), /"authApplicationPending"/);
    }
  });
});
