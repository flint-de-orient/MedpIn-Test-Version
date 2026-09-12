import { test, describe, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { boot, shutdown, wipe, as, allText } from './helpers/httpHarness.js';
import { makePractice, makeMember, makePatient } from './helpers/factories.js';
import { LabReport } from '../src/models/LabReport.js';
import { PLAN, PRACTICE_TYPE } from '../src/models/Practice.js';

/**
 * What came back from the lab, across a practice rather than one record.
 *
 * This route exists because the laboratory dashboard needed data and there was
 * none — lab reports were readable one patient at a time, which is a record
 * screen and not a bench screen. These check it answers the question a bench
 * actually asks, stays inside the practice, and does not invent the parts of a
 * laboratory this platform has never modelled.
 */

let origin;
let practice;
let doctor;

async function reportFor(patient, { title, testedOn, values }) {
  return LabReport.create({ patient: patient.user._id, title, testedOn, values });
}

describe('the bench sees what came back abnormal', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(async () => {
    await wipe();
    practice = await makePractice('Salt Lake Diagnostics', {
      practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
      plan: PLAN.PROFESSIONAL,
    });
    doctor = await makeMember(practice, { name: 'Dr Iyer', isOwner: true });
  });

  test('a critical value puts its report in front', async () => {
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    const ravi = await makePatient({ name: 'Ravi Menon', practices: [practice] });

    await reportFor(anita, {
      title: 'Renal panel',
      testedOn: new Date(),
      values: [{ code: 'CREAT', label: 'Creatinine', value: 6.2, unit: 'mg/dL', flag: 'critical' }],
    });
    await reportFor(ravi, {
      title: 'Lipid profile',
      testedOn: new Date(),
      values: [{ code: 'LDL', label: 'LDL', value: 98, unit: 'mg/dL', flag: 'normal' }],
    });

    const res = await as(doctor.token).get('/doctor/labs/overview');

    assert.equal(res.status, 200);
    assert.equal(res.body.critical.length, 1);
    assert.equal(res.body.critical[0].title, 'Renal panel');
    assert.equal(res.body.critical[0].patient.name, 'Anita Sengupta');
    // Both are recent; only one is critical.
    assert.equal(res.body.recent.length, 2);
  });

  test('and the normal values are not listed under it', async () => {
    /*
     * A panel of forty normal results is a list nobody reads, with the one
     * abnormal value somewhere in the middle. The report is surfaced by its
     * worst flag and carries only the values that earned it.
     */
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    await reportFor(anita, {
      title: 'Full blood count',
      testedOn: new Date(),
      values: [
        { code: 'HB', label: 'Haemoglobin', value: 7.1, unit: 'g/dL', flag: 'low' },
        { code: 'WBC', label: 'White cells', value: 6.4, unit: 'x10^9/L', flag: 'normal' },
        { code: 'PLT', label: 'Platelets', value: 240, unit: 'x10^9/L', flag: 'normal' },
      ],
    });

    const res = await as(doctor.token).get('/doctor/labs/overview');
    const [report] = res.body.recent;

    assert.equal(report.worstFlag, 'abnormal');
    assert.deepEqual(
      report.abnormal.map((v) => v.label),
      ['Haemoglobin'],
    );
  });

  test('the counts say which window they describe', async () => {
    /*
     * A total since the practice opened only ever grows and says nothing about
     * now. The window is what makes the number readable — and it is sent back
     * so the screen can state it rather than implying an all-time figure.
     */
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    await reportFor(anita, {
      title: 'Recent',
      testedOn: new Date(),
      values: [{ code: 'HB', value: 7.1, flag: 'low' }],
    });
    await reportFor(anita, {
      title: 'Two years ago',
      testedOn: new Date(Date.now() - 730 * 864e5),
      values: [{ code: 'HB', value: 6.0, flag: 'critical' }],
    });

    const res = await as(doctor.token).get('/doctor/labs/overview?days=30');

    assert.equal(res.body.days, 30);
    assert.equal(res.body.flags.low, 1);
    assert.equal(res.body.flags.critical, 0, 'a two-year-old value counted in a 30-day window');
  });

  test('an unflagged value is not counted as normal', async () => {
    // It has not been judged, and calling it normal is the app deciding it was.
    const anita = await makePatient({ name: 'Anita Sengupta', practices: [practice] });
    await reportFor(anita, {
      title: 'Imported panel',
      testedOn: new Date(),
      values: [{ code: 'X', value: 1 }, { code: 'Y', value: 2, flag: 'normal' }],
    });

    const res = await as(doctor.token).get('/doctor/labs/overview');

    assert.equal(res.body.flags.unflagged, 1);
    assert.equal(res.body.flags.normal, 1);
  });

  test('a window outside the allowed range is clamped, not obeyed', async () => {
    // `days=99999` is a full-collection scan somebody typed into a URL.
    const res = await as(doctor.token).get('/doctor/labs/overview?days=99999');
    assert.equal(res.body.days, 180);

    const nonsense = await as(doctor.token).get('/doctor/labs/overview?days=nonsense');
    assert.equal(nonsense.body.days, 30, 'an unparseable window should fall back to the default');
  });
});

describe('and sees only its own practice', () => {
  before(async () => {
    origin = await boot();
  });
  after(shutdown);
  beforeEach(wipe);

  test("another practice's reports are not on this bench", async () => {
    /*
     * The leak worth catching is not "the wrong array came back". It is one
     * other practice's patient name inside a populated field, which an
     * assertion about `length` sails straight past.
     */
    const ours = await makePractice('Salt Lake Diagnostics', {
      practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
      plan: PLAN.PROFESSIONAL,
    });
    const theirs = await makePractice('Behala Pathology', {
      practiceType: PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
      plan: PLAN.PROFESSIONAL,
    });

    const mine = await makeMember(ours, { name: 'Dr Iyer', isOwner: true });
    const myPatient = await makePatient({ name: 'Anita Sengupta', practices: [ours] });
    const notMine = await makePatient({ name: 'Sunil Kapadia', practices: [theirs] });

    await reportFor(myPatient, {
      title: 'Renal panel',
      testedOn: new Date(),
      values: [{ code: 'CREAT', value: 6.2, flag: 'critical' }],
    });
    await reportFor(notMine, {
      title: 'Renal panel',
      testedOn: new Date(),
      values: [{ code: 'CREAT', value: 7.1, flag: 'critical' }],
    });

    const res = await as(mine.token).get('/doctor/labs/overview');

    assert.equal(res.body.recent.length, 1);
    assert.ok(
      !allText(res.body).includes('Sunil Kapadia'),
      "another practice's patient appeared on this bench",
    );
    assert.equal(res.body.flags.critical, 1);
  });

  test('the capability guard is mounted, even though nothing is refused by it today', async () => {
    /*
     * Said plainly rather than dressed up as a paywall test.
     *
     * LAB_RESULT is on every practice type and every plan, so there is no
     * customer this guard can currently turn away — an assertion that somebody
     * gets a 403 would have to invent a practice that cannot exist, and a test
     * that passes by constructing an impossible fixture is worse than none.
     *
     * The guard is still right to be there: it is the difference between "no
     * plan withholds this yet" and "this route is ungated", and the day a
     * cheaper tier drops reading results, the refusal already works. What this
     * checks is that it is mounted and that the tables say why it is quiet.
     */
    const { BY_TYPE, BY_PLAN, CAPABILITIES } = await import('../src/services/capabilities.js');

    for (const [type, held] of Object.entries(BY_TYPE)) {
      assert.ok(held.includes(CAPABILITIES.LAB_RESULT), `${type} lost LAB_RESULT`);
    }
    for (const [plan, held] of Object.entries(BY_PLAN)) {
      assert.ok(held.includes(CAPABILITIES.LAB_RESULT), `${plan} lost LAB_RESULT`);
    }

    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/routes/doctor.js', import.meta.url), 'utf8');
    const at = src.indexOf("'/labs/overview'");
    assert.ok(at > 0, 'the lab overview route moved');
    const handler = src.slice(at, src.indexOf('\nrouter.', at));
    assert.match(handler, /requireCapability\(CAPABILITIES\.LAB_RESULT\)/);
  });
});
