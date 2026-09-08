import { AiUsage } from '../../models/AiUsage.js';
import { Practice, PLAN } from '../../models/Practice.js';
import { AuditLog } from '../../models/AuditLog.js';
import { capabilitiesOfPractice, CAPABILITIES } from '../capabilities.js';
import { practiceOfPatient } from '../../middleware/practiceScope.js';
import { inClinicTz } from '../../utils/clinicTime.js';
import { logger } from '../../config/logger.js';

/**
 * Whether the assistant may answer, and the record of when it may not.
 *
 * ---- Two different reasons to stand down --------------------------------
 *
 *   the practice has no AI_ASSISTANT     it never had one
 *   the month's allowance is spent       it has one and has used it
 *
 * Both end the same way on screen — the thread says no assistant is answering
 * here, which is exactly what it already says for a department nobody has
 * written a scope for. A patient does not need to be told which of a practice's
 * commercial arrangements applies to their question.
 *
 * ---- But the clinic does ------------------------------------------------
 *
 * A refusal that leaves no trace is the entry an audit trail most needs. A
 * clinic whose patients quietly stopped getting answers has nothing to look at
 * and no reason to suspect a limit — so both refusals are recorded, and the
 * counter separates "we hit it twice" from "we hit it four hundred times".
 * The first is a busy week; the second is the wrong plan.
 *
 * ---- Unknown means unlimited --------------------------------------------
 *
 * A practice with no plan, or a patient with no practice, gets no limit at all.
 * That is every practice today, and the rule is the same one the rest of this
 * codebase runs on: absence is not evidence. A cap invented for somebody who
 * never agreed to one would silence an assistant a clinic is relying on.
 */

/**
 * Replies a month, by plan. `null` is unlimited.
 *
 * The trial is deliberately generous rather than a taste: somebody deciding
 * whether to buy this needs to see it work under a real week's load, and a
 * trial that runs out on Wednesday demonstrates the opposite of what it is for.
 */
const MONTHLY = Object.freeze({
  [PLAN.TRIAL]: 2000,
  [PLAN.ESSENTIAL]: 1000,
  [PLAN.PROFESSIONAL]: 5000,
  [PLAN.ENTERPRISE]: null,
});

/** `2026-09`, in the clinic's timezone — a plan's month is a month where the clinic is. */
export function currentPeriod(at = new Date()) {
  return inClinicTz(at).format('YYYY-MM');
}

/** The month's allowance for a practice, or null for no limit. */
export function allowanceFor(practice) {
  if (!practice?.plan) return null;
  const limit = MONTHLY[practice.plan];
  return limit === undefined ? null : limit;
}

/**
 * May the assistant answer for this patient?
 *
 * Returns `{ allowed, reason }`. Never throws: an assistant that cannot check
 * its own allowance should answer, not fail — the failure mode of this
 * function must be a working clinic, not a silent one.
 */
export async function mayAssistantReply(patientId) {
  try {
    const practiceId = await practiceOfPatient(patientId);
    if (!practiceId) return { allowed: true };

    const practice = await Practice.findById(practiceId).select('plan practiceType capabilities').lean();
    if (!practice) return { allowed: true };

    if (!capabilitiesOfPractice(practice).has(CAPABILITIES.AI_ASSISTANT)) {
      await record(practiceId, patientId, 'no_capability');
      return { allowed: false, reason: 'no_capability' };
    }

    const limit = allowanceFor(practice);
    if (limit === null) return { allowed: true, practiceId };

    const period = currentPeriod();
    const row = await AiUsage.findOne({ practice: practiceId, period }).select('replies').lean();
    if ((row?.replies ?? 0) >= limit) {
      await record(practiceId, patientId, 'allowance_spent', period);
      return { allowed: false, reason: 'allowance_spent' };
    }

    return { allowed: true, practiceId };
  } catch (err) {
    // The clinic keeps working. An allowance check that cannot run is a
    // reason to answer, not a reason to go quiet.
    logger.warn({ err }, 'could not check the assistant allowance');
    return { allowed: true };
  }
}

/**
 * Count a reply that was actually produced.
 *
 * After the model has answered, not before: a request that fails on the
 * provider's side has cost the practice nothing and must not count against
 * them. Fire-and-forget — a counter that fails should not lose the reply.
 */
export function countReply(practiceId) {
  if (!practiceId) return;
  /*
   * `.exec()` on purpose, and it is not decoration.
   *
   * A mongoose query is a lazy thenable: `updateOne(...)` builds one and runs
   * nothing until something awaits it, calls `.then()`, or calls `.exec()`.
   * Without the trailing `.catch()` this line executed no query at all — the
   * counter worked only as a side effect of its own error handler, so tidying
   * that away would have stopped the counting silently rather than loudly.
   *
   * Made explicit so the execution does not depend on the handler.
   */
  AiUsage.updateOne(
    { practice: practiceId, period: currentPeriod() },
    { $inc: { replies: 1 } },
    { upsert: true },
  )
    .exec()
    .catch((err) => logger.warn({ err }, 'could not count an assistant reply'));
}

/** Both halves of a refusal: the counter, and the line somebody can read. */
async function record(practiceId, patientId, reason, period = currentPeriod()) {
  // Awaited, so this one always ran — but `.exec()` for the same reason as
  // above: whether a query executes should be visible in the line that writes
  // it, not inferred from what happens to be chained onto the end.
  await AiUsage.updateOne(
    { practice: practiceId, period },
    { $inc: { refused: 1 } },
    { upsert: true },
  )
    .exec()
    .catch((err) => logger.warn({ err }, 'could not count an assistant refusal'));

  AuditLog.create({
    actor: null,
    actorRole: 'assistant',
    // Prefixed like recordDenial's, so one query finds every refusal whatever
    // the reason.
    action: `assistant.declined.${reason}`,
    resource: 'ChatSession',
    subjectPatient: patientId ?? null,
    meta: { practice: String(practiceId), period },
  }).catch((err) => logger.warn({ err }, 'could not record an assistant refusal'));
}

export { MONTHLY as AI_MONTHLY_ALLOWANCE };
