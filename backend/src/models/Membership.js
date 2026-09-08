import mongoose from 'mongoose';

import { ROLES } from './User.js';

/**
 * A person's place in a practice.
 *
 * ---- Why a role on the user is not enough -------------------------------
 *
 * `User.role` says what someone is, once, everywhere. That was true while
 * there was one practice: Dr. Dey is a doctor, the receptionist is staff, and
 * the question never came up twice.
 *
 * It stops being true the moment a second practice exists, and it fails in both
 * directions. A doctor may consult at a polyclinic on Tuesdays and run their
 * own evening clinic — one person, two practices, and possibly a different
 * standing in each. And a receptionist who leaves is not "no longer staff";
 * they are no longer staff *here*, and disabling their account would take their
 * job at the other clinic away with it.
 *
 * So the pair (person, practice) gets its own row, and that row carries the
 * role. `User.role` stays as it is — nothing reads this yet, and a migration
 * that flips authorisation over in one commit is a migration that logs the
 * clinic out on a Monday morning.
 *
 * ---- Ended, not deleted -------------------------------------------------
 *
 * A membership that has finished keeps its row with an `endedOn`. A receptionist
 * who worked here until March registered patients and answered messages, and
 * the audit log points at a person who must still resolve to a name and a
 * reason for having had access. Deleting the row turns every one of those
 * entries into an orphan.
 */
export const MEMBERSHIP_STATUS = Object.freeze({
  INVITED: 'invited',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

/**
 * What a membership may do. Stored as a set, not derived from the role.
 *
 * The set exists from the first row because retrofitting it later is a
 * migration across every route that ever asked "is this a doctor". Roles do
 * not extend: a practice manager needs MANAGE_STAFF without PRESCRIBE, and a
 * locum needs PRESCRIBE without MANAGE_STAFF. Neither is expressible as a rank.
 */
export const PERMISSIONS = Object.freeze({
  VIEW_PATIENT: 'VIEW_PATIENT',
  EDIT_RECORD: 'EDIT_RECORD',
  PRESCRIBE: 'PRESCRIBE',
  MANAGE_STAFF: 'MANAGE_STAFF',
  MANAGE_DEPARTMENT: 'MANAGE_DEPARTMENT',
  VIEW_AUDIT: 'VIEW_AUDIT',
  SHARE_RECORDS: 'SHARE_RECORDS',
});

/**
 * The three presets every membership is seeded from.
 *
 * Deliberately not an editor. A permission matrix nobody has asked for is a
 * support burden and a way to lock a clinic out of its own records on a Sunday,
 * so the set is stored per row — which is what makes a custom one possible
 * later — and populated only from these until a customer needs otherwise.
 *
 * PRESCRIBE is granted here but gated again at the point of use: a doctor whose
 * registration number MedPin has not verified holds the permission and still
 * cannot sign. The permission says what the practice allows; verification says
 * what the platform allows.
 */
const P = PERMISSIONS;
export const PRESETS = Object.freeze({
  head: [
    P.VIEW_PATIENT,
    P.EDIT_RECORD,
    P.PRESCRIBE,
    P.MANAGE_STAFF,
    P.MANAGE_DEPARTMENT,
    P.VIEW_AUDIT,
    P.SHARE_RECORDS,
  ],
  clinician: [P.VIEW_PATIENT, P.EDIT_RECORD, P.PRESCRIBE],
  // The desk registers people, books them and takes their weight. It does not
  // prescribe, and it does not read the audit log of who looked at whom.
  desk: [P.VIEW_PATIENT, P.EDIT_RECORD],
});

/** The preset a role starts from. Owners are heads whatever their role says. */
export function presetFor({ role, isOwner = false }) {
  if (isOwner) return [...PRESETS.head];
  if (role === 'doctor') return [...PRESETS.clinician];
  // A dietician edits plans and reads the patients assigned to them; the
  // assignment check lives in /dietician and is not replaced by this.
  return [...PRESETS.desk];
}

const membershipSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    /// What this person is *here*. The same vocabulary as `User.role`, because
    /// a second set of names for the same four things is how two parts of an
    /// app come to disagree about who a dietician is.
    role: {
      type: String,
      enum: Object.values(ROLES),
      required: true,
    },

    /// The head doctor: may add locations, people, and edit the letterhead.
    ///
    /// A flag rather than a fifth role, because an owner is a doctor who also
    /// administers. Making "owner" a role would force the app to ask "is this
    /// person a doctor OR an owner" at every clinical check, and the day
    /// somebody forgets the second half is the day an owner cannot prescribe.
    isOwner: { type: Boolean, default: false },

    /// The actual grant. Seeded from a preset, stored per row.
    ///
    /// Read by the authorisation middleware rather than inferred from `role`,
    /// so that the day a practice needs a manager who administers but does not
    /// prescribe, it is a value on this row and not a new role threaded through
    /// every guard in the app.
    permissions: {
      type: [String],
      enum: Object.values(PERMISSIONS),
      default: [],
    },

    status: {
      type: String,
      enum: Object.values(MEMBERSHIP_STATUS),
      default: MEMBERSHIP_STATUS.ACTIVE,
      index: true,
    },

    /**
     * Which part of the practice, and which building.
     *
     * ---- Why both live here and not on the User ------------------------
     *
     * Because one person can be two things. A cardiologist consulting at a
     * polyclinic on Tuesdays and running their own evening clinic has two
     * memberships, and the department they belong to is a fact about one of
     * them. Putting either on the account would make changing a job at one
     * practice change it at the other.
     *
     * ---- Both nullable, and both stay nullable -------------------------
     *
     * A solo clinic has no departments and one location; requiring either
     * would make the commonest customer fill in a field whose only value is
     * "the only one there is". Null means "not narrowed", which is what the
     * scoping reads it as — the same rule as everywhere else here.
     *
     * `DoctorDepartment` still exists and still holds a doctor's *several*
     * specialties with their history. This is the one they belong to for the
     * purposes of a staff list — the primary, denormalised so that showing
     * forty people does not mean forty joins.
     */
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },
    location: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Clinic',
      default: null,
      index: true,
    },

    startedOn: { type: Date, default: Date.now },

    /// Null while current. See the note above on why this is not a delete.
    endedOn: { type: Date, default: null },

    /// Who added them, for the audit trail. Absent on the founding rows, which
    /// were created by a migration rather than by a person.
    addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

/// One row per person per practice. A second membership at the same practice is
/// a duplicate, not a promotion — changing someone's role edits the row.
membershipSchema.index({ user: 1, practice: 1 }, { unique: true });

/// "Who works here, and in what capacity" — the admin surface's list, and the
/// query behind every future authorisation check.
membershipSchema.index({ practice: 1, status: 1, role: 1 });

/// True while this membership grants access.
///
/// Both halves matter. An `invited` row is a person who has been added but has
/// not accepted, and an ended row is somebody who used to work here; neither
/// should open a patient record, and checking only `status` misses the second.
membershipSchema.methods.isCurrent = function isCurrent() {
  return this.status === MEMBERSHIP_STATUS.ACTIVE && this.endedOn == null;
};

/**
 * Whether this membership grants an action, here, now.
 *
 * Deliberately one method rather than a permission check and a separate
 * status check at each call site: a suspended member holding PRESCRIBE would
 * pass the obvious `permissions.includes(...)` and should not.
 */
membershipSchema.methods.can = function can(permission) {
  if (!this.isCurrent()) return false;

  // An empty grant means the row predates permissions, not that somebody has
  // been stripped of everything. Those two states look identical in the data
  // and only one of them can actually happen: there is no editor, by design,
  // so nothing can produce a deliberately empty set.
  //
  // The rows the backfill wrote before this field existed are all empty. Read
  // literally, they would deny every action to every member of the practice
  // that is seeing patients this morning — the precise outage the rest of this
  // work has been shaped to avoid. So an empty set falls back to the preset the
  // row's own role and ownership imply, which is what the backfill would have
  // written had it known to.
  const granted = this.permissions?.length
    ? this.permissions
    : presetFor({ role: this.role, isOwner: this.isOwner });

  return granted.includes(permission);
};

/// Seed the grant on the way in, so no row can exist without one.
membershipSchema.pre('validate', function seedPermissions(next) {
  if (!this.permissions?.length) {
    this.permissions = presetFor({ role: this.role, isOwner: this.isOwner });
  }
  next();
});

/**
 * The filter that means "currently a member", as a plain object.
 *
 * Exposed rather than kept inside `currentFor`, because three places needed
 * the same condition and each wrote its own copy — `currentFor`, the practice
 * resolver and the membership lookup. Three copies of a definition is two
 * chances for them to drift, and the one that drifts is the one that stops
 * excluding somebody who left.
 */
membershipSchema.statics.currentFilter = function currentFilter(userId, practiceId = null) {
  return {
    user: userId,
    ...(practiceId ? { practice: practiceId } : {}),
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  };
};

membershipSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    user: String(this.user),
    practice: String(this.practice),
    role: this.role,
    isOwner: Boolean(this.isOwner),
    department: this.department ? String(this.department) : null,
    location: this.location ? String(this.location) : null,
    status: this.status,
    startedOn: this.startedOn,
    endedOn: this.endedOn,
  };
};

export const Membership = mongoose.model('Membership', membershipSchema);
