import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../src/services/ai/prompts.js';
import { buildScopeBlock } from '../src/services/ai/departmentAssistant.js';
import { AI_DRAFT_SCOPES } from '../src/knowledge/aiDrafts.js';

/**
 * What the cardiology and general-medicine assistants are told, once approved.
 *
 * Their scope — who they are, what they cover, what they refuse, and their
 * specialty's red flags — and, unchanged beneath it, every platform safety rule:
 * the triage verdict is authoritative, doses are never changed, diagnoses are
 * never made, dangerous symptoms always escalate. A department decides the
 * subject; it does not get to decide any of those.
 */

const base = {
  language: 'en',
  triage: { urgency: 'routine', findings: [] },
  patientContext: '',
  groundingContext: '[1] A passage',
  careTeamNotes: '',
  identity: { doctorName: 'Dr Test', clinicName: 'Test Clinic', emergencyPhone: null },
};

const NAMES = { cardiology: 'Cardiologist', general_physician: 'General Physician' };

for (const draft of AI_DRAFT_SCOPES) {
  describe(`the ${draft.departmentKey} assistant's prompt`, () => {
    const department = {
      key: draft.departmentKey,
      names: { en: NAMES[draft.departmentKey] },
      assistantScope: draft,
    };
    const block = buildScopeBlock({
      department,
      role: draft.role,
      conditions: { conditions: [] },
      language: 'en',
    });
    const prompt = buildSystemPrompt({ ...base, departmentBlock: block });

    test('carries its whole scope', () => {
      assert.ok(block.startsWith(`You are ${draft.role} for the ${NAMES[draft.departmentKey]} department.`));
      for (const line of [...draft.covers, ...draft.refuses, ...draft.redFlags]) {
        assert.ok(prompt.includes(`- ${line}`), `missing from the prompt: ${line}`);
      }
      assert.match(prompt, /## Signs that mean hospital now in this specialty/);
      assert.match(prompt, /treat it as an emergency even if the triage/);
      assert.match(prompt, /Anything outside this department/);
    });

    test('keeps every platform safety rule', () => {
      for (const rule of [
        'No dose changes',
        'No new diagnoses',
        'No interpreting reports the doctor has not discussed',
        'Never stop a long-term steroid or a beta blocker',
        'A dangerous symptom is always escalated',
        'Its verdict is authoritative',
        'You must NEVER downplay, soften, or argue against the verdict',
        'If the grounded knowledge below does not cover the question, say you do not have approved guidance',
      ]) {
        assert.ok(prompt.includes(rule), `the safety rule "${rule}" is missing`);
      }
    });

    test('does not inherit the diabetes remit', () => {
      assert.ok(!prompt.includes('is a diabetologist and endocrinologist'));
      assert.ok(!prompt.includes('Cushing'));
    });

    test('an emergency verdict still overrides the specialty', () => {
      const emergency = buildSystemPrompt({
        ...base,
        triage: { urgency: 'emergency', findings: [{ summary: 'Chest pain or pressure' }] },
        departmentBlock: block,
      });
      assert.match(emergency, /Urgency: EMERGENCY/);
      assert.match(emergency, /go to the nearest hospital/);
    });
  });
}
