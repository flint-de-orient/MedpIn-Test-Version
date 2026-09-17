import { CARDIOLOGY_ASSISTANT_SCOPE, CARDIOLOGY_DRAFTS } from './seedContentCardiology.js';
import { GENERAL_MEDICINE_ASSISTANT_SCOPE, GENERAL_MEDICINE_DRAFTS } from './seedContentGeneralMedicine.js';

/**
 * The AI-drafted scopes and passages, in the shape the knowledge seed writes.
 *
 * ---- Why the review state is stamped here and not left to the seed ---------
 *
 * `KNOWLEDGE_SEED` used to be one list the seed script approved wholesale. The
 * drafts join that list — the practice backfill and the corpus tests read it,
 * and a draft missing from it would be mistaken for a passage somebody wrote in
 * the app — so each draft carries its own `status` and `origin` from the moment
 * it is exported. The seed reads them rather than deciding, and a test asserts
 * that every entry from this file says `pending_review` and `ai_draft`.
 *
 * ---- Adding a specialty -----------------------------------------------------
 *
 * A new file beside the two imported above, exporting a scope with its
 * `departmentKey` and a list of passages, added to DRAFT_SETS. The department
 * row must already exist (scripts/seedDepartments.js); the seed refuses to
 * write drafts for a department it cannot find rather than filing them under
 * none, which would make them cross-specialty.
 */

export const DRAFT_STATUS = 'pending_review';
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

/** Every AI-drafted passage, ready to seed. Never approved — see above. */
export const AI_DRAFT_SEED = Object.freeze(
  DRAFT_SETS.flatMap(({ scope, drafts }) =>
    drafts.map((d) =>
      Object.freeze({
        ...d,
        language: d.language ?? 'en',
        departmentKey: scope.departmentKey,
        origin: DRAFT_ORIGIN,
        status: DRAFT_STATUS,
        sourceCitation: citationFor(d.sources),
      }),
    ),
  ),
);

/** Every AI-drafted assistant scope, ready to seed. Never approved either. */
export const AI_DRAFT_SCOPES = Object.freeze(
  DRAFT_SETS.map(({ scope }) => Object.freeze({ ...scope, origin: DRAFT_ORIGIN, status: DRAFT_STATUS })),
);

/** docIds of the drafts, so the seed can tell a draft from the platform corpus. */
export const AI_DRAFT_DOC_IDS = Object.freeze(new Set(AI_DRAFT_SEED.map((d) => d.docId)));
