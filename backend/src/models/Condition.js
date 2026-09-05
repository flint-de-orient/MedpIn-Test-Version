import mongoose from 'mongoose';

/**
 * An illness the app knows how to look after.
 *
 * ---- Why this is a table and `diabetesType` was a column -----------------
 *
 * The app was built for one illness, so the illness lived in the schema:
 * `diabetesType` on the profile, `comorbidities` as nine loose strings beside
 * it. That arrangement has two costs and the second is the expensive one.
 *
 * Adding asthma is a schema change, a migration and a deploy. And more
 * importantly, "Type 2" is a fact about the diabetes, not about Rahul — putting
 * it on the person means a patient with two illnesses has nowhere to put the
 * second one's detail.
 *
 * So the illness becomes a row, the person's relationship to it becomes
 * [PatientCondition], and the type of their diabetes becomes detail on that
 * relationship.
 *
 * ---- What a condition carries besides a name ----------------------------
 *
 * The two things that make the app fit the patient: which cards their Home tab
 * shows, and which red flags apply to them. Diabetes brings the sugar chart and
 * the HbA1c tile; hypertension brings blood pressure; asthma would bring peak
 * flow. No condition brings no cards — which is the honest answer to a screen
 * full of empty sections.
 *
 * Shared by default (`practice: null`) for the same reason departments are:
 * hypertension means the same thing everywhere, and a hundred practices each
 * keeping their own copy is a hundred spellings of one illness.
 */
const conditionSchema = new mongoose.Schema(
  {
    /// Stable machine name: `diabetes`, `hypertension`. Never shown.
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,48}$/,
    },

    /// What a reader sees, in each language the app speaks. English required,
    /// the others fall back to it.
    names: {
      en: { type: String, required: true, trim: true, maxlength: 80 },
      bn: { type: String, trim: true, maxlength: 80 },
      hi: { type: String, trim: true, maxlength: 80 },
    },

    /// Null for the illnesses every practice shares. See the note above.
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Practice', default: null, index: true },

    /// Which Home cards a patient with this condition sees.
    ///
    /// Empty is a real answer, not a missing one: a condition whose cards
    /// nobody has chosen shows none, rather than showing a blood-sugar chart to
    /// somebody with asthma.
    homeCards: { type: [String], default: [] },

    /// Red-flag rule ids that apply to a patient with this condition.
    ///
    /// Empty on a new row and it stays empty until a clinician in that field
    /// writes them. The 21 existing rules are diabetes-tuned; an asthma
    /// exacerbation is not among them and cannot be inferred from them. No
    /// triage is honest; inherited triage looks like safety and is not.
    triageRules: { type: [String], default: [] },

    /// Shape of the `detail` this condition expects on a patient's row.
    ///
    /// Advisory, not enforced — it tells the UI which extra question to ask
    /// ("which type?") and documents what the JSON holds. The structure-versus-
    /// JSON rule still applies: anything that would ever appear in a query is a
    /// column, not detail.
    detailFields: {
      type: [
        {
          _id: false,
          key: { type: String, required: true },
          label: { type: String, required: true },
          options: { type: [String], default: [] },
        },
      ],
      default: [],
    },

    isSeed: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    sortIndex: { type: Number, default: 100 },
  },
  { timestamps: true },
);

/// One key per scope. Two practices may both add `long_covid`; one may not add
/// it twice, and neither may collide with a shared condition of the same key —
/// which the index cannot express, so [keyIsAvailable] checks it.
conditionSchema.index({ practice: 1, key: 1 }, { unique: true });

conditionSchema.statics.keyIsAvailable = async function keyIsAvailable(key, practice) {
  const clash = await this.exists({
    key: String(key).toLowerCase(),
    $or: [{ practice: null }, { practice }],
  });
  return !clash;
};

conditionSchema.methods.nameIn = function nameIn(language = 'en') {
  return this.names?.[language] || this.names?.en || this.key;
};

conditionSchema.methods.toPublic = function toPublic(language = 'en') {
  return {
    id: String(this._id),
    key: this.key,
    name: this.nameIn(language),
    names: { en: this.names?.en, bn: this.names?.bn ?? null, hi: this.names?.hi ?? null },
    isShared: this.practice == null,
    homeCards: this.homeCards ?? [],
    detailFields: (this.detailFields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      options: f.options ?? [],
    })),
    isActive: this.isActive,
    sortIndex: this.sortIndex,
  };
};

export const Condition = mongoose.model('Condition', conditionSchema);
