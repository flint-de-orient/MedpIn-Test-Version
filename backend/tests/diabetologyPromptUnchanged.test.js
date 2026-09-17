import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { buildSystemPrompt } from '../src/services/ai/prompts.js';
import { buildScopeBlock } from '../src/services/ai/departmentAssistant.js';

/**
 * The diabetology assistant reads exactly as it did before scopes were reviewed.
 *
 * ---- Why fingerprints -------------------------------------------------------
 *
 * Reviewed scopes, red flags, per-practice approval and department-scoped
 * retrieval all touch the files this prompt is built in. The founding clinic's
 * patients are answered by that prompt today, and "nothing changed for them" is
 * a claim worth proving rather than asserting: these sha256 fingerprints were
 * taken from the prompt as the code built it before any of that work, and every
 * one must still match.
 *
 * Two prompts are covered. The legacy one, with no department block, is every
 * conversation on the founding clinic today. The department one, built from the
 * diabetology scope in scripts/seedDepartments.js, is a thread that names the
 * diabetology department. Each in three languages, for a routine and an
 * emergency verdict, with and without a clinic number.
 *
 * If a change to these prompts is intended, it is a clinical change: have it
 * reviewed, then take new fingerprints.
 */

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const seed = readFileSync(new URL('../scripts/seedDepartments.js', import.meta.url), 'utf8');
function diabetologyRow() {
  const start = seed.indexOf('const DEPARTMENTS = [');
  const end = seed.indexOf('\n];', start);
  // eslint-disable-next-line no-new-func
  const rows = new Function(`${seed.slice(start, end + 3)}; return DEPARTMENTS;`)();
  return rows.find((d) => d.key === 'diabetology');
}

const BLOCKS = {
  en: '7696620f0559b1bb707ade410c20c229713a19632cbd1260ff20a6a6d41ef653',
  bn: 'd1d3b1b4e47cd0839d4c28bd9e7d43b76f1beba69d4a853260be46ec6e24d22d',
  hi: 'b107d336db8d29a1c3165a5c89a0756578d72229abd6701025fa255e444d0814',
};

const PROMPTS = {
  'legacy|en|routine|diabetology': '63718ded6cf4917ae1911c8e4e8296291380a26c63bd053e79628d1fea6f8772',
  'department|en|routine|diabetology': 'cc0a8356c67a9a7a71ac858c1418183d331c0d49bc0bf452b1651cf129d136c9',
  'legacy|en|routine|noNumber': 'b69c67ebfa86f32f2cfb7a443e6902858eeff38df0dc562637884d641314d4b0',
  'department|en|routine|noNumber': 'b4307e809baff584d8bb68750f2c51a19f049f2b6ea8fea34e2adc769c850478',
  'legacy|en|emergency|diabetology': '9e22ee0c7e8d4c4b452d031f3543c56c3859f5a251704070261a6b2fe895693e',
  'department|en|emergency|diabetology': '074271284ba306bd256ff7771587847bc82c33d26103993842df22cf948604ff',
  'legacy|en|emergency|noNumber': '88183153276d91898246806feed69917e02788029f34f7c05b121dac32ecd722',
  'department|en|emergency|noNumber': 'e8035d3a62563f54fe6584509591b2ea8729641ed947a28e0305b4741f948522',
  'legacy|bn|routine|diabetology': '08500279e79d8329a317cd1f965e198f493f75df5f3bb1d20d78fbe2d20f0562',
  'department|bn|routine|diabetology': '2e73e1b30e49825a600e2e61bb28f04b9515d09d4b09b428c37f42860991dd71',
  'legacy|bn|routine|noNumber': '7cde812c2b4628005a1be8615f6b7abd8ddea11d0988b541f8c8382000a8d901',
  'department|bn|routine|noNumber': 'e1cd1d82dbf4e6ee6a1dd22f9ea601df8e39b6d8d9ef7ead62e07bb33a08de24',
  'legacy|bn|emergency|diabetology': '7e2abec95172bee40cfd2df33f90b4c0784be09215f7c23d61963d9021a44155',
  'department|bn|emergency|diabetology': '9424d62e45cc201f41c6fc4ad48e096b0f9e074b3b15266b27f2b9acce0d247e',
  'legacy|bn|emergency|noNumber': '0350bcf838cc89578c508033a2cb689f3c28d14919da029ef1271d43ebc45df7',
  'department|bn|emergency|noNumber': '05b2f7d33edbc65385c259c40b4764532f5a0bfec4757ac9ccaf684de5da766e',
  'legacy|hi|routine|diabetology': '6917446aaee320e5f1df9b21218412710214cb17da1e5ae538412900450c4c79',
  'department|hi|routine|diabetology': '7c3a6bc10d6f0b3b8876ba71cbf72022a1fe21e249fea296710e3feb0c2bbb4d',
  'legacy|hi|routine|noNumber': '618614816b6ea5e02e4272d892cdadddbf900dd349038d29960fc8021dc586a7',
  'department|hi|routine|noNumber': '1e9b2b12718c6cd0778c28db38dee150b062c28c99b412203e88dbc149d22a27',
  'legacy|hi|emergency|diabetology': '292f496b2b5748ab0aab6bf84bfd7591d8f28890731c32af06e9b62f1f125de0',
  'department|hi|emergency|diabetology': '5434742fe433d34a1bc4f0b955b073bf1efc6885d176e27c877c233fdab081cb',
  'legacy|hi|emergency|noNumber': '71f620ef0f876d0c696662640ea4bafa2e12e1713ce3290a478067a2fc1c2e68',
  'department|hi|emergency|noNumber': '3fbdf8c32bbcf9fbc9b6d1f6481157a6a724cc81042e32d066bdc4085ff1e747',
};

const TRIAGES = {
  routine: { urgency: 'routine', findings: [] },
  emergency: {
    urgency: 'emergency',
    findings: [{ summary: 'Chest pain or pressure' }, { summary: 'Blood sugar 42 mg/dL is severely low (below 54).' }],
  },
};

// Only identities that name their own number, or say they have none: a
// fingerprint must not depend on a deployment's environment defaults.
const IDENTITIES = {
  diabetology: { doctorName: 'Dr Test', clinicName: 'Test Clinic', specialty: 'diabetology', emergencyPhone: '+913300000000' },
  noNumber: { doctorName: 'Dr Test', clinicName: 'Test Clinic', emergencyPhone: null },
};

const NO_CONDITIONS = { homeCards: [], triageRules: [], conditions: [] };

describe('the diabetology assistant’s prompt did not move', () => {
  const row = diabetologyRow();
  const department = { ...row, assistantScope: { ...row.assistantScope, redFlags: [] } };

  for (const language of ['en', 'bn', 'hi']) {
    test(`the diabetology department block, ${language}`, () => {
      const block = buildScopeBlock({ department, role: row.assistantScope.role, conditions: NO_CONDITIONS, language });
      assert.equal(sha(block), BLOCKS[language]);
    });

    for (const [triageName, triage] of Object.entries(TRIAGES)) {
      for (const [identityName, identity] of Object.entries(IDENTITIES)) {
        test(`both prompts, ${language}, ${triageName}, ${identityName}`, () => {
          const base = {
            language,
            triage,
            patientContext: 'Type 2 diabetes. Latest HbA1c 7.8%.',
            groundingContext: '[1] What to do when blood sugar is low\nTake 15 grams of fast-acting sugar.',
            careTeamNotes: '- Dr Test: walk after dinner',
            identity,
          };
          const block = buildScopeBlock({ department, role: row.assistantScope.role, conditions: NO_CONDITIONS, language });

          assert.equal(sha(buildSystemPrompt(base)), PROMPTS[`legacy|${language}|${triageName}|${identityName}`], 'the legacy prompt changed');
          assert.equal(
            sha(buildSystemPrompt({ ...base, departmentBlock: block })),
            PROMPTS[`department|${language}|${triageName}|${identityName}`],
            'the diabetology department prompt changed',
          );
        });
      }
    }
  }

  test('the seeded diabetology row carries no red flags, so its block has no new section', () => {
    assert.ok(!/redFlags/.test(seed.slice(seed.indexOf("key: 'diabetology'"), seed.indexOf("key: 'cardiology'"))));
  });
});
