import { Counter } from '../models/Counter.js';

/**
 * The next number in a named sequence, safe under any number of callers.
 *
 * ---- The two operations, and why there are two ---------------------------
 *
 * The increment is one atomic `$inc` on one document — the database will not
 * let two requests read the same value, which is the whole point.
 *
 * The seed comes first, and exists because sequences here are replacing
 * read-the-highest code that has already issued numbers. A prescription
 * counter created today at zero would hand out 000001, which the clinic
 * printed in January. So the first caller sets the starting point with
 * `$setOnInsert`, which only takes effect on the insert and is ignored by
 * every caller after it; `seed` is only asked when the counter does not exist.
 *
 * Two first callers can race to insert the same `_id`. The loser gets a
 * duplicate key, and retrying finds the document the winner made — so the
 * retry is bounded and cannot loop.
 *
 * ---- `floor`, for a sequence something else can also write -------------
 *
 * A seed is read once, so a counter that falls behind stays behind. `floor`
 * is read on every call, and the counter is raised to it with `$max` before
 * the increment, so the number handed out is always above it. See
 * chatSequence.js for the sequence that needed it.
 *
 * @param {string} key the sequence's name, e.g. `prescription:2026`
 * @param {{ seed?: () => Promise<number>, floor?: () => Promise<number> }} options
 *   where to start, if new; or the highest number already taken, every time
 * @returns {Promise<number>}
 */
export async function nextInSequence(key, { seed = null, floor = null } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (floor) {
        await Counter.updateOne({ _id: key }, { $max: { seq: await floor() } }, { upsert: true });
      } else if (seed && !(await Counter.exists({ _id: key }))) {
        await Counter.updateOne(
          { _id: key },
          { $setOnInsert: { seq: await seed() } },
          { upsert: true },
        );
      }

      const row = await Counter.findOneAndUpdate(
        { _id: key },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
      ).lean();
      return row.seq;
    } catch (err) {
      // Two first callers inserting the same counter. The other one's document
      // exists now; go round and increment it.
      if (err?.code !== 11000 || attempt === 2) throw err;
    }
  }
  // Unreachable: the loop either returns or throws.
  throw new Error(`Could not advance sequence ${key}`);
}
