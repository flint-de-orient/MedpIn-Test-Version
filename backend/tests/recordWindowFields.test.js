import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import mongoose from 'mongoose';

/**
 * The field named in `recordWindow(req, 'x')` must actually be `x`.
 *
 * ---- How this got through ------------------------------------------------
 *
 * `LabResult.find({ patient, ...recordWindow(req, 'testedOn') })` read like the
 * other ten. But `testedOn` on that model is `analysis.testedOn` — nested,
 * written by the report parser — and there is no top-level path of that name.
 *
 * `strictQuery` is on, so Mongoose removed the condition and the read ran
 * unbounded. Every check passed: the route had a window, the ratchet in
 * recordWindow.test.js saw it, the tests were green, and a second practice
 * could read every lab result a patient had ever uploaded.
 *
 * It failed open, which is why nobody noticed. Had it failed the other way —
 * had the path existed but been optional — every lab result would have
 * vanished from the clinic that has been running for a year, and the first
 * report would have come from a doctor, not a test.
 *
 * ---- So both directions are checked --------------------------------------
 *
 * The path must exist, or the bound does nothing. And it must always be set,
 * or `{ field: { $gte: d } }` silently drops every row that lacks it — Mongo
 * does not match a missing field against a range, and a hidden row looks
 * exactly like a row that was never there.
 */
const ROUTES = fileURLToPath(new URL('../src/routes/', import.meta.url));
const MODELS = fileURLToPath(new URL('../src/models/', import.meta.url));

// Loading every model registers it on the default mongoose connection, which is
// how a route's `Prescription` is resolved back to a schema without importing
// each one by name here. No database is touched.
for (const f of readdirSync(MODELS).filter((n) => n.endsWith('.js'))) {
  await import(pathToFileURL(path.join(MODELS, f)).href);
}

/** Walk back from an index to the `{` that opens the object containing it. */
function openingBrace(src, at) {
  let depth = 0;
  for (let i = at; i >= 0; i -= 1) {
    if (src[i] === '}') depth += 1;
    else if (src[i] === '{') {
      if (depth === 0) return i;
      depth -= 1;
    }
  }
  return -1;
}

/**
 * Every `recordWindow(req, 'field')` in the routes, paired with the model whose
 * query it sits in — taken from the `Xxx.find(` immediately before the brace.
 */
function boundedQueries() {
  const found = [];

  for (const f of readdirSync(ROUTES).filter((n) => n.endsWith('.js'))) {
    const src = readFileSync(path.join(ROUTES, f), 'utf8');

    for (const m of src.matchAll(/recordWindow\(req,\s*'([^']+)'\)/g)) {
      const field = m[1];
      const open = openingBrace(src, m.index);
      if (open === -1) continue;

      const before = src.slice(Math.max(0, open - 120), open).trimEnd();
      const line = src.slice(0, m.index).split('\n').length;

      // Written inline: `Prescription.find({ ...recordWindow(req, 'issuedOn') })`
      let model = before.match(
        /([A-Z][A-Za-z0-9]*)\.(find|findOne|countDocuments|aggregate)\($/,
      )?.[1];

      // Or hoisted, which most of the list routes do because the same filter
      // feeds both `find` and `countDocuments`:
      //
      //     const filter = { patient: req.patientId, ...recordWindow(...) };
      //     GlucoseReading.find(filter)
      //
      // Following the variable is the difference between checking eight of
      // these and checking all twenty.
      if (!model) {
        const named = before.match(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*$/);
        if (named) {
          const use = src
            .slice(open)
            .match(
              new RegExp(
                `([A-Z][A-Za-z0-9]*)\\.(?:find|findOne|countDocuments|aggregate)\\(\\s*${named[1]}\\b`,
              ),
            );
          model = use?.[1];
        }
      }

      found.push({ file: f, line, field, model: model ?? null });
    }
  }
  return found;
}

const QUERIES = boundedQueries();

describe('every window names a field the model actually has', () => {
  test('there are windows to check', () => {
    // A matcher that found nothing would make every test below vacuous.
    assert.ok(QUERIES.length >= 15, `only found ${QUERIES.length} recordWindow calls`);
  });

  test('each one sits in a query whose model could be identified', () => {
    // Not pedantry: an unidentified model is a window this test cannot verify,
    // and the whole point is that an unverifiable window is how the last one
    // survived. Rewrite the query so the model precedes the filter directly.
    const orphans = QUERIES.filter((q) => !q.model).map((q) => `${q.file}:${q.line} (${q.field})`);
    assert.deepEqual(orphans, [], `could not tell which model these bound:\n  ${orphans.join('\n  ')}`);
  });

  test('the field exists on that model, or the bound is stripped and does nothing', () => {
    const missing = [];

    for (const q of QUERIES) {
      if (!q.model) continue;
      const M = mongoose.models[q.model];
      if (!M) continue; // not a model — a local variable that happens to be capitalised
      if (!M.schema.path(q.field)) {
        const near = M.schema
          .paths ? Object.keys(M.schema.paths).filter((p) => p.endsWith(q.field)) : [];
        missing.push(
          `${q.file}:${q.line}  ${q.model}.${q.field} does not exist` +
            (near.length ? ` — did you mean ${near.join(', ')}?` : ''),
        );
      }
    }

    assert.deepEqual(
      missing,
      [],
      ['', 'A window on a path the schema does not have:', '', ...missing.map((s) => `  ${s}`),
        '', 'strictQuery removes it and the read runs unbounded. Silently.'].join('\n'),
    );
  });

  test('and is always set, or rows without it disappear', () => {
    const risky = [];

    for (const q of QUERIES) {
      const M = q.model && mongoose.models[q.model];
      if (!M) continue;
      const p = M.schema.path(q.field);
      if (!p) continue; // reported by the test above

      const timestamped =
        M.schema.options.timestamps && (q.field === 'createdAt' || q.field === 'updatedAt');
      const guaranteed =
        timestamped || p.options?.required === true || p.options?.default !== undefined;

      if (!guaranteed) {
        risky.push(`${q.file}:${q.line}  ${q.model}.${q.field} is optional with no default`);
      }
    }

    assert.deepEqual(
      risky,
      [],
      ['', 'A window on a field that may be absent:', '', ...risky.map((s) => `  ${s}`),
        '', 'Mongo does not match a missing field against a range, so every row',
        'lacking it vanishes from the list — and a hidden row looks exactly like',
        'a row that was never written.'].join('\n'),
    );
  });
});
