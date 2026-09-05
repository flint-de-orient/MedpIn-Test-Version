import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * Only one process runs the crons.
 *
 * The scheduler lives inside the API. Under `pm2 -i max` every worker starts
 * its own copy, and a patient with a 9pm insulin reminder gets it once per CPU
 * core. Nothing errors, nothing is logged, and the only symptom is a patient
 * being told four times — to which the plausible response is to take it again.
 *
 * This is the first step of the scaling order for exactly that reason, and the
 * guard belongs in code rather than a deployment note. A note is followed until
 * the evening somebody scales the API to fix a slow endpoint and does not think
 * about reminders.
 */
const src = readFileSync(new URL('../src/services/scheduler.js', import.meta.url), 'utf8');

describe('the scheduler refuses to run in more than one worker', () => {
  test('the guard exists and is consulted before the interval starts', () => {
    assert.match(src, /function shouldRunScheduler\(\)/);
    const start = src.indexOf('export function startScheduler');
    const guard = src.indexOf('shouldRunScheduler()', start);
    const interval = src.indexOf('setInterval(tick', start);
    assert.ok(guard > -1 && interval > guard, 'the interval starts before the guard runs');
  });

  test('worker 0 owns the crons, and unset counts as worker 0', () => {
    // A plain `node src/server.js` has no NODE_APP_INSTANCE and is the only
    // process, so it must schedule.
    assert.match(src, /\(process\.env\.NODE_APP_INSTANCE \?\? '0'\) === '0'/);
  });

  test('RUN_SCHEDULER overrides in both directions', () => {
    // For the next step: the scheduler extracted into a process of its own,
    // where the API sets false and the worker sets true. An override that only
    // turned it on would leave no way to turn it off.
    assert.match(src, /if \(override === 'true'\) return true;/);
    assert.match(src, /if \(override === 'false'\) return false;/);
  });

  test('a worker that is not scheduling says so', () => {
    // Or the first question during an incident is whether the crons are
    // running at all, and silence answers it wrongly.
    assert.match(src, /scheduler not started in this worker/);
  });

  test('the multi-machine limit is written down, not implied', () => {
    // Two servers each have a worker 0. The guard reads as complete and is not,
    // and the place that misleads is this file.
    assert.match(src, /Two \*machines\*/);
    assert.match(src, /needs a lock in the database/);
  });
});
