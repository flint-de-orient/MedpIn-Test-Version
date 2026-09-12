import { PRACTICE_TYPE, PLAN } from '../models/Practice.js';
import { PERMISSIONS } from '../models/Membership.js';
import { ROLES } from '../models/User.js';

/**
 * What this practice can do, and what this person in it can do.
 *
 * ---- Why this exists rather than a flag ---------------------------------
 *
 * The alternative was `premiumFeatures: true`, and the reason not to is that it
 * answers the wrong question. "Is this practice premium" is a billing fact.
 * "May this screen order a lab" is a product fact, and they are not the same
 * question — a diagnostic centre on the cheapest plan orders labs, and a
 * diabetes clinic on the dearest one has no use for a department.
 *
 * A boolean forces every screen to re-derive the second from the first, so the
 * derivation lives in twenty places and disagrees with itself in three of them.
 * This file is that derivation, once.
 *
 * ---- Four inputs, one answer --------------------------------------------
 *
 *   practice type   what kind of organisation this is at all
 *   plan            what the customer has paid for
 *   grants          what an operator has turned on for this practice by hand
 *   permissions     what THIS person may do inside it
 *
 * The first three decide what the practice HAS. The fourth decides what the
 * person in front of the screen may USE. Both are needed: a receptionist at a
 * hospital cannot prescribe, and neither can a doctor at a diagnostic centre —
 * for entirely different reasons, and a system that models only one of them
 * gets the other wrong.
 *
 * ---- Absence permits ----------------------------------------------------
 *
 * The rule the whole tenant migration rests on, applied again here. A practice
 * with no type is not a practice with no capabilities; it is a practice nobody
 * has classified yet, and every one that exists today is one. A resolver that
 * treated null as "nothing" would take prescriptions away from the clinic
 * seeing patients this morning, on the deploy that added a field.
 *
 * So: unknown type contributes everything, unknown plan contributes everything,
 * and narrowing begins the moment somebody says what this practice is.
 */

/**
 * The product surfaces that can be switched on or off.
 *
 * Named for what somebody does, not for the screen it lives on. `PRESCRIPTION`
 * survives the prescription screen being rewritten; `PRESCRIPTION_TAB` does not.
 */
export const CAPABILITIES = Object.freeze({
  PRESCRIPTION: 'PRESCRIPTION',
  LAB_ORDER: 'LAB_ORDER',
  LAB_RESULT: 'LAB_RESULT',
  DEPARTMENT: 'DEPARTMENT',
  MULTI_LOCATION: 'MULTI_LOCATION',
  AI_ASSISTANT: 'AI_ASSISTANT',
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',
  ADVANCED_REPORTS: 'ADVANCED_REPORTS',
  REPORT_EXPORT: 'REPORT_EXPORT',
  DEPARTMENT_ANALYTICS: 'DEPARTMENT_ANALYTICS',
  STAFF_ANALYTICS: 'STAFF_ANALYTICS',
  SCHEDULED_REPORTS: 'SCHEDULED_REPORTS',
});

const C = CAPABILITIES;

/** Every capability there is. The permissive answer, and the starting point. */
const ALL = Object.freeze(Object.values(CAPABILITIES));

/**
 * What each kind of organisation can have at all.
 *
 * This is a ceiling, not a grant — a hospital on the cheapest plan does not get
 * advanced analytics because hospitals are listed as capable of it. The plan
 * table below is the other ceiling, and a capability has to clear both.
 *
 * A diagnostic centre is the interesting row: it orders and reports labs and
 * does not prescribe, which is not a plan decision or a permission decision. It
 * is what the organisation is licensed to do.
 */
const BY_TYPE = Object.freeze({
  [PRACTICE_TYPE.CLINIC]: [
    C.PRESCRIPTION,
    C.LAB_ORDER,
    C.LAB_RESULT,
    C.AI_ASSISTANT,
    C.ADVANCED_ANALYTICS,
    C.ADVANCED_REPORTS,
    C.REPORT_EXPORT,
    C.STAFF_ANALYTICS,
  ],

  // A specialty centre is a clinic that is organised into sub-specialties.
  [PRACTICE_TYPE.SPECIALTY_CENTRE]: [
    C.PRESCRIPTION,
    C.LAB_ORDER,
    C.LAB_RESULT,
    C.DEPARTMENT,
    C.AI_ASSISTANT,
    C.ADVANCED_ANALYTICS,
    C.ADVANCED_REPORTS,
    C.REPORT_EXPORT,
    C.DEPARTMENT_ANALYTICS,
    C.STAFF_ANALYTICS,
  ],

  // Labs in, results out, and no prescribing. The one row where a capability
  // is withheld for a reason that is neither money nor seniority.
  [PRACTICE_TYPE.DIAGNOSTIC_CENTRE]: [
    C.LAB_ORDER,
    C.LAB_RESULT,
    C.MULTI_LOCATION,
    C.ADVANCED_ANALYTICS,
    C.ADVANCED_REPORTS,
    C.REPORT_EXPORT,
    C.STAFF_ANALYTICS,
    C.SCHEDULED_REPORTS,
  ],

  [PRACTICE_TYPE.POLYCLINIC]: [
    C.PRESCRIPTION,
    C.LAB_ORDER,
    C.LAB_RESULT,
    C.DEPARTMENT,
    C.MULTI_LOCATION,
    C.AI_ASSISTANT,
    C.ADVANCED_ANALYTICS,
    C.ADVANCED_REPORTS,
    C.REPORT_EXPORT,
    C.DEPARTMENT_ANALYTICS,
    C.STAFF_ANALYTICS,
  ],

  [PRACTICE_TYPE.HOSPITAL]: ALL,
  [PRACTICE_TYPE.HEALTHCARE_GROUP]: ALL,
});

/**
 * What each plan pays for.
 *
 * A plan is a name and a set of capabilities, and nothing else. It carries no
 * price — that lives in the Razorpay dashboard, which is where somebody can
 * change it without a deploy — and no numeric limit, which is per practice in
 * `Practice.limits` so that a customer who negotiates an extra location does
 * not need a plan invented for them.
 *
 * TRIAL is deliberately the widest. Somebody deciding whether to buy should be
 * looking at the product, not at a version of it with the interesting parts
 * removed — and a trial that cannot demonstrate what is being sold converts
 * nobody.
 */
const BY_PLAN = Object.freeze({
  [PLAN.TRIAL]: ALL,

  // The core clinical loop, and the basic numbers that come with it.
  [PLAN.ESSENTIAL]: [C.PRESCRIPTION, C.LAB_ORDER, C.LAB_RESULT, C.AI_ASSISTANT],

  [PLAN.PROFESSIONAL]: [
    C.PRESCRIPTION,
    C.LAB_ORDER,
    C.LAB_RESULT,
    C.DEPARTMENT,
    C.MULTI_LOCATION,
    C.AI_ASSISTANT,
    C.ADVANCED_ANALYTICS,
    C.ADVANCED_REPORTS,
    C.REPORT_EXPORT,
    C.DEPARTMENT_ANALYTICS,
    C.STAFF_ANALYTICS,
  ],

  [PLAN.ENTERPRISE]: ALL,
});

/**
 * Which permission a capability needs before this person may use it.
 *
 * Not every capability needs one. `AI_ASSISTANT` is available to anybody who
 * may see a patient, and what it may say about that patient is decided by the
 * patient scoping rather than by a permission — see [ai/scope.js].
 *
 * A capability with no entry here is available to every member of a practice
 * that has it.
 */
const NEEDS_PERMISSION = Object.freeze({
  [C.PRESCRIPTION]: PERMISSIONS.PRESCRIBE,
  [C.LAB_ORDER]: PERMISSIONS.EDIT_RECORD,
  [C.DEPARTMENT]: PERMISSIONS.MANAGE_DEPARTMENT,
  [C.DEPARTMENT_ANALYTICS]: PERMISSIONS.MANAGE_DEPARTMENT,
  [C.STAFF_ANALYTICS]: PERMISSIONS.MANAGE_STAFF,
  [C.SCHEDULED_REPORTS]: PERMISSIONS.MANAGE_STAFF,
});

/**
 * And which capabilities a role never gets, whatever the grant says.
 *
 * A short list on purpose. Most of "what may this person do" belongs in the
 * permission grant on their membership row, which is per-person and editable;
 * a role exclusion is per-role and needs a deploy to change. Only the ones that
 * would be incoherent belong here.
 */
const ROLE_EXCLUDES = Object.freeze({
  // A dietician writes diet plans. Whatever a practice has bought, and whatever
  // an over-generous grant says, that is not prescribing.
  [ROLES.DIETICIAN]: [C.PRESCRIPTION],
  // The desk books, registers and takes payment. It does not order clinical
  // investigations, and MANAGE_STAFF on a practice manager must not start
  // meaning it.
  [ROLES.STAFF]: [C.PRESCRIPTION, C.LAB_ORDER],

  /*
   * Assists on the record and does not sign.
   *
   * The line between assisting and practising, and the one exclusion that
   * defines this role — the permission grant is the desk's, so without this
   * an assistant with PRESCRIBE granted by hand would be able to sign.
   */
  [ROLES.DOCTOR_ASSISTANT]: [C.PRESCRIPTION],

  /*
   * The laboratory roles, and the reason they had to exist.
   *
   * Filed as `staff` they lost LAB_ORDER — deliberately, because a
   * receptionist must not order clinical investigations — and the result was
   * a bench that could read a critical result and could not begin the work
   * that produced it. Neither of these excludes LAB_ORDER or LAB_RESULT;
   * both exclude PRESCRIPTION, because reporting a result is not treating
   * anybody.
   */
  [ROLES.LAB_MANAGER]: [C.PRESCRIPTION],
  [ROLES.LAB_TECHNICIAN]: [C.PRESCRIPTION],

  /*
   * Administers the practice and touches no clinical work at all.
   *
   * The longest list here, and the only one that is a statement about the job
   * rather than about seniority. A practice manager rosters people, runs
   * departments and handles billing; they do not prescribe, order a test or
   * read a result — and MANAGE_STAFF, which they need, must never start to
   * mean any of those.
   */
  [ROLES.PRACTICE_MANAGER]: [C.PRESCRIPTION, C.LAB_ORDER, C.LAB_RESULT, C.AI_ASSISTANT],
});

/** A capability list for a key, or `null` meaning "unknown, do not narrow". */
function ceiling(table, key) {
  if (!key) return null;
  const row = table[key];
  return row ? [...row] : null;
}

/**
 * What this practice has, before anybody is standing in front of it.
 *
 * `grants` is the per-practice override an operator sets — the Enterprise
 * escape hatch, and the way to turn something on for one customer without
 * inventing a plan. It only ever adds: an operator switching a capability on
 * for a practice whose type cannot have it is a mistake worth refusing, and the
 * type ceiling is the thing that refuses it.
 */
export function capabilitiesOfPractice(practice) {
  const byType = ceiling(BY_TYPE, practice?.practiceType);
  const byPlan = ceiling(BY_PLAN, practice?.plan);

  // Unknown on either axis contributes nothing to the narrowing. This is the
  // whole safety argument and it should stay the first thing this function does
  // with its inputs.
  let out = ALL.filter(
    (c) => (byType === null || byType.includes(c)) && (byPlan === null || byPlan.includes(c)),
  );

  const grants = practice?.capabilities;
  if (Array.isArray(grants) && grants.length) {
    // Added, then re-checked against the type ceiling. A grant cannot make a
    // diagnostic centre prescribe.
    const added = grants.filter(
      (c) => ALL.includes(c) && (byType === null || byType.includes(c)),
    );
    out = [...new Set([...out, ...added])];
  }

  return new Set(out);
}

/**
 * What this person may actually use.
 *
 * The practice's set, minus what their role never has, minus what their grant
 * does not cover.
 *
 * `membership` may be null — a caller whose membership row does not exist yet
 * is the pre-backfill case, and they get the practice's set unnarrowed. Same
 * rule as everywhere else: absence is not evidence of a restriction.
 */
export function effectiveCapabilities({ practice, membership, role = null }) {
  const held = capabilitiesOfPractice(practice);
  if (!membership) return held;

  const theirRole = membership.role ?? role;
  const excluded = ROLE_EXCLUDES[theirRole] ?? [];

  // An empty grant means the preset applies, which the model already resolves
  // on read. An empty array here would mean "may do nothing", and that is the
  // reading that locks somebody out of their own practice.
  const grant = membership.permissions?.length ? membership.permissions : null;

  return new Set(
    [...held].filter((c) => {
      if (excluded.includes(c)) return false;
      const needs = NEEDS_PERMISSION[c];
      if (!needs || !grant) return true;
      return grant.includes(needs);
    }),
  );
}

/** Convenience for a single check. */
export function can(capability, { practice, membership, role = null }) {
  return effectiveCapabilities({ practice, membership, role }).has(capability);
}

/**
 * The shape the clients read to build themselves.
 *
 * Sorted, so a response body that has not changed does not look as though it
 * has, and a diff between two practices is readable.
 */
export function describeCapabilities({ practice, membership, role = null }) {
  return {
    practiceType: practice?.practiceType ?? null,
    specialty: practice?.specialty ?? null,
    plan: practice?.plan ?? null,
    practice: [...capabilitiesOfPractice(practice)].sort(),
    effective: [...effectiveCapabilities({ practice, membership, role })].sort(),
  };
}

/**
 * Every capability, and what is holding back the ones this practice lacks.
 *
 * ---- Why anything needs this -------------------------------------------
 *
 * `DEPARTMENT` clears three independent gates: the practice type must be one
 * that has departments at all, the plan must pay for them, and the person must
 * hold MANAGE_DEPARTMENT. Miss any one and the app draws nothing — deliberately,
 * because a greyed section on a screen a solo doctor opens weekly is a
 * permanent advertisement for something that will never apply to them.
 *
 * That is right for the doctor and useless for the operator who has just set a
 * practice up and is looking at a screen with no departments on it. Nothing in
 * the console showed what a type and a plan added up to, so the only way to
 * find out was to read two tables in this file.
 *
 * Type first when both block it: a plan is a sale and a type is what the
 * organisation is, so "a clinic does not have departments" is the more useful
 * half of the answer and the one that does not resolve itself with money.
 */
export function explainCapabilities(practice) {
  const byType = ceiling(BY_TYPE, practice?.practiceType);
  const byPlan = ceiling(BY_PLAN, practice?.plan);
  const held = capabilitiesOfPractice(practice);

  return ALL.map((capability) => {
    const typeAllows = byType === null || byType.includes(capability);
    const planAllows = byPlan === null || byPlan.includes(capability);

    return {
      capability,
      has: held.has(capability),
      /// What stops it, or null when nothing does.
      blockedBy: held.has(capability) ? null : !typeAllows ? 'type' : !planAllows ? 'plan' : null,
      /**
       * And what a member still needs before they can use it.
       *
       * Sent even when the practice has the capability, because "the practice
       * has departments and this doctor cannot manage them" is the commonest
       * reason the section is missing from one person's screen and not
       * another's — and it is a conversation with the practice, not a sale.
       */
      needsPermission: NEEDS_PERMISSION[capability] ?? null,
    };
  });
}

export { ALL as ALL_CAPABILITIES, BY_TYPE, BY_PLAN, NEEDS_PERMISSION, ROLE_EXCLUDES };
