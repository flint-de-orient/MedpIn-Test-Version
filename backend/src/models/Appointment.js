import mongoose from 'mongoose';

export const APPOINTMENT_STATUS = Object.freeze([
  'requested',
  'confirmed',
  'checked_in',
  'in_consultation',
  'completed',
  'cancelled',
  'no_show',
]);

const appointmentSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    // The location this appointment is booked at. Required for an in-clinic
    // visit (its slot came from the clinic's schedule); absent for teleconsult.
    clinic: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', index: true },

    /**
     * The practice whose diary this sits in.
     *
     * Every read and write here scopes by the practice's *doctors*, which
     * works and answers a slightly different question — "is this one of ours"
     * rather than "whose is it". The difference showed up the moment two
     * practices held requests for one patient: a rule about how many open
     * requests a patient may have at a clinic cannot be written against a set
     * of doctor ids, and the query that tried had neither practice nor doctor
     * in it, so the second clinic's request overwrote the first's.
     *
     * Derived from the clinic where there is one and from the doctor's
     * membership otherwise — a teleconsult has no building. Nullable, because
     * rows written before this field existed have none until the backfill
     * runs, and a required field would have refused to load every one of them.
     */
    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      default: null,
      index: true,
    },

    mode: { type: String, enum: ['in_clinic', 'teleconsult'], default: 'in_clinic' },
    /// When the appointment is. Absent while it is only a request.
    ///
    /// It was unconditionally required, which forced a chat request to invent a
    /// time — and since 'requested' counts as an active status, that invented
    /// time then held a real slot. A patient asking "can I come Tuesday?" would
    /// block that hour for everyone, including the desk trying to confirm the
    /// very request that blocked it.
    scheduledFor: {
      type: Date,
      index: true,
      required: [
        function requiredOnceScheduled() {
          return this.status !== 'requested';
        },
        'scheduledFor is required once an appointment is confirmed',
      ],
    },

    /// The day the patient asked for, on a request. Never a booking.
    ///
    /// Deliberately a separate field from scheduledFor: it is a wish, not a
    /// commitment, and nothing that reads the schedule should ever mistake it
    /// for one.
    preferredFor: { type: Date },

    /// The time of day the patient would like, as 'HH:mm', or absent.
    ///
    /// A wish, not a booking — which is why it is a separate field from
    /// `scheduledFor` and never becomes one by itself. The desk still picks
    /// from the hours the doctor actually keeps; this only tells them which
    /// end of the day to look at first, so a patient who said "evening" is not
    /// offered nine in the morning.
    ///
    /// Cleared with `preferredFor` when the appointment is confirmed: two
    /// times on one row, one of them imaginary, is how somebody turns up at
    /// the wrong hour.
    preferredTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },

    /// Set when the day-before reminder has gone out, so it goes out once.
    ///
    /// On the appointment rather than in the cron's memory: a process restart
    /// must not re-remind fifty patients, and a reminder that never sends
    /// because a restart lost the flag is worse still.
    remindedAt: { type: Date },
    durationMinutes: { type: Number, default: 15, min: 5, max: 120 },

    status: { type: String, enum: APPOINTMENT_STATUS, default: 'requested', index: true },
    reason: { type: String, maxlength: 600 },

    // Queue management: assigned when the patient checks in, so walk-ins and
    // booked patients share one ordering.
    queueNumber: { type: Number },
    queueDate: { type: String, index: true }, // 'YYYY-MM-DD' in clinic-local time
    calledAt: Date,

    teleconsult: {
      roomId: String,
      joinUrl: String,
      patientJoinedAt: Date,
      doctorJoinedAt: Date,
    },

    consultationNotes: { type: String, maxlength: 8000 },
    prescription: { type: mongoose.Schema.Types.ObjectId, ref: 'Prescription' },

    rescheduledFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'Appointment' },
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    cancellationReason: { type: String, maxlength: 500 },

    // Set when triage escalates a chat into a priority slot request.
    createdFromAlert: { type: mongoose.Schema.Types.ObjectId, ref: 'ClinicalAlert' },
    isPriority: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
);

appointmentSchema.index({ doctor: 1, scheduledFor: 1 });
appointmentSchema.index({ patient: 1, scheduledFor: -1 });
appointmentSchema.index({ queueDate: 1, queueNumber: 1 });

/**
 * One open request per patient per practice, enforced by the database.
 *
 * The route already looks for an existing request and updates it rather than
 * writing a second — but that is a read followed by a write, and two taps a
 * few milliseconds apart both read "nothing there". The desk then sees one
 * person listed twice, wanting two appointments.
 *
 * Partial on `practice` being a real id, not merely on the status: rows
 * written before the practice field existed all have `null`, and null counts
 * as a value in a unique index. Without the `$type` clause the first pair of
 * legacy requests would refuse to let this index build at all — and an index
 * that cannot build is enforcement nobody gets.
 *
 * And partial on `preferredFor` too, because "requested" covers two different
 * things. A patient asking for a day has one; the replacement row a
 * reschedule writes carries a time the patient already holds and no
 * preference. Somebody who has asked for an appointment *and* moved an
 * existing one wants two things, and the desk should see both — so only the
 * first kind is unique.
 */
appointmentSchema.index(
  { patient: 1, practice: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: 'requested',
      practice: { $type: 'objectId' },
      preferredFor: { $type: 'date' },
    },
    name: 'one_open_request_per_practice',
  },
);

export const Appointment = mongoose.model('Appointment', appointmentSchema);
