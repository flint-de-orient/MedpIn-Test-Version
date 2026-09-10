/** The shapes the API actually returns. Mirrors src/routes/admin.js. */

export type PracticeStatus = "onboarding" | "active" | "suspended";
export type Verification = "unverified" | "pending" | "verified" | "rejected";
export type Plan = "trial" | "essential" | "professional" | "enterprise";
export type MembershipStatus = "invited" | "active" | "suspended";

export type Limits = {
  patients: number | null;
  staff: number | null;
  locations: number | null;
};

export type PracticeType =
  | "clinic"
  | "specialty_centre"
  | "diagnostic_centre"
  | "polyclinic"
  | "hospital"
  | "healthcare_group";

/**
 * What the wizard needs before it can draw itself.
 *
 * Fetched rather than hardcoded: the specialties are the shared Department
 * rows and an operator can add one, so a list baked in here would be a rebuild
 * every time somebody opens a practice in a specialty nobody anticipated. The
 * responsible-person label travels with the type because it changes with it.
 */
export type PracticeOptions = {
  types: { key: PracticeType; label: string; responsibleLabel: string }[];
  specialties: { key: string; label: string }[];
};

export type DuplicateCheck = {
  sameName: { id: string; name: string; status: PracticeStatus; createdAt: string }[];
  registrationClash: { id: string; name: string } | null;
};

export type Practice = {
  id: string;
  name: string;
  tagline: string | null;
  doctorDisplayName: string | null;
  registrationNo: string | null;
  /** What kind of organisation. Null for every practice created before types existed. */
  practiceType: PracticeType | null;
  /** What it primarily treats. A shared Department key, or free text. */
  specialty: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  status: PracticeStatus;
  verification: Verification;
  plan: Plan;
  limits: Limits;
  planRenewsOn: string | null;
  createdAt: string;
};

/** The list adds two counts the detail screen reports in full. */
export type PracticeRow = Practice & {
  locations: number;
  staff: number;
};

export type Member = {
  id: string;
  name: string;
  phone: string | null;
  role: string;
  isOwner: boolean;
  status: MembershipStatus;
  endedOn: string | null;
  loginActive: boolean;
  permissions: string[];
  /**
   * True when the grant is empty and the role's preset is standing in. Said out
   * loud because it is the most surprising thing about this model: an empty
   * permission list means "the default for this role", not "nothing".
   */
  usingPreset: boolean;
  startedOn: string;
};

export type PracticeDetail = {
  practice: Practice;
  isFounding: boolean;
  notes: string;
  /**
   * The number verification would be checked against, and whose it is.
   *
   * null means there is none anywhere — not on the practice, not on a doctor,
   * not on a location — so there is nothing a verification could have checked
   * and the server refuses to record one.
   */
  registration: { number: string; where: string } | null;
  usage: {
    patients: number;
    patientsEver: number;
    /** Every active membership, doctors and the owner included. */
    staff: number;
    locations: number;
    departments: number;
  };
  /**
   * What Razorpay thinks, or null where nobody has paid.
   *
   * Two things write `practice.plan` now — an operator here and the billing
   * webhook — so the plan alone no longer says whether it was bought or
   * granted. `disagrees` is the case support needs: an active subscription for
   * a plan the practice is not on, which is either a missed delivery or an edit
   * made over the top of one.
   */
  subscription: {
    id: string;
    plan: Plan;
    status: string;
    providerSubscriptionId: string;
    currentPeriodEnd: string | null;
    confirmedAt: string | null;
    createdAt: string;
    disagrees: boolean;
  } | null;
  locations: {
    id: string;
    name: string;
    city: string | null;
    addressLine: string | null;
    phone: string | null;
  }[];
  departments: {
    id: string;
    key: string;
    name: string;
    isActive: boolean;
    hasAssistant: boolean;
  }[];
  members: Member[];
};

export type Movement = { current: number; previous: number };

export type Overview = {
  practices: Record<string, number>;
  verification: Record<string, number>;
  plans: Record<string, number>;
  activeEnrolments: number;
  staff: number;
  locations: number;
  admins: number;
  /**
   * The last thirty days against the thirty before them, computed from
   * `createdAt` rather than a stored series. Nothing on these screens needs a
   * resolution finer than "more than before, or fewer", and a snapshot table
   * would be a second source of truth that can drift from the first.
   */
  trends: {
    practices: Movement;
    staff: Movement;
    locations: Movement;
    patients: Movement;
  };
  newPracticesThisWeek: number;
};

export type AuditRow = {
  id: string;
  admin: string;
  action: string;
  practice: string | null;
  reason: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  at: string;
};

export type AuditPage = {
  items: AuditRow[];
  hasMore: boolean;
  nextBefore: string | null;
};

export type Passkey = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
};

export type Admin = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  emailVerifiedAt: string | null;
  emailVerified: boolean;
  totpEnabled: boolean;
  passkeys: Passkey[];
  /** True when anything protects the account beyond the password. */
  hasSecondFactor: boolean;
  isSelf?: boolean;
  createdAt?: string;
};

export type LoginResult = {
  /**
   * Returned for callers that are not a browser. The console ignores both of
   * these: its session is an httpOnly cookie the page cannot read, and the CSRF
   * value is read from its own readable cookie rather than held in memory,
   * so that a reload restores everything without a second sign-in.
   */
  token: string;
  csrf: string;
  admin: Admin;
  totpEnabled: boolean;
};

/**
 * Every permission a membership can carry, said as what it lets somebody do.
 *
 * `MANAGE_STAFF` is a constant; "Add and remove colleagues" is a sentence an
 * operator can decide about. The order is the order they are shown, weakest
 * first, so ticking down the list reads as granting more.
 */
export const PERMISSION_LABELS: Record<string, string> = {
  VIEW_PATIENT: "Open a patient record",
  EDIT_RECORD: "Write clinical notes and readings",
  PRESCRIBE: "Issue prescriptions",
  MANAGE_DEPARTMENT: "Configure departments",
  MANAGE_STAFF: "Add and remove colleagues",
  VIEW_AUDIT: "Read the access log — who opened whose record",
  SHARE_RECORDS: "Share records outside the practice",
};

export const PERMISSION_ORDER = Object.keys(PERMISSION_LABELS);

/**
 * What each tier is called on screen.
 *
 * The tiers used to be `solo`, `clinic` and `hospital` — names that described
 * the customer rather than the product, and two of which collided with a
 * practice *type*. "A hospital on the hospital plan" and, worse, "a clinic that
 * is not on the clinic plan" made every sentence about either one ambiguous.
 */
export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Trial",
  essential: "Essential",
  professional: "Professional",
  enterprise: "Enterprise",
};

/**
 * One tier, as the server composes it.
 *
 * Capabilities come from the resolver the guards use and limits from the map
 * assignment writes, so this page cannot disagree with what a practice
 * actually experiences. The price comes from Razorpay, and is null where it
 * could not be fetched — never a figure this console invented.
 */
export type PlanRow = {
  plan: Plan;
  /** A trial is granted, not purchased. It belongs on the page, not in checkout. */
  sellable: boolean;
  capabilities: string[];
  limits: { patients: number | null; staff: number | null; locations: number | null };
  amount: number | null;
  currency: string | null;
  period: string | null;
  interval: number | null;
  providerPlanId: string | null;
};

export type SubscriptionRow = {
  id: string;
  practice: { id: string; name: string; plan: Plan } | null;
  plan: Plan;
  /** A downgrade asked for and not yet landed. */
  pendingPlan: Plan | null;
  status: string;
  providerSubscriptionId: string;
  currentPeriodEnd: string | null;
  confirmedAt: string | null;
  graceEndsAt: string | null;
  createdAt: string;
  /**
   * Paying for one plan while sitting on another — a missed delivery, or an
   * edit made over the top of one. The row worth interrupting for.
   */
  disagrees: boolean;
};

/** How a status reads, and how alarming it is. */
export const SUBSCRIPTION_LABELS: Record<string, string> = {
  created: "Not started",
  authenticated: "Authorised",
  active: "Active",
  pending: "Payment retrying",
  halted: "Payment failed",
  paused: "Paused",
  cancelled: "Cancelled",
  completed: "Completed",
  expired: "Expired",
};

/**
 * What the platform earns.
 *
 * Every money field is `number | null`, and null means the prices could not
 * be fetched from Razorpay — not that the figure is zero. A revenue
 * dashboard reading zero during a provider outage is indistinguishable from
 * a business that has lost every customer.
 */
export type Revenue = {
  /** Paise a month, normalised: a yearly plan contributes a twelfth. */
  mrr: number | null;
  arr: number | null;
  arpu: number | null;
  subscriptions: {
    active: number;
    pastDue: number;
    halted: number;
    paused: number;
    cancelled: number;
    notStarted: number;
  };
  trials: number;
  revenueByPlan: { plan: Plan; amount: number }[] | null;
  /** So the page can say why the money is blank rather than looking broken. */
  pricesKnown: boolean;
  trend: {
    month: string;
    started: number;
    cancelled: number;
    /** Actually collected, from the ledger — a fact, not a projection. */
    collected: number;
    charges: number;
  }[];
  conversion: { practices: number; converted: number; rate: number | null };
};

/**
 * How many subscriptions are in each state, regardless of the current
 * filter. Keyed by status, plus `all`.
 *
 * They go on the filter buttons and are the reason to press one: "Payment
 * failed (8)" is a decision, "Payment failed" is a guess.
 */
export type SubscriptionCounts = Record<string, number>;
