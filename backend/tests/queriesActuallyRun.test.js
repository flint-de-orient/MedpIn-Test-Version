import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Queries that are built and never run.
 *
 * ---- Found by mutation testing, not by reading ---------------------------
 *
 * `countReply` wrote `AiUsage.updateOne(...).catch(...)`. Deleting the
 * `.catch()` produced no failure and no rejection, which was the wrong result
 * for a query that should have been unable to connect — and the reason is that
 * it was not connecting at all.
 *
 * A mongoose query is a lazy thenable. `Model.updateOne(...)` constructs a
 * Query and executes nothing until something awaits it, calls `.then()`,
 * `.catch()` or `.exec()`. So that counter was running only as a side effect of
 * its own error handler: tidying the handler away would have stopped the
 * counting silently, and the first sign would have been a practice that never
 * appeared to use its allowance.
 *
 * `Model.create()` is different — it returns a real Promise and has already
 * started. Checked rather than assumed:
 *
 *   M.updateOne({}, {}).constructor.name  ->  Query
 *   M.create({}).constructor.name         ->  Promise
 *
 * So only the Query-returning methods are listed here. Including `create` would
 * flag every fire-and-forget audit write in the codebase for a bug it cannot
 * have.
 */
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** The methods that return a Query or an Aggregate, and therefore do nothing on their own. */
const LAZY = [
  'find', 'findOne', 'findById', 'countDocuments', 'estimatedDocumentCount',
  'distinct', 'aggregate',
  'updateOne', 'updateMany', 'deleteOne', 'deleteMany', 'replaceOne',
  'findOneAndUpdate', 'findByIdAndUpdate', 'findOneAndDelete', 'findByIdAndDelete',
];

function jsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...jsFiles(full));
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

/** Source with comments blanked, keeping line numbers intact. */
function code(file) {
  const blank = (c) => c.replace(/[^\n]/g, ' ');
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/\/\/[^\n]*/g, blank);
}

/** From the call's open paren, through balanced brackets, to the statement's end. */
function chainAfter(src, open) {
  let depth = 0;
  let i = open;
  for (; i < src.length; i += 1) {
    const c = src[i];
    if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const end = src.indexOf(';', i);
  return src.slice(i, end === -1 ? i + 200 : end);
}

const bare = [];
const handlerOnly = [];

for (const file of jsFiles(SRC)) {
  const src = code(file);
  const re = new RegExp(`\\b([A-Z]\\w*)\\.(${LAZY.join('|')})\\s*\\(`, 'g');

  for (const m of src.matchAll(re)) {
    const [, model, method] = m;

    /*
     * What consumes this call, looking back across newlines.
     *
     * Reading only the current line calls every query inside a multi-line
     * `Promise.all([` bare — that produced 165 findings on the first run,
     * almost all of them wrong.
     */
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(src[j])) j -= 1;
    const prevChar = src[j] ?? '';
    const prevWord = src.slice(Math.max(0, j - 9), j + 1);

    if ('([,=?:&|'.includes(prevChar)) continue;        // an argument or a value
    if (/\b(await|return|yield)$/.test(prevWord)) continue;
    if (prevChar === '.') continue;                      // mid-chain

    const chain = chainAfter(src, src.indexOf('(', m.index + model.length + method.length));
    const where = `${path.relative(SRC, file)}:${src.slice(0, m.index).split('\n').length}`;

    if (/\.exec\s*\(/.test(chain)) continue;
    if (/\.(then|catch|finally)\s*\(/.test(chain)) {
      handlerOnly.push(`${where}  ${model}.${method}()`);
      continue;
    }
    bare.push(`${where}  ${model}.${method}()`);
  }
}

describe('the scan is looking at something', () => {
  test('it finds queries at all', () => {
    // Every assertion below passes on an empty scan. This one says the regex
    // still matches the code it is meant to be reading.
    let found = 0;
    for (const file of jsFiles(SRC)) {
      found += [...code(file).matchAll(new RegExp(`\\b[A-Z]\\w*\\.(${LAZY.join('|')})\\s*\\(`, 'g'))].length;
    }
    assert.ok(found > 200, `only ${found} queries found; the scan is broken`);
  });
});

describe('every query is executed', () => {
  test('none is built and abandoned', () => {
    assert.deepEqual(
      bare,
      [],
      [
        '',
        'These build a mongoose Query and never run it:',
        '',
        ...bare.map((b) => `  ${b}`),
        '',
        'A Query does nothing until something awaits it, calls .then()/.catch(),',
        'or calls .exec(). A write like this fails silently — no error, no data.',
      ].join('\n'),
    );
  });

  test('and none runs only because of its error handler', () => {
    assert.deepEqual(
      handlerOnly,
      [],
      [
        '',
        'These execute only as a side effect of the .then/.catch chained onto them:',
        '',
        ...handlerOnly.map((b) => `  ${b}`),
        '',
        'That works, and it breaks the moment somebody tidies the handler away —',
        'silently, because the query simply stops running. Add .exec() so the',
        'execution is visible in the line that writes it.',
      ].join('\n'),
    );
  });
});
