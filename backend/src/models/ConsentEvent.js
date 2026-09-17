import mongoose from 'mongoose';

/**
 * What was agreed, by whom, when, and on what basis.
 *
 * ---- Why a status field is not enough ------------------------------------
 *
 * `Enrollment.status` says where things stand now. It cannot answer the
 * question that actually gets asked when something goes wrong: who granted
 * this, when, and how did they prove it was them.
 *
 * A field that is overwritten each time loses the answer at the exact moment it
 * becomes valuable. If a patient says "I never agreed to that clinic seeing my
 * records", a status of `revoked` tells you they do not agree *now* — which is
 * not in dispute. The log tells you whether they ever did, which handset
 * answered, and which words they were shown.
 *
 * So these append and never update. The enrollment's status becomes a
 * projection of the latest event rather than the source of truth.
 *
 * ---- The wording version -------------------------------------------------
 *
 * `wording` records which consent text the patient was shown. Consent to a
 * sentence you later rewrite is not consent to the rewrite, and a clinic that
 * cannot say which version somebody agreed to has a signature on a blank page.
 */
export const CONSENT_ACTION = Object.freeze({
  REQUESTED: 'requested',
  GRANTED: 'granted',
  REVOKED: 'revoked',

  /*
   * The patient's answer to the two questions asked once per consent:
   * "share my own health logs with this clinic" and "share my earlier history
   * with this clinic".
   *
   * Asked when a practice enrols them — at the desk, in the same step as the
   * code, or in their own app afterwards. `sharing_given` when either answer
   * was yes (and `grants` names what that created), `sharing_declined` when
   * both were no. An answer is a consent decision like the three above, so it
   * lives in the same log; it does not move the enrolment between states,
   * which is why `latestFor` leaves it out.
   */
  SHARING_GIVEN: 'sharing_given',
  SHARING_DECLINED: 'sharing_declined',
});

/// The actions that move an enrolment between pending, active and revoked —
/// the ones its status is a projection of.
export const RELATIONSHIP_ACTIONS = Object.freeze([
  CONSENT_ACTION.REQUESTED,
  CONSENT_ACTION.GRANTED,
  CONSENT_ACTION.REVOKED,
]);

export const CONSENT_METHOD = Object.freeze({
  /// A code read back from the patient's own handset at the desk.
  OTP_DESK: 'otp_desk',
  /// The patient acting in the app themselves.
  IN_APP: 'in_app',
  /// A migration recording what was already true. Never a person's decision.
  MIGRATION: 'migration',
});

const consentEventSchema = new mongoose.Schema(
  {
    enrollment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Enrollment',
      required: true,
      index: true,
    },

    action: { type: String, enum: Object.values(CONSENT_ACTION), required: true },

    /// Who performed it. The patient for a grant in the app, a desk account for
    /// an OTP taken at the counter, null for a migration — which is honest: no
    /// person made that decision.
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    method: { type: String, enum: Object.values(CONSENT_METHOD), required: true },

    /// Which consent text they were shown. See the note above.
    wording: { type: String, trim: true, maxlength: 40, default: null },

    /// Free-text reason, for a revocation the patient explained.
    note: { type: String, trim: true, maxlength: 500 },

    /*
     * What the desk typed when it asked, on a `requested` event.
     *
     * A desk registering a number that already has an account must not be
     * shown anything about that account before its owner consents — not the
     * name on it, not the other numbers it signs in with. So the waiting list
     * is built from these, the desk's own words handed back, and never from
     * the account.
     *
     * `requestedPhone` is also where the code went. It is always a number the
     * account signs in with (that is how the account was found), and the
     * confirmation checks the code against it rather than against whatever the
     * account's primary number happens to be.
     */
    requestedName: { type: String, trim: true, maxlength: 120, default: null },
    requestedPhone: { type: String, trim: true, maxlength: 20, default: null },

    /// On a sharing answer: the `granted` event it answers. Unique, so one
    /// consent is answered once however many times the button is pressed.
    answers: { type: mongoose.Schema.Types.ObjectId, ref: 'ConsentEvent', default: null },

    /// On a sharing answer: each question's answer, what was shared, and the
    /// grants that carry it.
    ownLogs: { type: Boolean, default: undefined },
    history: { type: Boolean, default: undefined },
    categories: { type: [String], default: undefined },
    grants: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'ShareGrant' }], default: undefined },

    /*
     * On a `granted` event: this is somebody coming back to a practice they
     * had withdrawn from.
     *
     * The enrolment keeps its original `enrolledOn`, so the practice goes on
     * reading its own history with them; this is where the new consent is
     * recorded — its own event, its own date, marked for what it is — rather
     * than by moving the enrolment's date.
     */
    reconsent: { type: Boolean, default: undefined },

    at: { type: Date, default: Date.now },
  },
  // No `updatedAt`: these do not change. A timestamp saying a consent record
  // was modified would be a contradiction in terms.
  { timestamps: { createdAt: true, updatedAt: false } },
);

/// The consent history for one relationship, newest last.
consentEventSchema.index({ enrollment: 1, at: 1 });

/// One answer per consent. See `answers`.
consentEventSchema.index(
  { answers: 1 },
  { unique: true, partialFilterExpression: { answers: { $type: 'objectId' } } },
);

/**
 * Append an event. The only way rows are written.
 *
 * There is deliberately no update or delete helper. A log that can be edited is
 * a log that proves nothing, and the absence of the method is the guardrail —
 * somebody would have to write the mutation themselves and explain why.
 */
consentEventSchema.statics.record = function record({
  enrollment,
  action,
  actor = null,
  method,
  wording = null,
  note = null,
  requestedName = null,
  requestedPhone = null,
  answers = null,
  ownLogs = undefined,
  history = undefined,
  categories = undefined,
  grants = undefined,
  reconsent = undefined,
}) {
  return this.create({
    enrollment,
    action,
    actor,
    method,
    wording,
    note,
    requestedName,
    requestedPhone,
    answers,
    ownLogs,
    history,
    categories,
    grants,
    reconsent,
    at: new Date(),
  });
};

/**
 * The latest event that moved the relationship — what the status is a
 * projection of.
 *
 * Only those three actions. A history answer written after the consent is not
 * a change of state, and counting it would make every enrolment whose patient
 * answered the history question look as though its status and its log
 * disagreed.
 */
consentEventSchema.statics.latestFor = function latestFor(enrollmentId) {
  return this.findOne({ enrollment: enrollmentId, action: { $in: RELATIONSHIP_ACTIONS } }).sort({
    at: -1,
    _id: -1,
  });
};

consentEventSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    action: this.action,
    method: this.method,
    wording: this.wording,
    at: this.at,
  };
};

export const ConsentEvent = mongoose.model('ConsentEvent', consentEventSchema);
