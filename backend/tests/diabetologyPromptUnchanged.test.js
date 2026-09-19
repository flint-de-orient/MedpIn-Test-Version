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
'legacy|en|routine|diabetology': '5f51e5602194949aa73497f37007a8c48cf9144b27188157da440eaf04b52b67',
  'department|en|routine|diabetology': '55880554c750ba2920742986b8e5682a60d9faa4d335590139e8cdee369f4eb2',
  'legacy|en|routine|noNumber': 'f5d9f057d06b701b02ac120ddafce7c813c0b50f533e972e0ecfa1b234642c9f',
  'department|en|routine|noNumber': 'aa0b1118c7a7249b24aadbccae98a2d500ef56f7ff26c0e9d3944ef20c334ec5',
  'legacy|en|emergency|diabetology': '9be4302c6b1ecdeac26f00b4e763ae78a6bf48d614310b2d93a26c9bbd3d4f47',
  'department|en|emergency|diabetology': '2c67703c8c944ee3a0d6f6143a5b67d919785c0fe25bddf760bbaf474445e9e5',
  'legacy|en|emergency|noNumber': 'c3679ffc9adce9a3678bfdd6ccde8f2729bd6d5b370f10981dfdbbd636d1b1cb',
  'department|en|emergency|noNumber': '3c571aa27290d11ee047d18f99028eb1a74fd314659305c188a7bdd41c939d9b',
  'legacy|bn|routine|diabetology': '4f54cf405e7962bbf8af3dc80c445ddfe3e51a2f8cb3fd0a2c0576810a462066',
  'department|bn|routine|diabetology': '8c5787ffc229c4efb0c984ec9a4bff8d23befde0915b058db25e93fe804e5de3',
  'legacy|bn|routine|noNumber': '2d7c00cd6d6c54626d8c1e34b727aa05b1378eec76eaa22af705ba3da37bb289',
  'department|bn|routine|noNumber': '1fa03ce453990424597a7d1d1299c6a2e73f6488ef051888ab3d4a8822961f94',
  'legacy|bn|emergency|diabetology': '56246b4ef3d655d24c5a74a63632c328c588ec0522b5c16f5e6b1ddf88c46021',
  'department|bn|emergency|diabetology': '72ea5eb902c8cab967c9cec7a1f2b0ceaeb690d0e5436115d8bf91a8e8c24a0c',
  'legacy|bn|emergency|noNumber': 'f9b3a0d878acc0dd1ac5f00c84865a9824d5026b4539b0a3be735f03885aea0b',
  'department|bn|emergency|noNumber': 'ee66bd13ac2c0f6e48acf2e6dcb01243d650ccceca7d91ad644a55a0b966f821',
  'legacy|hi|routine|diabetology': '77a83643ee0914817837155c9d5cea8293f13f4b70b0fdb06ad4d29f66842e52',
  'department|hi|routine|diabetology': '803a2989dc583296a677f823693a8a719db0b93a53334769dbdf5e6289dd5735',
  'legacy|hi|routine|noNumber': 'fb0ae57e255d683ac54bbf8121ad0262c8a1814ffb52683d4ecb29e1b02d7c77',
  'department|hi|routine|noNumber': '4c6ba00a16f153f3e4148f72341136c6a87d6c3cf210f715c90ea8d6cbcd82af',
  'legacy|hi|emergency|diabetology': 'cb7fab7b4ba9feca01e7014b8394ca8629a450917d6128785ed8499914ef8daf',
  'department|hi|emergency|diabetology': '41088499e5e91e9b8a967e27e4533690fe61219c46c18694263adb74dc1b5281',
  'legacy|hi|emergency|noNumber': '9852ed5e7d13a21ef01f81bf3df72296f2cb95fdaa860a2d2163d5e3c5c0643d',
  'department|hi|emergency|noNumber': 'e93b5aae9c0ebc140ea04a973077aad51601c2d79ec5cfe80e39bdc9663c7c65',
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
            // The patient's own doctor (careDoctor.js), and whether an alert
            // was raised, as the assistant passes them. The identity's
            // doctorName is no longer read.
            careDoctorName: 'Dr Test',
            alerted: triageName !== 'routine',
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
