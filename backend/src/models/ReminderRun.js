import mongoose from 'mongoose';

/**
 * A record that a scheduled reminder pass has already run today.
 *
 * The cron used to hold this in a module-level variable, on the reasoning that
 * the worst a mid-morning restart could cost was one repeated nudge. That
 * reasoning held while deploys were rare. They are not: a redeploy inside the
 * reminder hour resets the flag and the whole pass fires again, and patients
 * were getting the same "upload your lab report" push twice in half an hour.
 *
 * The unique index is the mechanism, not a constraint on it — `insertOne`
 * failing with a duplicate key *is* the answer to "has this already run",
 * atomically, with no read-then-write gap. That also makes it correct if the
 * clinic ever runs two server processes, where the in-memory flag would have
 * had both of them nudging.
 */
const reminderRunSchema = new mongoose.Schema(
  {
    // 'glucose' | 'lab' — which pass.
    pass: { type: String, required: true },

    // The clinic-timezone date it ran, as YYYY-MM-DD. A date string rather
    // than a Date because "today" here means the clinic's calendar day, and a
    // Date would invite a comparison in the server's timezone instead.
    day: { type: String, required: true },

    ranAt: { type: Date, default: Date.now },

    // Kept for the log rather than for logic: how many pushes the pass sent.
    sent: { type: Number, default: 0 },
  },
  { timestamps: false },
);

reminderRunSchema.index({ pass: 1, day: 1 }, { unique: true });

// Nothing here is worth keeping for more than a few weeks — it exists to stop
// a second run today, and a row from last month cannot do that.
reminderRunSchema.index({ ranAt: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });

export const ReminderRun = mongoose.model('ReminderRun', reminderRunSchema);

/**
 * Claim today's run of `pass`, or report that someone already has.
 *
 * Returns true exactly once per pass per clinic day, however many processes
 * ask and however many times the server restarts.
 */
export async function claimReminderPass(pass, day) {
  try {
    await ReminderRun.create({ pass, day });
    return true;
  } catch (err) {
    // 11000 is a duplicate key: the pass has run. Anything else is a real
    // failure and must not be mistaken for "already done" — a database that is
    // down would otherwise silently cancel every reminder that day.
    if (err?.code === 11000) return false;
    throw err;
  }
}
