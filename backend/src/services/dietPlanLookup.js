import { DietPlan } from '../models/DietPlan.js';
import { DietPlanRevision } from '../models/DietPlanRevision.js';

/**
 * The diet plan the patient was last actually given.
 *
 * Normally this is simply the current plan. The exception is the window after a
 * dietician has started writing a replacement: the working plan is blank until
 * they send it, but the patient is still following the instructions they were
 * handed last. Reading only the current document in that window would tell the
 * patient — and the assistant answering them — that they have no plan, while
 * they are holding one.
 *
 * Only plans that were sent are ever returned. A draft is not care the patient
 * received, and quoting one would tell them something nobody has told them.
 *
 * `authors`, when given, are the people whose plans count: a practice's
 * dieticians. Another practice's plan is not this practice's advice, and the
 * nutrition assistant quotes whatever this returns as the patient's own plan.
 *
 * @param {import('mongoose').Types.ObjectId|string} patientId
 * @param {{populate?: string, authors?: Array}} [options] field list to populate on `dietician`
 */
export async function lastGivenPlan(patientId, { populate, authors = null } = {}) {
  const writtenHere = authors ? { dietician: { $in: authors } } : {};
  const current = DietPlan.findOne({ patient: patientId, sharedAt: { $ne: null }, ...writtenHere });
  if (populate) current.populate('dietician', populate);
  const plan = await current.lean();
  if (plan) return plan;

  const previous = DietPlanRevision.findOne({ patient: patientId, sharedAt: { $ne: null }, ...writtenHere }).sort({
    replacedAt: -1,
  });
  if (populate) previous.populate('dietician', populate);
  return previous.lean();
}
