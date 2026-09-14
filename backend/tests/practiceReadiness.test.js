import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * What a practice needs before a prescription is worth printing.
 *
 * The rule lives on the server rather than in the widget that draws it, because
 * it is a clinical rule wearing a form-validation costume: a prescription
 * without a council registration number is not a valid document, and the next
 * person to restyle the screen must not be able to delete that by tidying a
 * layout.
 *
 * Read from source rather than imported — importing the route pulls in the
 * database, and what is being checked is the list as written.
 */
const src = readFileSync(new URL('../src/routes/practices.js', import.meta.url), 'utf8');

/** The READINESS array, parsed without executing it. */
function readinessFields() {
  const start = src.indexOf('const READINESS = [');
  const end = src.indexOf('\n];', start);
  assert.notEqual(start, -1, 'could not find READINESS');
  const block = src.slice(start, end);

  return [...block.matchAll(/key: '(\w+)',\s*blocking: (true|false)/g)].map(([, key, b]) => ({
    key,
    blocking: b === 'true',
  }));
}

describe('prescription readiness', () => {
  const fields = readinessFields();

  test('the three legally required fields block', () => {
    // Name, council number, and the doctor's printed name. Without any one of
    // them the sheet that comes out of the printer is not a prescription.
    const blocking = fields.filter((f) => f.blocking).map((f) => f.key).sort();
    assert.deepEqual(blocking, ['doctorDisplayName', 'name', 'registrationNo']);
  });

  test('a missing logo or tagline does not block', () => {
    // A plain letterhead is still a valid one. Marking cosmetic fields as
    // blocking would put a red warning on a practice that is working correctly,
    // and a warning that fires when nothing is wrong stops being read.
    for (const key of ['logoLightAssetId', 'tagline']) {
      const f = fields.find((x) => x.key === key);
      assert.ok(f, `${key} is not in READINESS`);
      assert.equal(f.blocking, false, `${key} should not block`);
    }
  });

  test('every field says what it prints', () => {
    // The difference between a nag and a reason. "Registration number: missing"
    // is a form error; "prints under the signature, where the council number
    // must appear" tells a doctor why to stop and fix it.
    const start = src.indexOf('const READINESS = [');
    const block = src.slice(start, src.indexOf('\n];', start));
    const keys = (block.match(/key: '/g) ?? []).length;
    const prints = (block.match(/prints: '/g) ?? []).length;
    assert.equal(prints, keys, 'a readiness field has no `prints` sentence');
  });

  test('the practice cannot verify or un-suspend itself', () => {
    // `status` gates access and `verification` is a human checking papers.
    // Either one in the PATCH body would let a practice grant itself both.
    const patchBody = src.slice(src.indexOf("router.patch("), src.indexOf('audit(\'update\', \'Practice\')'));
    assert.ok(!/\bstatus:/.test(patchBody), 'status is editable from the client');
    assert.ok(!/\bverification:/.test(patchBody), 'verification is editable from the client');
    assert.ok(!/\bisFounding:/.test(patchBody), 'isFounding is editable from the client');
  });

  test('saving the letterhead drops the identity cache', () => {
    // The identity is cached for a minute. Without this, a doctor corrects the
    // registration number and the next prescription prints the old one.
    assert.match(src, /forgetClinicIdentity\(\);/);
  });

  test('no practice yet is a normal answer, not a 404', () => {
    // An account with no current membership has no practice, and the screen has
    // a real thing to say about it. This pinned `needsBackfill: true`, which
    // came from the branch that fell back to the platform's first clinic — that
    // branch showed such an account another practice's letterhead, and it is
    // gone. The answer is still a plain 200 with no practice, never a refusal.
    const at = src.indexOf("'/mine'");
    const mine = src.slice(at, src.indexOf('router.get(', at));
    assert.match(mine, /if \(!practice\) return res\.json\(\{ practice: null \}\)/);
    assert.ok(!/notFound\(/.test(mine), 'having no practice became an error');
  });
});
