import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Every kind the server pushes must be a kind the app knows where to open.
 *
 * A notification that lands somewhere unrelated is worse than none: the patient
 * is told something happened, taps, finds the screen unchanged, and concludes
 * the app is lying. It cost nothing to send and it spends the trust that makes
 * the next one worth opening.
 *
 * Two of these were live. A dietician's reply went out as `clinician_reply`,
 * which the app maps to the care thread — so the nutrition thread, the one that
 * had actually changed, was neither refreshed nor opened, and the app's own
 * `dietician_reply` branch sat waiting for a message nobody sent. And the
 * doctor's evening schedule digest carries no patientId, so it fell through to
 * the alerts screen, which is a list of clinical alarms and says nothing about
 * tomorrow.
 *
 * This reads both sides because the contract is a string on a wire: nothing in
 * either language fails to compile when they disagree.
 */
const notifications = readFileSync(
  new URL('../src/services/notifications.js', import.meta.url),
  'utf8',
);
const router = readFileSync(
  new URL('../../mobile/lib/core/push/push_service.dart', import.meta.url),
  'utf8',
);
const signal = readFileSync(
  new URL('../../mobile/lib/core/push/chat_push_signal.dart', import.meta.url),
  'utf8',
);

/**
 * Every kind the server puts in a push payload.
 *
 * Read off whole `kind:` lines rather than a `kind: '...'` pattern, because one
 * of them chooses between two at runtime:
 *
 *   kind: threadKind === 'nutrition' ? 'dietician_reply' : 'clinician_reply',
 *
 * A regex anchored to a quote straight after the colon sees neither of those,
 * and the list below would quietly lose the pair this test exists to protect.
 */
const sentKinds = new Set(
  notifications
    .split('\n')
    .filter((line) => line.includes('kind:'))
    // From the `kind:` onward, so a quoted string earlier on the same line —
    // a title, a channel — is not mistaken for one.
    .map((line) => line.slice(line.indexOf('kind:')))
    .flatMap((tail) => [...tail.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]))
    // `ChatSession.findOne({ patient, kind: 'nutrition' })` is a database
    // query, not a payload. It happens to share the word.
    .filter((k) => k !== 'nutrition'),
);

describe('the app knows what to do with every push it is sent', () => {
  test('the server sends the kinds we think it does', () => {
    // A guard on the guard: if this list empties because the regex stopped
    // matching, every test below would pass vacuously.
    assert.ok(sentKinds.size >= 10, `only found ${sentKinds.size} kinds`);
    for (const expected of [
      'medication_reminder',
      'clinician_reply',
      'dietician_reply',
      'patient_message',
      'schedule_digest',
      'appointment_tomorrow',
    ]) {
      assert.ok(sentKinds.has(expected), `server no longer sends ${expected}`);
    }
  });

  test('a dietician reply is distinguishable from a doctor one', () => {
    // Keyed on the thread, not the sender's role: a doctor can step into the
    // nutrition thread to guide a dietician, and when he does it is still the
    // patient's nutrition thread that should open.
    assert.match(
      notifications,
      /threadKind === 'nutrition' \? 'dietician_reply' : 'clinician_reply'/,
    );
  });

  test('the nutrition kinds open the nutrition thread', () => {
    // /food-log, not /chat. The patient's dietician conversation lives there.
    const patientSwitch = router.slice(
      router.indexOf("if (user.role == 'patient')"),
      router.indexOf('// The area this account is allowed into'),
    );
    for (const kind of ['dietician_reply', 'nutrition_message']) {
      assert.ok(patientSwitch.includes(`case '${kind}':`), `${kind} unrouted`);
    }
    assert.match(patientSwitch, /router\.go\('\/food-log'\)/);
  });

  test('the schedule digest opens the diary, not the alert list', () => {
    assert.match(router, /kind == 'schedule_digest'/);
    assert.match(router, /'\/clinician\/appointments'/);
  });

  test('the live-refresh signal agrees with the wire', () => {
    // The other half: a push also nudges an open thread to re-read. If it maps
    // a kind to the wrong thread, the message arrives in the tray and the open
    // conversation stays silent until the app is restarted.
    for (const kind of ['clinician_reply', 'dietician_reply', 'nutrition_message']) {
      assert.ok(signal.includes(`case '${kind}':`), `${kind} not in the signal`);
    }
  });

  test('an unknown kind still lands somewhere sensible', () => {
    // An older app meeting a newer server. The care thread is where the clinic
    // talks to them, so it is the right place to end up knowing nothing.
    assert.match(router, /default:\s*\n\s*router\.go\('\/chat'\)/);
  });
});
