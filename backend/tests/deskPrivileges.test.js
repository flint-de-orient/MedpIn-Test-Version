import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * What a front-desk account may and may not do.
 *
 * `doctor.js` mounts `requireClinician` at the top, and `requireClinician`
 * admits STAFF. That is right for the desk's actual work — registering a
 * walk-in, taking a height and weight, reading the care inbox — and it was
 * quietly wrong for everything else in the file, because STAFF arrived after
 * most of those routes were written and each of them inherited an audience
 * decided before the role existed.
 *
 * A receptionist could reassign a patient's dietician (which, in a clinic with
 * two, decides who may see that patient at all), edit and approve the knowledge
 * base the assistant answers patients from, post into a review thread under the
 * clinician's name, issue the dietician invite code, create dietician accounts,
 * and change clinic settings.
 *
 * Read from the source rather than exercised, because what these guard is a
 * *missing line* — one somebody deletes while making something else work — and
 * a request that is never made cannot be tested by making requests.
 */
const doctor = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');

/** The guards registered between a route's path and its handler. */
function guardsFor(path) {
  const at = doctor.indexOf(`\n  '${path}',\n`);
  assert.notEqual(at, -1, `no route registered at ${path}`);
  return doctor.slice(at, at + 400);
}

describe('the front desk is not a clinician', () => {
  const doctorOnly = [
    ['/patients/:id/dietician', 'reassigning a patient to a dietician'],
    ['/dieticians', 'creating a dietician account'],
    ['/dietician-invite/generate', 'issuing the dietician invite code'],
    ['/settings', 'changing clinic settings'],
    ['/knowledge', 'writing the assistant knowledge base'],
    ['/knowledge/:id', 'editing it'],
    ['/knowledge/:id/approve', 'putting a passage in front of patients'],
    ['/knowledge/:id/retire', 'withdrawing one'],
    ['/chat-review/:sessionId/reviewed', 'declaring a conversation reviewed'],
    ['/chat-review/:sessionId/message', 'posting as the clinician'],
    ['/alerts/:id/acknowledge', 'acknowledging a clinical alert'],
    ['/alerts/:id/resolve', 'resolving one'],
    ['/staff', 'creating a front-desk account'],
    ['/staff-invite/generate', 'issuing the front-desk invite code'],
  ];

  for (const [path, what] of doctorOnly) {
    test(`${what} is doctor-only`, () => {
      assert.match(
        guardsFor(path),
        /requireDoctor/,
        `${path} is open to STAFF — ${what} is not a receptionist's job`,
      );
    });
  }

  const deskWork = [
    ['/patients', 'registering a walk-in'],
    ['/patients/:id/vitals', 'taking a height and weight at the desk'],
    ['/notifications/seen', 'clearing the message badge'],
  ];

  for (const [path, what] of deskWork) {
    test(`${what} stays open to the desk`, () => {
      // The other half of the rule. Locking these down would leave a front desk
      // that cannot do the job the account exists for.
      assert.ok(
        !/requireDoctor/.test(guardsFor(path)),
        `${path} was closed to STAFF — ${what} is exactly what a desk does`,
      );
    });
  }
});

describe('the desk bell shows the desk work', () => {
  const route = doctor.slice(
    doctor.indexOf("'/notifications',"),
    doctor.indexOf("'/notifications/seen'"),
  );

  test('the clinical-review queue is withheld from staff', () => {
    // A conversation flagged for review is a quality check on the assistant's
    // answers. It keeps for days, its only destination is a screen that does
    // not exist under /staff, and every row was a tap onto a blank page plus a
    // number on a badge the desk could never clear.
    assert.match(route, /const isDesk = req\.user\.role === ROLES\.STAFF/);
    assert.match(route, /isDesk[\s\S]{0,12}\?[\s\S]{0,12}\[\][\s\S]{0,12}: ChatSession\.find\(\{ flaggedForReview/);
  });

  test('but emergencies are not', () => {
    // The desk is on the emergency push fan-out deliberately — the
    // receptionist is the person physically present, and what happens next is
    // fetching the doctor or ringing the patient back. A bell that stayed
    // silent about the one thing on it that cannot wait would be worse than a
    // noisy one, so severity decides here, not role alone.
    assert.match(
      doctor,
      /const DESK_ALERTS = \{ status: 'open', severity: \{ \$in: \['urgent', 'emergency'\] \} \}/,
    );
    assert.match(route, /ClinicalAlert\.find\(isDesk \? DESK_ALERTS/);
  });

  test('appointment requests are shown to staff', () => {
    // Giving a waiting patient a time is most of what a front desk does, and
    // it was in no notification list at all.
    assert.match(route, /Appointment\.find\(\{ status: 'requested' \}\)/);
    assert.match(route, /kind: 'request'/);
  });

  test('the badge counts what the list holds', () => {
    // The count and the list are computed separately, so a role that filters
    // one must filter the other or the bell and the sheet disagree on screen.
    assert.match(route, /alertTotal \+ unreadTotal \+ flaggedTotal \+ requestTotal/);
    // The same filter on both sides. A count computed from a different
    // predicate than the list is exactly how a bell and the sheet it opens
    // came to disagree with each other on one screen.
    assert.match(route, /ClinicalAlert\.countDocuments\(isDesk \? DESK_ALERTS/);
    assert.match(route, /isDesk \? 0 : ChatSession\.countDocuments/);
    assert.match(route, /isDesk \? Appointment\.countDocuments/);
  });
});
