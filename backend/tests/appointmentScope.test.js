import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * The diary, which was everybody's.
 *
 * ---- One function returned `{}` --------------------------------------------
 *
 *   const scopeFilter = (req) => isPatient(req) ? { patient: req.user._id } : {};
 *
 * A patient was correctly limited to their own appointments. Anybody else got
 * an empty filter — the right answer with one clinic and, with two, every
 * booking on the platform. It reached four places:
 *
 *   the diary listing
 *   the waiting-room queue, which carries patients' names
 *   reschedule and cancel, by id
 *   check-in, by id
 *
 * The last three are writes. `findOne({ _id, ...scopeFilter })` with an empty
 * filter is `findById`, so a clinician at one practice could cancel an
 * appointment at another by knowing its id.
 *
 * ---- And the queue numbers were shared -------------------------------------
 *
 * The next number came from `findOne({ queueDate: today })` sorted descending —
 * the highest anywhere that day. Two practices checking patients in shared one
 * sequence, so the second clinic's first patient of the morning was handed
 * number nine. Not a leak; the queue simply being wrong, in a way the person
 * holding the token can see.
 */
const src = readFileSync(new URL('../src/routes/appointments.js', import.meta.url), 'utf8');

/** The body of a route, from its declaration to the next one. */
function route(marker) {
  const at = src.indexOf(marker);
  assert.ok(at > 0, `${marker} moved`);
  const next = src.indexOf('\nrouter.', at + 1);
  return src.slice(at, next === -1 ? src.length : next);
}

describe('a clinician sees their own practice’s diary', () => {
  test('the filter is no longer empty for anybody but a patient', () => {
    assert.match(src, /async function scopeFilter\(req\)/);
    assert.match(src, /return practiceMembers\(req, ROLES\.DOCTOR, 'doctor'\)/);
    assert.ok(
      !/isPatient\(req\) \? \{ patient: req\.user\._id \} : \{\}/.test(src),
      'the empty clinician filter is back',
    );
  });

  test('scoped by the doctor, because a teleconsult has no clinic', () => {
    // Filtering on `clinic` alone would leave every remote consultation
    // unfiltered — the field is optional and absent for teleconsults, while
    // `doctor` is required on every appointment.
    const model = readFileSync(new URL('../src/models/Appointment.js', import.meta.url), 'utf8');
    assert.match(model, /doctor: \{[^}]*required: true/);
    assert.ok(
      !/clinic: \{[^}]*required: true/.test(model),
      'clinic became required; the doctor is no longer the only reliable scope',
    );
  });

  test('and every caller awaits it', () => {
    // It became async. A forgotten await spreads a Promise into a Mongo filter,
    // which matches nothing and empties the diary rather than throwing.
    const calls = [...src.matchAll(/scopeFilter\(req\)/g)];
    const awaited = [...src.matchAll(/await scopeFilter\(req\)/g)];
    // One extra: the declaration itself.
    assert.equal(calls.length - awaited.length, 1, 'a scopeFilter call is not awaited');
  });
});

describe('the writes are scoped too, not only the list', () => {
  for (const [marker, what] of [
    ["router.patch(\n  '/:id/confirm',", 'confirming'],
    ["router.patch(\n  '/:id/reschedule',", 'rescheduling'],
    ["router.patch(\n  '/:id/status',", 'moving one through the consultation'],
    ["router.post(\n  '/:id/check-in',", 'checking in'],
  ]) {
    test(`${what} cannot reach another practice by id`, () => {
      assert.match(route(marker), /\.\.\.\(await scopeFilter\(req\)\)/);
    });
  }

  test('and nothing fetches an appointment by id alone', () => {
    // `findById` and `findByIdAndUpdate` take no filter beyond the id, so a
    // route using either is scoped by nothing, whatever its guards say. Two
    // did: confirm, and the status change that moves somebody into
    // "in_consultation" — which the waiting-room screen then shows.
    assert.ok(
      !/Appointment\.findById\(req\.params\.id\)/.test(src),
      'an appointment is fetched by id with no practice scope',
    );

    const at = src.indexOf('Appointment.findByIdAndUpdate(');
    if (at > 0) {
      assert.match(
        src.slice(Math.max(0, at - 500), at),
        /\.\.\.\(await scopeFilter\(req\)\)/,
        'findByIdAndUpdate runs without a scoped check in front of it',
      );
    }
  });
});

describe('the waiting room is this practice’s waiting room', () => {
  const body = route("router.get(\n  '/queue/today',");

  test('the queue is scoped', () => {
    // It listed every patient checked in anywhere, by name, on a screen that
    // hangs in a waiting room.
    assert.match(body, /practiceMembers\(req, ROLES\.DOCTOR, 'doctor'\)/);
  });
});

describe('the queue number belongs to one queue', () => {
  const body = route("router.post(\n  '/:id/check-in',");

  test('the next number comes from this clinic, not the platform', () => {
    assert.match(body, /const queueScope = appt\.clinic/);
    assert.match(body, /Appointment\.findOne\(\{ queueDate: today, \.\.\.queueScope \}\)/);
    assert.ok(
      !/findOne\(\{ queueDate: today \}\)/.test(body),
      'the queue number is drawn from every practice again',
    );
  });

  test('and the position counts the same queue', () => {
    // "Seven ahead of you" counting people in another building is the same bug
    // wearing a different number.
    assert.match(body, /queueNumber: \{ \$lt: appt\.queueNumber \},\s*\n\s*\.\.\.queueScope,/);
  });

  test('a teleconsult queues with the practice', () => {
    // It has no clinic to queue at, and falling through to an unscoped count
    // would put it back where it started.
    assert.match(body, /: await practiceMembers\(req, ROLES\.DOCTOR, 'doctor'\)/);
  });
});

describe('a branch opens on its own day', () => {
  const list = route("router.get(\n  '/',");
  const queue = route("router.get(\n  '/queue/today',");

  test('the diary defaults to the location on your membership', () => {
    assert.match(list, /const mine = await memberLocation\(req\)/);
    assert.match(list, /mine && !clinicId \? \{ clinic: mine \} : \{\}/);
  });

  test('and an explicit clinic still overrides it', () => {
    // A default, not a wall. A doctor covering a colleague's afternoon at the
    // other branch has to be able to look at it, and the doctor filter still
    // bounds that to this practice — an id from elsewhere returns nothing.
    assert.ok(
      list.indexOf('clinic: mine') < list.indexOf('clinic: clinicId'),
      'the membership location is applied after the explicit one and wins',
    );
  });

  test('the waiting room shows the room you are standing in', () => {
    assert.match(queue, /const here = await memberLocation\(req\)/);
    assert.match(queue, /here \? \{ clinic: here \} : \{\}/);
  });

  test('and null means the whole practice, which is every membership today', () => {
    // The backfill sets no location, and a solo practice has one building
    // nobody needs telling about. Narrowing on null would empty both screens
    // for the clinic that is running.
    const scope = readFileSync(new URL('../src/middleware/practiceScope.js', import.meta.url), 'utf8');
    assert.match(scope, /req\._memberLocation = row\?\.location \? String\(row\.location\) : null;/);
  });
});
