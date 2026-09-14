import { ChatMessage } from '../models/ChatMessage.js';
import { ChatSession } from '../models/ChatSession.js';
import { ConversationSummary } from '../models/ConversationSummary.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../models/Membership.js';
import { User } from '../models/User.js';
import { relationshipOfSession } from './conversationPractice.js';
import { conversationDay, rulesSummary, clinicDay } from './ai/chatSummary.js';
import { responsibleFor, answeredBy } from './careResponsibility.js';
import { notifyClinicianOfChatDigest } from './notifications.js';
import { CLINIC_TZ, dayjs } from '../utils/clinicTime.js';
import { logger } from '../config/logger.js';

/**
 * The evening push telling a clinician that their patients' day is summarised.
 *
 * ---- Who hears it -------------------------------------------------------------
 *
 * The people who decide: a current member whose grant holds both VIEW_PATIENT
 * and PRESCRIBE. Read from the permission grant, never a role name — a doctor
 * whose grant was narrowed hears nothing, and a role added later that holds both
 * hears it without a deploy.
 *
 * ---- What it counts ------------------------------------------------------------
 *
 * Per person, their own patients by the rule the list uses: the ones they answer
 * for, and the ones nobody at the practice answers for.
 *
 * "Needs you" is what the list would say, worked out without a model call: the
 * stored summary's verdict while nothing has been written since it was made (a
 * written summary may only add to the rules), and the rules summary otherwise.
 * An evening push must neither wait on nor pay for a model call per patient.
 *
 * A day this person has marked read, with nothing written since, is not waiting
 * on them. The push and the list agree about that, or the push becomes the one
 * they learn to ignore.
 *
 * A conversation with no enrolment to decide its practice by is counted for
 * nobody. An evening push is not the place to guess whose patient somebody is.
 *
 * ---- What it never says ----------------------------------------------------------
 *
 * A name, or a word of what was written. See notifyClinicianOfChatDigest.
 */

function decides(membership) {
  const grant = membership.permissions?.length
    ? membership.permissions
    : presetFor({ role: membership.role, isOwner: membership.isOwner });
  return grant.includes(PERMISSIONS.VIEW_PATIENT) && grant.includes(PERMISSIONS.PRESCRIBE);
}

/**
 * Push the day's digest to every clinician who has something in it.
 *
 * @param {string} [day] the clinic's `YYYY-MM-DD`; today by default
 * @returns {Promise<{sent: number}>} devices delivered to
 */
export async function sendChatDigests(day = clinicDay()) {
  const start = dayjs.tz(day, CLINIC_TZ).startOf('day');
  const wrote = await ChatMessage.aggregate([
    {
      $match: {
        role: 'user',
        createdAt: { $gte: start.toDate(), $lt: start.add(1, 'day').toDate() },
        deletedForEveryoneAt: null,
      },
    },
    { $group: { _id: '$session' } },
  ]);
  if (!wrote.length) return { sent: 0 };

  const sessions = await ChatSession.find({ _id: { $in: wrote.map((w) => w._id) }, kind: { $ne: 'nutrition' } })
    .select('_id patient enrollment department')
    .lean();

  // The practice each conversation is with, that practice's enrolment of the
  // patient, and the departments the patient wrote to there today ('' for a
  // thread no department has taken).
  const byPractice = new Map();
  const writtenTo = new Map();
  for (const session of sessions) {
    const relationship = await relationshipOfSession(session);
    if (!relationship.practiceId || !relationship.enrollment) continue;
    const practiceId = String(relationship.practiceId);
    if (!byPractice.has(practiceId)) {
      byPractice.set(practiceId, new Map());
      writtenTo.set(practiceId, new Map());
    }
    const patient = String(session.patient);
    byPractice.get(practiceId).set(patient, relationship.enrollment);
    const departments = writtenTo.get(practiceId);
    if (!departments.has(patient)) departments.set(patient, new Set());
    departments.get(patient).add(session.department ? String(session.department) : '');
  }

  let sent = 0;
  for (const [practiceId, patients] of byPractice) {
    try {
      const members = (
        await Membership.find({ practice: practiceId, status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null })
          .select('user role isOwner permissions department')
          .lean()
      ).filter(decides);
      if (!members.length) continue;

      const patientIds = [...patients.keys()];
      const stored = new Map(
        (
          await ConversationSummary.find({ practice: practiceId, patient: { $in: patientIds }, kind: 'care', day })
            .select('patient lastMessageAt needsDoctor reviewedBy')
            .lean()
        ).map((s) => [String(s.patient), s]),
      );

      // Patient id → whether the day needs a clinician, for the patients who
      // wrote to this practice; and → who has read it, while that still stands.
      const needs = new Map();
      const readBy = new Map();
      for (const id of patientIds) {
        const enrollment = patients.get(id);
        const messages = await conversationDay({
          patientId: id,
          enrollment,
          enrolledOn: enrollment.enrolledOn ?? null,
          day,
          kind: 'care',
        });
        if (!messages.some((m) => m.role === 'user')) continue;

        // The same test the list uses: a summary speaks for the day only while
        // nothing has been written after it.
        const summary = stored.get(id);
        const last = messages.at(-1).createdAt;
        const current = summary?.lastMessageAt && new Date(summary.lastMessageAt) >= new Date(last);
        needs.set(id, current ? Boolean(summary.needsDoctor) : rulesSummary(messages).needsDoctor);
        if (current) readBy.set(id, new Set((summary.reviewedBy ?? []).map((r) => String(r.user))));
      }
      const responsible = await responsibleFor({ practiceId, patientIds });

      // Narrowed as the chat review list is: somebody in a department is
      // counted for the threads written to it and the ones no department has
      // taken, so the push never counts a patient their list will not show.
      const departmentOf = new Map(members.map((m) => [String(m.user), m.department ? String(m.department) : null]));
      const departments = writtenTo.get(practiceId);
      const reaches = (userId, patientId) => {
        const department = departmentOf.get(String(userId));
        const threads = departments.get(patientId);
        return !department || threads.has('') || threads.has(department);
      };

      const users = await User.find({ _id: { $in: members.map((m) => m.user) }, isActive: true })
        .select('_id deviceTokens')
        .lean();

      for (const user of users) {
        const me = String(user._id);
        const mine = answeredBy(responsible, user._id).filter((id) => needs.has(id) && reaches(user._id, id));
        if (!mine.length) continue;
        const out = await notifyClinicianOfChatDigest({
          user,
          patients: mine.length,
          needYou: mine.filter((id) => needs.get(id) && !readBy.get(id)?.has(me)).length,
          day,
        });
        sent += out?.delivered ?? 0;
      }
    } catch (err) {
      // One practice's failure must not cost every other practice its evening.
      logger.error({ err, practiceId }, 'chat digest failed for a practice');
    }
  }

  return { sent };
}
