import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { ROLES, CLINICIAN_ROLES } from '../src/models/User.js';
import { PERMISSIONS as P, PRESETS, PRESET_FOR_ROLE, presetFor } from '../src/models/Membership.js';
import {
  CAPABILITIES as C,
  ROLE_EXCLUDES,
  effectiveCapabilities,
} from '../src/services/capabilities.js';
import { resolveUi } from '../src/services/uiConfig.js';

/**
 * Who somebody is, and the four things that have to be decided about them.
 *
 * ---- The failure this file exists to prevent ---------------------------
 *
 * `staff` used to mean "everybody who is not a doctor". Not by design — by
 * fallthrough: `presetFor` ended with `return PRESETS.desk`, `ROLE_EXCLUDES`
 * had no entry for anything new, and the app's router ran out of `if`s and
 * sent the person to the patient app. Three defaults, none of them written for
 * the role that landed on them, and all three silent.
 *
 * A lab technician filed that way could read a result that came back critical
 * and could not order the test that produced it, because the desk's exclusions
 * strip LAB_ORDER — correct for a receptionist, wrong for the bench, and
 * invisible either way.
 *
 * So a role now needs four decisions, and every one of them is asserted here:
 *
 *   1. a permission preset       models/Membership.js
 *   2. capability exclusions     services/capabilities.js
 *   3. a landing area            mobile/lib/core/router/area.dart
 *   4. a dashboard               services/uiConfig.js, or a department's
 *
 * Miss one and this fails, naming the role and the file.
 */

/** Everybody who works at a practice. Patients are not roles in this sense. */
const WORKING = CLINICIAN_ROLES;

describe('every role is fully decided', () => {
  test('the list itself has not drifted', () => {
    // Every assertion below iterates WORKING. On an empty or truncated list
    // they would all pass, having checked nothing.
    assert.equal(WORKING.length, Object.values(ROLES).length - 1, 'a role is missing from CLINICIAN_ROLES');
    assert.ok(!WORKING.includes(ROLES.PATIENT), 'a patient is not a member of staff');
  });

  test('each has a permission preset, written not inherited', () => {
    for (const role of WORKING) {
      assert.ok(
        PRESET_FOR_ROLE[role],
        `${role} has no entry in PRESET_FOR_ROLE — it would have inherited the desk's grant`,
      );
    }
  });

  test('and a role with no preset throws rather than guessing', () => {
    /*
     * The one place in this codebase where absence does not permit.
     *
     * Everywhere else an unknown value keeps everything, because the
     * alternative is taking prescribing away from a live clinic on the deploy
     * that adds a column. That rule is about data older than a field. This is
     * not: a role reaching presetFor is one the code does not define, which
     * means a name was added in one place and not another. Permissive hands
     * out access nobody intended and restrictive locks somebody out of their
     * own job, so neither guess is safe and the error is the answer.
     */
    assert.throws(
      () => presetFor({ role: 'radiographer' }),
      /No permission preset for role "radiographer"/,
    );
  });

  test('each has an exclusion list, even where it is empty by intent', () => {
    // A doctor has none, correctly. Everybody else here is defined partly by
    // what their job is not, and a missing entry is a role that quietly keeps
    // every capability its practice has bought.
    for (const role of WORKING) {
      if (role === ROLES.DOCTOR) continue;
      assert.ok(
        ROLE_EXCLUDES[role],
        `${role} has no ROLE_EXCLUDES entry — it keeps every capability the practice holds`,
      );
    }
  });

  test('and the app knows where to put each of them', () => {
    /*
     * The third silent default, and the worst of the three.
     *
     * The router asked `isDoctor`, `isStaff`, `isDietician` and then fell
     * through to the patient app. A lab technician signing in would have
     * landed on the patient Assistant tab — not refused, not warned, just in
     * the wrong application.
     */
    const area = readFileSync(
      fileURLToPath(new URL('../../mobile/lib/core/router/area.dart', import.meta.url)),
      'utf8',
    );
    for (const role of WORKING) {
      assert.ok(
        area.includes(`'${role}'`),
        `${role} has no landing area in area.dart — it would fall through to the patient app`,
      );
    }
  });
});

describe('the laboratory can do its own work', () => {
  /*
   * The finding that made these roles necessary, now asserted as a fix.
   *
   * `httpDepartmentUi.test.js` carried a test named "the desk in a laboratory
   * can read results it cannot order", which documented the symptom and said
   * the expectation would invert when these roles landed. This is that.
   */
  const practice = { practiceType: null, plan: null };

  test('a lab technician may order and report', () => {
    const held = effectiveCapabilities({
      practice,
      membership: { role: ROLES.LAB_TECHNICIAN, permissions: [...PRESETS.labTech] },
    });
    assert.ok(held.has(C.LAB_ORDER), 'the bench still cannot order the test it is running');
    assert.ok(held.has(C.LAB_RESULT));
  });

  test('and a lab manager too', () => {
    const held = effectiveCapabilities({
      practice,
      membership: { role: ROLES.LAB_MANAGER, permissions: [...PRESETS.labManager] },
    });
    assert.ok(held.has(C.LAB_ORDER));
    assert.ok(held.has(C.LAB_RESULT));
  });

  test('neither prescribes', () => {
    // Reporting a result is not treating anybody. This is the line that makes
    // the roles safe to grant freely.
    for (const [role, preset] of [
      [ROLES.LAB_TECHNICIAN, PRESETS.labTech],
      [ROLES.LAB_MANAGER, PRESETS.labManager],
    ]) {
      const held = effectiveCapabilities({
        practice,
        membership: { role, permissions: [...preset] },
      });
      assert.ok(!held.has(C.PRESCRIPTION), `${role} can prescribe`);
    }
  });

  test('and the front desk still cannot order a test', () => {
    // The rule the lab roles exist to stop being applied to the wrong people.
    // It was right all along — it was being asked of the wrong job.
    const held = effectiveCapabilities({
      practice,
      membership: { role: ROLES.STAFF, permissions: [...PRESETS.desk] },
    });
    assert.ok(!held.has(C.LAB_ORDER));
  });

  test('only the manager rosters anybody', () => {
    assert.ok(PRESETS.labManager.includes(P.MANAGE_STAFF));
    assert.ok(!PRESETS.labTech.includes(P.MANAGE_STAFF));
  });
});

describe('an assistant assists and does not sign', () => {
  test('they may write to the record', () => {
    assert.ok(PRESETS.assistant.includes(P.EDIT_RECORD));
    assert.ok(PRESETS.assistant.includes(P.VIEW_PATIENT));
  });

  test('and cannot prescribe, however the grant is edited', () => {
    /*
     * The exclusion, not the preset, is what enforces this — and that is the
     * point of testing it with PRESCRIBE granted by hand. A practice that
     * customises an assistant's grant upward should not be able to turn them
     * into a prescriber by accident, because the difference between assisting
     * and practising is not a setting.
     */
    const held = effectiveCapabilities({
      practice: { practiceType: null, plan: null },
      membership: {
        role: ROLES.DOCTOR_ASSISTANT,
        permissions: [...PRESETS.assistant, P.PRESCRIBE],
      },
    });
    assert.ok(!held.has(C.PRESCRIPTION));
  });
});

describe('a practice manager administers and reads no records', () => {
  const membership = {
    role: ROLES.PRACTICE_MANAGER,
    permissions: [...PRESETS.manager],
  };

  test('no patient permission at all', () => {
    /*
     * The only preset here without VIEW_PATIENT, and the reason this role is
     * worth having. Until now the only way to employ somebody who runs rotas
     * and billing was to file them as `staff`, which hands them every patient
     * in the building.
     */
    assert.ok(!PRESETS.manager.includes(P.VIEW_PATIENT));
    assert.ok(!PRESETS.manager.includes(P.EDIT_RECORD));
  });

  test('and no clinical capability either', () => {
    const held = effectiveCapabilities({
      practice: { practiceType: null, plan: null },
      membership,
    });
    for (const cap of [C.PRESCRIPTION, C.LAB_ORDER, C.LAB_RESULT, C.AI_ASSISTANT]) {
      assert.ok(!held.has(cap), `a practice manager holds ${cap}`);
    }
  });

  test('but they can still run the practice', () => {
    assert.ok(PRESETS.manager.includes(P.MANAGE_STAFF));
    assert.ok(PRESETS.manager.includes(P.MANAGE_DEPARTMENT));
  });

  test('and their screen is not an empty one', () => {
    /*
     * Every patient-facing panel needs VIEW_PATIENT, which this role
     * deliberately withholds — so composing the general dashboard for a
     * practice manager and filtering it would leave nothing at all.
     *
     * An empty screen is not an answer. It reads as an app that failed to
     * load, and it would be the first thing a new practice manager saw.
     */
    const ui = resolveUi({
      role: ROLES.PRACTICE_MANAGER,
      capabilities: new Set(Object.values(C)),
      permissions: new Set(PRESETS.manager),
    });
    assert.ok(ui.widgets.length + ui.quickActions.length > 0, 'a practice manager sees nothing');
    assert.ok(ui.quickActions.includes('MANAGE_TEAM'));
    // And nothing clinical leaked in.
    assert.ok(!ui.widgets.includes('TRIAGE_QUEUE'));
  });
});

describe('the dashboard hierarchy resolves in one stated order', () => {
  const every = new Set(Object.values(C));

  test('a role default beats a department default', () => {
    /*
     * A department says where somebody works; a role says what they do. Where
     * neither has been configured, the job is the better guess — a lab
     * technician in a cardiology department is at a bench.
     */
    const ui = resolveUi({
      department: { key: 'cardiology' },
      role: ROLES.LAB_TECHNICIAN,
      capabilities: every,
      permissions: new Set(PRESETS.labTech),
    });
    assert.ok(ui.widgets.includes('CRITICAL_LAB_RESULTS'));
    assert.ok(!ui.widgets.includes('TRIAGE_QUEUE'));
    assert.equal(ui.source, 'role');
  });

  test('and a configured department beats the role default', () => {
    /*
     * Explicit beats default, which is the other half of the rule. Whoever
     * composed that department's screen did it knowing who works there, and a
     * platform guess should not override a person's decision.
     */
    const ui = resolveUi({
      department: { key: 'cardiology', widgets: ['TODAYS_CLINIC'] },
      role: ROLES.LAB_TECHNICIAN,
      capabilities: every,
      permissions: new Set([...PRESETS.labTech]),
    });
    assert.deepEqual(ui.widgets, ['TODAYS_CLINIC']);
    assert.equal(ui.source, 'department');
  });

  test('a doctor takes the department, because that is what departments are for', () => {
    const ui = resolveUi({
      department: { key: 'laboratory' },
      role: ROLES.DOCTOR,
      capabilities: every,
      permissions: new Set(PRESETS.clinician),
    });
    assert.ok(ui.widgets.includes('CRITICAL_LAB_RESULTS'));
    assert.equal(ui.source, 'departmentDefault');
  });

  test('and no department and no role default is the general set', () => {
    const ui = resolveUi({
      role: ROLES.DOCTOR,
      capabilities: every,
      permissions: new Set(PRESETS.clinician),
    });
    assert.ok(ui.widgets.includes('TRIAGE_QUEUE'));
    assert.equal(ui.source, 'general');
  });

  test('the source is always one of the four', () => {
    // It is sent to the console so an operator can find out why two people in
    // one department have different screens. A fifth value would be a tier
    // somebody added without saying so.
    const seen = new Set();
    for (const role of [...WORKING, null]) {
      for (const department of [null, { key: 'laboratory' }, { key: 'x', widgets: ['TODAYS_CLINIC'] }]) {
        seen.add(
          resolveUi({ role, department, capabilities: every, permissions: every }).source,
        );
      }
    }
    for (const s of seen) {
      assert.ok(
        ['department', 'role', 'departmentDefault', 'general'].includes(s),
        `unknown precedence tier: ${s}`,
      );
    }
  });
});

describe('the role names mean the same thing on both sides', () => {
  /*
   * The third vocabulary that exists twice, after Cap and Perm — and the one
   * with the worst failure mode. A drifted capability name switches a feature
   * off; a drifted *role* name puts somebody in the wrong application.
   *
   * Checked against the tables in area.dart rather than a list of constants,
   * because those tables are what the app actually decides with. A constant
   * nothing reads would pass this and change nothing.
   */
  const area = readFileSync(
    fileURLToPath(new URL('../../mobile/lib/core/router/area.dart', import.meta.url)),
    'utf8',
  );

  /** The keys of one `const Map<String, String>` literal, by its name. */
  function keysOf(name) {
    const at = area.indexOf(`${name} = {`);
    assert.ok(at > 0, `${name} is gone or renamed in area.dart`);
    const block = area.slice(at, area.indexOf('\n};', at));
    return [...block.matchAll(/^ {2}'([a-z_/]+)':/gm)].map((m) => m[1]);
  }

  test('every role the server defines has an area', () => {
    const inDart = new Set(keysOf('const Map<String, String> areaForRole'));
    const missing = WORKING.filter((r) => !inDart.has(r));
    assert.deepEqual(missing, [], `no landing area for: ${missing.join(', ')}`);
  });

  test('and the app names no role the server does not', () => {
    // A stale entry is a role somebody removed from the server and left
    // routable here — harmless until a name is reused for something else.
    const inDart = keysOf('const Map<String, String> areaForRole');
    const strays = inDart.filter((r) => !WORKING.includes(r));
    assert.deepEqual(strays, [], `the app routes roles the server never sends: ${strays.join(', ')}`);
  });

  test('every role has a label for its own profile screen', () => {
    // "Clinic staff" was shown to everybody who was not a doctor. A lab
    // technician reading that about themselves is the app being wrong about
    // something it knows.
    const labelled = new Set(keysOf('const Map<String, String> roleLabels'));
    const missing = WORKING.filter((r) => !labelled.has(r));
    assert.deepEqual(missing, [], `no profile label for: ${missing.join(', ')}`);
  });

  test('every area a role lands in has a home tab', () => {
    /*
     * The gap between the two tables, which nothing else would catch: a role
     * mapped to an area with no declared home falls back to the clinician
     * dashboard, which is a reasonable last resort and the wrong screen for
     * somebody the router has just sent somewhere else.
     */
    const areas = new Set(
      [...area.matchAll(/^ {2}'[a-z_]+': '(\/[a-z]+)',/gm)].map((m) => m[1]),
    );
    const homed = new Set(keysOf('const Map<String, String> homeForArea'));
    for (const a of areas) {
      assert.ok(homed.has(a), `${a} has no home tab in homeForArea`);
    }
  });
});
