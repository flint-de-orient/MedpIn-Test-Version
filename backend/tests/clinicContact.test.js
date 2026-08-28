import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { env } from '../src/config/env.js';
import { clinicEmergencyPhone, orCallClinic } from '../src/services/clinicContact.js';

/**
 * The number a patient in an emergency is told to ring.
 *
 * This shipped defaulting to '+91-0000000000' and the assistant read it out, in
 * three languages, in the one reply where being wrong matters most. These tests
 * are about the failure mode rather than the happy path: what the app says when
 * nobody filled the number in.
 */
describe('the clinic emergency number', () => {
  const original = env.CLINIC_EMERGENCY_PHONE;
  const set = (v) => {
    env.CLINIC_EMERGENCY_PHONE = v;
  };
  const restore = () => set(original);

  test('a real number is used as given', () => {
    set('+918981540690');
    assert.equal(clinicEmergencyPhone(), '+918981540690');
    assert.match(orCallClinic('en'), /\+918981540690/);
    restore();
  });

  test('the old placeholder is refused', () => {
    // The exact default that shipped.
    set('+91-0000000000');
    assert.equal(clinicEmergencyPhone(), null);
    restore();
  });

  test('unset means the clause disappears, in every language', () => {
    // Not a blank where the number was: the whole "or call ..." clause goes.
    // "Go to the nearest hospital" is correct on its own; completing it with a
    // number that rings nowhere is worse than saying nothing, because someone
    // will dial it.
    set('');
    assert.equal(clinicEmergencyPhone(), null);
    for (const lang of ['en', 'bn', 'hi']) {
      assert.equal(orCallClinic(lang), '', `${lang} must not offer a number`);
    }
    restore();
  });

  test('a number too short to dial is refused', () => {
    set('+91123');
    assert.equal(clinicEmergencyPhone(), null);
    restore();
  });

  test('each language gets its own wording, not English', () => {
    set('+918981540690');
    assert.match(orCallClinic('bn'), /ক্লিনিক/);
    assert.match(orCallClinic('hi'), /क्लिनिक/);
    restore();
  });
});
