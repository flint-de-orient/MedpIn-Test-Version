import { CAPABILITIES } from './capabilities.js';
import { PERMISSIONS } from '../models/Membership.js';

/**
 * What the app is allowed to draw, and what each thing costs to draw it.
 *
 * ---- Why a registry and not a payload ----------------------------------
 *
 * The server decides *which* components appear. It never describes them. A
 * response that carried layout, styling or behaviour would be the backend
 * shipping UI, and a compromised or mistaken server would then be able to put
 * anything on a clinician's screen. What travels is an identifier from this
 * list, and the app refuses one it does not recognise.
 *
 * That is also what makes a new department configurable without a release: an
 * operator composes a dashboard from components that already exist. Only a
 * genuinely new visualisation needs Flutter work — and then it is added here,
 * deliberately, in the same commit as the widget.
 *
 * ---- Every entry names data that exists ---------------------------------
 *
 * The rule this file was rewritten to obey. The first draft registered ECG, a
 * cardiac risk score, and a four-state sample queue for the laboratory —
 * because those are what a cardiology and a laboratory dashboard *ought* to
 * have. None of them exist in this platform. There is no ECG model, no risk
 * instrument, and no sample workflow at all; `LabReport` is a result document
 * somebody uploads, not a specimen moving through a bench.
 *
 * A registered widget with nothing behind it is not a placeholder. It is a
 * panel that renders empty forever and reads as a clinic with no data rather
 * than a feature that was never built — and `CARDIAC_RISK` would have been
 * worse than empty, because a cardiologist reading a number labelled that way
 * would take it for a validated score. Framingham, QRISK and ASCVD are
 * instruments, not arithmetic, and inventing one is the diabetes-scope mistake
 * with a sharper edge.
 *
 * So every identifier below names something the API already answers, and the
 * comment on each says what. Adding one means adding the data first.
 *
 * ---- `needs` is the whole access rule ----------------------------------
 *
 * Every entry says what it requires and nothing says it twice. A widget behind
 * a capability disappears when the plan does not include it; one behind a
 * permission disappears for a person who does not hold it. No component gets
 * its own branch, so there is no component whose rule somebody forgot.
 *
 * This is a courtesy, not a control. Every route behind these already enforces
 * the same capability and permission server-side — see requireCapability and
 * requirePermission. Hiding a button the server would refuse is for the person
 * using it; it is not what keeps them out.
 */

const C = CAPABILITIES;
const P = PERMISSIONS;

/**
 * Every dashboard component the app can render, and where its numbers come
 * from.
 *
 * `needs.capability` — the practice must have it, which is plan and type.
 * `needs.permission` — this person must hold it.
 *
 * A component with neither is available to anybody who can open the app at all,
 * which is most clinical reading: a doctor's own caseload is not a premium
 * feature and a plan lapse must not hide it. See billing/lapse.js on why
 * restriction stops growth rather than care.
 */
export const WIDGETS = Object.freeze({
  /*
   * ---- the clinical day ------------------------------------------------
   *
   * Named for the component rather than for the number inside it. `CASELOAD`
   * and `PENDING_REVIEWS` were two of five identifiers that all resolved to
   * tiles inside one existing panel — which would have made the registry a
   * list of things the app cannot separately draw, and every one of them a
   * promise to build a widget later.
   *
   * All behind VIEW_PATIENT, which every preset grants — so this changes
   * nothing for anybody real and states the rule correctly for the one case
   * it does not: a grant somebody has customised down. A panel of patient
   * names is patient data whatever shape it is drawn in.
   */
  /// Who needs a doctor now — GET /doctor/patients?attention, ranked.
  TRIAGE_QUEUE: { needs: { permission: P.VIEW_PATIENT } },
  /// The day's appointments, and how many are done.
  TODAYS_CLINIC: { needs: { permission: P.VIEW_PATIENT } },
  /// What is queued: alerts, unread messages, flagged chats, requests.
  ACTION_QUEUE: { needs: { permission: P.VIEW_PATIENT } },
  /// The alerts that have been raised, with their "all clear" state.
  OPEN_ALERTS: { needs: { permission: P.VIEW_PATIENT } },
  /// What the practice has been doing — context, not work.
  LIVE_ACTIVITY: { needs: { permission: P.VIEW_PATIENT } },

  // ---- what the practice has bought --------------------------------------
  /// GET /doctor/analytics — trends over a window the reader chooses.
  ANALYTICS_SUMMARY: { needs: { capability: C.ADVANCED_ANALYTICS } },

  // ---- labs, from LabReport ----------------------------------------------
  /*
   * What a laboratory-facing screen in this platform can honestly show.
   *
   * Not a bench queue — there is no sample model and no ordering workflow, so
   * "12 pending, 4 processing" would be four numbers with nothing behind them.
   * What does exist is the report and the flags on its values, which is a real
   * and genuinely different screen: results that came back abnormal, rather
   * than people who are in the building.
   */
  /// Reports holding a value flagged `critical`.
  CRITICAL_LAB_RESULTS: {
    needs: { capability: C.LAB_RESULT, permission: P.VIEW_PATIENT },
  },
  /// The most recent reports, by `testedOn`.
  RECENT_LAB_REPORTS: {
    needs: { capability: C.LAB_RESULT, permission: P.VIEW_PATIENT },
  },
  /// How many values came back low, high or critical across the practice.
  LAB_FLAG_SUMMARY: {
    needs: { capability: C.LAB_RESULT, permission: P.VIEW_PATIENT },
  },

  // ---- nutrition ----------------------------------------------------------
  /// The diet plans falling due for review.
  NUTRITION_REVIEWS: { needs: { permission: P.VIEW_PATIENT } },
});

/**
 * Every action a dashboard may offer, under the same rule.
 *
 * ---- Verbs, and widgets are nouns --------------------------------------
 *
 * `RECORD_VITALS`, not `VITALS`. The two tables started out sharing names —
 * `VITALS` meaning both "show the readings" and "take a reading" — and a name
 * in both tables is a name whose lookup can find the wrong entry, with a
 * different `needs` attached. Showing a blood pressure and recording one are
 * not the same permission.
 *
 * A widget is a thing on the screen and an action is something somebody does,
 * so naming them apart is not only a collision guard: a button labelled from
 * `VITALS` does not say what pressing it will do.
 *
 * Each of these opens a screen that exists. An action whose destination has
 * not been built is a button that goes nowhere, which is worse than an absent
 * one because somebody presses it in front of a patient.
 */
export const QUICK_ACTIONS = Object.freeze({
  /// /clinician/patients/:id/consult — vitals, diagnosis, advice.
  START_CONSULTATION: { needs: { permission: P.EDIT_RECORD } },
  /// /clinician/patients/add.
  ADD_PATIENT: { needs: { permission: P.EDIT_RECORD } },
  /// POST /tracking/vitals, and the consult flow's first step.
  RECORD_VITALS: { needs: { permission: P.EDIT_RECORD } },
  WRITE_PRESCRIPTION: {
    needs: { capability: C.PRESCRIPTION, permission: P.PRESCRIBE },
  },
  /// /clinician/alerts.
  VIEW_ALERTS: { needs: { permission: P.VIEW_PATIENT } },
  /// The lab reports on a patient's record.
  VIEW_LAB_REPORTS: {
    needs: { capability: C.LAB_RESULT, permission: P.VIEW_PATIENT },
  },
  /// /clinician/export.
  EXPORT_REPORT: { needs: { capability: C.REPORT_EXPORT } },
  /// /clinician/team.
  MANAGE_TEAM: { needs: { permission: P.MANAGE_STAFF } },
  /// /clinician/departments.
  MANAGE_DEPARTMENTS: {
    needs: { capability: C.DEPARTMENT, permission: P.MANAGE_DEPARTMENT },
  },
});

/**
 * What a department shows when nobody has configured it.
 *
 * A starting point an operator edits, not a rule. A department absent from
 * this map gets the general set — which is the honest default: the components
 * every clinical area uses are the ones that describe a caseload, and a new
 * department is a caseload before it is anything else.
 */
const GENERAL = {
  /*
   * The order the existing dashboard already draws, component for component.
   *
   * Not a redesign. This default is what Dr. Dey's clinic opens onto every
   * morning, and the deploy that moves the arrangement to the server must not
   * be the deploy that rearranges his screen — so the list is the old
   * hardcoded one transcribed, in its own order, including the snapshot chart
   * at the top.
   *
   * ANALYTICS_SUMMARY was missing from the first draft of this, which would
   * have taken the chart off the home screen of the one practice using the
   * product. It was wrapped in `if (analytics != null)` before, which is the
   * same thing the capability gate does now: a practice without the plan does
   * not see it, and one with the plan does.
   *
   * The reasoning the old comments carried still holds and lives here now:
   * clinical work above operational summary, context last. A doctor does not
   * open this to learn they have seven patients.
   */
  widgets: [
    'ANALYTICS_SUMMARY',
    'TRIAGE_QUEUE',
    'TODAYS_CLINIC',
    'ACTION_QUEUE',
    'NUTRITION_REVIEWS',
    'OPEN_ALERTS',
    'LIVE_ACTIVITY',
  ],
  quickActions: [
    'START_CONSULTATION',
    'ADD_PATIENT',
    'RECORD_VITALS',
    'WRITE_PRESCRIPTION',
    'VIEW_ALERTS',
  ],
};

/** What the bench sees. Shared by laboratory and pathology — see below. */
const BENCH = Object.freeze({
  widgets: ['CRITICAL_LAB_RESULTS', 'LAB_FLAG_SUMMARY', 'RECENT_LAB_REPORTS'],
  quickActions: ['VIEW_LAB_REPORTS', 'EXPORT_REPORT'],
});

/**
 * What a role opens onto, whatever department it is in.
 *
 * ---- Why a role needs its own answer at all ----------------------------
 *
 * Because a department says *where* somebody works and a role says *what they
 * do*, and the two disagree often enough to matter. A lab technician in a
 * cardiology department is at a bench, not in a clinic; a practice manager in
 * any department is in neither.
 *
 * ---- Only the roles whose answer differs -------------------------------
 *
 * A doctor is not here, and that is the point: a doctor's screen is the
 * department's screen, which is the whole argument for departments having
 * one. A role listed here is one whose work is the same wherever it is done.
 */
const ROLE_DEFAULTS = Object.freeze({
  /*
   * The bench, wherever the bench is.
   *
   * Both lab roles read the same panels, because both need to see what came
   * back. They differ in what they may *do*, and that turned out to need
   * saying rather than being left to the filters — an earlier version gave
   * both of them BENCH and a comment claiming the manager would see the team
   * action. They would not have: filtering removes what somebody may not
   * reach, and it cannot add what the list never offered.
   *
   * So the manager's list names it, and the filter still decides whether it
   * survives — a lab manager whose grant has been customised down loses the
   * action, which is the filter doing its job on a list that offered it.
   */
  lab_manager: {
    widgets: BENCH.widgets,
    quickActions: [...BENCH.quickActions, 'MANAGE_TEAM'],
  },
  lab_technician: BENCH,

  /*
   * Administers, and reads no clinical record.
   *
   * Every patient-facing panel needs VIEW_PATIENT, which this preset
   * deliberately withholds — so composing the general set for a practice
   * manager would produce an empty screen after filtering. An empty screen is
   * not an answer; this is what their job actually looks like.
   */
  practice_manager: {
    widgets: ['ANALYTICS_SUMMARY'],
    quickActions: ['MANAGE_TEAM', 'MANAGE_DEPARTMENTS', 'EXPORT_REPORT'],
  },
});

export const DEPARTMENT_DEFAULTS = Object.freeze({
  /*
   * Cardiology, within what the platform actually holds.
   *
   * Vitals carry systolic, diastolic and pulse, so a cardiology caseload is a
   * real thing to show and the risk banding is already stored per patient. The
   * ECG panel and the risk score that belong on this screen are not here,
   * because neither exists — see the note at the top of this file.
   */
  cardiology: {
    widgets: [
      'TRIAGE_QUEUE',
      'TODAYS_CLINIC',
      'RECENT_LAB_REPORTS',
      'ACTION_QUEUE',
      'OPEN_ALERTS',
    ],
    quickActions: [
      'START_CONSULTATION',
      'RECORD_VITALS',
      'WRITE_PRESCRIPTION',
      'VIEW_LAB_REPORTS',
      'VIEW_ALERTS',
    ],
  },

  /*
   * A laboratory is not a caseload.
   *
   * What somebody opening it needs is what came back abnormal, not who is in
   * the waiting room — so it has no appointments, no consultations and no
   * prescribing on it at all. This is the clearest case for the engine
   * existing: the same app, composed differently, rather than a second
   * application.
   */
  laboratory: BENCH,

  /*
   * Pathology reads the same data from the other end of it, so it shares the
   * laboratory's components — the same object, rather than a copied list that
   * would then drift from it.
   */
  pathology: BENCH,

  nutrition: {
    widgets: ['NUTRITION_REVIEWS', 'TRIAGE_QUEUE', 'ACTION_QUEUE'],
    quickActions: ['START_CONSULTATION', 'RECORD_VITALS'],
  },
});

/**
 * What this department shows, before anybody is standing in front of it.
 *
 * The fallback rule, in one place. It is read twice — once to resolve a
 * person's dashboard and once to tell the console what a department is
 * configured to do — and two copies of "empty means the default" is how the
 * console comes to disagree with the app about what a department shows.
 *
 * `usingDefault` is the distinction `/me/capabilities` got wrong with
 * `permissions`: `[]` on the row means the platform's default applies, not
 * that somebody chose to display nothing. A console that reads the raw array
 * shows every department as configured-to-show-nothing, and an operator then
 * "fixes" what was already correct.
 */
export function composeFor(department, role = null) {
  /*
   * ---- Precedence, in four tiers -------------------------------------
   *
   *   1. what an operator configured on this department
   *   2. the platform's default for this role
   *   3. the platform's default for this department
   *   4. the general clinical set
   *
   * Two rules produce that order, and both are worth stating because the
   * alternatives are each defensible until you try them:
   *
   * **Explicit beats default.** A practice that has composed its cardiology
   * screen has said something; a platform default has only guessed. So tier 1
   * sits above the role default even for a lab technician in cardiology —
   * whoever configured that department did it knowing who works there.
   *
   * **Role beats department, among defaults.** A department says where
   * somebody works and a role says what they do, and where neither has been
   * configured the job is the better guess. A lab technician in cardiology is
   * at a bench; a practice manager is in neither place.
   *
   * ---- What is deliberately not here ---------------------------------
   *
   * Per-role configuration on a department — "cardiology, but different for
   * assistants". It belongs in this hierarchy and it is not built, because a
   * role × department matrix with no screen to edit it is schema nobody can
   * reach. The four tiers below cover it: a role whose work differs gets a
   * default, and a department that needs something specific gets configured.
   */
  const configured = {
    widgets: department?.widgets?.length ? department.widgets : null,
    quickActions: department?.quickActions?.length ? department.quickActions : null,
  };
  const fallback =
    ROLE_DEFAULTS[role] ?? DEPARTMENT_DEFAULTS[department?.key] ?? GENERAL;

  return {
    widgets: configured.widgets ?? fallback.widgets,
    quickActions: configured.quickActions ?? fallback.quickActions,
    /// Whether anybody here chose this, as opposed to the platform.
    usingDefault: !configured.widgets && !configured.quickActions,
    /// Which tier answered, so the console can say so rather than leaving an
    /// operator to work out why two people in one department differ.
    source: configured.widgets || configured.quickActions
      ? 'department'
      : ROLE_DEFAULTS[role]
        ? 'role'
        : DEPARTMENT_DEFAULTS[department?.key]
          ? 'departmentDefault'
          : 'general',
  };
}

/**
 * Whether this person, at this practice, may be shown this component.
 *
 * A null set means "not narrowed", not "holds nothing" — the rule the whole
 * tenant migration rests on, applied here because it was very nearly broken.
 * A member whose membership row the backfill has not reached resolves to no
 * grant, and reading that literally hands a working doctor an empty home
 * screen on the deploy that added the field. `effectiveCapabilities` already
 * reads a null membership that way; so does this.
 */
function allowed({ needs }, { capabilities, permissions }) {
  if (needs.capability && capabilities && !capabilities.has(needs.capability)) return false;
  if (needs.permission && permissions && !permissions.has(needs.permission)) return false;
  return true;
}

/** A Set, an array, or null meaning "unknown — do not narrow". */
function asSet(value) {
  if (value == null) return null;
  return value instanceof Set ? value : new Set(value);
}

/**
 * The dashboard for one person, in one department, at one practice.
 *
 * ---- The order the brief draws, in one function ------------------------
 *
 *   practice → department → role → permissions → plan → capabilities → UI
 *
 * `capabilities` and `permissions` arrive already resolved — from
 * capabilities.js and the membership's grant — because both are enforced on
 * every route and a second derivation here would be a second answer.
 *
 * Precedence is composeFor's, and it is written out there: what an operator
 * configured, then the role's default, then the department's, then the general
 * set. An unknown identifier is dropped rather than passed on — an operator
 * who configures a widget this server has never heard of gets a dashboard
 * without it, not an app that cannot render its own home screen.
 *
 * Either set may be null, meaning "unknown, do not narrow". An empty set is a
 * different answer and means exactly what it says — see [allowed].
 */
export function resolveUi({ department = null, role = null, capabilities, permissions }) {
  const caps = asSet(capabilities);
  const perms = asSet(permissions);

  const composed = composeFor(department, role);

  const widgets = composed.widgets
    .filter((id) => WIDGETS[id])
    .filter((id) => allowed(WIDGETS[id], { capabilities: caps, permissions: perms }));

  const quickActions = composed.quickActions
    .filter((id) => QUICK_ACTIONS[id])
    .filter((id) => allowed(QUICK_ACTIONS[id], { capabilities: caps, permissions: perms }));

  return {
    department: department?.key ?? null,
    role,
    widgets,
    quickActions,
    /// Which tier of the hierarchy answered. Sent so a person looking at two
    /// colleagues with different screens can find out why without reading
    /// this file.
    source: composed.source,
  };
}
