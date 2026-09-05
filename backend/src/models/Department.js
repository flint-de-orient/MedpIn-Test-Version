import mongoose from 'mongoose';

/**
 * A medical specialty a doctor practises in.
 *
 * A row, not a hardcoded list. The eight the platform ships with — General
 * Physician, Gynaecologist, Paediatrician and the rest — are seeded rows like
 * any other, so adding Neurology is a database write rather than a deploy.
 *
 * ---- Why global and practice-owned in one table -------------------------
 *
 * `practice: null` means shared: every practice sees it, nobody may edit it.
 * That is where the standard specialties live, because "Cardiologist" means the
 * same thing in Salt Lake and in Behala, and a hundred practices each keeping
 * their own copy of it is a hundred slightly different spellings on a hundred
 * prescription letterheads.
 *
 * A practice may add its own — "Diabetic Foot Clinic", "Antenatal Day Unit" —
 * and those carry its id. The field is here from the first row rather than
 * added later, because retrofitting a scope onto rows that already exist means
 * deciding what the existing ones belonged to, and that is a guess.
 *
 * ---- What a department carries besides a name ---------------------------
 *
 * Two things that make the app fit the patient rather than the other way round:
 * which cards its patients see on their Home tab, and which red flags apply to
 * them. Both hang here so that a new specialty brings its own behaviour with
 * it, and — importantly — brings *no* clinical behaviour until a clinician
 * writes some.
 */
const departmentSchema = new mongoose.Schema(
  {
    /// Stable machine name: `cardiology`, `general_physician`. Never shown.
    ///
    /// Referenced by seeds, tests and any future clinical rule, so it must not
    /// change when somebody edits the display name.
    key: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-z][a-z0-9_]{1,48}$/,
    },

    /// What a reader sees, in each language the app speaks.
    ///
    /// English is required and the others fall back to it. A department with no
    /// Bengali name shows the English one, which is what a clinic that has just
    /// added "Diabetic Foot Clinic" at four in the afternoon needs to happen.
    names: {
      en: { type: String, required: true, trim: true, maxlength: 80 },
      bn: { type: String, trim: true, maxlength: 80 },
      hi: { type: String, trim: true, maxlength: 80 },
    },

    /// Null for the specialties every practice shares. See the note above.
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', default: null, index: true },

    /// Which Home cards this department's patients see — `['glucose', 'hba1c']`.
    ///
    /// Empty by default, and that is the correct default: a department whose
    /// cards nobody has chosen shows the general ones, rather than showing a
    /// blood-sugar chart to a paediatric asthma patient.
    homeCards: { type: [String], default: [] },

    /// What this specialty's assistant covers, and what it refuses.
    ///
    /// ---- Why this is data and not prose in a prompt file ---------------
    ///
    /// The system prompt was written for one clinic and says so: "You ONLY help
    /// with his areas of practice: Diabetes, Thyroid, PCOS…", then refuses skin
    /// rashes, coughs, broken bones and children's illness by name. Correct for
    /// a diabetologist. Fatal for the dermatology practice whose patients are
    /// told their rash is out of scope.
    ///
    /// A specialty an admin adds cannot bring a code change with it, so the
    /// scope lives on the row the admin creates.
    ///
    /// ---- Empty means no assistant, not a general one -------------------
    ///
    /// A department nobody has written a scope for gets silence in its thread,
    /// for the same reason `triageRules` starts empty: an assistant improvising
    /// cardiology answers out of diabetes guidance is worse than none, because
    /// the patient cannot tell the difference and neither can the doctor
    /// reviewing it afterwards.
    assistantScope: {
      /// How the assistant introduces itself — "a cardiology assistant".
      /// Absent, there is no assistant in this department's thread at all.
      role: { type: String, trim: true, maxlength: 200, default: null },
      /// What it may help with. One line each in the prompt.
      covers: { type: [String], default: [] },
      /// What it must decline and redirect rather than answer badly.
      refuses: { type: [String], default: [] },
    },

    /// Red-flag rule ids that apply to this department's patients.
    ///
    /// Deliberately empty on a new row, and it stays empty until a clinician in
    /// that specialty writes them. Obstetric bleeding is not in the diabetes
    /// rules and cannot be inferred from them. No triage is honest; inherited
    /// triage looks like safety and is not.
    triageRules: { type: [String], default: [] },

    /// Seeded rows are marked, so a re-seed can leave edited ones alone.
    isSeed: { type: Boolean, default: false },

    isActive: { type: Boolean, default: true, index: true },

    /// Display order. The general physician sits first because most patients
    /// start there.
    sortIndex: { type: Number, default: 100 },
  },
  { timestamps: true },
);

/// One key per scope. Two practices may both define `foot_clinic`; one practice
/// may not define it twice, and neither may collide with a shared specialty of
/// the same key — which the partial index below cannot express, so
/// [keyIsAvailable] checks it.
departmentSchema.index({ practice: 1, key: 1 }, { unique: true });

/**
 * True when `key` may be used by `practice`.
 *
 * Checks the practice's own rows AND the shared ones, because a practice
 * defining `cardiology` alongside the platform's would give its doctors two
 * indistinguishable departments with one name.
 */
departmentSchema.statics.keyIsAvailable = async function keyIsAvailable(key, practice) {
  const clash = await this.exists({
    key: String(key).toLowerCase(),
    $or: [{ practice: null }, { practice }],
  });
  return !clash;
};

departmentSchema.methods.nameIn = function nameIn(language = 'en') {
  return this.names?.[language] || this.names?.en || this.key;
};

departmentSchema.methods.toPublic = function toPublic(language = 'en') {
  return {
    id: String(this._id),
    key: this.key,
    name: this.nameIn(language),
    names: { en: this.names?.en, bn: this.names?.bn ?? null, hi: this.names?.hi ?? null },
    isShared: this.practice == null,
    homeCards: this.homeCards ?? [],
    // Whether this department can answer a patient at all. The screen reads it
    // to say "no assistant in this thread" rather than showing a composer that
    // silently does nothing.
    hasAssistant: Boolean(this.assistantScope?.role),
    isActive: this.isActive,
    sortIndex: this.sortIndex,
  };
};

export const Department = mongoose.model('Department', departmentSchema);
