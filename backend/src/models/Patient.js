import mongoose from 'mongoose';

/**
 * A body. One login may hold several.
 *
 * ---- Why this is separate from the login --------------------------------
 *
 * `User` is a person who can sign in: one phone number, globally unique. That
 * was the same thing as a patient while every patient had their own handset,
 * and it stops being the same thing the moment a family shares one.
 *
 * Renu is eighty and has never touched a phone; her record lives under the
 * login of whoever brings her. Aarav is four and does not have a number. Both
 * are patients with readings, prescriptions and reminders of their own, and
 * neither can be a `User` without inventing a phone number that nobody answers.
 *
 * So the login stays the login, and the body gets its own row.
 *
 * ---- The migration trick, and why it matters ----------------------------
 *
 * Twenty-one collections point at a patient by `User._id`. Rewriting all of
 * them would be the largest and riskiest migration in the project.
 *
 * They do not have to be. The backfill gives each existing patient a `Patient`
 * row whose `_id` **is** their `User._id`, so every prescription, reading and
 * appointment already holds the right value. Re-pointing a ref from `'User'` to
 * `'Patient'` becomes a one-word change with no data migration behind it, and
 * the two can be done a collection at a time instead of in one commit.
 *
 * The ids diverge only for a family member added after this ships, who has a
 * `Patient` row and no `User` at all — which is exactly the case that could not
 * be represented before.
 *
 * ---- Detach is one field --------------------------------------------------
 *
 * Aarav turns eighteen and wants his own login. His `Patient` row keeps its
 * `_id` and `login` points at his new account. Every reading, every enrollment
 * and every prescription follows him without moving, and the practices see no
 * change at all — which is the whole reason the record hangs off this row
 * rather than off the phone number.
 */
export const RELATIONSHIP = Object.freeze({
  /// The login holder themselves. Every backfilled row is one of these.
  SELF: 'self',
  CHILD: 'child',
  PARENT: 'parent',
  SPOUSE: 'spouse',
  OTHER: 'other',
});

const patientSchema = new mongoose.Schema(
  {
    /// Whose phone reaches this person. Changes on detach; never null, because
    /// a patient nobody can be contacted about is a record with no way to send
    /// a reminder or a result.
    login: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    /// Their own name, not the account holder's. "Aarav", not "Priya's child" —
    /// a reminder that says the wrong name on a phone carrying three people's
    /// prescriptions is a dose given to the wrong person.
    name: { type: String, required: true, trim: true, maxlength: 120 },

    dateOfBirth: { type: Date, default: null },
    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'undisclosed'],
      default: 'undisclosed',
    },

    /// How they relate to the login holder. `self` for the holder.
    relationship: {
      type: String,
      enum: Object.values(RELATIONSHIP),
      default: RELATIONSHIP.SELF,
    },

    /// Soft-disable, so records keep a valid patient when somebody is removed
    /// from a family. Nothing clinical is ever hard-deleted.
    isActive: { type: Boolean, default: true, index: true },

    /// When this row moved to its own login, and which one it came from. Kept
    /// so a detached record can still explain its own history.
    detachedAt: { type: Date, default: null },
    detachedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

/// "Who does this login look after" — the family switcher, read on app start.
patientSchema.index({ login: 1, isActive: 1 });

/**
 * Move this patient to a login of their own.
 *
 * The `_id` does not change, which is the point: readings, prescriptions,
 * appointments and enrollments all continue to name this row, so a practice
 * sees no change whatever. Only the phone that reaches them moves.
 */
patientSchema.methods.detachTo = function detachTo(newLoginId) {
  this.detachedFrom = this.login;
  this.detachedAt = new Date();
  this.login = newLoginId;
  // No longer somebody's dependant — they are their own account holder now.
  this.relationship = RELATIONSHIP.SELF;
  return this;
};

patientSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    login: String(this.login),
    name: this.name,
    dateOfBirth: this.dateOfBirth,
    gender: this.gender,
    relationship: this.relationship,
    isActive: this.isActive,
  };
};

export const Patient = mongoose.model('Patient', patientSchema);
