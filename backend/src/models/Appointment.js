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

export const Appointment = mongoose.model('Appointment', appointmentSchema);
