import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { readFileSync } from 'node:fs';

import { mayAssistantReply, countReply } from '../src/services/ai/allowance.js';

/**
 * The allowance check, run rather than read.
 *
 * ---- Why this one needs running -----------------------------------------
 *
 * A silent assistant looks like nothing at all from the outside. A department
 * with no scope is silent, an assistant switched off for the thread is silent,
 * a clinician reading the conversation makes it silent — and now a spent
 * allowance does too. If the new check is wrong, the symptom is a patient
 * getting no answer, which is indistinguishable from four things that are
 * working correctly.
 *
 * So the promise this file makes is narrow and the most important one in the
 * feature: **when the check cannot run, the assistant answers.**
 *
 * ---- How it is run without a database -----------------------------------
 *
 * `mayAssistantReply` reaches Mongo three times. With no connection and
 * buffering disabled, every one of those throws immediately — which is exactly
 * the disaster this is about, and the only fixture needed to produce it.
 *
 * Buffering is normally on and would make these hang for ten seconds before
 * failing, so it is turned off for the file and restored after.
 */
let buffering;

before(() => {
  buffering = mongoose.get('bufferCommands');
  mongoose.set('bufferCommands', false);
});

after(() => {
  mongoose.set('bufferCommands', buffering);
});

describe('a clinic with no database still gets its assistant', () => {
  test('the check permits when it cannot run', async () => {
    // Not `assert.doesNotReject` — that would pass on a function returning
    // `{ allowed: false }`, which is the failure being guarded against.
    const out = await mayAssistantReply('64b7f1a2c3d4e5f601234567');
    assert.deepEqual(out, { allowed: true });
  });

  test('and it answers rather than hanging', async () => {
    // Ten seconds of mongoose buffering inside a patient's message is its own
    // kind of broken. This is the reason the service does its own catching
    // instead of letting a route's error handler deal with it.
    const started = Date.now();
    await mayAssistantReply('64b7f1a2c3d4e5f601234567');
    assert.ok(Date.now() - started < 2000, 'the allowance check blocked the reply');
  });

  test('a missing patient id is permitted too', async () => {
    // Every caller passes `session.patient`, and a session with none is a
    // shape this should survive rather than refuse.
    assert.deepEqual(await mayAssistantReply(null), { allowed: true });
    assert.deepEqual(await mayAssistantReply(undefined), { allowed: true });
  });
});

describe('counting a reply cannot lose one', () => {
  test('it does not throw when the counter is unreachable', async () => {
    // Fire and forget by design: the reply has already been produced and is
    // about to be saved. An exception here would lose a message the patient is
    // waiting for, to protect a number nobody is reading yet.
    //
    // Listening for the rejection rather than trusting `doesNotThrow`, which
    // only sees synchronous throws — mutation testing showed it passing with
    // the `.catch()` deleted, because the failure arrives as an unhandled
    // rejection a beat later and the assertion had already returned.
    const escaped = [];
    const onUnhandled = (err) => escaped.push(err);
    process.on('unhandledRejection', onUnhandled);

    try {
      assert.doesNotThrow(() => countReply('64b7f1a2c3d4e5f601234567'));
      // Two turns of the loop: one for the query to reject, one for Node to
      // decide nobody handled it.
      await new Promise((r) => setTimeout(r, 50));
      assert.deepEqual(
        escaped.map((e) => e?.message ?? String(e)),
        [],
        'counting a reply rejected without being caught, which would surface as a crash',
      );
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('and it does nothing at all without a practice', () => {
    assert.doesNotThrow(() => countReply(null));
  });

  test('the query is actually executed, not merely built', () => {
    /*
     * A mongoose query is a lazy thenable: `updateOne(...)` builds one and
     * runs nothing until something awaits it, calls `.then()`, or calls
     * `.exec()`.
     *
     * Before this was explicit, `countReply` executed only as a side effect of
     * the `.catch()` chained onto the end — so removing that handler, which
     * looks like tidying, would have stopped the counting silently. Mutation
     * testing found it by producing no rejection where one was expected.
     *
     * Asserted on the source because the alternative is a database.
     */
    const src = readFileSync(new URL('../src/services/ai/allowance.js', import.meta.url), 'utf8');
    const writes = [...src.matchAll(/AiUsage\.updateOne\(/g)];
    assert.ok(writes.length >= 2, 'the usage writes moved');

    for (const m of writes) {
      assert.match(
        src.slice(m.index, m.index + 320),
        /\.exec\(\)/,
        'a usage write is built and never run',
      );
    }
  });
});
