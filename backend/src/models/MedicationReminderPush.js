import mongoose from 'mongoose';

/**
 * One row per medicine dose the server has pushed a reminder for.
 *
 * The push job ticks twice a minute, so it sees every dose minute twice, and it
 * remembered what it had already sent in a Set in memory. A restart inside the
 * minute forgot the Set; a second process never had it; and two overlapping
 * ticks both got past it, because a database read sat between the check and the
 * write. Each of those is a patient told twice to take one dose.
 *
 * The unique index is the mechanism, not a constraint on it — `create` failing
 * with a duplicate key *is* the answer to "has this dose been pushed",
 * atomically, for every process and across restarts. Same pattern as
 * ReminderRun, one row per dose instead of one per pass.
 */
const medicationReminderPushSchema = new mongoose.Schema(
  {
    medication: { type: mongoose.Schema.Types.ObjectId, ref: 'Medication', required: true },

    // The schedule slot's clinic-local time, HH:mm. Two slots of one medicine
    // at the same minute are one dose reminder, as they are on the phone: both
    // carry the same notification id.
    time: { type: String, required: true },

    // The clinic-timezone day, YYYY-MM-DD — "today" is the clinic's calendar
    // day, and a Date would invite a comparison in the server's timezone.
    day: { type: String, required: true },

    pushedAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

medicationReminderPushSchema.index({ medication: 1, day: 1, time: 1 }, { unique: true });

// A row only has to outlive its own minute. Two days covers any timezone
// difference between the server's clock and the clinic's with room to spare.
medicationReminderPushSchema.index({ pushedAt: 1 }, { expireAfterSeconds: 2 * 24 * 60 * 60 });

export const MedicationReminderPush = mongoose.model('MedicationReminderPush', medicationReminderPushSchema);

/**
 * Claim the push for one dose, or learn that it has been made.
 *
 * True exactly once per medicine, slot time and clinic day, however many ticks,
 * processes or restarts ask. Any failure other than the duplicate key is thrown:
 * a database that is down must not read as "already pushed" — nor as "go ahead",
 * which is decided by the caller.
 */
export async function claimDoseReminder({ medication, time, day }) {
  try {
    await MedicationReminderPush.create({ medication, time, day });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}
