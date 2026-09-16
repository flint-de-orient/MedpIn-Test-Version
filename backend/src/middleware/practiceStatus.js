import { Practice, PRACTICE_STATUS } from '../models/Practice.js';
import { AppError } from './errors.js';

/**
 * What a suspended practice's staff may do: nothing in that practice.
 *
 * ---- The gap ---------------------------------------------------------------
 *
 * An operator could set a practice to `suspended`, with a reason, in the
 * console — and nothing read it. The admin router's own description promised
 * that a suspended practice's staff could not log in; its doctors went on
 * prescribing and its desk went on booking, and the only change anywhere was
 * the word on the operator's screen.
 *
 * ---- The policy -------------------------------------------------------------
 *
 * Staff of a suspended practice are refused that practice's operational and
 * clinical routes with PRACTICE_SUSPENDED — distinct from NO_PRACTICE, which
 * tells somebody their own membership ended and to ask the practice, when the
 * practice is exactly who cannot help. Decided where the practice a request is
 * about is decided (`practicesOf` / `practiceOf` in practiceScope.js), so every
 * guard that asks which practice this is — the role guards, the patient scope,
 * the permission checks and the routes that ask for themselves — refuses
 * without having to remember to.
 *
 *   - A suspended practice is not somewhere anybody currently works. Somebody
 *     who also works at an active practice carries on there, and is refused
 *     only when they name the suspended one.
 *   - Signing in still works, and `GET /practices/mine` still answers, with
 *     `status: "suspended"` — so the app can say what has happened instead of
 *     showing an error on every screen.
 *   - Patients are not staff and have no membership: their own records, their
 *     prescriptions and their reminders are untouched. A suspension that
 *     silenced a patient's insulin alarm would punish the person who did
 *     nothing wrong.
 *   - Nothing is deleted or changed. Reinstating the practice restores access
 *     on the next request; nothing is cached across requests.
 */

/** The practices among these that the platform has suspended, as strings. */
export async function suspendedAmong(practiceIds) {
  if (!practiceIds?.length) return [];
  const rows = await Practice.find({ _id: { $in: practiceIds }, status: PRACTICE_STATUS.SUSPENDED })
    .select('_id')
    .lean();
  return rows.map((r) => String(r._id));
}

/** The refusal. A 403 with its own code, so a client can say what happened. */
export function practiceSuspended() {
  return new AppError(
    403,
    'PRACTICE_SUSPENDED',
    'This practice has been suspended on MedPin. Its records are kept, but nobody can work in it until it is reinstated.',
  );
}
