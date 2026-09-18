import mongoose from 'mongoose';
import { ChatSession } from '../models/ChatSession.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { notFound, conflict } from '../middleware/errors.js';
import { practiceOf, practicePatientIds, practiceOfPatient } from '../middleware/practiceScope.js';

/**
 * Which practice a conversation is with.
 *
 * ---- What was wrong ------------------------------------------------------
 *
 * A session never recorded it. Every read took the patient's sessions and every
 * write took the newest one, so for a patient two practices care for:
 *
 *   - each practice's clinician thread, chat review and dietician thread read
 *     the other practice's conversation;
 *   - a reply went into whichever session was newest — one practice's doctor
 *     writing into the conversation the other practice was holding;
 *   - the patient's message went to the newest conversation rather than the
 *     practice they meant;
 *   - and the assistant read, quoted and was counted as whichever practice the
 *     assigned-doctor proxy happened to name.
 *
 * ---- The rule -------------------------------------------------------------
 *
 * A conversation belongs to one enrolment. A session written before sessions
 * carried one belongs to the patient's first enrolment — the only practice they
 * had when it was written — which is the attribution the thread list and the
 * thread backfill already use. The first is the earliest the patient ever
 * consented to, not the earliest still current: a practice the patient has left
 * does not hand its old conversation to the next one.
 *
 * Where there is nothing to decide by — no enrolment anywhere, the deployment
 * the backfill has not reached — every conversation the patient has is the one
 * relationship they have, as it always was.
 */

const CURRENT = Object.freeze({ status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null });

/**
 * `details.reason` on the 409 that asks a patient which practice a message is
 * for, so the send can tell it from any other conflict — see
 * services/unplacedMessage.js, which triages the message before it is refused.
 */
export const CHOOSE_PRACTICE = 'CHOOSE_PRACTICE';

function kindFilter(kind) {
  // `$ne: 'nutrition'`, never `kind: 'care'`: sessions written before `kind`
  // existed have none. See the note on ChatSession.kind.
  if (kind === 'nutrition') return { kind: 'nutrition' };
  if (kind === 'care') return { kind: { $ne: 'nutrition' } };
  return {};
}

const idOf = (value) => (value?._id ?? value ?? null);

/** The patient's current enrolments, earliest first. */
export async function currentEnrolments(patientId) {
  if (!patientId) return [];
  return Enrollment.find({ patient: patientId, ...CURRENT }).sort({ enrolledOn: 1, _id: 1 }).lean();
}

/**
 * Which of a patient's relationships their own thread read shows.
 *
 * The conversation they opened, when it is theirs. Otherwise, with more than
 * one practice, their first — the conversation they have always had — rather
 * than every practice's messages interleaved on one screen. Null, with one
 * practice or none, is all of it, as it always was.
 */
export async function enrolmentForPatientRead(patientId, openedSessionId = null) {
  if (openedSessionId && mongoose.isValidObjectId(openedSessionId)) {
    const opened = await ChatSession.findOne({ _id: openedSessionId, patient: patientId }).lean();
    if (opened) return (await relationshipOfSession(opened)).enrollment;
  }
  if ((await currentEnrolments(patientId)).length <= 1) return null;
  return (await relationshipOfSession({ patient: patientId })).enrollment;
}

/**
 * The enrolment that owns the sessions written before sessions carried one.
 *
 * Pending rows are skipped: a desk that typed a number and never had it
 * confirmed was never the patient's practice.
 */
async function firstEnrolmentId(patientId) {
  const row = await Enrollment.findOne({ patient: patientId, status: { $ne: ENROLLMENT_STATUS.PENDING } })
    .sort({ enrolledOn: 1, _id: 1 })
    .select('_id')
    .lean();
  return row ? String(row._id) : null;
}

/**
 * A ChatSession filter for one patient's conversations with one practice.
 *
 * `enrollment` null means there is nothing to decide by, and the filter is the
 * patient's conversations as they always were. `kind` null means both the care
 * and the nutrition conversation.
 */
export async function relationshipSessions({ patientId, enrollment, kind = null }) {
  const base = { patient: patientId, ...kindFilter(kind) };
  if (!enrollment) return base;

  const ownsUnlinked = (await firstEnrolmentId(patientId)) === String(idOf(enrollment));
  return {
    ...base,
    ...(ownsUnlinked
      ? { $or: [{ enrollment: idOf(enrollment) }, { enrollment: null }] }
      : { enrollment: idOf(enrollment) }),
  };
}

/** Whether a session is part of the patient's relationship with this enrolment's practice. */
export async function sessionBelongsTo(session, enrollment) {
  if (!session) return false;
  if (!enrollment) return true;
  if (session.enrollment) return String(idOf(session.enrollment)) === String(idOf(enrollment));
  return (await firstEnrolmentId(idOf(session.patient))) === String(idOf(enrollment));
}

/**
 * The session a new message in this relationship goes into.
 *
 * The one already bound to the enrolment; failing that, the conversation this
 * relationship had before sessions carried an enrolment — adopted, and stamped
 * so the attribution is recorded rather than inferred again; failing that, a new
 * one. Never a session belonging to another practice, however recently used.
 */
export async function sessionForEnrolment({ patientId, enrollment, kind = 'care', language = 'en', title }) {
  const find = () =>
    enrollment
      ? ChatSession.findOne({
          patient: patientId,
          enrollment: idOf(enrollment),
          department: null,
          ...kindFilter(kind),
          isArchived: false,
        }).sort({ lastMessageAt: -1 })
      : null;

  const bound = await find();
  if (bound) return bound;

  const mayAdopt = !enrollment || (await firstEnrolmentId(patientId)) === String(idOf(enrollment));
  if (mayAdopt) {
    const unlinked = await ChatSession.findOne({
      patient: patientId,
      enrollment: null,
      ...kindFilter(kind),
      isArchived: false,
    }).sort({ lastMessageAt: -1 });

    if (unlinked) {
      if (!enrollment) return unlinked;
      try {
        await ChatSession.updateOne({ _id: unlinked._id, enrollment: null }, { $set: { enrollment: idOf(enrollment) } });
        unlinked.enrollment = idOf(enrollment);
        return unlinked;
      } catch (err) {
        // Another request bound one first. Theirs is the conversation now.
        if (err?.code !== 11000) throw err;
        const raced = await find();
        if (raced) return raced;
        throw err;
      }
    }
  }

  /*
   * A new conversation — unless another request made it a moment ago.
   *
   * Two replies arriving together both look for this enrolment's conversation,
   * both find none, and both reach here. Without an index behind it each
   * created its own, and the thread split in two; the unique index on
   * (enrollment, department, kind) now refuses the second, and the second
   * request continues in the conversation the first one made. A conversation
   * with no enrolment is outside that index and cannot race this way.
   */
  try {
    return await ChatSession.create({
      patient: patientId,
      enrollment: idOf(enrollment),
      kind,
      language,
      ...(title ? { title } : {}),
    });
  } catch (err) {
    if (err?.code !== 11000) throw err;
    const raced = await find();
    if (raced) return raced;
    throw err;
  }
}

/**
 * The conversation a patient's own message goes into.
 *
 *   1. the conversation they are in, when the id is theirs;
 *   2. the practice they chose, when they are enrolled there;
 *   3. their one practice — or, enrolled nowhere, the conversation they have
 *      always had;
 *   4. otherwise they are asked which practice. Never guessed for.
 *
 * The nutrition conversation has one more step before asking: the dietician
 * conversation the patient's screen already shows, which is the newest one.
 */
export async function sessionForPatientSend({
  patientId,
  sessionId = null,
  practiceId = null,
  kind = 'care',
  language = 'en',
  title,
}) {
  if (sessionId && mongoose.isValidObjectId(sessionId)) {
    const own = await ChatSession.findOne({ _id: sessionId, patient: patientId, ...kindFilter(kind) });
    if (own) return own;
  }

  if (practiceId) {
    const enrollment = mongoose.isValidObjectId(practiceId)
      ? await Enrollment.findOne({ patient: patientId, practice: practiceId, ...CURRENT })
      : null;
    // Not found, the same answer as a practice that does not exist.
    if (!enrollment) throw notFound('Practice not found');
    return sessionForEnrolment({ patientId, enrollment, kind, language, title });
  }

  const enrolments = await currentEnrolments(patientId);
  if (enrolments.length <= 1) {
    return sessionForEnrolment({ patientId, enrollment: enrolments[0] ?? null, kind, language, title });
  }

  if (kind === 'nutrition') {
    const shown = await ChatSession.findOne({ patient: patientId, kind: 'nutrition', isArchived: false }).sort({
      lastMessageAt: -1,
    });
    if (shown) return shown;
  }

  throw conflict('You are with more than one practice. Choose which one this message is for.', {
    reason: CHOOSE_PRACTICE,
  });
}

/**
 * The caller's practice's current enrolment of this patient.
 *
 * For routes that do not pass through `enrollmentGate`, the dietician's among
 * them. Null only where there is nothing to decide by. A patient enrolled
 * elsewhere and not here is not found.
 */
export async function callerEnrolment(req, patientId) {
  return enrolmentAt(await practiceOf(req), patientId);
}

/** The same question for a practice named directly: the practice of whoever is writing. */
export async function enrolmentAt(practiceId, patientId) {
  if (!practiceId) return null;
  const here = await Enrollment.findOne({ patient: patientId, practice: practiceId, ...CURRENT });
  if (here) return here;
  if (await Enrollment.exists({ patient: patientId })) throw notFound('No conversation with this patient');
  return null;
}

/**
 * A ChatSession filter for every conversation the caller's practice holds.
 *
 * For lists that name no patient. Permissive only where `practicePatientIds`
 * is — no practice on the caller, or no enrolments anywhere yet.
 */
export async function practiceSessions(req) {
  if (req._practiceSessions !== undefined) return req._practiceSessions;
  req._practiceSessions = await practiceSessionsUncached(req);
  return req._practiceSessions;
}

/**
 * A ChatMessage filter for messages in the caller's practice's conversations.
 *
 * For the bell, the badges and the inbox previews, which count and quote
 * messages without opening a conversation. Keyed on `session`, so it spreads
 * beside a `patient` scope without replacing it. `{}` wherever
 * [practiceSessions] is permissive. Cached on the request.
 */
export async function practiceMessages(req) {
  if (req._practiceMessages !== undefined) return req._practiceMessages;
  const sessions = await practiceSessions(req);
  req._practiceMessages = Object.keys(sessions).length
    ? { session: { $in: await ChatSession.distinct('_id', sessions) } }
    : {};
  return req._practiceMessages;
}

async function practiceSessionsUncached(req) {
  const practiceId = await practiceOf(req);
  const patients = await practicePatientIds(req);
  if (!practiceId || !patients) return {};

  const here = await Enrollment.find({ practice: practiceId, ...CURRENT }).select('_id patient').lean();
  if (!here.length) return { _id: { $in: [] } };

  // Whose conversations from before sessions carried an enrolment are this
  // practice's: the patients whose first enrolment is the one here.
  const firsts = await Enrollment.aggregate([
    { $match: { patient: { $in: here.map((e) => e.patient) }, status: { $ne: ENROLLMENT_STATUS.PENDING } } },
    { $sort: { enrolledOn: 1, _id: 1 } },
    { $group: { _id: '$patient', first: { $first: '$_id' } } },
  ]);
  const mine = new Set(here.map((e) => String(e._id)));
  const unlinkedPatients = firsts.filter((f) => mine.has(String(f.first))).map((f) => f._id);

  return {
    $or: [
      { enrollment: { $in: here.map((e) => e._id) } },
      { enrollment: null, patient: { $in: unlinkedPatients } },
    ],
  };
}

/**
 * The practice a conversation is with, and when that practice was given access.
 *
 * `practiceId` falls back to the assigned doctor's practice only where no
 * enrolment decides — a deployment the backfill has not reached. `enrolledOn`
 * is then null, and nothing is windowed.
 */
export async function relationshipOfSession(session) {
  const patientId = idOf(session?.patient);
  const enrollmentId = session?.enrollment ? idOf(session.enrollment) : await firstEnrolmentId(patientId);
  const enrollment = enrollmentId ? await Enrollment.findById(enrollmentId).lean() : null;

  return {
    enrollment,
    practiceId: enrollment ? String(enrollment.practice) : await practiceOfPatient(patientId),
    enrolledOn: enrollment?.enrolledOn ?? null,
  };
}
