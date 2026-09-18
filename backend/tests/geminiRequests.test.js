import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

/**
 * What gemini.js sends to Google, and what it throws back to the chat.
 *
 * "models/gemini-2.5-flash is not found for API version v1beta" from the
 * server, while a hand-typed curl to the same URL works, is a difference in
 * the model string, not in the path. The path is pinned here, and so is the
 * cleaning that makes an invisible difference in `.env` harmless.
 *
 * Nothing leaves the machine: fetch is replaced for the whole file.
 */

process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:1/unused';
process.env.JWT_ACCESS_SECRET ??= 'a'.repeat(40);
process.env.JWT_REFRESH_SECRET ??= 'b'.repeat(40);
process.env.GEMINI_API_KEY ??= 'test-key';

const { generate, generateStream, AiUnavailableError } = await import('../src/services/ai/gemini.js');
const { cleanModelName, visibleChars } = await import('../src/config/env.js');

const NOT_FOUND =
  'models/gemini-2.5-flash is not found for API version v1beta, or is not supported for generateContent. ' +
  'Call ListModels to see the list of available models and their supported methods.';

const contents = [{ role: 'user', parts: [{ text: 'what is a normal sugar' }] }];

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const sse = (text) =>
  new Response(
    `data: ${JSON.stringify({
      candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP' }],
    })}\r\n\r\n`,
    { status: 200, headers: { 'content-type': 'text/event-stream' } },
  );

/** Answers each request with the next of [replies], and records the URLs. */
function google(...replies) {
  const urls = [];
  globalThis.fetch = async (input) => {
    urls.push(new URL(String(input)).href);
    const next = replies.shift();
    return typeof next === 'function' ? next() : next;
  };
  return urls;
}

async function drain(stream) {
  let text = '';
  for await (const piece of stream) text += piece;
  return text;
}

describe('the request is the one a curl sends', () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });

  test('a reply goes to v1beta/models/<model>:generateContent', async () => {
    const urls = google(json(200, { candidates: [{ content: { parts: [{ text: 'Hello' }] }, finishReason: 'STOP' }] }));
    const reply = await generate({ system: 's', contents, model: 'gemini-2.5-flash' });
    assert.equal(reply.text, 'Hello');
    assert.deepEqual(urls, ['https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent']);
  });

  test('and a streamed reply to :streamGenerateContent on the same path', async () => {
    const urls = google(sse('Hello'));
    assert.equal(await drain(generateStream({ system: 's', contents, model: 'gemini-2.5-flash' })), 'Hello');
    assert.deepEqual(urls, [
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse',
    ]);
  });
});

describe('a failed stream is reported as the AI being unavailable, with Google’s reason', () => {
  const realFetch = globalThis.fetch;
  after(() => {
    globalThis.fetch = realFetch;
  });

  test('a 404 from Google is AiUnavailableError, not a ReferenceError', async () => {
    // generateStream called a helper that only existed inside generate(), so
    // every failed stream threw "isInvalidThinkingArg is not defined" and the
    // log never showed what Google said.
    google(json(404, { error: { code: 404, message: NOT_FOUND, status: 'NOT_FOUND' } }));
    await assert.rejects(drain(generateStream({ system: 's', contents, model: 'gemini-2.5-flash' })), (err) => {
      assert.ok(err instanceof AiUnavailableError, `threw ${err?.constructor?.name}: ${err?.message}`);
      assert.match(err.cause.message, /is not found for API version v1beta/);
      return true;
    });
  });

  test('a model that refuses thinkingConfig is asked again without it', async () => {
    const urls = google(
      json(400, { error: { code: 400, message: 'Invalid argument: thinking_config is not supported', status: 'INVALID_ARGUMENT' } }),
      sse('Answered without thinking'),
    );
    const text = await drain(generateStream({ system: 's', contents, model: 'gemini-refuses-thinking' }));
    assert.equal(text, 'Answered without thinking');
    assert.equal(urls.length, 2);
  });
});

describe('a model name from .env is cleaned of what cannot be seen', () => {
  test('spaces, quotes, look-alike hyphens, zero-width characters and a models/ prefix', () => {
    for (const raw of [
      'gemini-2.5-flash ',
      ' gemini-2.5-flash\t',
      '"gemini-2.5-flash"',
      "'gemini-2.5-flash'",
      'gemini‑2.5‑flash', // non-breaking hyphens, as pasted from a web page
      'gemini–2.5–flash', // en dashes
      '﻿gemini-2.5-flash', // a byte-order mark at the start of the file
      'gemini-2.5-flash​',
      'models/gemini-2.5-flash',
    ]) {
      assert.equal(cleanModelName(raw), 'gemini-2.5-flash', `"${visibleChars(raw)}" was not cleaned`);
    }
  });

  test('a clean name is left alone', () => {
    for (const name of ['gemini-2.5-flash', 'gemini-flash-latest', 'text-embedding-004', 'gemini-embedding-001']) {
      assert.equal(cleanModelName(name), name);
    }
  });

  test('hidden characters are written out where a log shows the value', () => {
    assert.equal(visibleChars('gemini‑2.5-flash '), 'gemini\\u20112.5-flash\\u0020');
  });

  describe('and a value that is still not a model name stops the server at start', () => {
    let result;
    before(() => {
      result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./src/config/env.js')"], {
        cwd: new URL('..', import.meta.url),
        env: { ...process.env, NODE_TEST_CONTEXT: '', GEMINI_CHAT_MODEL: 'gemini 2.5 flash' },
        encoding: 'utf8',
      });
    });

    test('it exits, naming the variable and showing the value', () => {
      assert.equal(result.status, 1);
      assert.match(result.stderr, /GEMINI_CHAT_MODEL: is not a Gemini model name: "gemini\\u00202\.5\\u0020flash"/);
    });
  });
});
