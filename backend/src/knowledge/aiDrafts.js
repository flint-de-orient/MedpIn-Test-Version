import { CARDIOLOGY_ASSISTANT_SCOPE, CARDIOLOGY_DRAFTS } from './seedContentCardiology.js';
import { GENERAL_MEDICINE_ASSISTANT_SCOPE, GENERAL_MEDICINE_DRAFTS } from './seedContentGeneralMedicine.js';
import { DRAFT_TRANSLATIONS, TRANSLATED_LANGUAGES } from './draftTranslations.js';

/**
 * The AI-drafted scopes and passages, in the shape the knowledge seed writes.
 *
 * ---- Live, and still attributed ---------------------------------------------
 *
 * There is no approval step for an assistant, so the cardiology and
 * general-medicine guidance is seeded `approved` — the status retrieval reads —
 * and each specialty's assistant answers from it. `origin: 'ai_draft'` stays on
 * every row, so the knowledge screen shows which passages a machine wrote, and a
 * practice that disagrees with one takes its own copy there to edit or retire.
 * Before they went live, the two passages that sent worsening angina and chest
 * pain that comes and goes to a same-day clinic contact were changed to
 * emergency care, as ESC guidance advises; the other differences from the
 * specialist guidance are listed in CARDIOLOGY_REVIEW.md for a cardiologist.
 *
 * The status and origin are stamped here, not decided by the seed, so a test
 * can assert what every entry is written as.
 *
 * ---- Adding a specialty -----------------------------------------------------
 *
 * A new file beside the two imported above, exporting a scope with its
 * `departmentKey` and a list of passages, added to DRAFT_SETS. The department
 * row must already exist (scripts/seedDepartments.js); the seed refuses to
 * write drafts for a department it cannot find rather than filing them under
 * none, which would make them cross-specialty.
 */

export const DRAFT_STATUS = 'approved';
export const DRAFT_ORIGIN = 'ai_draft';

const DRAFT_SETS = Object.freeze([
  { scope: CARDIOLOGY_ASSISTANT_SCOPE, drafts: CARDIOLOGY_DRAFTS },
  { scope: GENERAL_MEDICINE_ASSISTANT_SCOPE, drafts: GENERAL_MEDICINE_DRAFTS },
]);

/**
 * The one-line citation the prompt shows the model beside a passage, from the
 * structured sources. Kept within the model's 500 characters.
 */
export function citationFor(sources) {
  const line = sources
    .map((s) => `${s.organisation} — ${s.title}${s.year ? ` (${s.year})` : ''}`)
    .join('; ');
  return line.length > 500 ? `${line.slice(0, 497)}...` : line;
}

/**
 * A draft's Bengali and Hindi versions, as passages of their own.
 *
 * The same category and sources as the English: the English is what was
 * checked against the guidance, and a translation claims nothing it does not.
 * `translationOf` names the original for tests and reviewers; the seed does not
 * store it.
 */
function translationsOf(english, departmentKey) {
  return TRANSLATED_LANGUAGES.flatMap((language) => {
    const t = DRAFT_TRANSLATIONS[departmentKey]?.[language]?.[english.docId];
    if (!t) return [];
    return [
      Object.freeze({
        ...english,
        docId: `${english.docId}-${language}`,
        language,
        title: t.title,
        section: t.section,
        tags: t.tags,
        content: t.content,
        translationOf: english.docId,
      }),
    ];
  });
}

/** Every AI-drafted passage, ready to seed — live, see above. */
export const AI_DRAFT_SEED = Object.freeze(
  DRAFT_SETS.flatMap(({ scope, drafts }) =>
    drafts.flatMap((d) => {
      const english = Object.freeze({
        ...d,
        language: d.language ?? 'en',
        departmentKey: scope.departmentKey,
        origin: DRAFT_ORIGIN,
        status: DRAFT_STATUS,
        sourceCitation: citationFor(d.sources),
      });
      return [english, ...translationsOf(english, scope.departmentKey)];
    }),
  ),
);

/** Every AI-drafted assistant scope, ready to seed. */
export const AI_DRAFT_SCOPES = Object.freeze(
  DRAFT_SETS.map(({ scope }) => Object.freeze({ ...scope, origin: DRAFT_ORIGIN, status: DRAFT_STATUS })),
);

/** docIds of the drafts, so the seed can tell a draft from the platform corpus. */
export const AI_DRAFT_DOC_IDS = Object.freeze(new Set(AI_DRAFT_SEED.map((d) => d.docId)));
