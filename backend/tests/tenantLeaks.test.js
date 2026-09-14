import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Reads of people and places, which leaked for as long as they existed.
 *
 * ---- What was actually reported ----------------------------------------
 *
 * A practice created for a test, with one doctor, no patients and no staff of
 * its own, opened two screens and saw another clinic's data on both: a
 * dietician by name and phone number, and two addresses with their opening
 * days. Nothing had gone wrong. Both reads were doing exactly what they said:
 *
 *   User.find({ role: ROLES.DIETICIAN, isActive: true })
 *   Clinic.find(isClinician(req) ? {} : { isActive: true })
 *
 * ---- Why the existing tests did not catch it ---------------------------
 *
 * `doctorScope` and `recordWindow` were written after a patient-list leak, so
 * they check reads of *patients* and of clinical records. A dietician is not a
 * patient and a location is not a record, so both files were silent about the
 * two collections that leaked — and `practiceStaffFilter` in doctor.js, the one
 * scoped read of people in the codebase, made the area look covered.
 *
 * The same blind spot ran through every push notification. `notifyClinicStaff`
 * fanned out to every doctor and receptionist on the platform, with a patient's
 * name and the first 180 characters of their emergency in the body — a leak
 * that needs nobody to go looking, because it arrives on a lock screen.
 *
 * So this file is about the collections the other files do not cover: User read
 * by role, and Clinic.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

function read(rel) {
  return readFileSync(path.join(SRC, rel), 'utf8');
}

/**
 * The one file that reads across every practice on purpose.
 *
 * `/api/v1/admin` is the platform operator's own namespace, behind
 * `requireAdmin` and a separate signing key, and counting every practice is the
 * entire job of the screens it serves. Exempting it is not a hole: a clinic
 * token put in front of that guard fails on the signature, which is what
 * admin.test.js exists to prove.
 */
const CROSS_PRACTICE_BY_DESIGN = new Set(['routes/admin.js']);

/** Every .js under a directory, with its path. */
function filesUnder(rel) {
  const dir = path.join(SRC, rel);
  return readdirSync(dir)
    .filter((n) => n.endsWith('.js'))
    .map((n) => ({ name: `${rel}/${n}`, src: readFileSync(path.join(dir, n), 'utf8') }))
    .filter((f) => !CROSS_PRACTICE_BY_DESIGN.has(f.name));
}

/**
 * The statement a query sits in — from the call back to the previous `;`,
 * and forward through balanced brackets to the end of the chain.
 *
 * A ±N-line window is what let the last leak hide behind a bounded neighbour,
 * so this reads the actual expression.
 */
function statementAt(src, index) {
  const from = Math.max(
    src.lastIndexOf(';', index),
    src.lastIndexOf('{', index),
    src.lastIndexOf('\n\n', index),
  );

  let depth = 0;
  let i = src.indexOf('(', index);
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // Through the rest of the chain: .select().sort().lean()
  const end = src.indexOf(';', i);
  return src.slice(from + 1, end === -1 ? i : end);
}

/** Where the enclosing route handler or function begins. */
function enclosingStart(src, index) {
  const marks = [
    src.lastIndexOf('router.', index),
    src.lastIndexOf('async function', index),
    src.lastIndexOf('export async function', index),
  ];
  return Math.max(...marks, 0);
}

/**
 * The statement, plus the definitions of any variable it leans on.
 *
 * `Clinic.find(filter)` says nothing by itself; the filter was built three
 * lines up. Resolving one level is the difference between reading the code and
 * reading a fragment of it — and a ±N-line window, which is how the last audit
 * missed a leak, resolves nothing at all.
 */
function scopeTextFor(src, index) {
  const before = src.slice(enclosingStart(src, index), index);
  let text = statementAt(src, index);
  const seen = new Set();

  // Transitively, because one level is not enough. `Clinic.find(filter)`, where
  // `filter` spreads `scope`, where `scope` is `await practiceClinics(req)`, is
  // three hops — and it is the shape the real handler has. Capped, so a
  // self-referential const cannot spin.
  for (let pass = 0; pass < 4; pass += 1) {
    const names = new Set();
    for (const m of text.matchAll(/\.\.\.(\w+)/g)) names.add(m[1]);
    for (const m of text.matchAll(/\.(?:find|countDocuments|distinct)\((\w+)\)/g)) {
      names.add(m[1]);
    }

    let grew = false;
    for (const n of names) {
      if (seen.has(n)) continue;
      seen.add(n);
      for (const m of before.matchAll(new RegExp(`const\\s+${n}\\s*=[^;]*;`, 'g'))) {
        text += `\n${m[0]}`;
        grew = true;
      }
    }
    if (!grew) break;
  }
  return text;
}

/** Does this read restrict itself to one practice, by any of the sanctioned means? */
function isScoped(stmt) {
  return (
    /practiceMembers\(/.test(stmt) ||
    /memberIdsOf\(/.test(stmt) ||
    /practiceClinics\(/.test(stmt) ||
    /clinicsFor\(/.test(stmt) ||
    /patientClinics\(/.test(stmt) ||
    /practicePatients\(/.test(stmt) ||
    /practiceStaffFilter\(/.test(stmt) ||
    /staffFor\(/.test(stmt) ||
    /doctorTokensFor\(/.test(stmt) ||
    // Already narrowed to named ids, which cannot span a practice by accident.
    /_id:\s*\{\s*\$in/.test(stmt) ||
    /_id:\s*[a-zA-Z]/.test(stmt) ||
    // Explicitly about one practice.
    /practice:/.test(stmt)
  );
}

describe('a list of people is a list of this practice’s people', () => {
  /**
   * Reads of User filtered by role, anywhere a request or a patient is in
   * scope. `role:` is the tell — a query that names a role is asking for a
   * category of person rather than one known individual, and a category is
   * exactly what has to be bounded.
   */
  const WHERE = ['routes', 'services'];

  for (const dir of WHERE) {
    for (const { name, src } of filesUnder(dir)) {
      for (const m of src.matchAll(/User\.(find|countDocuments|distinct)\(/g)) {
        const stmt = scopeTextFor(src, m.index);
        if (!/role:/.test(stmt)) continue;

        // Patients are covered by doctorScope.test.js, which knows the rules
        // for them — enrolment, the record window, the assigned doctor.
        if (/ROLES\.PATIENT/.test(stmt) && !/ROLES\.(DOCTOR|STAFF|DIETICIAN)/.test(stmt)) {
          continue;
        }

        const line = src.slice(0, m.index).split('\n').length;
        test(`${name}:${line} — ${m[1]} by role`, () => {
          assert.ok(
            isScoped(stmt),
            [
              '',
              `${name}:${line} reads people by role with nothing bounding it to a practice:`,
              '',
              stmt.trim().split('\n').slice(0, 6).join('\n'),
              '',
              'Every practice on the platform is in that result. Use practiceMembers(req,',
              'roles) where there is a request, memberIdsOf(practiceId, roles) where there',
              'is not, or staffFor(patientId, roles) in notifications.js. All three permit',
              'when the practice is unknown, so none of them can lock out a clinic whose',
              'memberships have not been backfilled.',
            ].join('\n'),
          );
        });
      }
    }
  }
});

describe('and a list of places is this practice’s places', () => {
  for (const dir of ['routes', 'services']) {
    for (const { name, src } of filesUnder(dir)) {
      for (const m of src.matchAll(/Clinic\.(find|countDocuments|distinct)\(/g)) {
        const stmt = scopeTextFor(src, m.index);
        const line = src.slice(0, m.index).split('\n').length;

        test(`${name}:${line} — ${m[1]}`, () => {
          assert.ok(
            isScoped(stmt),
            [
              '',
              `${name}:${line} lists locations with nothing bounding them to a practice:`,
              '',
              stmt.trim().split('\n').slice(0, 6).join('\n'),
              '',
              'Every address on the platform is in that result. Use practiceClinics(req).',
            ].join('\n'),
          );
        });
      }
    }
  }
});

describe('the two reads that were actually reported', () => {
  test('the dietician list is scoped', () => {
    const doctor = read('routes/doctor.js');
    const at = doctor.indexOf("'/dieticians'");
    const body = doctor.slice(at, at + 900);
    assert.match(body, /practiceMembers\(req, ROLES\.DIETICIAN\)/);
  });

  test('the clinic list is scoped, for patients as well as clinicians', () => {
    const clinics = read('routes/clinics.js');
    const at = clinics.indexOf("router.get(\n  '/',");
    const body = clinics.slice(at, at + 700);
    assert.match(body, /clinicsFor\(req\)/);
    // The patient branch too — and not merely in the order the code is
    // written. This asserted that `practiceClinics` came before `isClinician`,
    // and it did; but `practiceClinics` answers from a membership and a patient
    // has none, so every patient was shown every practice's locations while
    // this passed. httpBookingScope.test.js proves the patient's list over HTTP.
    assert.ok(
      body.indexOf('clinicsFor') < body.indexOf('isClinician'),
      'the location filter is inside the clinician branch and misses patients',
    );
  });
});

describe('nobody is woken up about another practice’s patient', () => {
  const notif = read('services/notifications.js');

  test('there is one helper and it derives the practice from the patient', () => {
    assert.match(notif, /async function staffFor\(patientId, roles\)/);
    assert.match(notif, /await practiceOfPatient\(patientId\)/);
  });

  test('every fan-out goes through it', () => {
    // The signature that leaked, in every shape it took.
    const raw = [
      ...notif.matchAll(/User\.find\(\{[^}]*role:\s*\{?\s*\$in:\s*\[ROLES\.(DOCTOR|STAFF)/g),
    ];
    assert.equal(
      raw.length,
      0,
      'a notification still fans out to every clinician on the platform',
    );
    assert.ok(
      !/User\.find\(\{ role: ROLES\.(DOCTOR|DIETICIAN), isActive: true \}\)/.test(notif),
      'a notification still fans out to every doctor or dietician on the platform',
    );
  });

  test('the nightly digest counts one practice at a time', () => {
    // It was a cron over every appointment in the system telling every doctor
    // the total, so a clinic with three tomorrow was told it had forty.
    const at = notif.indexOf('export async function notifyClinicOfTomorrowSchedule');
    const body = notif.slice(at, notif.indexOf('\nexport ', at + 10));
    assert.match(body, /byPractice/);
    assert.match(body, /memberIdsOf\(practiceId, ROLES\.DOCTOR\)/);
  });

  test('and the visit reminders do too', () => {
    const sched = read('services/scheduler.js');
    assert.match(sched, /doctorTokensFor/);
    assert.match(sched, /memberIdsOf\(key, ROLES\.DOCTOR\)/);
    assert.ok(
      !/User\.find\(\{ role: ROLES\.DOCTOR, isActive: true \}\)\s*\n?\s*\.select\('deviceTokens'\)/.test(
        sched,
      ),
      'the reminder loop still copies in every doctor on the platform',
    );
  });
});

describe('the assistant answers about this practice’s doctor', () => {
  test('“the only one there is” means the only one here', () => {
    // Unscoped, this asked whether the platform had exactly one doctor and
    // said no the moment a second practice existed — so every solo practice
    // got "more than one doctor could be meant here" for a question with one
    // possible answer.
    const ctx = read('services/doctorContext.js');
    assert.match(ctx, /memberIdsOf\(practiceId, ROLES\.DOCTOR\)/);
  });
});

describe('and none of it can lock out a clinic that is running', () => {
  const scope = read('middleware/practiceScope.js');

  test('an unknown practice restricts nothing', () => {
    assert.match(scope, /if \(!practiceId\) return null;/);
  });

  test('an unmigrated database restricts nothing', () => {
    // No membership rows at all is the pre-backfill state, and an empty `$in`
    // there is indistinguishable from a practice with no staff.
    assert.match(scope, /if \(!rows\.length && !\(await membershipsExist\(\)\)\) return null;/);
    assert.match(scope, /async function membershipsExist\(\)/);
  });

  test('and neither does an unlinked set of locations', () => {
    assert.match(scope, /async function clinicsAreLinked\(\)/);
    assert.match(scope, /if \(!practiceId \|\| !\(await clinicsAreLinked\(\)\)\) return \{\};/);
  });
});

describe('the clinic’s inbox is this clinic’s inbox', () => {
  test('feedback is scoped to the practice’s own patients', () => {
    // `Feedback.find()` — no filter at all — returned every patient's words on
    // the platform with their name, phone and photograph populated onto it.
    // Feedback is attributable by design, which is what makes an unscoped read
    // of it worse than an unscoped count.
    const src = read('routes/feedback.js');
    assert.match(src, /await practicePatients\(req, 'patient'\)/);

    // Comments stripped first. The note above the fix quotes the query it
    // replaced, and an assertion that cannot tell code from the explanation of
    // code forbids explaining anything — which is the fourth time that has
    // caught me in this suite.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    assert.ok(
      !/Feedback\.find\(\)/.test(code),
      'the clinician feedback list is unfiltered again',
    );
    assert.ok(
      !/Feedback\.countDocuments\(\)/.test(code),
      'the feedback count is unfiltered again',
    );
  });
});
