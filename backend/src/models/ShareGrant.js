import mongoose from 'mongoose';

import { ROLES } from './User.js';

/**
 * A patient letting one of their practices see more of their record than its
 * enrolment does.
 *
 * ---- What an enrolment already gives, and what this adds ----------------
 *
 * A practice reads a patient's dated records from `enrolledOn` forward (see
 * `recordWindow` in middleware/authorise.js). Rahul joining a second clinic
 * today does not hand them four years of the first clinic's notes.
 *
 * A grant is how he hands some of them over on purpose. It names:
 *
 *   - the practice that may read      (always one of his current practices)
 *   - optionally one doctor there     (nobody else at that practice benefits)
 *   - which categories of record      (prescriptions, readings, …)
 *   - optionally when it ends         (and it can be revoked at any moment)
 *
 * and widens nothing else. It lets that practice read those categories from
 * before its enrolment; it never lets anybody write, never opens a patient the
 * practice is not enrolled with, and gives nothing once it has expired or been
 * revoked — checked at the moment of every read, not by a sweep.
 *
 * ---- The one rule the shape has to encode -------------------------------
 *
 * The patient grants it, and the patient revokes it. Never the practice that
 * wants the access, and never the practice that holds the records.
 *
 * A practice may *ask* — a row in state `requested`, created by a clinician
 * holding SHARE_RECORDS — and asking grants nothing. It becomes a grant only
 * when the patient approves it in their own app, and `grantedBy` then names
 * them. A clinic able to grant itself access would have an enrolment meaning
 * something quite different from what the patient agreed to; a clinic able to
 * refuse to share would be holding a record hostage. Both directions belong to
 * the person the record is about.
 *
 * ---- Why categories are a list and not "everything" ---------------------
 *
 * The first sketch of this model had a `full` scope. A grant of "everything"
 * silently widens the day a new kind of record is added, which is a default
 * expanding access that nobody chose. A list of named categories means exactly
 * what the patient saw when they said yes.
 */
export const SHARE_CATEGORY = Object.freeze({
  /// Prescriptions, and the tests they advised.
  PRESCRIPTIONS: 'prescriptions',
  /// Blood sugar, blood pressure and weight.
  READINGS: 'readings',
  /// HbA1c, uploaded lab reports and ECGs.
  LAB_RESULTS: 'lab_results',
  /// Eye and foot examinations.
  EXAMINATIONS: 'examinations',
  /// Food photos and lifestyle logs.
  LIFESTYLE: 'lifestyle',
});

export const GRANT_STATE = Object.freeze({
  /// A practice asked. Grants nothing until the patient approves.
  REQUESTED: 'requested',
  /// In force — unless `expiresAt` has passed, which is read at every check
  /// rather than written by a job.
  ACTIVE: 'active',
  /// The patient said no to a request.
  DECLINED: 'declined',
  /// Ended: by the patient, or because the enrolment it widened ended.
  REVOKED: 'revoked',
});

/// Where the row came from — provenance, so a grant can always say how it
/// came to exist without anybody inferring it.
export const GRANT_ORIGIN = Object.freeze({
  /// The patient chose it from "Who can see my records?".
  PATIENT_APP: 'patient_app',
  /// The patient answered the one-time question asked after a desk connected
  /// an existing account to a new practice.
  HISTORY_PROMPT: 'history_prompt',
  /// A practice asked and the patient approved.
  PRACTICE_REQUEST: 'practice_request',
});

export const REVOKE_REASON = Object.freeze({
  /// The patient withdrew it.
  PATIENT: 'patient',
  /// The practice's enrolment ended, so the grant went with it — otherwise a
  /// later re-enrolment would quietly bring back history the patient shared
  /// under a relationship that had ended.
  ENROLMENT_ENDED: 'enrolment_ended',
});

const shareGrantSchema = new mongoose.Schema(
  {
    /// The body, not the login: a mother sharing her child's record grants on
    /// the child's row.
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'Patient', required: true, index: true },

    /// Who may read.
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', required: true, index: true },

    /// The relationship this widens. A grant is meaningless without one, and
    /// a grant pointing at an enrolment other than the one a read is made under
    /// is ignored by that read.
    enrollment: { type: mongoose.Schema.Types.ObjectId, ref: 'Enrollment', required: true },

    /// One doctor at that practice, or null for anybody there who may already
    /// open the patient.
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    categories: {
      type: [{ type: String, enum: Object.values(SHARE_CATEGORY) }],
      validate: {
        validator: (v) => Array.isArray(v) && v.length > 0,
        message: 'A grant names at least one category of record.',
      },
    },

    state: { type: String, enum: Object.values(GRANT_STATE), required: true, index: true },
    origin: { type: String, enum: Object.values(GRANT_ORIGIN), required: true },

    /// Who wrote the row: the patient (or their guardian) for a grant, the
    /// clinician for a request.
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    createdByRole: { type: String, enum: Object.values(ROLES), required: true },

    /// What the practice said when it asked. Shown to the patient verbatim.
    requestNote: { type: String, trim: true, maxlength: 300, default: null },

    /// Always the patient's login. Recorded rather than assumed, so the row can
    /// be audited without inferring who must have acted.
    grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    grantedAt: { type: Date, default: null },

    /// Null means until revoked. The patient chooses; a grant with no end is
    /// allowed because a patient moving their care wants their history to stay
    /// with the practice now treating them, and "Who can see my records?"
    /// lists every open-ended grant so none of them is forgotten.
    expiresAt: { type: Date, default: null },

    revokedAt: { type: Date, default: null },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    revokeReason: { type: String, enum: [...Object.values(REVOKE_REASON), null], default: null },

    declinedAt: { type: Date, default: null },
    declinedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /// The answer to the history question this grant came from, when it did.
    consentEvent: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsentEvent', default: null },

    /// A retried request — see middleware/idempotency.js. A patient tapping
    /// "Share" twice on a slow network should find one grant to revoke, not
    /// two, one of which they will never notice.
    idempotencyKey: { type: String, default: null },
    idempotencyHash: { type: String, default: null },
  },
  { timestamps: true },
);

/// "What has this patient shared with this practice" — asked on every read a
/// clinician makes of a patient, so it is the index that matters.
shareGrantSchema.index({ patient: 1, practice: 1, state: 1 });

/// One open request per patient per practice. A practice asking again while
/// the patient has not answered is nagging, and two open requests would have
/// the patient approve one and find the other still waiting.
shareGrantSchema.index(
  { patient: 1, practice: 1 },
  { unique: true, partialFilterExpression: { state: GRANT_STATE.REQUESTED } },
);

shareGrantSchema.index(
  { createdBy: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } },
);

/**
 * Whether this grant is in force right now.
 *
 * Expiry is checked here rather than by a job that sweeps rows: a grant that
 * expired an hour ago must stop working an hour ago, not whenever the sweep
 * next runs.
 */
shareGrantSchema.methods.isCurrent = function isCurrent(now = new Date()) {
  return (
    this.state === GRANT_STATE.ACTIVE &&
    this.revokedAt == null &&
    (this.expiresAt == null || new Date(this.expiresAt) > now)
  );
};

/**
 * Whether this grant lets `userId` read `category` right now.
 *
 * A static over plain objects as well as a method, because the reads that ask
 * it hold lean rows and a hydrated document per grant per request would be
 * spent on nothing.
 */
export function grantCovers(grant, { category, userId, now = new Date() }) {
  if (!grant) return false;
  if (grant.state !== GRANT_STATE.ACTIVE || grant.revokedAt != null) return false;
  if (grant.expiresAt != null && new Date(grant.expiresAt) <= now) return false;
  if (!category || !(grant.categories ?? []).includes(category)) return false;
  // Narrowed to one doctor: everybody else at the practice reads only what the
  // enrolment gives them.
  if (grant.doctor && String(grant.doctor) !== String(userId)) return false;
  return true;
}

/** What a grant is called on screen and in the history: its state, with expiry read in. */
export function grantStatus(grant, now = new Date()) {
  if (grant.state === GRANT_STATE.ACTIVE && grant.expiresAt && new Date(grant.expiresAt) <= now) {
    return 'expired';
  }
  return grant.state;
}

shareGrantSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    patient: String(this.patient),
    practice: String(this.practice),
    doctor: this.doctor ? String(this.doctor) : null,
    categories: [...(this.categories ?? [])],
    state: this.state,
    status: grantStatus(this),
    origin: this.origin,
    requestNote: this.requestNote ?? null,
    grantedAt: this.grantedAt,
    expiresAt: this.expiresAt,
    revokedAt: this.revokedAt,
    revokeReason: this.revokeReason ?? null,
    declinedAt: this.declinedAt,
    createdAt: this.createdAt,
  };
};

export const ShareGrant = mongoose.model('ShareGrant', shareGrantSchema);
