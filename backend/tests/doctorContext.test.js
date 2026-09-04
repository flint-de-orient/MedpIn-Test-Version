import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Which doctor a thing belongs to.
 *
 * Six routes asked `User.findOne({ role: ROLES.DOCTOR })` with no other filter
 * and took whichever row came back first. With one doctor that is right every
 * time. With two it is a coin flip, and one of the things being decided by the
 * coin is the attribution on a prescription — the field that says who is
 * answerable for it.
 *
 * These pin the two halves of the fix: that no route asks the unfiltered
 * question any more, and that an ambiguous answer is an error wherever the
 * answer has to be right.
 */
const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));
const service = readFileSync(
  new URL('../src/services/doctorContext.js', import.meta.url),
  'utf8',
);

describe('no route guesses at the doctor any more', () => {
  test('the unfiltered lookup is gone from every route', () => {
    // `findOne({ role: DOCTOR })` with nothing else. A lookup that also names
    // an `_id` is fine — that one is asking about a specific person.
    const offenders = [];

    for (const name of readdirSync(ROUTES)) {
      if (!name.endsWith('.js')) continue;
      const src = readFileSync(path.join(ROUTES, name), 'utf8');

      src.split('\n').forEach((line, i) => {
        if (!/User\.findOne\(\{[^}]*role:\s*ROLES\.DOCTOR/.test(line)) return;
        if (/_id\s*:/.test(line)) return; // asking about a named doctor
        offenders.push(`${name}:${i + 1}  ${line.trim().slice(0, 70)}`);
      });
    }

    assert.deepEqual(offenders, [], `\n  ${offenders.join('\n  ')}\n`);
  });

  test('the six call sites go through the resolver', () => {
    for (const name of [
      'appointments.js',
      'clinics.js',
      'auth.js',
      'doctor.js',
      'prescriptions.js',
    ]) {
      const src = readFileSync(path.join(ROUTES, name), 'utf8');
      assert.match(src, /resolveDoctor\(/, `${name} does not use the resolver`);
      assert.match(
        src,
        /from '\.\.\/services\/doctorContext\.js'/,
        `${name} uses resolveDoctor without importing it`,
      );
    }
  });
});

describe('the resolution order', () => {
  test('an explicit id is never overridden', () => {
    // The caller said which doctor. Falling through from that to a different
    // one would be the same class of bug, one level up.
    const first = service.indexOf('if (explicitId)');
    const acting = service.indexOf('actingUser?.role === ROLES.DOCTOR');
    assert.ok(first > -1 && acting > first, 'explicitId is not tried first');
  });

  test('a named doctor that does not exist is an error, not a substitution', () => {
    assert.match(service, /if \(!named && required\) throw conflict/);
  });

  test('the acting doctor is preferred over any lookup', () => {
    // The case the old code missed most often: it went hunting for "the
    // doctor" while one was making the request.
    const acting = service.indexOf('actingUser?.role === ROLES.DOCTOR');
    const clinic = service.indexOf('if (clinicId)');
    assert.ok(acting > -1 && clinic > acting, 'the acting user is not tried before the clinic');
  });

  test('counting doctors is capped, not a full scan', () => {
    // This only needs to tell "exactly one" from "more than one". Reading every
    // doctor on the platform to learn that gets slower with each practice.
    assert.match(service, /\.limit\(2\)/);
  });
});

describe('ambiguity', () => {
  test('is an error where the answer must be right', () => {
    // A prescription's attribution, an appointment's doctor.
    assert.match(service, /More than one doctor could be meant here/);
    assert.match(service, /if \(required\) \{/);
  });

  test('is silence where the field is optional', () => {
    // `assignedDoctor` is optional, and a patient with none is one the desk
    // assigns later. Failing a registration over it would be worse than the
    // gap it prevents.
    const tail = service.slice(service.indexOf('if (required) {'));
    assert.match(tail, /return null;/);
  });

  test('the two required call sites ask for it', () => {
    const appts = readFileSync(path.join(ROUTES, 'appointments.js'), 'utf8');
    const pres = readFileSync(path.join(ROUTES, 'prescriptions.js'), 'utf8');
    assert.equal((appts.match(/required: true/g) ?? []).length, 2);
    assert.match(pres, /required: true/);
  });

  test('registration does not', () => {
    // auth.js assigns; it does not attribute.
    const auth = readFileSync(path.join(ROUTES, 'auth.js'), 'utf8');
    const call = auth.slice(auth.indexOf('resolveDoctor('), auth.indexOf('resolveDoctor(') + 60);
    assert.ok(!/required:\s*true/.test(call), 'registration fails on an ambiguous doctor');
  });
});

describe('the waitlist reads the right field', () => {
  test('PatientProfile is queried by user, not patient', () => {
    // `PatientProfile` has no `patient` field. Queried by that name the lookup
    // matched nothing, every risk score came back 0, and the sort compared zero
    // to zero — so a freed slot went to whoever Mongo returned first rather
    // than to the sickest patient waiting for it.
    const src = readFileSync(path.join(ROUTES, 'appointments.js'), 'utf8');
    assert.ok(
      !/PatientProfile\.find\(\{\s*patient:/.test(src),
      'the waitlist still queries a field PatientProfile does not have',
    );
    assert.match(src, /PatientProfile\.find\(\{ user: \{ \$in:/);
  });
});
