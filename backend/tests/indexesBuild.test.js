import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import mongoose from 'mongoose';

import { boot, shutdown } from './helpers/httpHarness.js';

/**
 * Every index a model declares, MongoDB will actually build.
 *
 * ---- The failure this exists for -----------------------------------------
 *
 * ChatSession declared its "one conversation per enrolment" unique index with
 * both `sparse: true` and a `partialFilterExpression`. MongoDB refuses that
 * combination. Mongoose reports an index build failure through an event almost
 * nothing listens to and carries on — so the server booted, every test passed,
 * and a uniqueness rule the code relied on (it even caught the duplicate-key
 * error it expected the index to raise) was enforced by nothing, in every
 * environment, from the day it was written. Two replies arriving together split
 * a patient's conversation in two.
 *
 * A unique index is a statement about the data. One that does not build is a
 * statement nobody is making, and nothing else in the suite could tell.
 *
 * ---- Why every model, built explicitly ----------------------------------
 *
 * Because the rest of the suite builds indexes by accident, once per process,
 * against whichever database connected first — which is how this one hid.
 * Here each model is asked to build all of its indexes, and a refusal names
 * the model and MongoDB's reason.
 */

const MODELS = fileURLToPath(new URL('../src/models/', import.meta.url));

describe('every declared index builds', () => {
  before(async () => {
    await boot();
    for (const file of readdirSync(MODELS).filter((f) => f.endsWith('.js'))) {
      await import(pathToFileURL(path.join(MODELS, file)).href);
    }
  });
  after(shutdown);

  test('no model declares an index MongoDB refuses', async () => {
    const refused = [];

    for (const name of mongoose.modelNames().sort()) {
      const model = mongoose.model(name);
      try {
        await model.createIndexes();
      } catch (err) {
        refused.push(`${name}: ${String(err.message).split('::').pop().trim()}`);
      }
    }

    assert.deepEqual(refused, [], `\n  ${refused.join('\n  ')}\n`);
  });

  test('and the conversation rule in particular is enforced', async () => {
    // The one that was missing, asserted by what it does rather than by its
    // declaration: a second conversation for one enrolment is refused.
    const { ChatSession } = await import('../src/models/ChatSession.js');
    await ChatSession.createIndexes();

    const enrollment = new mongoose.Types.ObjectId();
    const patient = new mongoose.Types.ObjectId();
    await ChatSession.create({ patient, enrollment, kind: 'care' });

    await assert.rejects(
      ChatSession.create({ patient, enrollment, kind: 'care' }),
      (err) => err?.code === 11000,
      'a second conversation for the same enrolment was accepted',
    );

    // While a conversation with no enrolment — the older rows — is not
    // indexed at all, so two of those do not collide on nothing.
    await ChatSession.create({ patient, kind: 'care' });
    await ChatSession.create({ patient, kind: 'care' });
  });
});
