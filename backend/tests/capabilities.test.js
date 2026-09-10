import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  CAPABILITIES as C,
  ALL_CAPABILITIES,
  capabilitiesOfPractice,
  effectiveCapabilities,
  can,
  describeCapabilities,
  explainCapabilities,
} from '../src/services/capabilities.js';
import { PRACTICE_TYPE, PLAN, PRACTICE_TYPE_ORDER, RESPONSIBLE_LABEL } from '../src/models/Practice.js';
import { PERMISSIONS, PRESETS } from '../src/models/Membership.js';
import { ROLES } from '../src/models/User.js';

/**
 * What a practice can do, and what a person in it can do.
 *
 * Unlike most of this suite these are real unit tests rather than assertions
 * about source, because this is the one piece that is pure logic: four inputs
 * and a set out. A source test would check that a table exists; these check
 * that the answers are right, which is what the screens and the guards both
 * depend on.
 *
 * ---- The assertion that matters most ------------------------------------
 *
 * "Absence permits". Every practice that exists today has no type, and the
 * clinic seeing patients this morning must not lose prescribing because a
 * column was added. That is the first block below and it is not a nicety —
 * getting it wrong is an outage on the deploy, not a bug found later.
 */

const doctor = { role: ROLES.DOCTOR, permissions: [...PRESETS.clinician] };
const head = { role: ROLES.DOCTOR, isOwner: true, permissions: [...PRESETS.head] };
const desk = { role: ROLES.STAFF, permissions: [...PRESETS.desk] };
const dietician = { role: ROLES.DIETICIAN, permissions: [...PRESETS.desk] };

describe('a practice nobody has classified keeps everything', () => {
  test('no type and no plan is not "no capabilities"', () => {
    // Every row in the database today. If this ever fails, the deploy that
    // makes it fail takes prescriptions away from a live clinic.
    const held = capabilitiesOfPractice({});
    assert.equal(held.size, ALL_CAPABILITIES.length);
  });

  test('null explicitly, not just missing', () => {
    const held = capabilitiesOfPractice({ practiceType: null, plan: null });
    assert.equal(held.size, ALL_CAPABILITIES.length);
  });

  test('a type but no plan narrows only by type', () => {
    const held = capabilitiesOfPractice({ practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE });
    assert.ok(!held.has(C.PRESCRIPTION), 'a diagnostic centre should not prescribe');
    assert.ok(held.has(C.LAB_ORDER));
  });

  test('a plan but no type narrows only by plan', () => {
    const held = capabilitiesOfPractice({ plan: PLAN.ESSENTIAL });
    assert.ok(held.has(C.PRESCRIPTION));
    assert.ok(!held.has(C.ADVANCED_ANALYTICS), 'essential should not get advanced analytics');
  });

  test('and a member with no membership row keeps the practice’s set', () => {
    // The pre-backfill caller. Narrowing here would lock somebody out of a
    // practice they demonstrably work at.
    const practice = { practiceType: PRACTICE_TYPE.HOSPITAL, plan: PLAN.ENTERPRISE };
    const held = capabilitiesOfPractice(practice);
    const mine = effectiveCapabilities({ practice, membership: null });
    assert.deepEqual([...mine].sort(), [...held].sort());
  });

  test('an empty permission grant means the preset, not "nothing"', () => {
    // The model resolves an empty grant to the role preset on read. Reading it
    // here as "may do nothing" is the same bug from the other end.
    const practice = { practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.PROFESSIONAL };
    const mine = effectiveCapabilities({
      practice,
      membership: { role: ROLES.DOCTOR, permissions: [] },
    });
    assert.ok(mine.has(C.PRESCRIPTION), 'an empty grant locked a doctor out of prescribing');
  });
});

describe('the type decides what the organisation can do at all', () => {
  test('a diagnostic centre does not prescribe, on any plan', () => {
    for (const plan of Object.values(PLAN)) {
      const held = capabilitiesOfPractice({
        practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
        plan,
      });
      assert.ok(!held.has(C.PRESCRIPTION), `prescribing leaked in on plan ${plan}`);
    }
  });

  test('and money cannot buy it', () => {
    // The grant is the operator's escape hatch and it is still bounded. An
    // operator switching this on is making a mistake, and the ceiling is what
    // catches it rather than the customer discovering it.
    const held = capabilitiesOfPractice({
      practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
      plan: PLAN.ENTERPRISE,
      capabilities: [C.PRESCRIPTION],
    });
    assert.ok(!held.has(C.PRESCRIPTION));
  });

  test('a solo clinic has no departments to manage', () => {
    const held = capabilitiesOfPractice({
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.ENTERPRISE,
    });
    assert.ok(!held.has(C.DEPARTMENT));
    assert.ok(!held.has(C.DEPARTMENT_ANALYTICS));
  });

  test('a polyclinic does', () => {
    const held = capabilitiesOfPractice({
      practiceType: PRACTICE_TYPE.POLYCLINIC,
      plan: PLAN.PROFESSIONAL,
    });
    assert.ok(held.has(C.DEPARTMENT));
    assert.ok(held.has(C.MULTI_LOCATION));
  });

  test('every type has a row, and every row is real capabilities', () => {
    for (const type of Object.values(PRACTICE_TYPE)) {
      const held = capabilitiesOfPractice({ practiceType: type });
      assert.ok(held.size > 0, `${type} has no capabilities at all`);
      for (const c of held) {
        assert.ok(ALL_CAPABILITIES.includes(c), `${type} lists an unknown capability ${c}`);
      }
    }
  });
});

describe('the plan decides what has been paid for', () => {
  test('a trial shows the whole product', () => {
    // Somebody deciding whether to buy should be looking at what is for sale.
    const held = capabilitiesOfPractice({ plan: PLAN.TRIAL });
    assert.equal(held.size, ALL_CAPABILITIES.length);
  });

  test('essential gets the clinical loop and not the analytics', () => {
    const held = capabilitiesOfPractice({ plan: PLAN.ESSENTIAL });
    assert.ok(held.has(C.PRESCRIPTION));
    assert.ok(held.has(C.LAB_RESULT));
    assert.ok(!held.has(C.ADVANCED_ANALYTICS));
    assert.ok(!held.has(C.REPORT_EXPORT));
  });

  test('a grant adds one thing without inventing a plan', () => {
    const held = capabilitiesOfPractice({
      practiceType: PRACTICE_TYPE.CLINIC,
      plan: PLAN.ESSENTIAL,
      capabilities: [C.REPORT_EXPORT],
    });
    assert.ok(held.has(C.REPORT_EXPORT));
    // And nothing else came with it.
    assert.ok(!held.has(C.SCHEDULED_REPORTS));
  });

  test('a grant of something that does not exist is ignored', () => {
    const held = capabilitiesOfPractice({ plan: PLAN.ESSENTIAL, capabilities: ['WHATEVER'] });
    assert.ok(!held.has('WHATEVER'));
  });
});

describe('and the person decides what they may use', () => {
  const hospital = { practiceType: PRACTICE_TYPE.HOSPITAL, plan: PLAN.ENTERPRISE };

  test('a receptionist at a hospital cannot prescribe', () => {
    assert.ok(!can(C.PRESCRIPTION, { practice: hospital, membership: desk }));
  });

  test('nor order a lab, whatever their grant says', () => {
    // A practice manager holds MANAGE_STAFF, and that must not start meaning
    // clinical authority the day somebody widens the desk preset.
    const manager = { role: ROLES.STAFF, permissions: Object.values(PERMISSIONS) };
    assert.ok(!can(C.LAB_ORDER, { practice: hospital, membership: manager }));
    assert.ok(!can(C.PRESCRIPTION, { practice: hospital, membership: manager }));
  });

  test('a dietician does not prescribe either', () => {
    assert.ok(!can(C.PRESCRIPTION, { practice: hospital, membership: dietician }));
  });

  test('a doctor does', () => {
    assert.ok(can(C.PRESCRIPTION, { practice: hospital, membership: doctor }));
  });

  test('but not staff analytics — that needs MANAGE_STAFF', () => {
    assert.ok(!can(C.STAFF_ANALYTICS, { practice: hospital, membership: doctor }));
    assert.ok(can(C.STAFF_ANALYTICS, { practice: hospital, membership: head }));
  });

  test('the head doctor gets departments; an ordinary one does not', () => {
    assert.ok(can(C.DEPARTMENT, { practice: hospital, membership: head }));
    assert.ok(!can(C.DEPARTMENT, { practice: hospital, membership: doctor }));
  });

  test('a person can never have more than their practice', () => {
    // The property that makes the two layers safe to reason about separately.
    const practice = { practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE, plan: PLAN.ESSENTIAL };
    const held = capabilitiesOfPractice(practice);
    for (const m of [head, doctor, desk, dietician, null]) {
      for (const c of effectiveCapabilities({ practice, membership: m })) {
        assert.ok(held.has(c), `${m?.role ?? 'nobody'} has ${c} and the practice does not`);
      }
    }
  });
});

describe('the shape the clients are given', () => {
  test('it says both what the practice has and what this person has', () => {
    const out = describeCapabilities({
      practice: { practiceType: PRACTICE_TYPE.HOSPITAL, plan: PLAN.ENTERPRISE },
      membership: desk,
    });
    assert.ok(out.practice.includes(C.PRESCRIPTION), 'the hospital can prescribe');
    assert.ok(!out.effective.includes(C.PRESCRIPTION), 'the receptionist cannot');
  });

  test('and it is sorted, so two responses are comparable', () => {
    const out = describeCapabilities({ practice: {}, membership: head });
    assert.deepEqual(out.practice, [...out.practice].sort());
    assert.deepEqual(out.effective, [...out.effective].sort());
  });
});

describe('a type is a whole answer, not half of one', () => {
  test('every type is orderable and has a name for its responsible person', () => {
    // The wizard asks for one human whatever the type, and calls them the right
    // thing. A type with no label would render "undefined" above a phone field.
    for (const type of Object.values(PRACTICE_TYPE)) {
      assert.ok(PRACTICE_TYPE_ORDER.includes(type), `${type} is missing from the picker order`);
      assert.ok(RESPONSIBLE_LABEL[type], `${type} has no responsible-person label`);
    }
    assert.equal(PRACTICE_TYPE_ORDER.length, Object.values(PRACTICE_TYPE).length);
  });

  test('and specialty is a separate field, not folded into the type', () => {
    // "Cardiology hospital" is two facts that change independently. Folding
    // them produces the cross product and a migration per specialty.
    const model = readFileSync(new URL('../src/models/Practice.js', import.meta.url), 'utf8');
    assert.match(model, /practiceType: \{/);
    assert.match(model, /specialty: \{ type: String/);
    for (const type of Object.values(PRACTICE_TYPE)) {
      assert.ok(!/cardio|diabet|paediat/i.test(type), `${type} names a specialty`);
    }
  });
});

describe('hiding the button is not the feature', () => {
  const guard = readFileSync(
    new URL('../src/middleware/requireCapability.js', import.meta.url),
    'utf8',
  );

  test('there is a route guard, not only a client answer', () => {
    // A capability-driven UI hides what is not bought. The route stays mounted
    // and answers anybody who types the URL, which makes the paywall a
    // suggestion unless the server checks too.
    assert.match(guard, /export function requireCapability\(/);
    assert.match(guard, /effectiveCapabilities\(ctx\)\.has\(capability\)/);
  });

  test('it refuses rather than filtering', () => {
    assert.match(guard, /forbidden\(/);
    assert.match(guard, /recordDenial\(/);
  });

  test('and it permits a caller with no practice', () => {
    assert.match(guard, /if \(!ctx\.practice\) return next\(\);/);
  });
});

/**
 * Why a capability is off, not merely that it is.
 *
 * `DEPARTMENT` clears three independent gates — the practice type must be an
 * organisation that has departments, the plan must pay for them, and the
 * member must hold MANAGE_DEPARTMENT. The app draws nothing when any one
 * fails, deliberately: a greyed section advertising something that will never
 * apply to a solo clinic is worse than nothing.
 *
 * That leaves the operator who has just set a practice up looking at a screen
 * with no departments on it, three possible reasons, and nothing anywhere that
 * says which. The console showed the type and the plan and never what they
 * added up to.
 */
describe('what is stopping a capability', () => {
  const stateOf = (practice, capability) =>
    explainCapabilities(practice).find((c) => c.capability === capability);

  test('a clinic does not have departments, whatever it pays', () => {
    for (const plan of [PLAN.ESSENTIAL, PLAN.PROFESSIONAL, PLAN.ENTERPRISE]) {
      const d = stateOf({ practiceType: PRACTICE_TYPE.CLINIC, plan }, 'DEPARTMENT');
      assert.equal(d.has, false);
      assert.equal(d.blockedBy, 'type', `on ${plan} the block was reported as ${d.blockedBy}`);
    }
  });

  test('and a specialty centre on Essential is blocked by the plan instead', () => {
    // The distinction that matters to whoever has to fix it: one is a sale and
    // the other is what the organisation is.
    const d = stateOf(
      { practiceType: PRACTICE_TYPE.SPECIALTY_CENTRE, plan: PLAN.ESSENTIAL },
      'DEPARTMENT',
    );
    assert.equal(d.has, false);
    assert.equal(d.blockedBy, 'plan');
  });

  test('type is named first when both would block it', () => {
    // A plan resolves itself with money and a type does not, so the half that
    // does not is the more useful answer.
    const d = stateOf({ practiceType: PRACTICE_TYPE.CLINIC, plan: PLAN.ESSENTIAL }, 'DEPARTMENT');
    assert.equal(d.blockedBy, 'type');
  });

  test('and nothing blocks it once both allow it', () => {
    const d = stateOf(
      { practiceType: PRACTICE_TYPE.SPECIALTY_CENTRE, plan: PLAN.PROFESSIONAL },
      'DEPARTMENT',
    );
    assert.equal(d.has, true);
    assert.equal(d.blockedBy, null);
  });

  test('the permission is reported even where the practice has it', () => {
    // The commonest reason a section is on one colleague's screen and not
    // another's, and the one that is a conversation rather than a sale.
    const d = stateOf(
      { practiceType: PRACTICE_TYPE.SPECIALTY_CENTRE, plan: PLAN.PROFESSIONAL },
      'DEPARTMENT',
    );
    assert.equal(d.needsPermission, PERMISSIONS.MANAGE_DEPARTMENT);
  });

  test('an unclassified practice is blocked by nothing', () => {
    // Absence permits, here as everywhere. Every practice predating these
    // fields is in this state and must not be told it has lost anything.
    for (const c of explainCapabilities({})) {
      assert.equal(c.has, true, `${c.capability} was withheld from an unclassified practice`);
      assert.equal(c.blockedBy, null);
    }
  });

  test('and the explanation agrees with what the practice actually gets', () => {
    /*
     * The two must not drift. `explainCapabilities` computes the ceilings a
     * second time to say *why*, and a second implementation of one rule is
     * how a console ends up confidently describing something the app does not
     * do.
     */
    for (const practiceType of [...Object.values(PRACTICE_TYPE), null]) {
      for (const plan of [...Object.values(PLAN), null]) {
        const practice = { practiceType, plan };
        const held = capabilitiesOfPractice(practice);
        for (const row of explainCapabilities(practice)) {
          assert.equal(
            row.has,
            held.has(row.capability),
            `${practiceType}/${plan}: ${row.capability} explained as ${row.has}`,
          );
        }
      }
    }
  });
});
