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

    status: {
      type: String,
      enum: Object.values(MEMBERSHIP_STATUS),
      default: MEMBERSHIP_STATUS.ACTIVE,
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
 * The practices this person currently belongs to.
 *
 * A static rather than a route helper because authorisation will need it from
 * several places, and the definition of "currently" should exist once.
 */
membershipSchema.statics.currentFor = function currentFor(userId) {
  return this.find({
    user: userId,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  });
};

membershipSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    user: String(this.user),
    practice: String(this.practice),
    role: this.role,
    isOwner: Boolean(this.isOwner),
    status: this.status,
    startedOn: this.startedOn,
    endedOn: this.endedOn,
  };
};

export const Membership = mongoose.model('Membership', membershipSchema);
