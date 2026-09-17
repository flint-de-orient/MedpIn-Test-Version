import mongoose from 'mongoose';

/**
 * A write somebody asked for by key, and what it answered.
 *
 * ---- Why not on the record, as prescriptions keep it ----------------------------
 *
 * A prescription or a reading is a new row, so the key can live on the row it
 * wrote and a unique index can refuse a second one. Most appointment writes are
 * not new rows: confirming, moving, cancelling and checking in change one that
 * exists, several times over its life, and a key stored on it would be
 * overwritten by the next change — a retry of the confirmation, arriving after
 * the check-in, would find nothing to recognise.
 *
 * So a keyed write claims its key here before it runs, and records the answer it
 * gave once it has. A retry of the same request finds the answer and is given
 * it; a retry arriving while the first is still running waits for it; a key
 * reused for a different request is refused. See middleware/idempotentWrite.js.
 */
const idempotentWriteSchema = new mongoose.Schema(
  {
    /// Keys are the caller's own. One person's key never answers another's request.
    actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true },

    /// What was asked for: the method, the path with its ids, and the body.
    fingerprint: { type: String, required: true },

    /// `pending` while the first request is running, `done` once it answered.
    state: { type: String, enum: ['pending', 'done'], default: 'pending' },

    /// The request running it, and when its claim lapses if it never answers.
    holder: { type: String, default: null },
    leaseUntil: { type: Date, default: null },

    /// The answer, given again to a retry.
    status: { type: Number, default: null },
    body: { type: mongoose.Schema.Types.Mixed, default: null },

    /// A day. A retry comes within minutes; after that the key has done its job.
    createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 },
  },
  { versionKey: false },
);

/// One claim per key per person: the constraint that makes two copies of one
/// request, arriving together, one write.
idempotentWriteSchema.index({ actor: 1, key: 1 }, { unique: true });

export const IdempotentWrite = mongoose.model('IdempotentWrite', idempotentWriteSchema);
