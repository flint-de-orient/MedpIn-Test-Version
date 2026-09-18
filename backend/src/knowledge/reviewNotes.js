/**
 * What a doctor should know before approving a specialty's assistant, in the
 * doctor's own terms.
 *
 * ---- Why these exist ------------------------------------------------------------
 *
 * One approval switches on a whole knowledge base — every passage, in three
 * languages. That is the right amount of work to ask of a busy doctor, and it
 * means a disagreement buried in passage 23 is approved along with the rest
 * unless somebody puts it in front of them. These are those disagreements: the
 * places where a drafted passage and the specialist guidance it was checked
 * against differ, and the parts that were machine-made. Shown on the assistant's
 * card and again in the approval dialog.
 *
 * They are notes, not rewrites. Which of two sound positions a practice follows
 * is the practice's clinical decision; a passage it disagrees with can be edited
 * or retired on the knowledge screen before approving, and an edited copy is
 * kept as the practice wrote it.
 *
 * `docIds` name the English passages; each has a Bengali and a Hindi version.
 * The evidence for every guideline statement quoted here is in
 * specialistEvidence.js or was recorded when the guideline was opened.
 */

const TRANSLATION_NOTE = Object.freeze({
  title: 'Bengali and Hindi versions are machine translations',
  detail:
    'Every passage has a Bengali and a Hindi version, translated from the checked English and not yet read ' +
    'by a clinician in those languages. Ask a colleague who reads each language to look through them — ' +
    'the phrases the translation flagged as hardest are listed in src/knowledge/translations/REVIEW.md.',
  docIds: Object.freeze([]),
});

export const REVIEW_NOTES = Object.freeze({
  cardiology: Object.freeze([
    Object.freeze({
      title: 'Angina that is getting worse, and chest pain that comes and goes',
      detail:
        'The drafts say to contact the clinic the same day when angina is worse, more frequent, longer or comes on ' +
        'at rest, and for chest pain that comes and goes — as the NHS advises. ESC 2023 (acute coronary syndromes) ' +
        'and ESC 2024 (chronic coronary syndromes) treat these as possible unstable angina needing emergency ' +
        'assessment. Decide which your practice follows before approving. Independently of the wording, the app ' +
        'escalates angina that does not settle as an emergency.',
      docIds: Object.freeze(['cardio-angina', 'cardio-bp-emergency']),
    }),
    Object.freeze({
      title: 'Limiting fluids in heart failure',
      detail:
        'The draft says patients may be asked to limit how much they drink. ESC 2026 (heart failure) says no ' +
        'evidence supports fluid restriction in chronic heart failure, and reserves it for individual cases.',
      docIds: Object.freeze(['cardio-hf-self-care']),
    }),
    Object.freeze({
      title: 'What “good” cholesterol does',
      detail:
        'The draft says HDL “may make you less likely” to have heart problems. ESC 2021 and CSI 2024 treat HDL as ' +
        'a marker of lower risk, not something that lowers risk itself.',
      docIds: Object.freeze(['cardio-cholesterol-basics']),
    }),
    Object.freeze({
      title: 'Muscle aches on statins',
      detail:
        'The drafts list muscle aches as a common statin side effect. ESC 2021 says most muscle aches in people ' +
        'taking statins are not caused by the statin — worth telling patients to report aches rather than stop.',
      docIds: Object.freeze(['cardio-statins', 'cardio-heart-medicine-side-effects']),
    }),
    Object.freeze({
      title: 'Dietary fat, and the blood pressure threshold',
      detail:
        'The drafts follow ESC 2021 on saturated fat and dairy fat, where CSI 2024 is more permissive, and use ' +
        '140/90 for high blood pressure (ESC 2024, WHO) where US guidance uses a lower threshold. The US ' +
        'guidelines could not be opened to check.',
      docIds: Object.freeze(['cardio-cholesterol-lifestyle', 'cardio-heart-healthy-eating', 'cardio-bp-numbers']),
    }),
    TRANSLATION_NOTE,
  ]),
  general_physician: Object.freeze([TRANSLATION_NOTE]),
  diabetology: Object.freeze([]),
});

/** The notes for a department, by its key. A department with none has none. */
export function reviewNotesFor(departmentKey) {
  return REVIEW_NOTES[departmentKey] ?? [];
}
