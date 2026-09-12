import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { ROLES, CLINICIAN_ROLES } from '../src/models/User.js';
import { readFileSync } from 'node:fs';

/**
 * Which acts belong to the doctor alone.
 *
 * A receptionist could issue a prescription. The create route was guarded by
 * `requireClinician`, which admits STAFF, and it records `doctor: req.user._id`
 * — so a prescription written at the front desk stored the receptionist as the
 * prescribing doctor and printed their name in that role on the PDF. Not a
 * loose permission: a false medical record.
 *
 * Read as source rather than exercised through a live server, because that is
 * what the failure was — a missing line, not a broken behaviour. This notices
 * the day someone relaxes it back.
 */
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

/** The guards named in the first few lines of a route registration. */
function guardsFor(source, routePath) {
  const at = source.indexOf(`'${routePath}',`);
  assert.ok(at > -1, `route ${routePath} not found`);
  return source.slice(at, at + 400);
}

describe('clinical authority', () => {
  test('only a doctor may issue a prescription', () => {
    const src = read('../src/routes/prescriptions.js');
    const at = src.indexOf('router.post(');
    assert.ok(at > -1, 'no create route');
    const block = src.slice(at, at + 400);
    assert.match(block, /requireDoctor/, 'prescribing must be doctor-only');
    assert.doesNotMatch(
      block.split('validate(')[0],
      /requireClinician/,
      'requireClinician admits staff and must not guard prescribing',
    );
  });

  test('only a doctor may resolve a clinical alert', () => {
    const src = read('../src/routes/doctor.js');
    assert.match(guardsFor(src, '/alerts/:id/resolve'), /requireDoctor/);
  });

  test('requireDoctor really does exclude staff', () => {
    const src = read('../src/middleware/auth.js');
    assert.match(src, /export const requireDoctor = requireRole\(ROLES\.DOCTOR\)/);

    /*
     * And the broader guard still admits the desk, because the desk needs it.
     *
     * Checked against the list rather than against the expression. This
     * pinned `requireRole(ROLES.DOCTOR, ROLES.STAFF)` as a literal, which was
     * both the claim and the bug: that guard is on forty routes and means
     * "works at a practice", so written as two names it refused the dietician
     * it already had and would have refused every role added since. A lab
     * technician would have signed in and then been told by the whole
     * application that they needed a different role.
     *
     * The claim worth protecting is that the desk is admitted and a patient
     * is not.
     */
    assert.match(src, /requireClinician = requireRole\(\.\.\.CLINICIAN_ROLES\)/);
    assert.ok(CLINICIAN_ROLES.includes(ROLES.STAFF), 'the desk lost its own routes');
    assert.ok(CLINICIAN_ROLES.includes(ROLES.DOCTOR));
    assert.ok(!CLINICIAN_ROLES.includes(ROLES.PATIENT), 'a patient is admitted as staff');
  });

  test('the desk keeps the work that is theirs', () => {
    // Registration and the appointment queue must NOT have become doctor-only:
    // locking the front desk out of its own job would be the opposite mistake.
    const appts = read('../src/routes/appointments.js');
    assert.doesNotMatch(appts, /requireDoctor/, 'appointments are the desk’s work');
  });
});
