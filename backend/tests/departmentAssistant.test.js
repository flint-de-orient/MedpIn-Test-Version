import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { Department } from '../src/models/Department.js';
import { KnowledgeChunk } from '../src/models/KnowledgeChunk.js';
import { buildSystemPrompt } from '../src/services/ai/prompts.js';

/**
 * One assistant per department, or none.
 *
 * There was one assistant and it was a diabetologist. Its prompt names its
 * areas of practice and then refuses, by name, "a skin rash, a cough or cold, a
 * broken bone, an eye infection, mental-health matters unrelated to diabetes, a
 * child's illness, or anything belonging to another specialty".
 *
 * Exactly right for Dr. Dey, whose patients all have diabetes. Fatal for the
 * dermatology practice whose patients are told their rash is out of scope by an
 * assistant introducing itself as somebody else's doctor.
 */
const service = readFileSync(
  new URL('../src/services/ai/departmentAssistant.js', import.meta.url),
  'utf8',
);
const rag = readFileSync(new URL('../src/services/ai/rag.js', import.meta.url), 'utf8');
const seed = readFileSync(new URL('../scripts/seedDepartments.js', import.meta.url), 'utf8');

const base = {
  language: 'en',
  triage: { urgency: 'routine' },
  patientContext: '',
  groundingContext: '',
  careTeamNotes: '',
};

describe('no scope means no assistant, not a general one', () => {
  test('a department without a scope reports it has none', () => {
    const d = new Department({ key: 'cardiology', names: { en: 'Cardiologist' } });
    assert.equal(d.toPublic().hasAssistant, false);
  });

  test('one with a role reports it has one', () => {
    // A written scope is live — there is no approval step. Whether it answers a
    // given conversation is asked of assistantAvailability.js, which also needs
    // its guidance to be there, and the route passes that answer in.
    const d = new Department({
      key: 'derm',
      names: { en: 'Dermatologist' },
      assistantScope: { role: 'a dermatology assistant' },
    });
    assert.equal(d.toPublic().hasAssistant, true);
    assert.equal(d.toPublic('en', { assistant: { enabled: false } }).hasAssistant, false);
  });

  test('the service returns null rather than falling back', () => {
    // Returning a general assistant here is the entire bug this module exists
    // to prevent. An assistant improvising cardiology answers out of diabetes
    // guidance is worse than none — it is fluent, so neither the patient nor
    // the doctor skimming the thread can tell it is guessing.
    assert.match(service, /if \(!role\) return null;/);
    assert.match(service, /No scope, no assistant/);
  });

  test('whether a department answers is asked of one function, not worked out here', () => {
    // departmentHasAssistant read the role alone, which a scope still awaiting
    // review also has, and nothing called it. The answer now lives in
    // assistantAvailability.js — assistantAvailability.test.js runs it against a
    // real database — and the prompt context asks it before building anything.
    assert.ok(!/export async function departmentHasAssistant/.test(service), 'a second answer to "is there an assistant" is back');
    assert.match(service, /const availability = status \?\? \(await assistantStatus\(\{ department: row, practiceId, language \}\)\);/);
    assert.match(service, /if \(!availability\.enabled\) return null;/);
  });

  test('a written scope is live whatever its review status — only a retired one is not', () => {
    // There is no approval step; see scopeReviewFor in guidanceReview.js.
    const waiting = new Department({
      key: 'cardiology',
      names: { en: 'Cardiologist' },
      assistantScope: { role: 'the cardiology assistant', status: 'pending_review', version: 1 },
    });
    assert.equal(waiting.toPublic().hasAssistant, true);
    const retired = new Department({
      key: 'cardiology',
      names: { en: 'Cardiologist' },
      assistantScope: { role: 'the cardiology assistant', status: 'retired', version: 1 },
    });
    assert.equal(retired.toPublic().hasAssistant, false, 'a retired scope reads as a live assistant');
  });
});

describe('the prompt is the department, not the clinic', () => {
  test('a department block replaces the diabetes remit entirely', () => {
    const derm = buildSystemPrompt({
      ...base,
      departmentBlock: 'You are a dermatology assistant for the Dermatology department.',
    });
    assert.ok(derm.includes('dermatology assistant'));
    assert.ok(
      !derm.includes('diabetologist and endocrinologist'),
      'the diabetes remit survived into another specialty’s prompt',
    );
    assert.ok(!derm.includes('a skin rash'), 'dermatology is still refusing skin rashes');
  });

  test('no block keeps exactly the remit the assistant has always had', () => {
    // Dr. Dey's clinic must read identically until a scope is seeded for his
    // department.
    const dey = buildSystemPrompt(base);
    assert.ok(dey.includes('diabetologist and endocrinologist'));
    assert.ok(dey.includes('Cushing'));
  });

  test('the safety rules survive both paths', () => {
    // The department decides the subject. It does not get to decide whether
    // dose changes are refused or whether a dangerous symptom escalates.
    for (const p of [buildSystemPrompt(base), buildSystemPrompt({ ...base, departmentBlock: 'x' })]) {
      assert.ok(p.includes('No dose changes'), 'dose rule missing');
      assert.ok(p.includes('No new diagnoses'), 'diagnosis rule missing');
      assert.ok(p.includes('always escalated'), 'escalation override missing');
    }
  });

  test('a scoped department still states a limit even when it lists none', () => {
    // An assistant with no stated limit answers anything asked of it.
    assert.match(service, /## What you do NOT help with/);
    assert.match(service, /Anything outside this department/);
  });

  test('the patient’s own conditions go into the prompt', () => {
    // A four-year-old is not a small adult, and an assistant that does not know
    // which illnesses it is speaking about gives advice for the wrong one.
    assert.match(service, /describeForPrompt\(conditions\)/);
    assert.match(service, /Recorded conditions:/);
  });
});

describe('the seeded scope is the real one, moved not invented', () => {
  test('diabetology carries the remit lifted from the prompt file', () => {
    assert.match(seed, /assistantScope: \{/);
    assert.match(seed, /role: 'the AI health assistant'/);
    assert.match(seed, /Thyroid — hypo and hyperthyroidism/);
  });

  test('no other department claims a scope it has not earned', () => {
    // Eight specialties nobody has written for. Inventing "you are a
    // cardiology assistant, you cover hearts" would be a clinical claim made by
    // whoever wrote the seed file.
    assert.equal((seed.match(/assistantScope: \{/g) ?? []).length, 1);
  });
});

describe('knowledge is filtered before ranking', () => {
  test('a chunk knows whose it is and which specialty it serves', () => {
    const paths = Object.keys(KnowledgeChunk.schema.paths);
    assert.ok(paths.includes('practice'), 'chunks are not scoped to a practice');
    assert.ok(paths.includes('department'), 'chunks are not scoped to a department');
    assert.equal(KnowledgeChunk.schema.path('practice').options.default, null);
  });

  test('the filter is applied in the query, not to the results', () => {
    // A passage ranked and then discarded has already been read: the model saw
    // it, and the retrieval it was cut from is not the retrieval that happened.
    assert.match(rag, /function scopeFilter/);
    assert.match(rag, /status: 'approved', \.\.\.scopeFilter\(\{ practice, department \}\)/);
  });

  test('every retrieval path is scoped, not just the ones that usually run', () => {
    // Atlas vector search, the in-process cosine fallback, and the text search
    // both fall back to when embedding fails. Scoping one would leak on
    // whichever deployment used another — and this counted two while the text
    // search, which only runs during an outage, searched every practice's
    // passages. ragFallbackScope.test.js runs that path for real.
    assert.equal(
      (rag.match(/scopeFilter\(\{ practice, department \}\)/g) ?? []).length,
      3,
      'a retrieval path is unscoped',
    );
    assert.match(rag, /return textSearch\(query, \{ limit, language, practice, department \}\)/);
  });

  test('null practice means shared, null department means all', () => {
    // Hypoglycaemia advice is as true in cardiology as in diabetology.
    assert.match(rag, /\$or: \[\{ practice: null \}, \{ practice \}\]/);
    assert.match(rag, /\$or: \[\{ department: null \}, \{ department \}\]/);
  });

  test('with no practice given, only shared content is searched', () => {
    // The safe default: a caller that forgets to pass a practice gets the
    // platform's own material, never another clinic's.
    assert.match(rag, /else clauses\.push\(\{ practice: null \}\);/);
  });
});
