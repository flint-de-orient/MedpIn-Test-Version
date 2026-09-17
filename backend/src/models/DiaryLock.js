import mongoose from 'mongoose';

/**
 * Who is writing into a doctor's diary at this moment.
 *
 * ---- Why a lock, and why here ------------------------------------------------
 *
 * Booking, confirming a request and moving an appointment each read the
 * doctor's commitments, decide the time is free, and then write. Read and then
 * write: two desks at two branches booking the same doctor for ten o'clock in
 * the same instant both read "free", and both wrote. Nothing in the database
 * could refuse the second — a doctor's clash is an overlap of intervals, which
 * no unique index can express, and the deployment has no replica set for
 * transactions.
 *
 * So every write that puts a time into a doctor's diary takes that doctor's row
 * here first, and the check and the write happen while it is held. One doctor's
 * writes queue behind each other for the few milliseconds a booking takes;
 * different doctors never wait for one another.
 *
 * ---- A lease, not a flag ---------------------------------------------------------
 *
 * `until` is when the hold lapses on its own. A process that dies holding it
 * must not close that doctor's diary for ever, so a hold older than its lease
 * is treated as free. See withDoctorDiary in services/scheduling.js.
 */
const diaryLockSchema = new mongoose.Schema(
  {
    /// `doctor:<userId>`.
    _id: { type: String, required: true },

    /// A random id for the request holding it, so only that request releases it.
    holder: { type: String, default: null },

    /// When the hold lapses if nobody releases it.
    until: { type: Date, default: null },
  },
  { versionKey: false, timestamps: false },
);

export const DiaryLock = mongoose.model('DiaryLock', diaryLockSchema);
