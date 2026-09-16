import mongoose from 'mongoose';

/**
 * The lifecycle every clinical record shares. Nothing is ever hard-deleted.
 *
 * ---- Why three states and not a flag ------------------------------------
 *
 * `isActive: false` says a record is no longer in force. It cannot say whether
 * it was issued in error, corrected, or replaced by a later version — and those
 * are three different clinical facts with three different consequences.
 *
 * A prescription **voided** was wrong when it was written: the patient should
 * not act on it and probably never should have. One **corrected** was right in
 * substance and wrong in a detail, and both versions matter, because the
 * patient may have been dispensed against the first. One **superseded** was
 * correct and has simply been replaced by a newer plan.
 *
 * Told apart, a pharmacist reading the record knows which. Collapsed into a
 * flag, they know only that something changed.
 *
 * ---- Why nothing is removed ---------------------------------------------
 *
 * A record one party can erase is not a record. If a patient disputes what they
 * were told to take, a deleted prescription is indistinguishable from one that
 * never existed — and the party who can delete is the party the dispute is
 * with.
 *
 * So the row stays, carrying who ended it, when, and why. The `reason` is not
 * optional decoration: "voided" with no explanation is the same problem one
 * level down.
 *
 * ---- Applying it ---------------------------------------------------------
 *
 *   prescriptionSchema.plugin(clinicalRecord);
 *
 * It adds the fields, an index, `isCurrent()`, and `void`/`correct`/`supersede`
 * helpers. It deliberately does **not** add a `remove` of any kind.
 *
 * ---- Readings: `{ hideVoided: true }` ------------------------------------------
 *
 * A glucose reading typed with a wrong digit, or a lab report uploaded for the
 * wrong person, has to stop counting — in the trend, the risk score, the panels,
 * the assistant's context — without disappearing. They used to be deleted, and
 * a lab report's deletion took with it every clinic glucose reading that
 * happened to share its value and date.
 *
 * With this option every find, count, distinct and aggregate on the model leaves
 * voided entries out, so the forty places that read readings do not each have
 * to remember to. A query that names `recordState` itself is left alone: that
 * is how the history and audit views ask for everything (see WITH_VOIDED).
 * Prescriptions do not use it — a superseded prescription is history the lists
 * show on purpose.
 */

/**
 * Filter fragment that includes voided entries on a model that hides them.
 * `$nin: []` matches every document, including those written before
 * `recordState` existed, and naming the field turns the hiding off.
 */
export const WITH_VOIDED = Object.freeze({ recordState: { $nin: [] } });
export const RECORD_STATE = Object.freeze({
  /// In force.
  CURRENT: 'current',
  /// Issued in error. The patient should not act on it.
  VOIDED: 'voided',
  /// Replaced because it was wrong in a detail. Both versions are kept.
  CORRECTED: 'corrected',
  /// Replaced by a later version. This one was right at the time.
  SUPERSEDED: 'superseded',
});

/** The states in which a record no longer stands. */
const ENDED = [RECORD_STATE.VOIDED, RECORD_STATE.CORRECTED, RECORD_STATE.SUPERSEDED];

export function clinicalRecord(schema, { hideVoided = false } = {}) {
  schema.add({
    recordState: {
      type: String,
      enum: Object.values(RECORD_STATE),
      default: RECORD_STATE.CURRENT,
      index: true,
    },

    /// Who ended it, when, and why. All three, or the entry answers "what
    /// happened" and none of the questions that follow it.
    endedAt: { type: Date, default: null },
    endedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    /// In what capacity — the patient correcting their own log is a different
    /// act from a clinician withdrawing a result.
    endedByRole: { type: String, default: null },
    endedReason: { type: String, trim: true, maxlength: 500, default: null },

    /// The record that replaced this one, for a correction or a supersession.
    /// Null for a voiding: nothing replaced it, it should not have existed.
    replacedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  });

  /// "What is in force for this patient" — the query behind every clinical list.
  schema.index({ recordState: 1, updatedAt: -1 });

  schema.methods.isCurrent = function isCurrent() {
    return (this.recordState ?? RECORD_STATE.CURRENT) === RECORD_STATE.CURRENT;
  };

  /**
   * End this record.
   *
   * Not exported as three near-identical methods by accident: the caller has to
   * name which of the three happened, and cannot end a record without saying
   * why.
   */
  if (hideVoided) {
    const leavesOutVoided = function leavesOutVoided() {
      if (Object.prototype.hasOwnProperty.call(this.getFilter(), 'recordState')) return;
      this.where({ recordState: { $ne: RECORD_STATE.VOIDED } });
    };
    schema.pre(['find', 'findOne', 'countDocuments', 'distinct'], leavesOutVoided);
    schema.pre('aggregate', function leavesOutVoidedAggregate() {
      const first = this.pipeline()[0];
      if (first?.$match && Object.prototype.hasOwnProperty.call(first.$match, 'recordState')) return;
      this.pipeline().unshift({ $match: { recordState: { $ne: RECORD_STATE.VOIDED } } });
    });
  }

  schema.methods.endAs = function endAs(state, { by = null, byRole = null, reason, replacedBy = null } = {}) {
    if (!ENDED.includes(state)) {
      throw new Error(`endAs expects one of ${ENDED.join(', ')}, got ${state}`);
    }
    if (!reason || !String(reason).trim()) {
      // The rule that makes the rest of it worth having. A voided prescription
      // with no reason tells a later reader that somebody changed their mind
      // and nothing else.
      throw new Error('Ending a clinical record requires a reason.');
    }

    this.recordState = state;
    this.endedAt = new Date();
    this.endedBy = by;
    this.endedByRole = byRole;
    this.endedReason = String(reason).trim();
    this.replacedBy = replacedBy;

    // Kept in step for the routes and screens that still read the old flag.
    // They go on working, and this can be removed when none does.
    if ('isActive' in this) this.isActive = false;

    return this;
  };

  schema.statics.RECORD_STATE = RECORD_STATE;
}
