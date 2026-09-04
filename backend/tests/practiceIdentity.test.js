import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveIdentity } from '../src/services/clinicIdentity.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { Clinic } from '../src/models/Clinic.js';

/**
 * The brand moving up from the location to the practice.
 *
 * The whole change rests on one promise: a clinic row that has not been
 * backfilled resolves exactly as it did before any of this existed. The
 * practice is a source of last resort beneath it, never one that replaces it.
 * If that order inverts, the clinic running today loses its letterhead to a row
 * somebody typed on a staging server.
 *
 * So the fallback order is pinned here, field by field, and so is the rule that
 * the backfill copies rather than moves.
 */
const ENV = { CLINIC_NAME: 'MedPin Clinic', DOCTOR_DISPLAY_NAME: 'The Doctor' };

describe('a clinic that has never heard of practices', () => {
  test('resolves entirely from its own row', () => {
    // The state of every deployment before the backfill runs, and of any row
    // the backfill missed. Nothing here may depend on a practice existing.
    const id = resolveIdentity(
      {
        _id: 'c1',
        name: 'Dey Diabetes Clinic',
        tagline: 'Diabetes Obesity & Metabolic Clinic',
        doctorDisplayName: 'Dr. Amit Kumar Dey',
        registrationNo: 'WBMC-12345',
        phone: '033 1234 5678',
        addressLine: '12 Salt Lake',
        city: 'Kolkata',
        logoLightAssetId: 'a1',
      },
      ENV,
    );

    assert.equal(id.clinicName, 'Dey Diabetes Clinic');
    assert.equal(id.tagline, 'Diabetes Obesity & Metabolic Clinic');
    assert.equal(id.doctorName, 'Dr. Amit Kumar Dey');
    assert.equal(id.registrationNo, 'WBMC-12345');
    assert.equal(id.logoLightAssetId, 'a1');
    assert.equal(id.practiceId, null);
  });

  test('still falls back to the environment when the row is bare', () => {
    // The seed path for a fresh deployment whose profile nobody has filled in.
    const id = resolveIdentity({ _id: 'c1', name: '' }, ENV);
    assert.equal(id.clinicName, 'MedPin Clinic');
    assert.equal(id.doctorName, 'The Doctor');
  });

  test('resolves with no row at all', () => {
    const id = resolveIdentity(null, ENV);
    assert.equal(id.clinicName, 'MedPin Clinic');
    assert.equal(id.id, null);
  });
});

describe('a location under a practice', () => {
  const practice = {
    _id: 'p1',
    name: 'Dey Diabetes Clinic',
    tagline: 'Diabetes Obesity & Metabolic Clinic',
    doctorDisplayName: 'Dr. Amit Kumar Dey',
    registrationNo: 'WBMC-12345',
    logoLightAssetId: 'shared-logo',
  };

  test('inherits what it has not set', () => {
    const id = resolveIdentity({ _id: 'c2', name: 'Behala Branch', practice }, ENV);
    assert.equal(id.tagline, 'Diabetes Obesity & Metabolic Clinic');
    assert.equal(id.registrationNo, 'WBMC-12345');
    assert.equal(id.logoLightAssetId, 'shared-logo');
    assert.equal(id.practiceId, 'p1');
  });

  test('its own value wins over the practice', () => {
    // Load-bearing. The settings screen the clinic uses today writes to the
    // Clinic row; if the practice won, saving that screen would look like it
    // had done nothing at all.
    const id = resolveIdentity(
      { _id: 'c2', name: 'Behala Branch', tagline: 'Evening Sitting', practice },
      ENV,
    );
    assert.equal(id.clinicName, 'Behala Branch');
    assert.equal(id.tagline, 'Evening Sitting');
  });

  test('an empty string is not an override', () => {
    // `||` not `??`. A field cleared to '' in a form should inherit, rather
    // than print a blank line on the letterhead.
    const id = resolveIdentity({ _id: 'c2', name: '', tagline: '', practice }, ENV);
    assert.equal(id.clinicName, 'Dey Diabetes Clinic');
    assert.equal(id.tagline, 'Diabetes Obesity & Metabolic Clinic');
  });

  test('address and phone never inherit', () => {
    // A branch that has not filled its phone in has no phone. Inheriting head
    // office's would send patients to the wrong building.
    const id = resolveIdentity(
      { _id: 'c2', name: 'Behala Branch', practice: { ...practice, phone: '033 1', city: 'X' } },
      ENV,
    );
    assert.equal(id.phone, null);
    assert.equal(id.city, null);
    assert.equal(id.addressLine, null);
  });

  test('an unpopulated ref supplies no brand', () => {
    // `.populate()` forgotten on some future query leaves an ObjectId here, and
    // reading `.name` off one is undefined. Falling through to the practice in
    // that state would print another clinic's name; falling through to the
    // environment is at least this deployment's configured one.
    const id = resolveIdentity({ _id: 'c2', name: '', practice: 'p1' }, ENV);
    assert.equal(id.clinicName, 'MedPin Clinic');
    assert.equal(id.practiceId, 'p1');
  });

  test('the dark-chip flag follows whichever row supplied the artwork', () => {
    // Taking the flag from the practice while the logo came from the location
    // paints a dark chip behind a mark drawn for a white background.
    const ownLight = resolveIdentity(
      {
        logoLightAssetId: 'mine',
        logoNeedsDarkChip: false,
        practice: { ...practice, logoNeedsDarkChip: true },
      },
      ENV,
    );
    assert.equal(ownLight.logoNeedsDarkChip, false);

    const inherited = resolveIdentity({ practice: { ...practice, logoNeedsDarkChip: true } }, ENV);
    assert.equal(inherited.logoNeedsDarkChip, true);
  });
});

describe('the models', () => {
  test('Clinic kept every brand field it had', () => {
    // The split adds a parent; it does not empty the child. A field removed
    // here is a letterhead that goes blank the moment a query forgets to
    // populate, so removing one has to be a deliberate, separate decision.
    const paths = Object.keys(Clinic.schema.paths);
    for (const f of [
      'name',
      'tagline',
      'doctorDisplayName',
      'registrationNo',
      'logoLightAssetId',
      'logoDarkAssetId',
      'logoNeedsDarkChip',
    ]) {
      assert.ok(paths.includes(f), `Clinic lost ${f}`);
    }
    assert.ok(paths.includes('practice'), 'Clinic has no practice ref');
    assert.equal(Clinic.schema.path('practice').options.default, null);
  });

  test('a practice is active and unverified by default', () => {
    // Verification is not access. A practice that has not sent its papers in
    // still works — the alternative is a clinic that cannot see patients
    // because an administrator has not opened an email.
    const p = new Practice({ name: 'New Clinic' });
    assert.equal(p.status, PRACTICE_STATUS.ACTIVE);
    assert.equal(p.verification, VERIFICATION.UNVERIFIED);
    assert.equal(p.isFounding, false);
  });

  test('"which practices does this doctor head" is indexed', () => {
    const idx = Practice.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.headDoctor === 1 && f.status === 1));
  });
});

describe('the backfill', () => {
  const src = readFileSync(new URL('../scripts/backfillPractices.js', import.meta.url), 'utf8');

  test('copies the brand up and removes nothing', () => {
    // The entire safety argument. If this script ever unsets a clinic's brand,
    // a clinic whose practice fails to populate prints a blank letterhead —
    // and there is no window in which that is acceptable.
    assert.ok(!/\$unset/.test(src), 'the backfill unsets a field');

    const setsOnClinic = src.match(/Clinic\.updateMany\([\s\S]{0,200}?\);/)?.[0] ?? '';
    assert.match(setsOnClinic, /\$set: \{ practice:/);
    assert.ok(
      !/tagline|logoLightAssetId|registrationNo/.test(setsOnClinic),
      'the backfill writes brand fields onto the clinic rows',
    );
  });

  test('is re-runnable', () => {
    // Marked so a second run finds the founding practice rather than making a
    // second one, and only ever links rows that have none.
    assert.match(src, /isFounding: true/);
    assert.match(src, /findOne\(\{ isFounding: true \}\)/);
    assert.match(src, /\{ practice: null \}/);
  });

  test('does not write unless asked', () => {
    assert.match(src, /const apply = process\.argv\.includes\('--apply'\)/);
    assert.match(src, /if \(!apply\)/);
  });

  test('the founding practice is verified, not left pending', () => {
    // It has been seeing patients for months. A pending badge on it would be
    // the migration telling the clinic it is not yet trusted.
    assert.match(src, /verification: VERIFICATION\.VERIFIED/);
  });
});
