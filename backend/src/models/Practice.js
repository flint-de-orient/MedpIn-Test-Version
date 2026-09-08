import mongoose from 'mongoose';

/**
 * The business a patient thinks of as "the clinic".
 *
 * `Clinic` in this codebase means a *place* — an address, a phone number, a
 * weekly schedule the slot engine turns into bookable times. That was right
 * while there was one doctor at one address. It stops being right the moment a
 * practice has two branches, because a `Clinic` row carries both the brand
 * ("Dey Diabetes Clinic", the logo, the registration number) and the location
 * (Salt Lake, 10:00–14:00, this phone). Two branches means two rows, which
 * means two copies of the brand, which means renaming the practice renames it
 * in one place and not the other.
 *
 * So the brand moves up here and the place stays down there. One Practice, many
 * Clinic rows beneath it.
 *
 * ---- Nothing is taken away from Clinic ----------------------------------
 *
 * The backfill *copies* the brand fields up; it does not clear them. A location
 * that sets its own name or phone keeps winning over the practice's — see
 * [services/clinicIdentity.js], where the resolution order is location, then
 * practice, then the environment.
 *
 * That order is not an accident. The settings screen the clinic uses today
 * writes to the Clinic row. If the practice won, saving that screen would look
 * like it had done nothing. Beneath that, it is also the semantics a polyclinic
 * wants: the practice brand is the default and a branch may override it.
 *
 * ---- Verification is not access -----------------------------------------
 *
 * `status` says whether the practice may use the app. `verification` says
 * whether a human has checked the registration papers. They are separate
 * fields because collapsing them means either a verified practice that cannot
 * log in or an unverified one that can print prescriptions, and the honest
 * arrangement is a practice that works from day one while its badge says
 * pending.
 */
export const PRACTICE_STATUS = Object.freeze({
  ONBOARDING: 'onboarding',
  ACTIVE: 'active',
  SUSPENDED: 'suspended',
});

export const VERIFICATION = Object.freeze({
  UNVERIFIED: 'unverified',
  PENDING: 'pending',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
});

/**
 * What the practice is on, commercially.
 *
 * Names only. The numbers that actually restrain anything live in `limits`,
 * per practice — see the note there. A plan whose limits were baked into its
 * name would need a new plan every time somebody negotiates.
 *
 * `TRIAL` is the default because a practice that has just been created has not
 * agreed to anything yet, and the honest label for that is not "solo".
 */
export const PLAN = Object.freeze({
  TRIAL: 'trial',
  ESSENTIAL: 'essential',
  PROFESSIONAL: 'professional',
  ENTERPRISE: 'enterprise',
});

/**
 * What the plans used to be called.
 *
 * `solo`, `clinic` and `hospital` described the customer rather than the
 * product, and two of them collided with a practice *type* — a hospital on the
 * hospital plan, a clinic that was not on the clinic plan. Naming a tier after
 * a kind of organisation makes every sentence about either one ambiguous.
 *
 * Kept because a stored value outlives the constant that named it. Mongoose
 * validates an enum on save and not on read, so a practice sitting on `clinic`
 * loads perfectly and then throws the next time anything touches it — a
 * failure that arrives days later, on an unrelated edit, at whoever happened to
 * press save.
 *
 * The hook below normalises on the way into validation, so a row the migration
 * has not reached is corrected rather than refused. Delete both once
 * `backfillPlanNames.js` reports nothing left.
 */
export const LEGACY_PLANS = Object.freeze({
  solo: PLAN.ESSENTIAL,
  clinic: PLAN.PROFESSIONAL,
  hospital: PLAN.ENTERPRISE,
});

/**
 * What kind of organisation this is. Not what it treats — see `specialty`.
 *
 * ---- Why these are two fields and not one -------------------------------
 *
 * "Cardiology hospital" is two facts, and they change independently: a clinic
 * that grows into a polyclinic keeps its specialty, and a diabetes clinic that
 * adds a cardiologist keeps its type. Collapsing them into one list produces
 * the cross product — six types times a dozen specialties — and every one of
 * those needs its own row the day somebody adds a specialty.
 *
 * ---- What the type decides ----------------------------------------------
 *
 * Which capabilities the practice can have at all: a diagnostic centre orders
 * and reports labs and does not prescribe; a solo clinic has no departments to
 * manage. See [services/capabilities.js] — the type is an input there, not a
 * switch read directly by a screen.
 *
 * ---- Null is a real value and stays one ---------------------------------
 *
 * Every practice that exists today has none, and the clinic seeing patients
 * this morning must not lose prescriptions because a field was added. Unknown
 * type means unrestricted, exactly as unknown practice means unrestricted in
 * the tenant guards. The resolver is where that rule is written down.
 */
export const PRACTICE_TYPE = Object.freeze({
  CLINIC: 'clinic',
  POLYCLINIC: 'polyclinic',
  HOSPITAL: 'hospital',
  DIAGNOSTIC_CENTRE: 'diagnostic_centre',
  SPECIALTY_CENTRE: 'specialty_centre',
  HEALTHCARE_GROUP: 'healthcare_group',
});

/** Reading order for a picker: smallest organisation first. */
export const PRACTICE_TYPE_ORDER = Object.freeze([
  PRACTICE_TYPE.CLINIC,
  PRACTICE_TYPE.SPECIALTY_CENTRE,
  PRACTICE_TYPE.DIAGNOSTIC_CENTRE,
  PRACTICE_TYPE.POLYCLINIC,
  PRACTICE_TYPE.HOSPITAL,
  PRACTICE_TYPE.HEALTHCARE_GROUP,
]);

/**
 * What the person who signs for the practice is called, by type.
 *
 * A hospital does not have a "head doctor" and a diagnostic centre's
 * responsible person is not a doctor at all in the sense the word implies. The
 * onboarding wizard asks for one human either way; only the label changes.
 */
export const RESPONSIBLE_LABEL = Object.freeze({
  [PRACTICE_TYPE.CLINIC]: 'Head doctor',
  [PRACTICE_TYPE.SPECIALTY_CENTRE]: 'Lead consultant',
  [PRACTICE_TYPE.DIAGNOSTIC_CENTRE]: 'Responsible pathologist',
  [PRACTICE_TYPE.POLYCLINIC]: 'Medical director',
  [PRACTICE_TYPE.HOSPITAL]: 'Medical superintendent',
  [PRACTICE_TYPE.HEALTHCARE_GROUP]: 'Group medical director',
});

const practiceSchema = new mongoose.Schema(
  {
    /// What a patient reads: "Dey Diabetes Clinic".
    name: { type: String, required: true, trim: true, maxlength: 160 },

    /// The line under the name — "Diabetes Obesity & Metabolic Clinic".
    tagline: { type: String, trim: true, maxlength: 160 },

    /// The doctor's name as it should print, which is not always the name on
    /// their account. Stays here as well as on the location because a
    /// single-doctor practice has exactly one and repeating it per branch is
    /// how the two drift apart.
    doctorDisplayName: { type: String, trim: true, maxlength: 160 },

    /// Printed under the signature on a prescription.
    registrationNo: { type: String, trim: true, maxlength: 60 },

    /// What kind of organisation. Null until somebody says — see PRACTICE_TYPE.
    practiceType: {
      type: String,
      enum: [...Object.values(PRACTICE_TYPE), null],
      default: null,
      index: true,
    },

    /**
     * What it primarily treats: `diabetology`, `cardiology`, `paediatrics`.
     *
     * A string, not an enum, and matching a shared [Department] key where one
     * fits. The argument is already written down in Department.js: a specialty
     * an admin adds cannot bring a code change with it, so a hard list here
     * would mean a deploy every time somebody opens a practice in a specialty
     * nobody anticipated.
     *
     * It is a label and a default, not a restriction. A diabetes clinic that
     * sees a cardiac patient is a diabetes clinic that saw a cardiac patient.
     */
    specialty: { type: String, trim: true, maxlength: 80, default: null, index: true },

    /// Two logo assets, never an inverted copy of one another — inverting
    /// artwork destroys the brand colour. See the note on the same fields in
    /// [models/Clinic.js].
    logoLightAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
    logoDarkAssetId: { type: mongoose.Schema.Types.ObjectId, ref: 'MediaAsset' },
    logoNeedsDarkChip: { type: Boolean, default: false },

    /// The doctor who owns the practice and may add other doctors, staff and
    /// locations. MedPin onboards this one person; everyone else is added by
    /// them. Nullable so the backfill can create a practice for an existing
    /// clinic that has no doctor row set.
    headDoctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },

    /// May this practice use the app. See the note above.
    status: {
      type: String,
      enum: Object.values(PRACTICE_STATUS),
      default: PRACTICE_STATUS.ACTIVE,
      index: true,
    },

    /// Have the papers been checked. Separate from access, deliberately.
    verification: {
      type: String,
      enum: Object.values(VERIFICATION),
      default: VERIFICATION.UNVERIFIED,
    },
    verifiedAt: { type: Date, default: null },

    /// Set on the practice that existed before practices did, so the backfill
    /// can be re-run without creating a second one and so support can tell at a
    /// glance which row is the original clinic.
    isFounding: { type: Boolean, default: false },

    /**
     * What this practice is paying for, and what that entitles them to.
     *
     * ---- Why the limits are nullable and not "the plan's numbers" --------
     *
     * A plan is a label somebody sells; a limit is a number the software
     * enforces. Deriving one from the other means a practice that negotiated
     * an extra location needs a new plan invented for it, and the founding
     * clinic — which is on no plan at all — would inherit whatever the default
     * happened to be.
     *
     * So the plan is a name, and each limit is a number or `null`. Null means
     * unlimited, which is what every existing row has and what the founding
     * practice keeps. The limits bite only where somebody has typed one in.
     */
    plan: {
      type: String,
      enum: Object.values(PLAN),
      default: PLAN.TRIAL,
      index: true,
    },

    limits: {
      patients: { type: Number, default: null, min: 0 },
      staff: { type: Number, default: null, min: 0 },
      locations: { type: Number, default: null, min: 0 },
    },

    /// When the current arrangement lapses. Null is open-ended, and a date in
    /// the past does not itself suspend anybody — that stays a decision a human
    /// makes and the audit log records, because a clinic locked out of its
    /// records by a billing date is a patient safety problem.
    planRenewsOn: { type: Date, default: null },

    /**
     * Capabilities an operator has turned on for this practice by hand.
     *
     * The Enterprise escape hatch, and the way to give one customer something
     * without inventing a plan for it. Additive only, and still bounded by what
     * the practice type can have — see [services/capabilities.js]. Empty for
     * almost every practice, which is the point: the plan should be the answer
     * and this should be the exception somebody had to type.
     */
    capabilities: { type: [String], default: [] },

    /// Free text for the operator. "Paying annually, invoice by email" is the
    /// kind of thing that otherwise lives in somebody's memory.
    notes: { type: String, trim: true, maxlength: 2000, default: '' },
  },
  { timestamps: true },
);

/// "Which practices does this doctor head" — the admin surface's first query.
practiceSchema.index({ headDoctor: 1, status: 1 });

practiceSchema.methods.toPublic = function toPublic() {
  return {
    id: String(this._id),
    name: this.name,
    tagline: this.tagline ?? null,
    doctorDisplayName: this.doctorDisplayName ?? null,
    registrationNo: this.registrationNo ?? null,
    logoLightUrl: this.logoLightAssetId ? `/api/v1/uploads/${this.logoLightAssetId}/raw` : null,
    logoDarkUrl: this.logoDarkAssetId ? `/api/v1/uploads/${this.logoDarkAssetId}/raw` : null,
    logoNeedsDarkChip: Boolean(this.logoNeedsDarkChip),
    status: this.status,
    verification: this.verification,
    practiceType: this.practiceType ?? null,
    specialty: this.specialty ?? null,
    plan: this.plan ?? PLAN.TRIAL,
    // Spread rather than passed through: `limits` is a subdocument, and handing
    // the Mongoose object to res.json ships its internals.
    limits: {
      patients: this.limits?.patients ?? null,
      staff: this.limits?.staff ?? null,
      locations: this.limits?.locations ?? null,
    },
    planRenewsOn: this.planRenewsOn ?? null,
    createdAt: this.createdAt,
  };
};

/**
 * Is this practice over the named limit, if it has one?
 *
 * Returns null when there is nothing to enforce — no limit set, which is every
 * practice today. The caller treats null as "carry on", so a limit that was
 * never typed in cannot refuse anybody.
 */
practiceSchema.methods.overLimit = function overLimit(which, current) {
  const cap = this.limits?.[which];
  if (cap === null || cap === undefined) return null;
  return current >= cap ? { which, cap, current } : null;
};

/**
 * A plan under its old name is still that plan.
 *
 * Runs before enum validation, so a document written when the tiers were called
 * `solo`, `clinic` and `hospital` saves cleanly instead of failing on a field
 * nobody in that request was editing.
 */
practiceSchema.pre('validate', function normaliseLegacyPlan(next) {
  const mapped = LEGACY_PLANS[this.plan];
  if (mapped) this.plan = mapped;
  next();
});

export const Practice = mongoose.model('Practice', practiceSchema);
