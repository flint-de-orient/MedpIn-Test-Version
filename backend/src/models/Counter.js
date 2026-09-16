import mongoose from 'mongoose';

/**
 * A number that only goes up, handed out one at a time.
 *
 * ---- Why a collection for something this small --------------------------
 *
 * Every sequence in the application was "read the highest, add one, write":
 * prescription references counted the year's documents, queue numbers read the
 * day's maximum, chat messages read the last `seq`. Each is correct for one
 * caller and wrong for two, because between the read and the write another
 * request reads the same number. Where a unique index sat behind it, the second
 * request was refused and its work lost; where none did, two patients were
 * given the same token at the counter.
 *
 * MongoDB will increment one field of one document atomically, so a sequence
 * that lives in a document is a sequence nobody can read twice.
 *
 * `_id` is the sequence's name, e.g. `prescription:2026`. Nothing else is
 * stored: a counter that knows what it counts is a counter somebody will be
 * tempted to query instead of the thing itself.
 */
const counterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
  },
  { versionKey: false },
);

export const Counter = mongoose.model('Counter', counterSchema);
