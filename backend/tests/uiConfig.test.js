import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  WIDGETS,
  QUICK_ACTIONS,
  DEPARTMENT_DEFAULTS,
  composeFor,
  resolveUi,
} from '../src/services/uiConfig.js';
import { CAPABILITIES as C, ALL_CAPABILITIES } from '../src/services/capabilities.js';
import { PERMISSIONS as P, PRESETS } from '../src/models/Membership.js';

/**
 * What each screen is made of, and who decides.
 *
 * Real unit tests, like capabilities.test.js and for the same reason: this is
 * pure logic — a department, a capability set and a permission set in, a list
 * of identifiers out. What the identifiers *mean* is the app's business and is
 * tested there.
 *
 * ---- The two failures worth catching ------------------------------------
 *
 * Both are silent. A configured widget id that no longer exists produces a
 * shorter dashboard, not an error; and a widget whose `needs` were never
 * written is visible to everybody, which looks like it is working. Neither
 * shows up in use — the first looks like a design decision and the second
 * looks like a feature.
 */

/** Everything, which is what a practice nobody has classified holds. */
const everything = new Set(ALL_CAPABILITIES);

const head = new Set(PRESETS.head);
const clinician = new Set(PRESETS.clinician);
const desk = new Set(PRESETS.desk);

/** The unclassified practice and a full grant — the widest possible answer. */
function forHead(department = null) {
  return resolveUi({ department, capabilities: everything, permissions: head });
}

describe('the registry and the defaults agree', () => {
  test('every default widget is a widget this server knows', () => {
    /*
     * The drift guard, and the reason it is first.
     *
     * A typo in DEPARTMENT_DEFAULTS does not throw. It is filtered out by
     * resolveUi — deliberately, so an operator cannot break a home screen —
     * and the result is a cardiology dashboard quietly missing its ECG. That
     * is indistinguishable from somebody having decided against it.
     */
    for (const [key, spec] of Object.entries(DEPARTMENT_DEFAULTS)) {
      for (const id of spec.widgets) {
        assert.ok(WIDGETS[id], `${key} defaults to widget ${id}, which does not exist`);
      }
      for (const id of spec.quickActions) {
        assert.ok(QUICK_ACTIONS[id], `${key} defaults to action ${id}, which does not exist`);
      }
    }
  });

  test('every entry names a capability and a permission that exist', () => {
    // A `needs` referring to a capability that has been renamed is a gate that
    // can never open: the set will never contain it, and the component simply
    // stops appearing for everybody.
    const caps = new Set(ALL_CAPABILITIES);
    const perms = new Set(Object.values(P));

    for (const [id, spec] of Object.entries({ ...WIDGETS, ...QUICK_ACTIONS })) {
      if (spec.needs.capability) {
        assert.ok(caps.has(spec.needs.capability), `${id} needs a capability that does not exist`);
      }
      if (spec.needs.permission) {
        assert.ok(perms.has(spec.needs.permission), `${id} needs a permission that does not exist`);
      }
    }
  });

  test('no identifier is declared twice', () => {
    /*
     * A duplicate key in an object literal is not an error in JavaScript. The
     * later one wins, silently, and the `needs` written on the first is simply
     * gone — so a component somebody carefully gated can lose its gate to a
     * copy-paste twenty lines down and nothing anywhere says so.
     *
     * Object.keys cannot see it, because by then it has already happened. This
     * reads the source.
     */
    const src = readFileSync(new URL('../src/services/uiConfig.js', import.meta.url), 'utf8');
    for (const table of ['WIDGETS', 'QUICK_ACTIONS']) {
      const at = src.indexOf(`export const ${table} = Object.freeze({`);
      const block = src.slice(at, src.indexOf('\n});', at));
      const keys = [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((m) => m[1]);
      const seen = new Set();
      const twice = keys.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
      assert.deepEqual(twice, [], `${table} declares ${twice.join(', ')} twice`);
    }
  });

  test('nothing is registered as both a widget and an action', () => {
    // They are looked up in separate tables and a name in both means one of
    // the two lookups is finding the wrong entry — with a different `needs`.
    for (const id of Object.keys(WIDGETS)) {
      assert.ok(!QUICK_ACTIONS[id], `${id} is registered as both a widget and an action`);
    }
  });
});

describe('a department with nothing configured still has a screen', () => {
  test('no department at all gets the general clinical set', () => {
    // A solo clinic, and every member of a practice nobody has assigned to a
    // department. The commonest case, not an edge.
    const ui = forHead(null);
    assert.ok(ui.widgets.includes('TRIAGE_QUEUE'));
    assert.ok(ui.quickActions.includes('START_CONSULTATION'));
    assert.equal(ui.department, null);
  });

  test('a department the platform has no default for gets the same', () => {
    // Neurology is seeded and has no dashboard written for it. It gets the
    // general one, which is honest: a caseload is a caseload.
    const ui = forHead({ key: 'neurology', widgets: [], quickActions: [] });
    assert.deepEqual(ui.widgets, forHead(null).widgets);
    assert.equal(ui.department, 'neurology');
  });

  test('an empty array means the default, not an empty screen', () => {
    /*
     * The same reading as `permissions` on a Membership. Every department row
     * in the database today has `widgets: []`, and a literal reading would
     * give the clinic seeing patients this morning a home screen with nothing
     * on it — on the deploy that added the field.
     */
    const ui = forHead({ key: 'cardiology', widgets: [], quickActions: [] });
    assert.ok(ui.widgets.length > 0);
    assert.ok(composeFor({ key: 'cardiology' }).usingDefault);
  });

  test('and a configured department says so', () => {
    const composed = composeFor({ key: 'cardiology', widgets: ['ACTION_QUEUE'] });
    assert.equal(composed.usingDefault, false);
    assert.deepEqual(composed.widgets, ['ACTION_QUEUE']);
  });
});

describe('two departments, two different applications', () => {
  /*
   * The point of the whole engine, stated as an assertion.
   *
   * Cardiology is a caseload: who is here, what their pressure is, what the
   * risk score says. A laboratory is a queue with states: how much is waiting
   * and what has gone critical. If these two came out looking alike, the
   * configuration layer would be decoration over one hardcoded screen.
   */
  test('cardiology is a caseload', () => {
    const ui = forHead({ key: 'cardiology' });
    assert.ok(ui.widgets.includes('TRIAGE_QUEUE'));
    assert.ok(ui.widgets.includes('TODAYS_CLINIC'));
    assert.ok(ui.quickActions.includes('START_CONSULTATION'));
  });

  test('a laboratory is a set of results', () => {
    const ui = forHead({ key: 'laboratory' });
    assert.ok(ui.widgets.includes('CRITICAL_LAB_RESULTS'));
    assert.ok(ui.widgets.includes('LAB_FLAG_SUMMARY'));
    // No appointments, no consultations, no prescribing anywhere on it.
    assert.ok(!ui.widgets.includes('TODAYS_CLINIC'));
    assert.ok(!ui.quickActions.includes('WRITE_PRESCRIPTION'));
  });

  test('and pathology reads the same bench', () => {
    // The same object, not a copied list. A second copy is a second thing to
    // keep in step, and the one that drifts is the one nobody opens.
    assert.deepEqual(forHead({ key: 'pathology' }).widgets, forHead({ key: 'laboratory' }).widgets);
  });

  test('and the only thing they share is the one thing both read', () => {
    /*
     * Named rather than asserted to be empty, which is what this said first
     * and was simply untrue: a cardiologist looks at their patients' lab
     * reports, so RECENT_LAB_REPORTS belongs on both screens. An assertion
     * that the overlap is nil would have been satisfied by removing it, which
     * would make the cardiology dashboard worse to keep a test tidy.
     *
     * What matters is that the overlap is deliberate and small — if a third
     * component appears here, somebody has started drifting the two screens
     * back towards one.
     */
    const cardiology = new Set(forHead({ key: 'cardiology' }).widgets);
    const laboratory = forHead({ key: 'laboratory' }).widgets;
    const shared = laboratory.filter((id) => cardiology.has(id));

    assert.deepEqual(shared, ['RECENT_LAB_REPORTS']);
  });

  test('and the laboratory has none of the caseload', () => {
    // The assertion that actually says "two different applications". A bench
    // screen with an appointments panel on it is a cardiology screen wearing
    // a different name.
    const ui = forHead({ key: 'laboratory' });
    for (const id of ['TODAYS_CLINIC', 'TRIAGE_QUEUE', 'ACTION_QUEUE', 'OPEN_ALERTS']) {
      assert.ok(!ui.widgets.includes(id), `the laboratory dashboard shows ${id}`);
    }
  });

  test('the configured order is the order drawn', () => {
    // A dashboard is ranked: the first component is the one somebody reads
    // first. Filtering must not reshuffle what survives it.
    const ui = forHead({
      key: 'cardiology',
      widgets: ['OPEN_ALERTS', 'ACTION_QUEUE', 'TODAYS_CLINIC'],
    });
    assert.deepEqual(ui.widgets, ['OPEN_ALERTS', 'ACTION_QUEUE', 'TODAYS_CLINIC']);
  });
});

describe('what the plan pays for disappears when it stops paying', () => {
  test('no analytics, no analytics panel', () => {
    const without = new Set([...everything].filter((c) => c !== C.ADVANCED_ANALYTICS));
    const ui = resolveUi({
      department: { key: 'cardiology' },
      capabilities: without,
      permissions: head,
    });

    assert.ok(!ui.widgets.includes('ANALYTICS_SUMMARY'));
    // And the rest of the dashboard is still there. A capability going away
    // removes a component; it does not empty the screen.
    assert.ok(ui.widgets.includes('TRIAGE_QUEUE'));
  });

  test('the readings themselves are never behind a plan', () => {
    /*
     * Deliberate, and the one rule here that is a clinical decision rather
     * than a product one: a doctor's own caseload and their patients' vitals
     * are not a premium feature. A practice that has stopped paying loses
     * growth and analysis — see billing/lapse.js — and does not lose the
     * ability to see who is in front of it.
     */
    const ui = resolveUi({ department: null, capabilities: new Set(), permissions: head });
    assert.ok(ui.widgets.includes('TODAYS_CLINIC'));
    assert.ok(ui.widgets.includes('TRIAGE_QUEUE'));
    assert.ok(ui.widgets.includes('OPEN_ALERTS'));
  });

  test('a diagnostic centre is offered no prescribing action', () => {
    // Not a plan decision and not a permission decision — it is what the
    // organisation is. The capability table refuses it and this inherits that
    // refusal rather than restating it.
    const centre = new Set([C.LAB_ORDER, C.LAB_RESULT]);
    const ui = resolveUi({
      department: { key: 'laboratory' },
      capabilities: centre,
      permissions: head,
    });

    assert.ok(!ui.quickActions.includes('WRITE_PRESCRIPTION'));
    assert.ok(ui.quickActions.includes('VIEW_LAB_REPORTS'));
  });
});

describe('and what this person may do narrows it again', () => {
  test('the desk is not offered prescribing', () => {
    const ui = resolveUi({ department: null, capabilities: everything, permissions: desk });
    assert.ok(!ui.quickActions.includes('WRITE_PRESCRIPTION'));
    // But it still registers people and takes their weight.
    assert.ok(ui.quickActions.includes('RECORD_VITALS'));
    assert.ok(ui.quickActions.includes('ADD_PATIENT'));
  });

  test('a clinician is not shown the staff list', () => {
    const ui = resolveUi({ department: null, capabilities: everything, permissions: clinician });
    assert.ok(!ui.quickActions.includes('MANAGE_TEAM'));
  });

  test('and the head of the practice is', () => {
    const ui = resolveUi({
      department: { key: 'general_physician', quickActions: ['MANAGE_TEAM', 'MANAGE_DEPARTMENTS'] },
      capabilities: everything,
      permissions: head,
    });
    assert.deepEqual(ui.quickActions, ['MANAGE_TEAM', 'MANAGE_DEPARTMENTS']);
  });

  test('a permission and a capability both have to clear', () => {
    // DEPARTMENT_OVERVIEW needs both. Holding one is not holding it.
    const noCapability = new Set([...everything].filter((c) => c !== C.DEPARTMENT));
    assert.ok(
      !resolveUi({
        department: { key: 'x', quickActions: ['MANAGE_DEPARTMENTS'] },
        capabilities: noCapability,
        permissions: head,
      }).quickActions.includes('MANAGE_DEPARTMENTS'),
    );
    assert.ok(
      !resolveUi({
        department: { key: 'x', quickActions: ['MANAGE_DEPARTMENTS'] },
        capabilities: everything,
        permissions: clinician,
      }).quickActions.includes('MANAGE_DEPARTMENTS'),
    );
  });
});

describe('nothing the server has not heard of reaches the app', () => {
  test('a widget id that does not exist is dropped', () => {
    /*
     * The allow-list, and it is the whole reason `widgets` is safe to be an
     * operator-editable array of free strings. Somebody typing `HEART_RAET`
     * into the console gets a dashboard without it, not an app that cannot
     * draw its own home screen.
     */
    const ui = forHead({
      key: 'cardiology',
      widgets: ['ACTION_QUEUE', 'ACTION_QEUEU', 'TODAYS_CLINIC'],
    });
    assert.deepEqual(ui.widgets, ['ACTION_QUEUE', 'TODAYS_CLINIC']);
  });

  test('an action id that does not exist is dropped', () => {
    const ui = forHead({ key: 'laboratory', quickActions: ['VIEW_LAB_REPORTS', 'LAUNCH_MISSILES'] });
    assert.deepEqual(ui.quickActions, ['VIEW_LAB_REPORTS']);
  });

  test('a widget id in the actions list is not an action', () => {
    // The two tables are separate and a name is looked up in one of them. A
    // widget named in `quickActions` is a mistake, not a widget.
    const ui = forHead({ key: 'cardiology', quickActions: ['ACTION_QUEUE'] });
    assert.deepEqual(ui.quickActions, []);
  });

  test('and the tables cannot be edited at runtime', () => {
    // Frozen, because a registry a request can add to is not an allow-list.
    assert.throws(() => {
      WIDGETS.ANYTHING = { needs: {} };
    });
  });
});

describe('the resolver accepts what its callers actually hold', () => {
  test('arrays as well as sets', () => {
    // `effectiveCapabilities` returns a Set and a membership's grant is an
    // array. Requiring the caller to convert is how one call site ends up
    // passing an array to `.has` and silently resolving to nothing.
    const ui = resolveUi({
      department: { key: 'cardiology' },
      capabilities: [...everything],
      permissions: [...head],
    });
    assert.ok(ui.widgets.length > 0);
  });

  test('and nothing at all means "unknown", not "holds nothing"', () => {
    /*
     * The rule the whole tenant migration rests on, and the one this resolver
     * very nearly broke.
     *
     * A member whose membership row the backfill has not reached resolves to
     * no grant. Read literally that is "may do nothing", and the deploy that
     * added this field would have handed a working doctor an empty home
     * screen on a Monday morning. `effectiveCapabilities` reads a null
     * membership as "do not narrow"; so must this, or the two disagree and
     * one hides what the other permits.
     */
    const ui = resolveUi({ capabilities: undefined, permissions: undefined });
    assert.deepEqual(ui.widgets, [
      'TRIAGE_QUEUE',
      'TODAYS_CLINIC',
      'ACTION_QUEUE',
      'NUTRITION_REVIEWS',
      'OPEN_ALERTS',
      'LIVE_ACTIVITY',
    ]);
    assert.ok(ui.quickActions.includes('WRITE_PRESCRIPTION'));
  });

  test('but an empty set is an answer, and means it', () => {
    // The other half, and the distinction that makes the one above safe. A
    // grant somebody has actually customised down to nothing is not the same
    // state as a grant nobody has written yet.
    const ui = resolveUi({ capabilities: new Set(), permissions: new Set() });
    assert.deepEqual(ui.widgets, []);
    assert.deepEqual(ui.quickActions, []);
  });
});
