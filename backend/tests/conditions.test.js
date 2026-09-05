import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Condition } from '../src/models/Condition.js';
import { PatientCondition, CONDITION_STATUS } from '../src/models/PatientCondition.js';
import { describeForPrompt } from '../src/services/patientConditions.js';

/**
 * Illnesses as rows, and the promise that the app behaves identically until
 * every reader has moved.
 *
 * `diabetesType` is read in 48 places. The whole migration rests on those 48
 * going on working while the rows are written beside them, so most of what is
 * pinned here is what the migration must *not* do.
 */
const seedSrc = readFileSync(new URL('../scripts/seedConditions.js', import.meta.url), 'utf8');
const backfillSrc = readFileSync(
  new URL('../scripts/backfillConditions.js', import.meta.url),
  'utf8',
);

function seeded() {
  const start = seedSrc.indexOf('const CONDITIONS = [');
  const block = seedSrc.slice(start, seedSrc.indexOf('\n];', start));
  return [...block.matchAll(/\{\s*\n\s*key: '([a-z_]+)',\s*\n\s*names: \{([^}]+)\}/g)].map(
    ([, key, names]) => ({ key, langs: [...names.matchAll(/\b(en|bn|hi):/g)].map((m) => m[1]) }),
  );
}

describe('the illnesses the app already knew about', () => {
  const rows = seeded();

  test('all ten are there — diabetes plus the nine comorbidities', () => {
    // Nothing new is being claimed clinically. This is the same list the schema
    // already asserted, in a shape that can grow without a deploy.
    assert.equal(rows.length, 10, rows.map((r) => r.key).join(', '));
    for (const key of [
      'diabetes',
      'hypertension',
      'dyslipidaemia',
      'ckd',
      'retinopathy',
      'neuropathy',
      'cad',
      'thyroid',
      'obesity',
      'other',
    ]) {
      assert.ok(rows.some((r) => r.key === key), `missing ${key}`);
    }
  });

  test('every one is named in all three languages', () => {
    for (const r of rows) {
      for (const lang of ['en', 'bn', 'hi']) {
        assert.ok(r.langs.includes(lang), `${r.key} has no ${lang} name`);
      }
    }
  });

  test('no condition ships with triage rules', () => {
    // The 21 rules the app has are diabetes-tuned. An asthma exacerbation is
    // not among them and cannot be inferred from them.
    const block = seedSrc.slice(seedSrc.indexOf('const CONDITIONS = ['));
    assert.ok(!/triageRules:\s*\[\s*'/.test(block), 'a seeded condition carries triage rules');
  });

  test('only cards that exist are claimed', () => {
    // Inventing a card key here puts a screen nobody has built onto a Home tab.
    const block = seedSrc.slice(seedSrc.indexOf('const CONDITIONS = ['));
    const cards = new Set([...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));
    const built = ['glucose', 'hba1c', 'medications', 'diet_plan', 'blood_pressure'];
    for (const c of ['glucose', 'blood_pressure']) assert.ok(cards.has(c));
    // Any card mentioned must be one of the built ones.
    const mentioned = [...block.matchAll(/homeCards: \[([^\]]*)\]/g)]
      .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    for (const c of mentioned) {
      assert.ok(built.includes(c), `homeCards claims '${c}', which no screen renders`);
    }
  });

  test('the diabetes type keeps the same five values', () => {
    // So the migration is a move, not a reinterpretation.
    assert.match(seedSrc, /'type1', 'type2', 'gestational', 'prediabetes', 'none'/);
  });
});

describe('the model', () => {
  test('a condition is shared unless a practice owns it', () => {
    const c = new Condition({ key: 'asthma', names: { en: 'Asthma' } });
    assert.equal(c.practice, null);
    assert.equal(c.toPublic().isShared, true);
  });

  test('cards and rules start empty', () => {
    const c = new Condition({ key: 'asthma', names: { en: 'Asthma' } });
    assert.deepEqual(c.homeCards, []);
    assert.deepEqual(c.triageRules, []);
  });

  test('one row per person per illness', () => {
    // A change of type edits the row; a second row is a duplicate, not a
    // second diagnosis.
    const idx = PatientCondition.schema.indexes().map(([f, o]) => ({ f, o }));
    const unique = idx.find((i) => i.f.patient === 1 && i.f.condition === 1);
    assert.ok(unique, 'no patient+condition index');
    assert.equal(unique.o.unique, true);
  });

  test('"which cards" is indexed', () => {
    const idx = PatientCondition.schema.indexes().map(([f]) => f);
    assert.ok(idx.some((f) => f.patient === 1 && f.status === 1));
  });

  test('only an active condition counts as current', () => {
    // A resolved gestational diabetes must not keep a sugar chart on Home for
    // life, and a suspicion must not put one there at all.
    for (const [status, expected] of [
      [CONDITION_STATUS.ACTIVE, true],
      [CONDITION_STATUS.RESOLVED, false],
      [CONDITION_STATUS.SUSPECTED, false],
    ]) {
      const pc = new PatientCondition({
        patient: '000000000000000000000001',
        condition: '000000000000000000000002',
        status,
      });
      assert.equal(pc.isCurrent(), expected, status);
    }
  });

  test('the type of the diabetes lives on the join, not the person', () => {
    const pc = new PatientCondition({
      patient: '000000000000000000000001',
      condition: '000000000000000000000002',
      detail: { type: 'type2' },
    });
    assert.equal(pc.toPublic().detail.type, 'type2');
  });
});

describe('the migration leaves the old columns alone', () => {
  test('it never writes to diabetesType or comorbidities', () => {
    // 48 readers go on reading them, unchanged, whether this has run, half-run
    // or never run. The columns come out on a separate day.
    assert.ok(!/\$unset/.test(backfillSrc), 'the backfill unsets a field');
    assert.ok(
      !/PatientProfile\.(updateOne|updateMany|findOneAndUpdate)/.test(backfillSrc),
      'the backfill writes to PatientProfile',
    );
  });

  test('"none" does not become a diabetes row', () => {
    // It is an answer meaning "not diabetic". A row would put a sugar chart on
    // the Home screen of somebody who does not have diabetes.
    assert.match(backfillSrc, /p\.diabetesType !== 'none'/);
  });

  test('an existing row is never overwritten', () => {
    assert.match(backfillSrc, /\$setOnInsert/);
    assert.match(backfillSrc, /already recorded — left alone/);
  });

  test('the migration does not sign a diagnosis', () => {
    // Nobody recorded these; they were inferred from a column.
    assert.match(backfillSrc, /diagnosedBy: null/);
  });

  test('it refuses to run before the seed', () => {
    assert.match(backfillSrc, /Run seedConditions\.js first/);
  });
});

describe('what the assistant is told', () => {
  test('the illness and its type, not just the illness', () => {
    // An assistant answering a hypertension question out of diabetes guidance
    // is worse than one that says it does not know.
    const text = describeForPrompt({
      conditions: [
        { key: 'diabetes', name: 'Diabetes', detail: { type: 'type2' } },
        { key: 'hypertension', name: 'High blood pressure', detail: {} },
      ],
    });
    assert.equal(text, 'Diabetes (type2), High blood pressure');
  });

  test('nothing recorded says nothing, rather than guessing', () => {
    assert.equal(describeForPrompt({ conditions: [] }), null);
    assert.equal(describeForPrompt({}), null);
  });
});
