import mongoose from 'mongoose';

export const ALERT_SEVERITY = Object.freeze(['info', 'warning', 'urgent', 'emergency']);

/**
 * The escalation record. Anything that should reach Dr. Dey or clinic staff —
 * a critical reading, an emergency triage verdict, a severe foot assessment —
 * becomes an alert so nothing depends on someone happening to read a chat log.
 */
const clinicalAlertSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    severity: { type: String, enum: ALERT_SEVERITY, required: true, index: true },

    type: {
      type: String,
      enum: [
        'critical_hyperglycaemia',
        'severe_hypoglycaemia',
        'hypertensive_crisis',
        'chest_pain',
        'breathing_difficulty',
        'vision_loss',
        'foot_infection',
        'dka_suspected',
        'hhs_suspected',
        'thyroid_storm',
        'adrenal_crisis',
        'medication_nonadherence',
        'missed_appointment',
        'abnormal_trend',
        'chat_escalation',
        'other',
      ],
      required: true,
      index: true,
    },

    title: { type: String, required: true, maxlength: 200 },
    detail: { type: String, maxlength: 4000 },

    // What produced this alert, for auditability.
    source: {
      kind: {
        type: String,
        enum: ['glucose', 'vital', 'chat', 'foot', 'eye', 'adherence', 'appointment', 'system'],
        required: true,
      },
      ref: { type: mongoose.Schema.Types.ObjectId },
    },
    matchedRules: [{ type: String }],

    status: {
      type: String,
      enum: ['open', 'acknowledged', 'resolved', 'dismissed'],
      default: 'open',
      index: true,
    },
    acknowledgedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    acknowledgedAt: Date,
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    resolvedAt: Date,
    resolutionNotes: { type: String, maxlength: 2000 },

    /// When staff were actually reached — set only when a push was delivered.
    /// It used to be stamped after every attempt, so an alert nobody's phone
    /// ever showed was recorded as one the clinic had been told about.
    notifiedStaffAt: Date,
    notifiedPatientAt: Date,

    /// The last attempt to reach staff, whatever came of it: how many people
    /// were eligible and how many deliveries succeeded. Zero delivered is a
    /// fact worth keeping, not a silence.
    staffNotification: {
      attemptedAt: Date,
      recipients: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
    },

    /// Each time this episode got worse. An emergency arriving while a warning
    /// of the same kind is open raises the alert in place — one item in the
    /// queue — and pages as if it were new.
    escalations: [
      {
        _id: false,
        from: { type: String, enum: ALERT_SEVERITY },
        to: { type: String, enum: ALERT_SEVERITY },
        at: Date,
        previousTitle: { type: String, maxlength: 200 },
      },
    ],

    /// patient | type | severity | window. Two identical alerts raised in the
    /// same instant both pass the "anything open?" look-up; this refuses the
    /// second, so one emergency pages once. Null for alerts that are never
    /// de-duplicated.
    dedupeKey: { type: String, default: null },
  },
  { timestamps: true },
);

clinicalAlertSchema.index({ status: 1, severity: 1, createdAt: -1 });
clinicalAlertSchema.index({ patient: 1, createdAt: -1 });
clinicalAlertSchema.index(
  { dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } },
);

export const ClinicalAlert = mongoose.model('ClinicalAlert', clinicalAlertSchema);
