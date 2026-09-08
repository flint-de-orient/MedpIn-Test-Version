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
    staff: number;
    locations: number;
    departments: number;
  };
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
