import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSystemPrompt } from '../src/services/ai/prompts.js';

/**
 * The assistant belongs to the practice it is answering for.
 *
 * ---- What every patient on the platform was told ------------------------
 *
 * The opening line was written for the first clinic and then shown to all of
 * them:
 *
 *   "You are the AI Health Assistant for ${doctorName}, Consultant Physician
 *    and Diabetologist at ${clinicName}. You support his patients..."
 *
 * Two claims nobody made. A cardiologist was introduced to their own patients
 * as a diabetologist — a credential, stated as fact, in the first sentence the
 * assistant reads — and every doctor on the platform was "his".
 *
 * The scope beneath it did the same at greater length: it named diabetes and
 * endocrinology as the doctor's areas and declined anything else as belonging
 * to another specialty. A cardiology practice's assistant refused cardiology.
 *
 * ---- Why the endocrine block did not simply become generic --------------
 *
 * It is a careful piece of clinical safety writing and it is correct for the
 * practice it was written for. Writing the cardiology equivalent from here
 * would be inventing a clinical scope no clinician has reviewed, which is the
 * same error as borrowing this one. So it stays, applied only where it is true.
 */

const base = {
  language: 'en',
  // The prompt reads `triage.urgency` unconditionally; a routine verdict is the
  // ordinary case and keeps these tests about the identity block.
  triage: { urgency: 'routine', reasons: [] },
  patientContext: '',
  groundingContext: '',
  careTeamNotes: '',
};

const promptFor = (identity, extra = {}) => buildSystemPrompt({ ...base, identity, ...extra });

describe('the assistant does not invent a specialty', () => {
  test('a practice that has said nothing gets no credential', () => {
    const prompt = promptFor({ doctorName: 'Dr Sen', clinicName: 'Meridian Clinic' });

    assert.ok(
      !/Consultant Physician and Diabetologist/.test(prompt),
      'a credential nobody claimed is still being stated as fact',
    );
    assert.match(prompt, /AI Health Assistant for Dr Sen at Meridian Clinic/);
  });

  test('and a practice that has said gets what it said', () => {
    const prompt = promptFor({
      doctorName: 'Dr Test',
      clinicName: 'Test Practice',
      specialty: 'cardiology',
    });
    assert.match(prompt, /AI Health Assistant for Dr Test, cardiology, at Test Practice/);
  });

  test('a cardiology practice is not told it is a diabetes practice', () => {
    // The failure this file exists for. The scope block asserted the doctor's
    // areas by name, so the assistant declined the practice's own subject.
    const prompt = promptFor({
      doctorName: 'Dr Test',
      clinicName: 'Test Practice',
      specialty: 'cardiology',
    });

    assert.ok(
      !/is a diabetologist and endocrinologist/.test(prompt),
      'a cardiologist is still described as a diabetologist',
    );
    assert.match(prompt, /Dr Test practises cardiology/);
  });

  test('and the endocrine scope still reaches the practice it was written for', () => {
    // The other half. Narrowing where it applies is only safe if it still
    // applies — this is a live clinic's topic limit, not a default.
    const prompt = promptFor({
      doctorName: 'Dr Amit Kumar Dey',
      clinicName: 'Dr Dey Diabetes Care',
      specialty: 'diabetology',
    });

    assert.match(prompt, /is a diabetologist and endocrinologist/);
    assert.match(prompt, /Thyroid — hypo\/hyperthyroidism/);
  });

  test('as does a practice that has not filled the field in yet', () => {
    /*
     * The founding practice predates `specialty` exactly as it predates `plan`,
     * so it reads null today. Dropping its topic limit the moment this shipped
     * would take a working clinical safeguard off a live clinic to fix a
     * cosmetic problem on a test one — so unknown keeps the scope it has always
     * had, and setting the field is what makes it deliberate.
     */
    const prompt = promptFor({ doctorName: 'Dr Amit Kumar Dey', clinicName: 'Dr Dey Diabetes Care' });
    assert.match(prompt, /is a diabetologist and endocrinologist/);
  });

  test('every specialty spelling that means endocrine keeps the endocrine scope', () => {
    // A near-match must not silently drop the topic limit, so the test names
    // the spellings an operator would plausibly type.
    for (const spelling of ['diabetology', 'Diabetes & Endocrinology', 'endocrinology', 'metabolic medicine']) {
      assert.match(
        promptFor({ doctorName: 'Dr Dey', clinicName: 'C', specialty: spelling }),
        /is a diabetologist and endocrinologist/,
        `"${spelling}" lost the endocrine scope`,
      );
    }
  });
});

describe('and it does not assume the doctor is a man', () => {
  test('no third-person pronoun for the doctor anywhere in the prompt', () => {
    /*
     * "You support his patients between visits", and "his areas of practice"
     * in the scope beneath it. Written for one doctor, shown to every practice
     * on the platform — and read by their patients.
     */
    const prompt = promptFor({
      doctorName: 'Dr Priya Nair',
      clinicName: 'Nair Heart Clinic',
      specialty: 'cardiology',
    });

    assert.ok(!/\bhis\b/i.test(prompt), 'the prompt still calls the doctor "his"');
    assert.ok(!/\bher\b|\bhers\b/i.test(prompt), 'the prompt guesses the other way instead');
    assert.match(prompt, /support their patients/);
  });

  test('including on the practice whose scope names the doctor repeatedly', () => {
    const prompt = promptFor({ doctorName: 'Dr Dey', clinicName: 'C', specialty: 'diabetology' });
    assert.ok(!/\bhis\b/i.test(prompt), 'the endocrine scope still says "his areas of practice"');
  });
});
