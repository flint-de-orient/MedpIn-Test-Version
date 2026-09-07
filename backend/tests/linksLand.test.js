import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { PRACTICE_STATUS, VERIFICATION, PLAN } from '../src/models/Practice.js';

/**
 * Every link in the console goes somewhere, and arrives filtered.
 *
 * ---- Why a link can be wrong and still work -----------------------------
 *
 * The metric cards on the overview are links now: Patients opens the growth
 * chart on the patients line, Active practices opens the register filtered to
 * active. Both are `?param=value` against a page that reads the URL, and both
 * fail quietly when the value is wrong.
 *
 * `/analytics/?line=patient` — singular, one letter out — is not an error. The
 * page whitelists what it reads and falls back to the default, so the card
 * opens the practices line and looks like it worked. Nobody finds that except
 * by noticing the chart is the wrong one, which is not something anybody
 * notices.
 *
 * The same hole runs through the server: four of these links are built in
 * `admin.js` and handed to the console as attention items. A typo there is a
 * "Review" button that opens an unfiltered list.
 *
 * ---- So the contract is written down and both sides are held to it ------
 *
 * ACCEPTS below is the contract. Every link is checked against it, and it is
 * checked against the pages — a param nobody reads would make this test pass by
 * describing a filter that does not exist.
 */
const WEB = fileURLToPath(new URL('../../web/src/', import.meta.url));
const APP = path.join(WEB, 'app');

/** Every .ts/.tsx under a directory, as one string. */
function sourceUnder(dir) {
  let out = '';
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out += sourceUnder(full);
    else if (/\.tsx?$/.test(name)) out += readFileSync(full, 'utf8') + '\n';
  }
  return out;
}

const app = sourceUnder(WEB);
const routes = readFileSync(new URL('../src/routes/admin.js', import.meta.url), 'utf8');

/** The four lines the growth chart can draw, read from the page that draws them. */
const LINE_KEYS = [...sourceUnder(path.join(APP, 'analytics')).matchAll(/key: "(\w+)"/g)].map(
  (m) => m[1],
);

/**
 * What each route reads out of its own URL, and which values mean anything.
 *
 * `null` means free text — an id, a search term — that cannot be checked here.
 */
const ACCEPTS = {
  '/practices/': {
    id: null,
    q: null,
    status: Object.values(PRACTICE_STATUS),
    verification: Object.values(VERIFICATION),
    plan: Object.values(PLAN),
  },
  '/analytics/': {
    line: LINE_KEYS,
    months: ['6', '12', '24'],
  },
  '/admins/': {},
  '/audit/': {},
  '/account/': {},
  '/': {},
};

/** Every internal link written anywhere, with where it was written. */
function linksIn(source, origin) {
  const found = [];
  for (const m of source.matchAll(/href[=:]\s*[{]?[`'"](\/[^`'"]*)[`'"]/g)) {
    found.push({ href: m[1], origin });
  }
  return found;
}

const links = [...linksIn(app, 'the console'), ...linksIn(routes, 'admin.js')];

describe('the links are worth testing at all', () => {
  test('there are some, and the analytics lines were found', () => {
    // Every assertion below passes on an empty list. This is the one that says
    // the regex still matches the code it is meant to be reading.
    assert.ok(links.length >= 8, `only ${links.length} links found; the scan is broken`);
    assert.ok(LINE_KEYS.length >= 4, `only ${LINE_KEYS.length} chart lines found`);
    assert.ok(LINE_KEYS.includes('patients'), 'the patients line is gone from the chart');
  });
});

describe('every link points at a page that exists', () => {
  for (const { href, origin } of links) {
    const route = href.split('?')[0];

    test(`${href} (${origin})`, () => {
      // The export is `trailingSlash: true`, so a link without one redirects
      // and drops the query string on some hosts.
      assert.ok(route.endsWith('/'), `"${href}" has no trailing slash`);

      const dir = route === '/' ? APP : path.join(APP, route.slice(1, -1));
      assert.ok(
        existsSync(path.join(dir, 'page.tsx')),
        `"${href}" points at ${route}, which has no page`,
      );
    });
  }
});

describe('every filter in a link is one the page reads', () => {
  for (const { href, origin } of links) {
    const [route, qs] = href.split('?');
    if (!qs) continue;

    test(`${href} (${origin})`, () => {
      const accepted = ACCEPTS[route];
      assert.ok(accepted, `no contract written for ${route}`);

      for (const pair of qs.split('&')) {
        const [key, value] = pair.split('=');
        assert.ok(
          key in accepted,
          `"${href}" sets ?${key}=, which ${route} does not read — it opens unfiltered`,
        );

        const allowed = accepted[key];
        // `${...}` is filled in at runtime; only the name can be checked.
        if (!allowed || value?.includes('${')) continue;

        assert.ok(
          allowed.includes(value),
          `"${href}" sets ?${key}=${value}, which is not one of ${allowed.join(', ')} — ` +
            'the page falls back to its default and the link looks like it worked',
        );
      }
    });
  }
});

describe('and the contract is not describing filters nobody implemented', () => {
  for (const [route, accepted] of Object.entries(ACCEPTS)) {
    const keys = Object.keys(accepted);
    if (keys.length === 0) continue;

    test(`${route} reads every param it is said to`, () => {
      // Named files rather than the whole app: `params.get("status")` on some
      // other screen would satisfy a search of everything and prove nothing
      // about this one.
      const dir = route === '/' ? APP : path.join(APP, route.slice(1, -1));
      let source = sourceUnder(dir);

      // A page can delegate its whole list to a component, which is what
      // /practices/ does — the register holds the filters.
      source += sourceUnder(path.join(WEB, 'components'));

      for (const key of keys) {
        assert.ok(
          source.includes(`params.get("${key}")`) || source.includes(`get("${key}")`),
          `${route} is documented as reading ?${key}= and never looks for it`,
        );
      }
    });
  }
});

describe('a count that leads somewhere leads to something on the page', () => {
  const anchors = new Set([...app.matchAll(/\bid="([\w-]+)"/g)].map((m) => m[1]));

  for (const m of app.matchAll(/jumpTo="([\w-]+)"/g)) {
    test(`jumpTo="${m[1]}" has a panel`, () => {
      assert.ok(
        anchors.has(m[1]),
        `a stat jumps to #${m[1]} and no panel carries that id — the click does nothing`,
      );
    });
  }

  test('the anchors are reachable under the sticky header', () => {
    // Jumping to a panel with no offset puts its heading behind the bar, so
    // the click looks like it landed a section too far down.
    const primitives = readFileSync(
      new URL('../../web/src/components/primitives.tsx', import.meta.url),
      'utf8',
    );
    assert.match(primitives, /scroll-mt-\d+/);
  });
});
