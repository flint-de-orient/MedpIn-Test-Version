import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ownsTheCrons } from '../src/services/cronOwner.js';
import { startScheduler } from '../src/services/scheduler.js';
import { startMedicationReminderCron } from '../src/services/medicationReminderCron.js';
import { startPatientReminderCron } from '../src/services/patientReminderCron.js';

/**
 * Only one process runs the background jobs.
 *
 * The jobs live inside the API. Under `pm2 -i max` every worker starts its own
 * copy, and a patient with a 9pm insulin reminder gets it once per CPU core.
 * Nothing errors, nothing is logged, and the only symptom is a patient being
 * told four times — to which the plausible response is to take it again.
 *
 * The guard used to be the scheduler's alone. The medicine-reminder job, the
 * one that sentence is about, and the morning nudges started in every worker
 * (V-53). So this checks every job that starts, not the scheduler's source.
 */

const ENV = ['NODE_APP_INSTANCE', 'RUN_SCHEDULER'];
const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));

function worker(instance, runScheduler) {
  for (const [k, v] of [
    ['NODE_APP_INSTANCE', instance],
    ['RUN_SCHEDULER', runScheduler],
  ]) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

afterEach(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const JOBS = [
  ['the scheduler', startScheduler],
  ['the medicine reminders', startMedicationReminderCron],
  ['the morning nudges', startPatientReminderCron],
];

describe('only the process that owns the crons runs them', () => {
  test('worker 0 owns the crons, and a plain `node src/server.js` counts as worker 0', () => {
    worker(undefined, undefined);
    assert.equal(ownsTheCrons(), true);
    worker('0', undefined);
    assert.equal(ownsTheCrons(), true);
    worker('1', undefined);
    assert.equal(ownsTheCrons(), false);
    worker('3', undefined);
    assert.equal(ownsTheCrons(), false);
  });

  test('RUN_SCHEDULER overrides in both directions', () => {
    // For the next step: the jobs extracted into a process of their own, where
    // the API sets false and the worker sets true. An override that only turned
    // it on would leave no way to turn it off.
    worker('1', 'true');
    assert.equal(ownsTheCrons(), true);
    worker('0', 'false');
    assert.equal(ownsTheCrons(), false);
    worker(undefined, 'false');
    assert.equal(ownsTheCrons(), false);
  });

  for (const [name, start] of JOBS) {
    test(`${name} does not start in worker 1`, () => {
      worker('1', undefined);
      assert.equal(start(), null, `${name} started in a worker that does not own the crons`);
    });

    test(`${name} starts in worker 0, and can be stopped`, () => {
      worker('0', undefined);
      const stop = start();
      assert.equal(typeof stop, 'function', `${name} did not start in the worker that owns the crons`);
      stop();
    });
  }

  test('nothing else in the server starts an interval without asking', () => {
    // A job added later that calls setInterval directly is the same bug again.
    const src = fileURLToPath(new URL('../src', import.meta.url));
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const full = path.join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith('.js')) files.push(full);
      }
    };
    walk(src);

    const unguarded = files.filter((f) => {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      return /\bsetInterval\(/.test(code) && !/\bownsTheCrons\(\)/.test(code);
    });
    assert.deepEqual(
      unguarded.map((f) => path.relative(src, f)),
      [],
      'a file starts a repeating job without asking ownsTheCrons()',
    );
  });

  test('a worker that is not running a job says so', () => {
    // Or the first question during an incident is whether the jobs are running
    // at all, and silence answers it wrongly.
    const owner = readFileSync(new URL('../src/services/cronOwner.js', import.meta.url), 'utf8');
    assert.match(owner, /not started in this worker/);
  });

  test('the multi-machine limit is written down, with what covers it', () => {
    // Two servers each have a worker 0. The guard reads as complete and is not;
    // the claims in the database are what keep a patient told once.
    const owner = readFileSync(new URL('../src/services/cronOwner.js', import.meta.url), 'utf8');
    assert.match(owner, /Two \*machines\*/);
    assert.match(owner, /needs a lock in the database/);
    assert.match(owner, /MedicationReminderPush/);
  });
});
