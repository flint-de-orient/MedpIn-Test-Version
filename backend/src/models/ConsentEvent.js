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
});

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

    at: { type: Date, default: Date.now },
  },
  // No `updatedAt`: these do not change. A timestamp saying a consent record
  // was modified would be a contradiction in terms.
  { timestamps: { createdAt: true, updatedAt: false } },
);

/// The consent history for one relationship, newest last.
consentEventSchema.index({ enrollment: 1, at: 1 });

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
}) {
  return this.create({ enrollment, action, actor, method, wording, note, at: new Date() });
};

/** The latest event for an enrollment — what the status is a projection of. */
consentEventSchema.statics.latestFor = function latestFor(enrollmentId) {
  return this.findOne({ enrollment: enrollmentId }).sort({ at: -1 });
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
