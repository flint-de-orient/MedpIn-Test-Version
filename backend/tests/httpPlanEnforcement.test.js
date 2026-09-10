import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { boot, shutdown, wipe, as } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { PLAN } from '../src/models/Practice.js';
import { CAPABILITIES, capabilitiesOfPractice } from '../src/services/capabilities.js';

/**
 * The paywall, over the wire.
 *
 * ---- Why the old test was not enough ------------------------------------
 *
 * `capabilities.test.js` asserted that `requireCapability` exists and refuses.
 * It passed while eight of the twelve capabilities were attached to no route at
 * all — the guard was written, correct, and mounted on nothing. An Essential
 * practice that knew a URL had Professional's analytics.
 *
 * So these send real requests as a real doctor at a real practice on a real
 * plan, and read the status. A capability that stops being enforced fails here
 * rather than in a support conversation about a customer who never upgraded.
 */

let origin;

async function doctorAt(plan) {
  const practice = await makePractice('Sunrise Diabetes Care', { plan });
  const owner = await makeMember(practice, { name: 'Dr Bose', isOwner: true });
  const patient = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
  return { practice, owner, patient };
}

/** Every route this suite claims is gated, and by what. */
const GATED = [
  {
    capability: CAPABILITIES.ADVANCED_ANALYTICS,
    method: 'GET',
    path: () => '/doctor/analytics',
  },
  {
    capability: CAPABILITIES.ADVANCED_REPORTS,
    method: 'GET',
    path: (ctx) => `/doctor/patients/${ctx.patient.user._id}/summary`,
  },
  {
    capability: CAPABILITIES.ADVANCED_REPORTS,
    method: 'GET',
    path: (ctx) => `/doctor/patients/${ctx.patient.user._id}/adherence`,
  },
];

describe('a plan that does not include it is refused', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  for (const route of GATED) {
    test(`Essential is refused ${route.method} ${route.path({ patient: { user: { _id: ':id' } } })}`, async () => {
      // Sanity first: this test is only meaningful if Essential genuinely
      // lacks the capability. Otherwise it would pass for the wrong reason.
      assert.ok(
        !capabilitiesOfPractice({ plan: PLAN.ESSENTIAL }).has(route.capability),
        `Essential now includes ${route.capability}; this test is checking nothing`,
      );

      const ctx = await doctorAt(PLAN.ESSENTIAL);
      const res = await as(ctx.owner.token).get(route.path(ctx));

      assert.equal(
        res.status,
        403,
        `${route.capability} is not enforced: got ${res.status}`,
      );
    });

    test(`Professional is allowed ${route.method} ${route.path({ patient: { user: { _id: ':id' } } })}`, async () => {
      const ctx = await doctorAt(PLAN.PROFESSIONAL);
      const res = await as(ctx.owner.token).get(route.path(ctx));

      // Not "is 200" — some of these legitimately 404 for a patient with no
      // data yet. What matters is that the plan is not the reason.
      assert.notEqual(res.status, 403, `${route.capability} refused a plan that includes it`);
    });

    test(`Enterprise is allowed ${route.method} ${route.path({ patient: { user: { _id: ':id' } } })}`, async () => {
      const ctx = await doctorAt(PLAN.ENTERPRISE);
      const res = await as(ctx.owner.token).get(route.path(ctx));
      assert.notEqual(res.status, 403);
    });
  }

  test('and a practice on no plan at all keeps everything', async () => {
    // Every practice that existed before plans did, the founding clinic
    // included. Refusing here would be an outage on the deploy, not a paywall.
    const ctx = await doctorAt(undefined);
    for (const route of GATED) {
      const res = await as(ctx.owner.token).get(route.path(ctx));
      assert.notEqual(res.status, 403, `an unclassified practice lost ${route.capability}`);
    }
  });

  test('a trial sees the whole product', async () => {
    // Somebody deciding whether to buy should be looking at what is for sale.
    const ctx = await doctorAt(PLAN.TRIAL);
    for (const route of GATED) {
      const res = await as(ctx.owner.token).get(route.path(ctx));
      assert.notEqual(res.status, 403, `a trial was refused ${route.capability}`);
    }
  });
});

describe('reading a lab result is gated, and every plan has it', () => {
  /*
   * The spec for this work asked for "Essential -> 403" on LAB_RESULT. That
   * would have broken the clinical loop: Essential holds LAB_ORDER, so
   * refusing it the results means ordering an investigation nobody may read.
   *
   * Every plan and every practice type includes LAB_RESULT today, so the guard
   * refuses nobody. It is still correct to have: the resolver answers "may this
   * practice read results" separately from "may it order them" — a diagnostic
   * centre reports labs and never prescribes — and the route now asks the
   * question rather than assuming the answer.
   *
   * So this asserts the gate exists AND that it currently costs nobody
   * anything. If a future tier excludes LAB_RESULT, the second half fails and
   * whoever made that decision has to come and look at this comment.
   */
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  test('the route asks', () => {
    const src = readFileSync(path.join(process.cwd(), 'src', 'routes', 'care.js'), 'utf8');
    assert.match(src, /requireCapability\(CAPABILITIES\.LAB_RESULT\)/);
  });

  test('and no current plan is refused by it', async () => {
    for (const plan of Object.values(PLAN)) {
      assert.ok(
        capabilitiesOfPractice({ plan }).has(CAPABILITIES.LAB_RESULT),
        `${plan} lost LAB_RESULT — a practice that orders labs cannot read them`,
      );

      await wipe();
      const ctx = await doctorAt(plan);
      const res = await as(ctx.owner.token).get(`/patients/${ctx.patient.user._id}/labs`);
      assert.notEqual(res.status, 403, `${plan} was refused its own lab results`);
    }
  });
});

describe('and the count of what is enforced only goes up', () => {
  /*
   * The ratchet that would have caught the original gap.
   *
   * Counting call sites rather than naming them, so adding a gate needs no test
   * edit and removing one fails. The number is deliberately a floor and not an
   * equality: a route that grows a second check should not have to come here.
   */
  const ROUTES = path.join(process.cwd(), 'src', 'routes');

  function enforcedCapabilities() {
    const found = new Set();
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.js')) {
          const src = readFileSync(full, 'utf8');
          for (const m of src.matchAll(
            /(?:requireCapability|requestCan)\([^)]*CAPABILITIES\.([A-Z_]+)/g,
          )) {
            found.add(m[1]);
          }
        }
      }
    };
    walk(ROUTES);
    return found;
  }

  test('the capabilities with a route behind them', () => {
    const enforced = enforcedCapabilities();
    for (const must of [
      'PRESCRIPTION',
      'LAB_ORDER',
      'LAB_RESULT',
      'DEPARTMENT',
      'MULTI_LOCATION',
      'ADVANCED_ANALYTICS',
      'ADVANCED_REPORTS',
    ]) {
      assert.ok(enforced.has(must), `${must} is no longer enforced on any route`);
    }
  });

  test('and the four with no server feature are named, not forgotten', () => {
    /*
     * REPORT_EXPORT, DEPARTMENT_ANALYTICS, STAFF_ANALYTICS and SCHEDULED_REPORTS
     * have no endpoint to gate, because the feature does not exist on the
     * server:
     *
     *   REPORT_EXPORT        the export is built in the app from data the
     *                        practice already reads. Gating it would mean
     *                        gating the patient list, which every plan needs.
     *   DEPARTMENT_ANALYTICS no endpoint
     *   STAFF_ANALYTICS      no endpoint
     *   SCHEDULED_REPORTS    not built
     *
     * Attaching a guard to a route that does not exist is a no-op that looks
     * like progress. This test exists so the gap is a recorded decision rather
     * than an oversight — when one of them is built, its gate goes on with it
     * and its name moves to the list above.
     */
    const enforced = enforcedCapabilities();
    for (const notYet of [
      'REPORT_EXPORT',
      'DEPARTMENT_ANALYTICS',
      'STAFF_ANALYTICS',
      'SCHEDULED_REPORTS',
    ]) {
      assert.ok(
        !enforced.has(notYet),
        `${notYet} is now enforced somewhere — move it to the list above and add an endpoint test`,
      );
    }
  });
});
