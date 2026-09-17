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
 *
 * Retaken once, at the merge with C10 (practice identity): the only change is
 * the example attribution in the care-team block, "Dr. Dey told you..." to
 * "Your doctor told you...". Putting that one line back reproduces every
 * earlier fingerprint exactly, which was checked before these were written.
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
'legacy|en|routine|diabetology': 'eeb872c09ac4bcd862c239e7c412631851176702852b323b7825bfbb5b20f63a',
  'department|en|routine|diabetology': 'abc1eb812616503eb0cc625b0614d81cdb6987624488c5539c9332be96fa0601',
  'legacy|en|routine|noNumber': '425c81ffa9cc20733ba75cfc97ef736d1bc4c5b0522d9b6f4f87060b9c7b9711',
  'department|en|routine|noNumber': '2e7ed5096677594462b17d69d5c16d1db545f23af49348fff88fcabb23b01249',
  'legacy|en|emergency|diabetology': '3596ca0c4e01aebdd7590d23fc173143442fd7793399976f1a3de7e04d10927d',
  'department|en|emergency|diabetology': '1198067f6f1f71d72dd32801ac214cf6debcf86f30948899c6f100363d745eb6',
  'legacy|en|emergency|noNumber': 'be0522d134681ffc440052c2c0c060e2fc35b009d4d4c8a808b4ec7d93a7f277',
  'department|en|emergency|noNumber': 'dc538e91d917f65460a91b2ae7bed9c16df73bc8aa7bf0d758ab546f4c4911d5',
  'legacy|bn|routine|diabetology': '9a8b20aa33ebde1b7d30c9d6439583fec127d6510e207529f6ac845e36a8886a',
  'department|bn|routine|diabetology': '2afc9a16c2896947f6fe9194c8b27ff2663e3d8ef68b467a815883c682e06eb0',
  'legacy|bn|routine|noNumber': '5f190c5a3f71c874eeac789a1313b72a60162349abd439c60c5496f5edf4216e',
  'department|bn|routine|noNumber': '0a726f70cc8b0a0ef10243ca6ab54b4f9f4509ff52d935c70c4daf5a95c98d9c',
  'legacy|bn|emergency|diabetology': '4f7d75a93dfdff8c136f010ae711024ad5e2ae4197f6bcfc3358cd58c88439d5',
  'department|bn|emergency|diabetology': 'd0e59360b5edc0a2fe4dec63145a6a827d07c807090660cc90acfcaeaa6e24ed',
  'legacy|bn|emergency|noNumber': '05e848a5009887537f71a4170f24385653f29f311a2c96975ec39c9776707f53',
  'department|bn|emergency|noNumber': 'c0dc73ee184a3dc32c0b0eb1d77b4535c8c90e97ba10b9d2365ee2447e0f3851',
  'legacy|hi|routine|diabetology': 'a8b10b5dcc9257efaced1ea9bf042776b94ca3e7fe6bf2218a18ec8f0115c5ab',
  'department|hi|routine|diabetology': 'd557c3871d4749dd4354408f5cf3f21f58478ab13acc46c64fff837cd6d0f3de',
  'legacy|hi|routine|noNumber': '37ef70cb1a7b25387be5e5b700d00ff439fbaf2e9c41753cc73a4f8d0554ece2',
  'department|hi|routine|noNumber': 'fb87524322a60da340e1d56998590e84eeff3d55c7e422966d696fad657bbefe',
  'legacy|hi|emergency|diabetology': '07437d66ffd270fed6839b8fa0edbc5cafcd6afa3ded672c0213cd7ba3537702',
  'department|hi|emergency|diabetology': 'a609d68155566fc859754df588f0e76babbadbbebb21e32fe1d80bf36f5ac0d0',
  'legacy|hi|emergency|noNumber': '3bf8992864c1554416cc22c812cd4497f12f4f373bdc6e91ef5f3c9c11441aef',
  'department|hi|emergency|noNumber': '66b39c818a1371d56e61ca389a275e561fc9b9abb789b59881dba3241c7e0d9c',
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
