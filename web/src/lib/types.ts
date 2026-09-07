/** The shapes the API actually returns. Mirrors src/routes/admin.js. */

export type PracticeStatus = "onboarding" | "active" | "suspended";
export type Verification = "unverified" | "pending" | "verified" | "rejected";
export type Plan = "trial" | "solo" | "clinic" | "hospital";
export type MembershipStatus = "invited" | "active" | "suspended";

export type Limits = {
  patients: number | null;
  staff: number | null;
  locations: number | null;
};

export type Practice = {
  id: string;
  name: string;
  tagline: string | null;
  doctorDisplayName: string | null;
  registrationNo: string | null;
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

export type Overview = {
  practices: Record<string, number>;
  verification: Record<string, number>;
  plans: Record<string, number>;
  activeEnrolments: number;
  staff: number;
  admins: number;
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

export type Admin = {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: string | null;
  totpEnabled: boolean;
  isSelf?: boolean;
  createdAt?: string;
};

export type LoginResult = {
  token: string;
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

export const PLAN_LABELS: Record<Plan, string> = {
  trial: "Trial",
  solo: "Solo practice",
  clinic: "Clinic",
  hospital: "Hospital",
};
