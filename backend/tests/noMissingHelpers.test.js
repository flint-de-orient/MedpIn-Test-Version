import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Catches a function that is called but never defined or imported.
 *
 * This exists because exactly that shipped. A helper was deleted from
 * `routes/dietician.js` while its call site stayed, and every check in the
 * pipeline passed: `node --check` only parses, importing the module only
 * evaluates the top level, and a missing function is a *runtime* ReferenceError
 * thrown when the route is finally hit. The dietician's dashboard returned 500
 * on every request and nothing said so until someone opened the app.
 *
 * ESLint's `no-undef` is the real tool for this, but the backend has no dev
 * dependencies and adding a lint toolchain to catch one bug is the wrong
 * trade. This is deliberately narrow: it does not lint, it answers one
 * question — is every locally-called name reachable from this file?
 */

// fileURLToPath, not `.pathname`: a checkout in a folder with a space in its
// name ("MedpIn New") read as "MedpIn%20New", so this test found no folder and
// checked nothing there.
const SRC = fileURLToPath(new URL('../src/', import.meta.url));

/** Everything a module can call without declaring it. */
const AMBIENT = new Set([
  'require', 'import', 'fetch', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'queueMicrotask', 'structuredClone', 'parseInt', 'parseFloat',
  'isNaN', 'isFinite', 'encodeURIComponent', 'decodeURIComponent', 'encodeURI',
  'decodeURI', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Date', 'RegExp',
  'Error', 'TypeError', 'RangeError', 'Promise', 'Map', 'Set', 'WeakMap', 'JSON',
  'Math', 'Symbol', 'BigInt', 'Buffer', 'URL', 'URLSearchParams', 'AbortController',
  'TextEncoder', 'TextDecoder', 'console', 'process', 'globalThis',
  // Capitalised globals, for the receiver check below.
  'Intl', 'Reflect', 'Proxy', 'WeakSet', 'WeakRef', 'ArrayBuffer', 'DataView',
  'Uint8Array', 'Int32Array', 'Float64Array', 'Atomics', 'Function', 'Infinity',
  'NaN', 'AggregateError', 'EvalError', 'SyntaxError', 'ReferenceError',
  'Blob', 'File', 'FormData', 'Headers', 'Request', 'Response', 'Event',
  // Control-flow keywords that the call-shaped regex would otherwise pick up.
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'function',
  'await', 'yield', 'new', 'delete', 'void', 'in', 'of', 'do', 'else', 'case',
  // Syntax that reads as a call to the regex but is not one.
  'async', 'constructor', 'super',
]);

function jsFilesIn(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesIn(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

/**
 * Names this file can legally call: anything it declares, imports, destructures
 * or takes as a parameter. Over-collects on purpose — a false *negative* here
 * costs nothing, a false positive would make the test noise.
 */
function declaredNames(src) {
  const names = new Set();
  const add = (re, group = 1) => {
    for (const m of src.matchAll(re)) {
      for (const part of m[group].split(',')) {
        // `import { getMessaging as messagingFor }` binds the alias, not the
        // original — take whatever is on the right of `as` when there is one.
        const aliased = part.includes(' as ') ? part.split(' as ').pop() : part;
        // Parens included: an executor written `new Promise((resolve, reject)`
        // hands the param matcher a leading `(`, which recorded the binding as
        // `(resolve` and left every `resolve()` looking undefined.
        const clean = aliased.trim().split(/[:=]/)[0].replace(/[{}()\[\]\s.]/g, '').trim();
        if (clean) names.add(clean);
      }
    }
  };

  // `function*` binds its name with no space before the star.
  add(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g);
  add(/\bclass\s+([A-Za-z_$][\w$]*)/g);
  add(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g);
  // Destructured bindings and import lists, both `{ a, b }` shaped.
  add(/\b(?:const|let|var)\s*\{([^}]*)\}/g);
  add(/\bimport\s*\{([^}]*)\}\s*from/g);
  add(/\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/g);
  add(/\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)/g);
  // Parameters, including destructured ones — good enough at this resolution.
  add(/\(([^)]*)\)\s*=>/g);
  add(/\bfunction\s*\*?\s*[A-Za-z_$\w]*\s*\(([^)]*)\)/g);
  return names;
}

/** Comments, string bodies and regex literals removed, so prose never reads
 * as code. Split out so both checks below see the same cleaned source. */
function strip(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/`(?:\\[\s\S]|[^\\`])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    // Regex literals last, and they matter more than they look: the triage
    // rules are built from patterns like /\b(can(no|')?t\s+breath\w*/i, and
    // without this `\b(` and `can(` both read as calls to functions that do
    // not exist. Anything preceded by a value can only be division, so the
    // lookbehind on the left is what keeps `a / b` intact.
    .replace(
      /(^|[^\w$)\]\s]|[\s](?=\/))\/(?![*/])(?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\\n])+\/[gimsuyd]*/g,
      '$1/RE/',
    );
}

/** Locally-called names: `foo(`, but never `obj.foo(` or `new Foo(`. */
function calledNames(stripped) {
  const out = new Set();
  for (const m of stripped.matchAll(/(^|[^.\w$])([a-z_$][\w$]*)\s*\(/gm)) {
    out.add(m[2]);
  }
  return out;
}

/**
 * Capitalised receivers: the `PatientProfile` in `PatientProfile.findOne(...)`.
 *
 * Added because the check above missed the same bug wearing a different shape.
 * It matches lowercase bare calls only, so a Mongoose model that was used but
 * never imported slipped past twice over — capitalised, and behind a dot. The
 * patient's dietician tab answered 500 for every newly registered patient and
 * drew "Could not load the conversation", and nothing in the pipeline said a
 * word, for exactly the reason written at the top of this file: it is a runtime
 * ReferenceError on a path no test walked.
 *
 * Only method receivers, never every capitalised mention. A class named in a
 * doc comment or a string is not a use, and this file is worth keeping only
 * while a failure here still means something.
 */
function calledStatics(stripped) {
  const out = new Set();
  for (const m of stripped.matchAll(/(^|[^.\w$])([A-Z][\w$]*)\.[a-z][\w$]*\s*\(/gm)) {
    out.add(m[2]);
  }
  return out;
}

describe('every called helper is reachable', () => {
  for (const file of jsFilesIn(SRC)) {
    const rel = file.slice(SRC.length).replace(/\\/g, '/');
    test(rel, () => {
      const src = readFileSync(file, 'utf8');
      const declared = declaredNames(src);
      const stripped = strip(src);
      const missing = [
        ...calledNames(stripped),
        ...calledStatics(stripped),
      ].filter((n) => !declared.has(n) && !AMBIENT.has(n));
      assert.deepEqual(
        missing,
        [],
        `${rel} calls ${missing.join(', ')} but never defines or imports it`,
      );
    });
  }
});
