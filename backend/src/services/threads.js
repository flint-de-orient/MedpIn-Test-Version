import { ChatSession } from '../models/ChatSession.js';
import { Department } from '../models/Department.js';
import { Practice } from '../models/Practice.js';
import { practicesFor } from './enrollments.js';
import { conversationAssistant } from './ai/assistantAvailability.js';

/**
 * A patient's conversations, grouped the way they actually exist.
 *
 * ---- One practice must render exactly as today ---------------------------
 *
 * This is the test of whether the rework is right rather than merely finished.
 * A patient with one practice and one thread has to come out of here as one
 * thread, opening straight into the conversation, with no list and no chooser —
 * because that is what they have now and nothing about their care changed.
 *
 * A patient with three practices gets a list, like any messaging app. Same
 * function, same data, different number of rows. The screen counts; this does
 * not.
 *
 * ---- Why null is a real answer and not a gap -----------------------------
 *
 * Every session that exists today has no enrollment and no department, because
 * neither existed when it was written. Those are not broken rows to be
 * repaired: a null department *is* the practice's general thread, which is what
 * a single-specialty clinic has. The backfill fills in the enrollment and
 * deliberately leaves the department alone.
 */

/**
 * Every care conversation this patient has, newest activity first within each
 * practice.
 *
 * Nutrition is excluded here and stays its own thread: the dietician's
 * conversation is a different care relationship, not a specialty of the
 * doctor's, and interleaving diet coaching with clinical questions leaves both
 * harder to follow.
 *
 * @returns {Promise<Array<{practice, enrollment, threads: Array}>>}
 */
export async function threadsFor(patientId, { language = 'en' } = {}) {
  const enrollments = await practicesFor(patientId);

  // `$ne: 'nutrition'`, never `kind: 'care'` — sessions written before `kind`
  // existed have none at all, and an equality check makes a patient's whole
  // history vanish. See the note on the field itself.
  const sessions = await ChatSession.find({
    patient: patientId,
    kind: { $ne: 'nutrition' },
    isArchived: false,
  })
    .sort({ lastMessageAt: -1 })
    .lean();

  if (!enrollments.length) {
    // Pre-migration: no enrollments, so there is nothing to group by. Return
    // the threads as one unlabelled group, which is precisely today's screen.
    return sessions.length
      ? [{ practice: null, enrollment: null, threads: await describe(sessions, language, null) }]
      : [];
  }

  const practices = await Practice.find({
    _id: { $in: enrollments.map((e) => e.practice) },
  })
    .select('name')
    .lean();
  const nameOf = new Map(practices.map((p) => [String(p._id), p.name]));

  // Sessions whose enrollment was never backfilled belong to the patient's
  // first practice — it is the only one they had when the row was written.
  const primary = enrollments[0];

  const groups = enrollments.map((e) => ({
    practice: { id: e.practice, name: nameOf.get(e.practice) ?? null },
    enrollment: e.id,
    sessions: [],
  }));
  const byEnrollment = new Map(groups.map((g) => [g.enrollment, g]));

  for (const s of sessions) {
    const key = s.enrollment ? String(s.enrollment) : primary.id;
    (byEnrollment.get(key) ?? byEnrollment.get(primary.id))?.sessions.push(s);
  }

  const out = [];
  for (const g of groups) {
    out.push({
      practice: g.practice,
      enrollment: g.enrollment,
      threads: await describe(g.sessions, language, g.practice.id),
    });
  }
  // A practice the patient has joined but never messaged still appears, so they
  // can start a conversation rather than wondering where the clinic went.
  return out;
}

/**
 * Label each thread with its department, and say whether it can be answered.
 *
 * Whether it can be answered is the availability check's answer for this
 * practice, asked once per department rather than once per thread. It was
 * `Boolean(assistantScope.role)`, which a scope still awaiting review also
 * satisfies — the list would have promised an assistant nobody had approved.
 */
async function describe(sessions, language, practiceId) {
  const ids = [...new Set(sessions.map((s) => s.department).filter(Boolean).map(String))];
  const departments = ids.length
    ? await Department.find({ _id: { $in: ids } }).lean()
    : [];
  const byId = new Map(departments.map((d) => [String(d._id), d]));

  const answers = new Map();
  for (const s of sessions) {
    const key = s.department ? String(s.department) : 'general';
    if (!answers.has(key)) {
      answers.set(key, await conversationAssistant({ session: s, practiceId, language }));
    }
  }

  return sessions.map((s) => {
    const d = s.department ? byId.get(String(s.department)) : null;
    const answer = answers.get(s.department ? String(s.department) : 'general');
    return {
      id: String(s._id),
      // Null department renders as the practice's own name upstream, which is
      // what a single-specialty clinic's thread has always shown.
      department: d
        ? { id: String(d._id), key: d.key, name: d.names?.[language] || d.names?.en || d.key }
        : null,
      hasAssistant: answer.enabled,
      // Why not, for a screen that wants to say more than "clinic replies
      // only": a scope still awaiting review reads differently from a
      // specialty with no assistant at all.
      assistant: { enabled: answer.enabled, reason: answer.reason },
      lastMessageAt: s.lastMessageAt,
      highestUrgency: s.highestUrgency,
      messageCount: s.messageCount ?? 0,
    };
  });
}

/**
 * The thread for one patient in one department, creating it if this is the
 * first message.
 *
 * `departmentId` null resolves the practice's general thread, which is the only
 * thread a single-specialty clinic has and the one every existing session is.
 */
export async function threadFor({ patientId, enrollmentId = null, departmentId = null, language = 'en' }) {
  const existing = await ChatSession.findOne({
    patient: patientId,
    kind: { $ne: 'nutrition' },
    isArchived: false,
    ...(enrollmentId ? { enrollment: enrollmentId } : {}),
    department: departmentId ?? null,
  }).sort({ lastMessageAt: -1 });

  if (existing) return existing;

  return ChatSession.create({
    patient: patientId,
    enrollment: enrollmentId,
    department: departmentId,
    kind: 'care',
    language,
  });
}

// Whether a reply may be generated in a thread is `conversationAssistant` in
// ai/assistantAvailability.js: a department with no approved assistant gets
// silence, a practice's general thread follows the practice's specialty, and
// with no specialty on the practice it keeps the assistant it has always had.
// The thread list above and the assistant itself both ask it.
