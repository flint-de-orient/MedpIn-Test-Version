import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { boot, shutdown, wipe } from './helpers/httpHarness.js';
import { makePractice } from './helpers/factories.js';
import { AiUsage } from '../src/models/AiUsage.js';
import { countReply, countAiCall } from '../src/services/ai/allowance.js';

/**
 * What the assistant costs, as opposed to how often it answered.
 *
 * ---- The meter measured the wrong thing --------------------------------
 *
 * `AiUsage` carried `replies` and `refused` and nothing else, and the plan
 * allowances — 1,000 on Essential, 5,000 on Professional — compare against
 * `replies`. A reply is not a unit of anything. A conversation carrying a
 * patient's clinical record and several retrieved knowledge chunks can cost
 * several thousand prompt tokens; a one-line answer costs a few hundred. Both
 * decrement the allowance by one.
 *
 * So a practice could spend its thousand replies at 4,400 prompt tokens each —
 * 4.4 million tokens — or at 800, and nothing in the product could tell the
 * two apart.
 *
 * ---- And it was only watching one of six doors -------------------------
 *
 * `countReply` was called from the patient assistant and nowhere else. The
 * nutrition assistant, the foot and eye readers, prescription extraction, lab
 * report extraction and voice transcription all call Gemini and none of them
 * reached the meter — not as tokens, not even as calls. The recorded spend was
 * not the spend and nobody could say by how much.
 *
 * A seventh was worse: the *streaming* assistant path, which is how the app
 * sends every patient message, discarded usage entirely. `generateStream`
 * yielded text and never surfaced `usageMetadata`, so the largest single
 * contributor to the bill reported nothing at all.
 */

const AI_DIR = fileURLToPath(new URL('../src/services/ai/', import.meta.url));

describe('the meter records what the provider charges for', () => {
  before(async () => {
    await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  test('a reply records its tokens as well as itself', async () => {
    const practice = await makePractice('Salt Lake Clinic');

    await countReply(practice._id, { promptTokens: 4400, responseTokens: 180 });

    const row = await AiUsage.findOne({ practice: practice._id }).lean();
    assert.equal(row.replies, 1);
    assert.equal(row.promptTokens, 4400);
    assert.equal(row.responseTokens, 180);
  });

  test('and two replies of very different size are no longer the same number', async () => {
    /*
     * The whole point, stated as an assertion. Under the old meter these two
     * practices were identical: one reply each. They differ by a factor of
     * five in what they actually cost.
     */
    const cheap = await makePractice('Cheap Clinic');
    const dear = await makePractice('Expensive Clinic');

    await countReply(cheap._id, { promptTokens: 800, responseTokens: 120 });
    await countReply(dear._id, { promptTokens: 4400, responseTokens: 600 });

    const a = await AiUsage.findOne({ practice: cheap._id }).lean();
    const b = await AiUsage.findOne({ practice: dear._id }).lean();

    assert.equal(a.replies, b.replies, 'the old meter saw these as equal');
    assert.ok(
      b.promptTokens > a.promptTokens * 4,
      'the new one still cannot tell them apart',
    );
  });

  test('a missing figure does not lose the count', async () => {
    /*
     * `usageMetadata` is absent on a cached or blocked response, and `$inc` by
     * `undefined` makes Mongo reject the whole update — which would throw away
     * the reply count as well. A figure nobody has is worth nothing; losing
     * the row is worth less.
     */
    const practice = await makePractice('Salt Lake Clinic');

    await countReply(practice._id, undefined);
    await countReply(practice._id, { promptTokens: undefined, responseTokens: null });

    const row = await AiUsage.findOne({ practice: practice._id }).lean();
    assert.equal(row.replies, 2, 'a reply was lost to a missing token figure');
    assert.equal(row.promptTokens, 0);
  });

  test('the other AI paths are counted without touching the allowance', async () => {
    /*
     * The distinction that makes this safe to deploy.
     *
     * These calls cost money and must be visible. They must not start
     * decrementing the reply allowance, because a clinic whose assistant stops
     * answering at eleven in the morning — because five other kinds of call now
     * count against the same thousand — has had an outage, not a price change.
     */
    const practice = await makePractice('Salt Lake Clinic');

    await countAiCall(practice._id, 'nutrition', { promptTokens: 900, responseTokens: 200 });
    await countAiCall(practice._id, 'transcribe', { promptTokens: 1200, responseTokens: 40 });
    await countAiCall(practice._id, 'labReport', { promptTokens: 3000, responseTokens: 500 });

    const row = await AiUsage.findOne({ practice: practice._id }).lean();

    assert.equal(row.replies, 0, 'a non-assistant call spent the reply allowance');
    assert.equal(row.calls.nutrition, 1);
    assert.equal(row.calls.transcribe, 1);
    assert.equal(row.calls.labReport, 1);
    // But every token is on the bill.
    assert.equal(row.promptTokens, 5100);
    assert.equal(row.responseTokens, 740);
  });

  test('and an unattributable call is dropped rather than mis-billed', async () => {
    // A practice that cannot be resolved is not somebody else's to charge.
    await countAiCall(null, 'nutrition', { promptTokens: 900 });
    assert.equal(await AiUsage.countDocuments(), 0);
  });
});

describe('every Gemini call site reaches the meter', () => {
  /*
   * The ratchet, and the reason this is not just a set of unit tests.
   *
   * Six of seven call sites were unmetered, and nothing anywhere would have
   * said so — a new AI feature costs money from the day it ships and appears
   * in no counter until somebody happens to look at a Google invoice.
   *
   * Same shape as auditCoverage.test.js: walk the source, and a call that
   * records nothing fails the build with a reason attached.
   */
  const files = readdirSync(AI_DIR).filter((f) => f.endsWith('.js'));

  /**
   * Call sites that deliberately do not meter, and why.
   *
   * Every entry needs a reason. A list that accumulates paths without them is
   * where calls get added when metering is inconvenient.
   */
  const EXEMPT = new Map([
    [
      'gemini.js',
      'The provider client itself. It has no practice in scope and must not — ' +
        'a transport that knew about billing would be the wrong shape, and every ' +
        'caller above it meters.',
    ],
    [
      'rag.js',
      'Embeddings for knowledge retrieval, which are charged per document at ' +
        'indexing time rather than per practice at query time. Billed to the ' +
        'platform, not to a clinic.',
    ],
  ]);

  test('the source was actually read', () => {
    assert.ok(files.length >= 6, `only ${files.length} AI service files found`);
  });

  test('a file that calls the model records what it cost', () => {
    const silent = [];

    for (const file of files) {
      const src = readFileSync(path.join(AI_DIR, file), 'utf8');
      // A call to the model, not a re-export or an import of one.
      const calls = /await generate(?:FromImage)?\(|generateStream\(/.test(src);
      if (!calls) continue;
      if (EXEMPT.has(file)) continue;
      if (/countAiCall\(|countReply\(|onUsage/.test(src)) continue;
      silent.push(file);
    }

    assert.deepEqual(
      silent,
      [],
      `\n\nThese call the model and record nothing:\n\n  ${silent.join(
        '\n  ',
      )}\n\nCall countAiCall(practiceId, kind, result?.usage) after a successful\ncall, or add an entry to EXEMPT in this file with a reason. An AI path\nthat costs money and appears in no counter is one nobody finds until the\ninvoice arrives.\n`,
    );
  });

  test('every exemption states a reason', () => {
    for (const [file, reason] of EXEMPT) {
      assert.ok(reason && reason.length > 40, `${file} is exempt without a real reason`);
    }
  });

  test('and every kind it records is a field the schema has', () => {
    /*
     * `$inc` on `calls.typo` creates the field silently — Mongo does not mind,
     * and the number then exists in the database and in no query anybody
     * writes. The schema names the kinds; this checks the code agrees.
     */
    const schema = readFileSync(
      fileURLToPath(new URL('../src/models/AiUsage.js', import.meta.url)),
      'utf8',
    );
    /*
     * Brace-matched rather than sliced to the next `},`.
     *
     * The first `},` inside this block is the end of `assistant: { type:
     * Number, default: 0 },` — so a naive slice reads one field and reports
     * every other kind as unknown. The test failed on its own parser, which is
     * the usual way a source-reading test fails.
     */
    const at = schema.indexOf('calls: {');
    assert.ok(at > 0, 'AiUsage no longer declares a `calls` block');

    let i = schema.indexOf('{', at);
    let depth = 0;
    do {
      if (schema[i] === '{') depth += 1;
      else if (schema[i] === '}') depth -= 1;
      i += 1;
    } while (depth > 0);

    const block = schema.slice(at, i);
    const known = new Set([...block.matchAll(/(\w+): \{ type: Number/g)].map((m) => m[1]));

    assert.ok(known.size >= 5, `only ${known.size} kinds declared`);

    for (const file of files) {
      const src = readFileSync(path.join(AI_DIR, file), 'utf8');
      for (const [, kind] of src.matchAll(/countAiCall\([^,]+,\s*'(\w+)'/g)) {
        assert.ok(known.has(kind), `${file} records "${kind}", which AiUsage has no field for`);
      }
    }
  });

  test('the streaming path reports its usage too', () => {
    /*
     * The one that mattered most and was easiest to miss: a generator yields
     * text and cannot also return a number, so the highest-volume path in the
     * product silently reported nothing. The SDK exposes the aggregate
     * response only once the stream drains, which is why it is a callback.
     *
     * ---- What this cannot see ------------------------------------------
     *
     * It reads source, so it catches the wiring being removed — deleting the
     * block, or the assistant no longer passing `onUsage`, both fail here —
     * and it cannot catch the block being disabled in place, `if (false)`.
     * Proving that would mean stubbing the provider SDK, which is a fixture
     * that tests the mock more than the code.
     *
     * Recorded rather than left as a gap somebody discovers by planting the
     * mutation and finding it survives.
     */
    const gemini = readFileSync(path.join(AI_DIR, 'gemini.js'), 'utf8');
    const at = gemini.indexOf('export async function* generateStream');
    const fn = gemini.slice(at);
    assert.match(fn, /onUsage/, 'generateStream cannot report what it cost');
    assert.match(fn, /result\.response/, 'the aggregate response is never read');

    const assistant = readFileSync(path.join(AI_DIR, 'assistant.js'), 'utf8');
    assert.match(assistant, /onUsage:/, 'the assistant does not ask for it');
  });
});
