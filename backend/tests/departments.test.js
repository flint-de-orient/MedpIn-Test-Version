import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Department } from '../src/models/Department.js';
import { DoctorDepartment } from '../src/models/DoctorDepartment.js';

/**
 * The specialties, and the rules about them that a database cannot enforce.
 *
 * The seed list is read from the script's source rather than imported, because
 * importing it would run a script that connects to a database. What is being
 * checked is the data as written — a missing Bengali name or a duplicated key
 * is a mistake made in the editor, and this is where it should be caught.
 */
const seedSource = readFileSync(
  new URL('../scripts/seedDepartments.js', import.meta.url),
  'utf8',
);

/** The DEPARTMENTS array, parsed out of the script without executing it. */
function seededDepartments() {
  const start = seedSource.indexOf('const DEPARTMENTS = [');
  const end = seedSource.indexOf('\n];', start);
  assert.notEqual(start, -1, 'could not find the DEPARTMENTS array');
  const block = seedSource.slice(start, end);

  return [...block.matchAll(/\{\s*\n\s*key: '([a-z_]+)',\s*\n\s*names: \{([^}]+)\}/g)].map(
    ([, key, names]) => ({
      key,
      langs: [...names.matchAll(/\b(en|bn|hi):/g)].map((m) => m[1]),
    }),
  );
}

describe('the specialties that ship with the platform', () => {
  const seeded = seededDepartments();

  test('all nine are there', () => {
    // The eight the clinic asked for, plus diabetology — which is what Dr. Dey
    // actually practises and was not on the list, because his clinic predates
    // the idea of departments.
    assert.equal(seeded.length, 9, `found ${seeded.map((d) => d.key).join(', ')}`);
    for (const key of [
      'general_physician',
      'gynaecology',
      'paediatrics',
      'dermatology',
      'psychiatry',
      'orthopaedics',
      'cardiology',
      'physical_medicine',
      'diabetology',
    ]) {
      assert.ok(seeded.some((d) => d.key === key), `missing ${key}`);
    }
  });

  test('no key appears twice', () => {
    // The unique index would catch this at write time, on the server, at the
    // end of a deploy. Here it is caught before the commit.
    const keys = seeded.map((d) => d.key);
    assert.equal(new Set(keys).size, keys.length);
  });

  test('every one is named in all three languages', () => {
    // A department name is the one word on a prescription that tells a patient
    // which doctor they saw. English-only would be the app quietly deciding
    // that the Bengali reader does not need to know.
    for (const d of seeded) {
      for (const lang of ['en', 'bn', 'hi']) {
        assert.ok(d.langs.includes(lang), `${d.key} has no ${lang} name`);
      }
    }
  });

  test('no department ships with triage rules', () => {
    // The 21 existing red flags are diabetes-tuned. Obstetric bleeding and
    // suicidal ideation are not among them and cannot be inferred from them,
    // so a new specialty carries none until a clinician in it writes them.
    // No triage is honest; inherited triage looks like safety and is not.
    const block = seedSource.slice(seedSource.indexOf('const DEPARTMENTS = ['));
    assert.ok(
      !/triageRules:\s*\[\s*'/.test(block),
      'a seeded department carries triage rules it did not earn',
    );
  });

  test('a seeded row is marked, so an edited one is never overwritten', () => {
    assert.match(seedSource, /isSeed: true/);
    assert.match(seedSource, /!byKey\.get\(d\.key\)\.isSeed/);
  });
});

describe('the model', () => {
  test('shared departments have no practice', () => {
    const d = new Department({ key: 'cardiology', names: { en: 'Cardiologist' } });
    assert.equal(d.practice, null);
    assert.equal(d.toPublic().isShared, true);
  });

  test('a key is machine-readable and lower-cased', () => {
    const ok = new Department({ key: 'Foot_Clinic', names: { en: 'Foot Clinic' } });
    assert.equal(ok.key, 'foot_clinic');

    const bad = new Department({ key: 'foot clinic!', names: { en: 'x' } });
    assert.ok(bad.validateSync()?.errors?.key, 'a key with spaces was accepted');
  });

  test('a name falls back to English, then to the key', () => {
    // A clinic adding "Diabetic Foot Clinic" at four in the afternoon should
    // not have to supply three translations before it can be used.
    const d = new Department({ key: 'foot_clinic', names: { en: 'Foot Clinic' } });
    assert.equal(d.nameIn('bn'), 'Foot Clinic');
    assert.equal(d.nameIn('en'), 'Foot Clinic');

    const bare = new Department({ key: 'foot_clinic', names: {} });
    assert.equal(bare.nameIn('en'), 'foot_clinic');
  });

  test('triage rules and home cards start empty', () => {
    const d = new Department({ key: 'neurology', names: { en: 'Neurology' } });
    assert.deepEqual(d.triageRules, []);
    assert.deepEqual(d.homeCards, []);
  });

  test('one key per scope', () => {
    const idx = Department.schema.indexes().map(([fields, opts]) => ({ fields, opts }));
    const unique = idx.find((i) => i.fields.practice === 1 && i.fields.key === 1);
    assert.ok(unique, 'no practice+key index');
    assert.equal(unique.opts.unique, true);
  });
});

describe('doctor to department', () => {
  test('is many-to-many, scoped to a practice', () => {
    // A doctor may hold different departments at different practices — a
    // cardiologist at the polyclinic, a general physician at their own evening
    // clinic. The pair alone cannot express that.
    const idx = DoctorDepartment.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find(
      (i) => i.f.doctor === 1 && i.f.department === 1 && i.f.practice === 1,
    );
    assert.ok(unique, 'no doctor+department+practice index');
    assert.equal(unique.o.unique, true);
  });

  test('"who can answer this department?" is indexed', () => {
    // The query behind departmental chat routing, run on every incoming
    // patient message.
    const idx = DoctorDepartment.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.department === 1 && f.endedOn === 1));
  });

  test('leaving a department is an end date, not a delete', () => {
    // A doctor who stops covering paediatrics has still signed paediatric
    // prescriptions, and the record must still say which department they were
    // in when they wrote one.
    const dd = new DoctorDepartment({
      doctor: '000000000000000000000001',
      department: '000000000000000000000002',
    });
    assert.equal(dd.endedOn, null);
    assert.ok('endedOn' in dd.toObject());
  });
});
