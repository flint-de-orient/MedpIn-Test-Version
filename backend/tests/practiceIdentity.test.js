import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveIdentity } from '../src/services/clinicIdentity.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../src/models/Practice.js';
import { Clinic } from '../src/models/Clinic.js';

/**
 * Practice → Location → Head Doctor, field by field.
 *
 * The identity starts from the practice: its name is the practice's, and the
 * doctor it names is the practice's printed name, then the location's, then the
 * head doctor's own. A branch still overrides the parts a branch may own — its
 * tagline, logo and registration — and alone supplies its address and phone.
 *
 * What it never does is borrow. There was an environment fallback beneath all
 * of it, and it named the founding clinic and Dr. Amit Kumar Dey to anybody the
 * rows did not describe. A row that says nothing now resolves to nothing, and a
 * missing row to the neutral identity.
 *
 * So the order is pinned here, field by field, and so is the rule that the
 * backfill copies rather than moves.
 */

describe('a clinic that has never heard of practices', () => {
  test('resolves entirely from its own row', () => {
    // A location the backfill missed. Nothing here may depend on a practice
    // existing, and nothing here may come from anywhere but the row.
    const id = resolveIdentity({
      _id: 'c1',
      name: 'Salt Lake Diabetes Clinic',
      tagline: 'Diabetes Obesity & Metabolic Clinic',
      doctorDisplayName: 'Dr. Rina Sen',
      registrationNo: 'WBMC-12345',
      phone: '033 1234 5678',
      addressLine: '12 Salt Lake',
      city: 'Kolkata',
      logoLightAssetId: 'a1',
    });

    assert.equal(id.clinicName, 'Salt Lake Diabetes Clinic');
    assert.equal(id.tagline, 'Diabetes Obesity & Metabolic Clinic');
    assert.equal(id.doctorName, 'Dr. Rina Sen');
    assert.equal(id.registrationNo, 'WBMC-12345');
    assert.equal(id.logoLightAssetId, 'a1');
    assert.equal(id.practiceId, null);
    assert.equal(id.neutral, false);
  });

  test('a bare row borrows nothing', () => {
    // This was "still falls back to the environment", and the environment was
    // the founding clinic by default. A row that says nothing says nothing.
    const id = resolveIdentity({ _id: 'c1', name: '' });
    assert.equal(id.clinicName, null);
    assert.equal(id.doctorName, null);
  });

  test('no row at all is the neutral identity', () => {
    const id = resolveIdentity(null);
    assert.equal(id.neutral, true);
    assert.equal(id.clinicName, null);
    assert.equal(id.doctorName, null);
    assert.equal(id.emergencyPhone, null);
    assert.equal(id.id, null);
  });
});

describe('a location under a practice', () => {
  const practice = {
    _id: 'p1',
    name: 'Meridian Diabetes Care',
    tagline: 'Diabetes Obesity & Metabolic Clinic',
    doctorDisplayName: 'Dr. Meera Iyer',
    registrationNo: 'WBMC-12345',
    logoLightAssetId: 'shared-logo',
  };

  test('inherits what it has not set', () => {
    const id = resolveIdentity({ _id: 'c2', name: 'Behala Branch', practice });
    assert.equal(id.tagline, 'Diabetes Obesity & Metabolic Clinic');
    assert.equal(id.registrationNo, 'WBMC-12345');
    assert.equal(id.logoLightAssetId, 'shared-logo');
    assert.equal(id.practiceId, 'p1');
  });

  test('the name is the practice’s, and the branch is where it is', () => {
    // The practice is who the patient is dealing with. A location's name was
    // winning, so a practice that called its first location "Park Street"
    // introduced its assistant as working at Park Street and printed that
    // across the top of its prescriptions. The branch's name is still there,
    // for anything that is about the place.
    const id = resolveIdentity({ _id: 'c2', name: 'Behala Branch', practice });
    assert.equal(id.clinicName, 'Meridian Diabetes Care');
    assert.equal(id.locationName, 'Behala Branch');
  });

  test('a branch’s own tagline, logo and registration still win', () => {
    // Load-bearing, and what the practice screen calls a branch overriding the
    // brand: the settings screen writes these to the Clinic row, and if the
    // practice won, saving that screen would look like it had done nothing.
    const id = resolveIdentity({
      _id: 'c2',
      name: 'Behala Branch',
      tagline: 'Evening Sitting',
      registrationNo: 'EST-77',
      logoLightAssetId: 'branch-logo',
      practice,
    });
    assert.equal(id.tagline, 'Evening Sitting');
    assert.equal(id.registrationNo, 'EST-77');
    assert.equal(id.logoLightAssetId, 'branch-logo');
  });

  test('the doctor is the practice’s printed name, then the location’s, then the head doctor', () => {
    const head = { _id: 'u1', name: 'Dr. Head Doctor' };

    assert.equal(
      resolveIdentity({ _id: 'c2', name: 'B', doctorDisplayName: 'Dr. Branch', practice: { ...practice, headDoctor: head } })
        .doctorName,
      'Dr. Meera Iyer',
    );
    assert.equal(
      resolveIdentity({
        _id: 'c2',
        name: 'B',
        doctorDisplayName: 'Dr. Branch',
        practice: { ...practice, doctorDisplayName: '', headDoctor: head },
      }).doctorName,
      'Dr. Branch',
    );
    assert.equal(
      resolveIdentity({ _id: 'c2', name: 'B', practice: { ...practice, doctorDisplayName: null, headDoctor: head } })
        .doctorName,
      'Dr. Head Doctor',
    );
    // A head doctor who did not populate is an id, not a name.
    assert.equal(
      resolveIdentity({ _id: 'c2', name: 'B', practice: { ...practice, doctorDisplayName: null, headDoctor: 'u1' } })
        .doctorName,
      null,
    );
  });

  test('a practice with no location yet is still itself', () => {
    const id = resolveIdentity({ practice: { ...practice, headDoctor: { name: 'Dr. Head Doctor' } } });
    assert.equal(id.clinicName, 'Meridian Diabetes Care');
    assert.equal(id.doctorName, 'Dr. Meera Iyer');
    assert.equal(id.locationName, null);
    assert.equal(id.phone, null);
    assert.equal(id.neutral, false);
  });

  test('an empty string is not an override', () => {
    // `||` not `??`. A field cleared to '' in a form should inherit, rather
    // than print a blank line on the letterhead.
    const id = resolveIdentity({ _id: 'c2', name: '', tagline: '', practice });
    assert.equal(id.clinicName, 'Meridian Diabetes Care');
    assert.equal(id.tagline, 'Diabetes Obesity & Metabolic Clinic');
  });

  test('address and phone never inherit', () => {
    // A branch that has not filled its phone in has no phone. Inheriting head
    // office's would send patients to the wrong building.
    const id = resolveIdentity({
      _id: 'c2',
      name: 'Behala Branch',
      practice: { ...practice, phone: '033 1', city: 'X' },
    });
    assert.equal(id.phone, null);
    assert.equal(id.city, null);
    assert.equal(id.addressLine, null);
  });

  test('an unpopulated ref supplies no brand', () => {
    // `.populate()` forgotten on some future query leaves an ObjectId here, and
    // reading `.name` off one is undefined. Falling through to anything else in
    // that state would print another clinic's name, so it prints none.
    const id = resolveIdentity({ _id: 'c2', name: '', practice: 'p1' });
    assert.equal(id.clinicName, null);
    assert.equal(id.doctorName, null);
    assert.equal(id.practiceId, 'p1');
  });

  test('the dark-chip flag follows whichever row supplied the artwork', () => {
    // Taking the flag from the practice while the logo came from the location
    // paints a dark chip behind a mark drawn for a white background.
    const ownLight = resolveIdentity({
      _id: 'c3',
      logoLightAssetId: 'mine',
      logoNeedsDarkChip: false,
      practice: { ...practice, logoNeedsDarkChip: true },
    });
    assert.equal(ownLight.logoNeedsDarkChip, false);

    const inherited = resolveIdentity({ practice: { ...practice, logoNeedsDarkChip: true } });
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
