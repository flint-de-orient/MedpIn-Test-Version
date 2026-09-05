import { PatientCondition, CONDITION_STATUS } from '../models/PatientCondition.js';

/**
 * What a patient's illnesses mean for their screen.
 *
 * One place, because the two questions it answers — which Home cards, which red
 * flags — are asked from different parts of the app and must not drift apart. A
 * patient whose cards say diabetes and whose triage does not is a patient the
 * app will fail quietly.
 *
 * ---- Reads the rows, falls back to the column ---------------------------
 *
 * `diabetesType` is still on the profile and still read in 48 places. This
 * prefers condition rows and falls back to the old column when a patient has
 * none, so the answer is correct before the migration runs, during it, and
 * after — and the fallback comes out with the column, not before it.
 */

/** Cards for a patient with nothing recorded. */
const NO_CONDITIONS = Object.freeze({ homeCards: [], triageRules: [], conditions: [] });

/**
 * The active conditions for a patient, with their cards and rules folded
 * together.
 *
 * Only ACTIVE contributes. A resolved gestational diabetes should not keep a
 * sugar chart on Home for life, and a suspicion should not put one there at
 * all — recording a suspicion is how a doctor keeps track of a question, not
 * how they answer it.
 */
export async function conditionsFor(patientId, { profile = null } = {}) {
  const rows = await PatientCondition.find({
    patient: patientId,
    status: CONDITION_STATUS.ACTIVE,
  })
    .populate('condition')
    .lean();

  const live = rows.filter((r) => r.condition && r.condition.isActive !== false);

  if (!live.length) return fallback(profile);

  // Union, de-duplicated, order preserved from the condition's sortIndex so two
  // patients with the same illnesses see their cards in the same order.
  live.sort((a, b) => (a.condition.sortIndex ?? 100) - (b.condition.sortIndex ?? 100));

  const homeCards = [];
  const triageRules = [];
  for (const r of live) {
    for (const card of r.condition.homeCards ?? []) {
      if (!homeCards.includes(card)) homeCards.push(card);
    }
    for (const rule of r.condition.triageRules ?? []) {
      if (!triageRules.includes(rule)) triageRules.push(rule);
    }
  }

  return {
    homeCards,
    triageRules,
    conditions: live.map((r) => ({
      key: r.condition.key,
      name: r.condition.names?.en ?? r.condition.key,
      detail: r.detail ?? {},
    })),
  };
}

/**
 * The pre-migration answer, from the column that is still there.
 *
 * Deliberately narrow: it reproduces exactly what the app did before conditions
 * existed, and nothing more. Making the fallback cleverer than the thing it
 * replaces is how a migration changes behaviour it promised not to.
 */
function fallback(profile) {
  if (!profile?.diabetesType || profile.diabetesType === 'none') return NO_CONDITIONS;

  return {
    homeCards: ['glucose', 'hba1c', 'medications', 'diet_plan'],
    triageRules: [],
    conditions: [{ key: 'diabetes', name: 'Diabetes', detail: { type: profile.diabetesType } }],
  };
}

/**
 * The one-line description the assistant needs in its prompt.
 *
 * "a four-year-old is not a small adult" — the same argument applies to the
 * illness. An assistant answering a hypertension question out of diabetes
 * guidance is worse than one that says it does not know.
 */
export function describeForPrompt({ conditions = [] } = {}) {
  if (!conditions.length) return null;
  return conditions
    .map((c) => (c.detail?.type ? `${c.name} (${c.detail.type})` : c.name))
    .join(', ');
}
