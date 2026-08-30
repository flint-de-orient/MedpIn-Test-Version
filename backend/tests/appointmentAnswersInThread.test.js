import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(
  new URL('../src/routes/appointments.js', import.meta.url),
  'utf8',
);

const block = (marker) => {
  const at = src.indexOf(marker);
  assert.ok(at > -1, `expected to find ${marker}`);
  const next = src.indexOf('\nrouter.', at);
  return src.slice(at, next > -1 ? next : src.length);
};

/**
 * A patient asks in the thread; the answer has to land there.
 *
 * Both answers. Confirming wrote a line into the conversation and being turned
 * down wrote nothing, so a refusal existed only as a push notification — and a
 * push is swiped away, arrives face-down, or is cleared by somebody tidying
 * their tray. After that the thread read as a question nobody answered, which
 * is the exact failure the confirmation note was added to prevent, left in
 * place for the answer that is harder to hear.
 *
 * The failure mode is a patient turning up for an appointment they were never
 * given.
 */
describe('the clinic answers where it was asked', () => {
  test('confirming writes into the thread', () => {
    assert.match(block("'/:id/confirm'"), /postCareThreadNote/);
  });

  test('declining writes into the thread too', () => {
    const cancel = src.slice(src.indexOf("appt.status = 'cancelled'"));
    assert.match(
      cancel.slice(0, 2000),
      /postCareThreadNote/,
      'a refusal must leave a trace the patient can go back and read',
    );
  });

  test('neither announces the patient\'s own action back at them', () => {
    // Cancelling your own appointment and then being told you cancelled it is
    // noise, and noise is what teaches people to ignore the alert that matters.
    const cancel = src.slice(src.indexOf("appt.status = 'cancelled'"), src.length);
    const guard = cancel.indexOf('!appt.patient?._id?.equals?.(req.user._id)');
    const note = cancel.indexOf('postCareThreadNote');
    assert.ok(guard > -1, 'the guard exists');
    assert.ok(note > guard, 'and the note is inside it');
  });

  test('a declined request and a cancelled booking are worded apart', () => {
    // A request that was refused never had a time, so there is nothing to say
    // has been called off. Telling somebody their 1pm was cancelled when they
    // were never given a 1pm is a different — and more alarming — message.
    const cancel = src.slice(src.indexOf("appt.status = 'cancelled'"));
    assert.match(cancel.slice(0, 2500), /declinedRequest/);
    assert.match(cancel.slice(0, 2500), /!appt\.scheduledFor/);
  });
});
