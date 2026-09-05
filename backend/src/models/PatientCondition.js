import mongoose from 'mongoose';

/**
 * A person's relationship to an illness.
 *
 * ---- Why the type of diabetes lives here --------------------------------
 *
 * `diabetesType` was a column on the patient, which quietly asserted that a
 * person has at most one illness worth qualifying. "Type 2" is a fact about the
 * diabetes; the year it was diagnosed is a fact about the diabetes; whether it
 * is controlled is a fact about the diabetes. All of it belongs on the row that
 * joins the person to the illness, not on the person.
 *
 * That is also what makes a second illness possible without a second column.
 *
 * ---- What goes in `detail`, and what does not ---------------------------
 *
 * The rule from the specification: if you would ever put it in a `where`
 * clause, it is a column. JSON only for condition-specific detail nobody
 * queries.
 *
 * So `status` and `diagnosedOn` are columns — the app filters and sorts on
 * both. The diabetes type is detail: it is displayed, printed and passed to the
 * assistant, and nothing searches for it. If that changes, it becomes a column
 * and this comment is the reason it was not one already.
 */
export const CONDITION_STATUS = Object.freeze({
  /// Being treated now. The only status that contributes Home cards.
  ACTIVE: 'active',
  /// Was true, no longer is — gestational diabetes after delivery.
  RESOLVED: 'resolved',
  /// Noted, not confirmed. Carries no cards and no triage, because acting on a
  /// suspicion as though it were a diagnosis is how a screen misleads a doctor.
  SUSPECTED: 'suspected',
});

const patientConditionSchema = new mongoose.Schema(
  {
    /// The person. A `User` today; this becomes `Patient` at step 8, when one
    /// login may hold a mother, a child and a grandmother. The ref moves and
    /// nothing else on this row does.
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    condition: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Condition',
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: Object.values(CONDITION_STATUS),
      default: CONDITION_STATUS.ACTIVE,
      index: true,
    },

    /// Condition-specific facts nobody queries. See the note above.
    /// For diabetes: `{ type: 'type2' }`.
    detail: { type: mongoose.Schema.Types.Mixed, default: {} },

    diagnosedOn: { type: Date, default: null },

    /// Who recorded it. Absent on rows the migration wrote from the old columns,
    /// which is honest: nobody recorded those, they were inferred.
    diagnosedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

    /// Free-text the clinician added. Not searched, not shown to the patient.
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

/// One row per person per condition. Recording the same illness twice is a
/// duplicate, not a second diagnosis — a change of type edits the row.
patientConditionSchema.index({ patient: 1, condition: 1 }, { unique: true });

/// "Which cards, which triage rules" — read on every Home load.
patientConditionSchema.index({ patient: 1, status: 1 });

/// Only an active condition contributes cards or red flags. A resolved
/// gestational diabetes should not keep a sugar chart on Home for life, and a
/// suspicion should not put one there at all.
patientConditionSchema.methods.isCurrent = function isCurrent() {
  return this.status === CONDITION_STATUS.ACTIVE;
};

patientConditionSchema.methods.toPublic = function toPublic(language = 'en') {
  const c = this.condition;
  const populated = c && typeof c === 'object' && c.key !== undefined;

  return {
    id: String(this._id),
    condition: populated
      ? { id: String(c._id), key: c.key, name: c.names?.[language] || c.names?.en || c.key }
      : { id: String(c) },
    status: this.status,
    detail: this.detail ?? {},
    diagnosedOn: this.diagnosedOn,
    note: this.note ?? null,
  };
};

export const PatientCondition = mongoose.model('PatientCondition', patientConditionSchema);
