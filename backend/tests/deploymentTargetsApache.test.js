import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * The server runs Apache, and four sets of instructions said nginx.
 *
 * ---- Why this is a test and not a note ----------------------------------
 *
 * nginx is installed on that box and stopped. Config written to `/etc/nginx/`
 * is never read, so a Content-Security-Policy put there is not misconfigured —
 * it is *absent*, and an absent security header looks exactly like a permissive
 * one. Nothing fails, nothing logs, and the page works.
 *
 * It recurred four times because each new document was written by reading the
 * previous one. A note in a file is read by whoever is already reading that
 * file; this runs whether anyone reads anything or not.
 *
 * If the server ever does move to nginx, delete this test in the same commit
 * that moves it. That is the point: the claim lives in one place and changing
 * it is deliberate.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Deployment instructions: what to run, and what to write where. */
function deploymentFiles() {
  const found = [];

  const walk = (dir, depth = 0) => {
    if (depth > 3) return;
    for (const name of readdirSync(dir)) {
      if (['node_modules', '.git', '.next', 'out', 'build', 'uploads'].includes(name)) {
        continue;
      }
      const full = path.join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue; // a symlink to nowhere, or a file that vanished mid-walk
      }
      if (s.isDirectory()) walk(full, depth + 1);
      else if (/^deploy\.sh$|DEPLOY\.md$|\.conf$/i.test(name)) found.push(full);
    }
  };
  walk(ROOT);
  return found;
}

/**
 * Instructions that would actually be carried out on the server, as opposed to
 * prose explaining why nginx is the wrong answer.
 *
 * The distinction matters: every one of these files now discusses nginx at
 * length in order to warn about it, and a test that banned the word would force
 * the warnings to be deleted.
 */
const ACTIONS = [
  /systemctl\s+(reload|restart|start)\s+nginx/,
  /nginx\s+-s\s+reload/,
  /\bnginx\s+-t\b/,
  /rsync[^\n]*\/etc\/nginx/,
  /:\/etc\/nginx/,
  /a2enmod[^\n]*nginx/,
];

/**
 * And config somebody would paste, which is an instruction without a verb.
 *
 * This test banned nginx *commands*, and the console's deployment doc carried a
 * whole `server { }` block underneath for months. Nobody runs a config block,
 * so no ACTION matched — but a block in a file headed "serve the files" gets
 * copied to /etc/nginx, where it is never read. The page then works with no CSP
 * and no proxy, and the absence of both looks like nothing at all.
 *
 * That block also had no `/api/` proxy in it, so following it produced a
 * console whose every request was answered by the web server's own 404 page.
 *
 * `server_name` and `location` cannot appear in an Apache file, so a line with
 * either is nginx config whatever the fence around it claims.
 */
const NGINX_CONFIG = [
  /^\s*server_name\s+\S+;/,
  /^\s*location\s+[^{]*\{/,
  /proxy_pass\s+http/,
];

describe('deployment instructions target the server we actually have', () => {
  const files = deploymentFiles();

  test('there are deployment files to check', () => {
    // A walk that found nothing would make every test below vacuous.
    assert.ok(files.length >= 2, `only found ${files.length} deployment file(s)`);
  });

  test('none of them acts on nginx', () => {
    const offenders = [];

    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');

      src.split('\n').forEach((line, i) => {
        // A line inside a warning, a comment, or a fenced quote is explaining
        // the mistake rather than repeating it.
        const t = line.trim();
        if (t.startsWith('#') || t.startsWith('>') || t.startsWith('//') || t.startsWith('*')) {
          return;
        }
        for (const rx of [...ACTIONS, ...NGINX_CONFIG]) {
          if (rx.test(line)) offenders.push(`${rel}:${i + 1}  ${t.slice(0, 70)}`);
        }
      });
    }

    assert.deepEqual(
      offenders,
      [],
      [
        '',
        'A deployment instruction acts on nginx:',
        '',
        ...offenders.map((o) => `  ${o}`),
        '',
        'The VPS serves with Apache. nginx is installed there and stopped, and',
        'must stay stopped — starting it collides with Apache on 80 and 443 and',
        'takes down every site on the box.',
        '',
        'Config written to /etc/nginx is never read, so a CSP put there is absent',
        'rather than wrong. An absent security header looks exactly like a',
        'permissive one, which is how this went unnoticed four times.',
        '',
        'Use apache2ctl configtest && systemctl reload apache2, and',
        '/etc/apache2/conf-available for the policy. See web/DEPLOY.md.',
      ].join('\n'),
    );
  });

  test('the live deploy script reloads Apache', () => {
    const sh = readFileSync(path.join(ROOT, 'web', 'deploy.sh'), 'utf8');
    assert.match(sh, /apache2ctl configtest && systemctl reload apache2/);

    // And refuses to run if the box turns out to be serving with nginx after
    // all, rather than writing a policy nothing will read.
    assert.match(sh, /systemctl is-active --quiet nginx/);
    assert.match(sh, /headers_module/);
  });

  test('the generated policy is an Apache directive by default', () => {
    const csp = readFileSync(path.join(ROOT, 'web', 'scripts', 'csp.mjs'), 'utf8');
    assert.match(csp, /const apache = !process\.argv\.includes\("--nginx"\)/);
    assert.match(csp, /Header always set Content-Security-Policy/);
  });
});
