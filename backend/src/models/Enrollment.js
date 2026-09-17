import mongoose from 'mongoose';

/**
 * A patient at a practice: since when, under which doctor, active or revoked.
 *
 * ---- What this is for ----------------------------------------------------
 *
 * Everything clinical hangs off an enrollment, which names a patient and a
 * practice. That is the sentence the whole multi-tenant design reduces to: no
 * clinical row can exist without saying whose it is.
 *
 * Without it, "which practice does this prescription belong to?" is answered by
 * joining through the doctor who wrote it, which fails the moment a doctor
 * works at two practices — and fails silently, by returning the wrong
 * practice's records rather than none.
 *
 * ---- Access is not retroactive -------------------------------------------
 *
 * `enrolledOn` is not decoration. A practice reads its patient's record from
 * that date forward. Rahul walking into a second clinic today does not hand
 * them four years of the first clinic's notes; he shares those deliberately,
 * through a share grant, or not at all.
 *
 * This is why the date is on the enrollment rather than inferred from the first
 * record: a practice that enrolled a patient in March and wrote nothing until
 * June still may not read May.
 *
 * ---- Revoked deletes nothing ---------------------------------------------
 *
 * Revoking ends future access. The prescriptions already written remain, and
 * remain readable by the practice that wrote them, because a record one party
 * can erase is not a record. What stops is the practice's ability to see
 * anything new.
 */
export const ENROLLMENT_STATUS = Object.freeze({
  /// Created, awaiting the patient's consent — the OTP has been sent and not
  /// yet answered. Grants nothing.
  PENDING: 'pending',
  ACTIVE: 'active',
  REVOKED: 'revoked',
});

/**
 * How the dietician on an enrolment came to be there.
 *
 *   auto      — the practice's only active dietician, taken on by default
 *   doctor    — a doctor chose: a dietician, or deliberately nobody
 *   migration — carried over from the single field on the patient's profile,
 *               where assignments lived before they were per practice
 *
 * Null means nothing has been decided for this relationship yet, which is the
 * only state the default is ever allowed to fill. See
 * services/dieticianAssignment.js.
 */
export const DIETICIAN_SOURCE = Object.freeze({
  AUTO: 'auto',
  DOCTOR: 'doctor',
  MIGRATION: 'migration',
});

/**
 * One period somebody held — or nobody held — a patient's nutrition care here,
 * kept when it ends. A dietician who has left is still the person who looked
 * after the patient in March, and the record has to be able to say so.
 */
const dieticianPeriodSchema = new mongoose.Schema(
  {
    dietician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    source: { type: String, enum: Object.values(DIETICIAN_SOURCE) },
    /// Null where it was never recorded: an assignment carried over from the
    /// profile has no date, and inventing today's would misdate it.
    since: { type: Date, default: null },
    by: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    endedAt: { type: Date, required: true },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { _id: false },
);

const enrollmentSchema = new mongoose.Schema(
  {
    /// The body, not the login. A mother and her child at the same practice are
    /// two enrollments under one phone number.
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(ENROLLMENT_STATUS),
      default: ENROLLMENT_STATUS.PENDING,
      index: true,
    },

    /// The date access begins. Never earlier than this row's creation, and the
    /// boundary every clinical read is filtered by. See the note above.
    enrolledOn: { type: Date, default: Date.now },

    /// The clinician or desk account that created the link, for the audit
    /// trail. Absent on rows the migration wrote — nobody enrolled those, they
    /// were already patients when practices came into being.
    enrolledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /// Which doctor at this practice the patient is under. Optional: a
    /// polyclinic patient may belong to the practice without one named doctor,
    /// and forcing a choice would make the desk guess.
    primaryDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /**
     * Who looks after this patient's nutrition at this practice.
     *
     * ---- Why here and not on the patient ------------------------------------
     *
     * It was `PatientProfile.assignedDietician`: one field for the person, so a
     * patient enrolled at two practices could be held by one practice's
     * dietician at a time, and the second practice's choice silently took the
     * patient from the first. Who looks after somebody's nutrition is a fact
     * about their care at a practice, and this is the row that says "this
     * patient, at this practice".
     *
     * It is also the grant. A dietician's caseload is the current enrolments
     * that name them, at the practice they are working in — so an assignment
     * can never reach a patient at a practice the dietician does not belong to.
     */
    dietician: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /// How the current state was decided. Null until anything is. See DIETICIAN_SOURCE.
    dieticianSource: { type: String, enum: Object.values(DIETICIAN_SOURCE), default: null },
    dieticianSince: { type: Date, default: null },
    /// The doctor who decided, or null for the default and the migration.
    dieticianBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /// Every earlier state, appended when it ends and never rewritten.
    dieticianHistory: { type: [dieticianPeriodSchema], default: [] },
  },
  { timestamps: true },
);

/// One enrollment per patient per practice. A second is a duplicate, not a
/// re-enrollment — somebody returning after revoking reactivates this row, so
/// the original `enrolledOn` and the consent history stay attached to it.
enrollmentSchema.index({ patient: 1, practice: 1 }, { unique: true });

/// The patient's chat list — the most-run query in the app once a patient can
/// hold several practices.
enrollmentSchema.index({ patient: 1, status: 1 });

/// "Everyone this practice may see" — the desk's roll and the doctor's day.
enrollmentSchema.index({ practice: 1, status: 1 });

/// A dietician's caseload: the current enrolments at their practice that name
/// them. Read on every screen of the dietician's app.
enrollmentSchema.index({ practice: 1, dietician: 1, status: 1 });

/**
 * Whether this enrollment grants access right now.
 *
 * Pending is not access: the patient has been added at a desk and has not yet
 * answered the code on their own handset. Treating pending as active is exactly
 * the failure the OTP step exists to prevent — a typo at the counter attaching
 * a practice to a stranger's record.
 */
enrollmentSchema.methods.isCurrent = function isCurrent() {
  return this.status === ENROLLMENT_STATUS.ACTIVE && this.revokedAt == null;
};

/**
 * Whether a record created at `when` is inside this enrollment's window.
 *
 * The second half of "access is not retroactive". A practice that may see the
 * patient still may not see what happened before it was given access.
 */
enrollmentSchema.methods.covers = function covers(when) {
  if (!this.isCurrent()) return false;
  if (!when) return true;
  return new Date(when) >= new Date(this.enrolledOn);
};

enrollmentSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    patient: String(this.patient),
    practice: String(this.practice),
    status: this.status,
    enrolledOn: this.enrolledOn,
    primaryDoctor: this.primaryDoctor ? String(this.primaryDoctor) : null,
    revokedAt: this.revokedAt,
  };
};

export const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
