import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildSystemPrompt, fallbackReply } from '../src/services/ai/prompts.js';

/**
 * The clinic's name and the doctor's name come from the practice, not the
 * environment.
 *
 * These exist because `clinicIdentity()` was written to be the single source of
 * truth for both, complete with a cache and a comment saying it was "read on
 * every prescription and every AI turn" — and nothing called it. Every prompt
 * and the prescription letterhead went on reading `env.CLINIC_NAME` directly.
 *
 * For one clinic that is invisible: the env default happens to be the right
 * name. For the second practice it is fatal, and quietly so — their patients
 * would open the assistant and read that it works for a doctor they have never
 * met, and be refused anything outside his specialty.
 *
 * So the wiring is pinned here. A new service that reaches for the env var
 * instead of the identity fails this file rather than shipping.
 */

const SERVICES = fileURLToPath(new URL('../src/services/', import.meta.url));

/** Every .js under src/services, recursively. */
function serviceFiles(dir = SERVICES) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return serviceFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
}

describe('nothing reads the clinic brand out of the environment', () => {
  test('every env read is a fallback behind the resolved identity', () => {
    // The env vars are allowed to survive as the last resort — they are what a
    // fresh deployment has before anyone fills in a profile. What is not
    // allowed is reading them *instead of* asking.
    const offenders = [];

    for (const file of serviceFiles()) {
      if (file.endsWith(path.join('services', 'clinicIdentity.js'))) continue;
      const src = readFileSync(file, 'utf8');

      src.split('\n').forEach((line, i) => {
        if (!/env\.(CLINIC_NAME|DOCTOR_DISPLAY_NAME)/.test(line)) return;
        // A fallback looks like `identity?.x || env.Y` or `a ?? b ?? env.Y`.
        const isFallback = /(\|\||\?\?)\s*env\.(CLINIC_NAME|DOCTOR_DISPLAY_NAME)/.test(line);
        if (!isFallback) {
          offenders.push(`${path.relative(SERVICES, file)}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }

    assert.deepEqual(offenders, [], `\n  ${offenders.join('\n  ')}\n`);
  });

  test('the assistant asks for the identity before building a prompt', () => {
    const src = readFileSync(new URL('../src/services/ai/assistant.js', import.meta.url), 'utf8');
    const prompts = (src.match(/buildSystemPrompt\(\{/g) ?? []).length;
    // And resolved for this patient's practice. Asked with no argument it was
    // the first clinic on the platform's, which this used to count as resolved.
    const resolves = (
      src.match(/await clinicIdentity\(null, \{ practiceId: await practiceForPatient\(patientId\) \}\)/g) ?? []
    ).length;
    assert.ok(prompts > 0, 'no prompt is built here any more — has this moved?');
    assert.equal(resolves, prompts, 'a prompt is built without this patient’s practice’s identity');
  });

  test('no service asks for an identity without saying whose', () => {
    // The bare call is the platform's first clinic. A caller that knows a
    // location or a practice passes it; one that knows neither has no business
    // naming a clinic to a patient.
    const offenders = [];
    for (const file of serviceFiles()) {
      if (file.endsWith(path.join('services', 'clinicIdentity.js'))) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
        if (/\b(clinicIdentity|identitySnapshot)\(\s*(null\s*)?\)/.test(line)) {
          offenders.push(`${path.relative(SERVICES, file)}:${i + 1}  ${line.trim().slice(0, 70)}`);
        }
      });
    }
    assert.deepEqual(offenders, [], `\n  ${offenders.join('\n  ')}\n`);
  });

  test('the prescription letterhead is snapshotted, not re-read', () => {
    // A prescription is a record of what was printed that day. Rendering the
    // *current* name every time it is opened would let a settings screen
    // silently re-letterhead every prescription ever issued.
    const src = readFileSync(new URL('../src/services/prescriptionPdf.js', import.meta.url), 'utf8');
    assert.match(src, /identitySnapshot\(null, \{ practiceId \}\)/);
    // Lettered by the practice that issued it — see identityPerPractice.test.js.
    assert.match(src, /const identity = await letterheadIdentityFor\(prescription\)/);
    assert.match(src, /letterhead: letterheadToPersist/);
    // The number goes with it, and the document prints that rather than the
    // configured one — identityPerPractice.test.js is about whose number it is.
    assert.match(src, /emergencyPhone: identity\.emergencyPhone \?\? null/);
    assert.match(src, /identity\?\.emergencyPhone !== undefined \? identity\.emergencyPhone : clinicEmergencyPhone\(\)/);
    // Persisted in the same write as the file it describes, so the two can
    // never disagree.
    assert.match(src, /pdfFile: asset\._id, \.\.\.\(letterheadToPersist/);
  });
});

describe('a second practice gets its own assistant', () => {
  const other = { doctorName: 'Dr. Meera Iyer', clinicName: 'Lake Town Heart Centre' };

  test('the system prompt names the practice that was passed in', () => {
    const prompt = buildSystemPrompt({
      language: 'en',
      triage: { urgency: 'routine' },
      patientContext: '',
      groundingContext: '',
      careTeamNotes: '',
      identity: other,
    });

    assert.ok(prompt.includes('Dr. Meera Iyer'), 'the prompt does not name the passed doctor');
    assert.ok(prompt.includes('Lake Town Heart Centre'), 'the prompt does not name the passed clinic');
    assert.ok(
      !prompt.includes('Amit Kumar Dey'),
      'another practice’s assistant still introduces itself as Dr. Dey',
    );
  });

  test('the outage message names the right doctor too', () => {
    // The fallback replies are a module-level constant evaluated once at load,
    // which is exactly why they needed a placeholder rather than a baked name.
    const reply = fallbackReply('unavailable', 'en', other);
    assert.ok(reply.includes('Dr. Meera Iyer'));
    assert.ok(!reply.includes('Amit Kumar Dey'));
  });

  test('with no identity it still reads as it always did', () => {
    // The single-clinic deployment running today passes nothing and must be
    // unchanged. This is the whole safety argument for the rewiring.
    const prompt = buildSystemPrompt({
      language: 'en',
      triage: { urgency: 'routine' },
      patientContext: '',
      groundingContext: '',
      careTeamNotes: '',
    });
    assert.ok(prompt.includes('Amit Kumar Dey'), 'the env fallback stopped working');
  });

  test('an empty saved name falls through instead of blanking the prompt', () => {
    // `||` not `??`. A practice saved with an empty doctor name should read as
    // the configured one, not introduce an assistant working for nobody.
    const prompt = buildSystemPrompt({
      language: 'en',
      triage: { urgency: 'routine' },
      patientContext: '',
      groundingContext: '',
      careTeamNotes: '',
      identity: { doctorName: '', clinicName: '' },
    });
    assert.ok(prompt.includes('Amit Kumar Dey'));
  });
});
