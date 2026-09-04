import mongoose from 'mongoose';

/**
 * Which departments a doctor practises in.
 *
 * A join table rather than a field on the doctor, because the relationship is
 * many-to-many in both directions and the single-field version is wrong in a
 * way that shows up immediately: a physician covering General Medicine and
 * Diabetology is one doctor in two departments, and a department has as many
 * doctors as the practice employs.
 *
 * Written before any of it is used. A field would have been quicker today and
 * a migration across every reader tomorrow — and the tomorrow in question is
 * the first polyclinic, which is the customer this whole rework is for.
 *
 * ---- Why the practice is on the row too ---------------------------------
 *
 * A doctor may work at two practices and hold different departments at each:
 * a cardiologist at the polyclinic, a general physician at their own evening
 * clinic. The pair (doctor, department) alone cannot say that. So the row names
 * the practice as well, and "which departments does this doctor cover *here*"
 * has an answer.
 */
const doctorDepartmentSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      required: true,
      index: true,
    },

    /// Where this holds. See the note above.
    practice: { type: mongoose.Schema.Types.ObjectId, ref: 'Clinic', index: true },

    /// The one shown on a prescription letterhead when a doctor holds several.
    ///
    /// Without it, a doctor in three departments has no answer to "what does it
    /// say under my name", and the app would pick whichever row came back
    /// first — which is to say, a different one on different days.
    isPrimary: { type: Boolean, default: false },

    /// Ended rather than deleted: a doctor who stops covering paediatrics has
    /// still signed paediatric prescriptions, and the record should still be
    /// able to say which department they were in when they wrote one.
    endedOn: { type: Date, default: null },
  },
  { timestamps: true },
);

/// One row per doctor per department per practice.
doctorDepartmentSchema.index(
  { doctor: 1, department: 1, practice: 1 },
  { unique: true },
);

/// "Who can answer cardiology?" — the query behind departmental chat routing.
doctorDepartmentSchema.index({ department: 1, endedOn: 1 });

export const DoctorDepartment = mongoose.model('DoctorDepartment', doctorDepartmentSchema);
