import { Router } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';

import { requireAuth, requireClinician } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { requirePermission, enrollmentGate } from '../middleware/authorise.js';
import { PERMISSIONS } from '../models/Membership.js';
import { practiceOf, assertSamePractice, departmentThreads } from '../middleware/practiceScope.js';
import { requestCan } from '../middleware/requireCapability.js';
import { CAPABILITIES } from '../services/capabilities.js';
import { practiceSessions } from '../services/conversationPractice.js';
import { responsibleFor, answeredBy } from '../services/careResponsibility.js';
import { summaryFor, clinicDay, bySeverity } from '../services/ai/chatSummary.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { ChatSession } from '../models/ChatSession.js';
import { ConversationSummary } from '../models/ConversationSummary.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { User, ROLES } from '../models/User.js';
import { CLINIC_TZ, DATE_RE, dayjs } from '../utils/clinicTime.js';

/**
 * The day's conversations, summarised for the clinicians they did not interrupt.
 *
 * ---- Who reads what ------------------------------------------------------------
 *
 * Anybody at the practice who may see patients — the permission, not a role —
 * and only that practice's conversations. "Mine" is the patients a person
 * answers for: assigned to them, enrolled under them, or answered for by nobody
 * at the practice, so that a patient nobody has taken on is summarised to
 * everybody rather than to nobody. "Practice" is everyone who wrote.
 *
 * Both are narrowed the way the chat review list is: a clinician in a
 * department reads the threads written to that department and the ones no
 * department has taken. A summary itself covers the patient's whole day with
 * the practice — one per patient, practice and day.
 *
 * ---- What the practice has decides how it is written ----------------------------
 *
 * With the assistant, the model writes the summary on top of the rules one.
 * Without it — the plan, the type, or a model that is down — the rules summary
 * is the answer, and it still says what needs a clinician.
 */

const router = Router();
// Signed in, for everything here. The role guard sits on each route beside its
// permission: the role is the platform's check and the permission the
// practice's grant, and a route carrying only the second would admit anyone
// whose membership happened to hold it.
router.use(requireAuth);

/** How many patients one list summarises. A busier day is narrowed by scope. */
const LIST_LIMIT = 60;

/** Summaries written at once, so a busy morning does not open sixty model calls together. */
const CONCURRENCY = 4;

const CURRENT = Object.freeze({ status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null });

const kindQuery = z.enum(['care', 'nutrition']).default('care');

function dayBounds(day) {
  const start = dayjs.tz(day, CLINIC_TZ).startOf('day');
  return { start: start.toDate(), end: start.add(1, 'day').toDate() };
}

const kindFilter = (kind) => (kind === 'nutrition' ? { kind: 'nutrition' } : { kind: { $ne: 'nutrition' } });

async function inBatches(items, size, run) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(run))));
  }
  return out;
}

function serialise(summary, { patient, sessionId, me }) {
  const mine = (summary.reviewedBy ?? []).find((r) => String(r.user) === String(me));
  return {
    id: String(summary._id),
    patient: patient
      ? {
          id: String(patient._id),
          name: patient.name,
          avatarUrl: patient.avatarAssetId ? `/api/v1/uploads/${patient.avatarAssetId}/raw` : null,
        }
      : null,
    sessionId: sessionId ? String(sessionId) : null,
    kind: summary.kind,
    day: summary.day,
    highestUrgency: summary.highestUrgency,
    needsDoctor: Boolean(summary.needsDoctor),
    reasons: summary.reasons ?? [],
    overview: summary.overview ?? '',
    points: (summary.points ?? []).map((p) => ({
      kind: p.kind,
      text: p.text,
      messageIds: (p.messageIds ?? []).map(String),
    })),
    messageCount: summary.messageCount ?? 0,
    patientMessageCount: summary.patientMessageCount ?? 0,
    unansweredCount: summary.unansweredCount ?? 0,
    lastMessageAt: summary.lastMessageAt ?? null,
    // Whether it was written by the model or from the rules alone, so the
    // screen can say so rather than presenting both the same way.
    source: summary.source,
    reviewed: Boolean(mine),
    reviewedAt: mine?.at ?? null,
  };
}

/** One day's list for the caller's practice. */
router.get(
  '/',
  requireClinician,
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  validate({
    query: z.object({
      day: z.string().regex(DATE_RE).optional(),
      scope: z.enum(['mine', 'practice']).default('mine'),
      kind: kindQuery,
    }),
  }),
  audit('read', 'ConversationSummary'),
  asyncHandler(async (req, res) => {
    const { scope, kind } = q(req);
    const day = q(req).day ?? clinicDay();
    const empty = { day, scope, kind, counts: { patients: 0, needsDoctor: 0, reviewed: 0 }, items: [] };

    // No practice, no patients. A summary is patient data, and the absence of
    // a membership is not a reason to show everybody's.
    const practiceId = await practiceOf(req);
    if (!practiceId) return res.json(empty);

    const { start, end } = dayBounds(day);
    // `$and`, not spreads: the practice and the department can each be an `$or`.
    const sessions = await ChatSession.find({
      $and: [await practiceSessions(req), await departmentThreads(req), kindFilter(kind)],
    })
      .select('_id patient lastMessageAt')
      .sort({ lastMessageAt: -1 })
      .lean();
    if (!sessions.length) return res.json(empty);

    const wrote = await ChatMessage.aggregate([
      {
        $match: {
          role: 'user',
          session: { $in: sessions.map((s) => s._id) },
          createdAt: { $gte: start, $lt: end },
          deletedForEveryoneAt: null,
        },
      },
      { $group: { _id: '$patient', last: { $max: '$createdAt' } } },
      { $sort: { last: -1 } },
    ]);
    let patientIds = wrote.map((w) => String(w._id));
    if (scope === 'mine') {
      const mine = new Set(answeredBy(await responsibleFor({ practiceId, patientIds }), req.user._id));
      patientIds = patientIds.filter((id) => mine.has(id));
    }
    patientIds = patientIds.slice(0, LIST_LIMIT);
    if (!patientIds.length) return res.json(empty);

    const [users, enrolments, useAi] = await Promise.all([
      User.find({ _id: { $in: patientIds }, role: ROLES.PATIENT }).select('name avatarAssetId').lean(),
      Enrollment.find({ practice: practiceId, patient: { $in: patientIds }, ...CURRENT }),
      requestCan(req, CAPABILITIES.AI_ASSISTANT),
    ]);
    const userBy = new Map(users.map((u) => [String(u._id), u]));
    const enrolmentBy = new Map(enrolments.map((e) => [String(e.patient), e]));
    const sessionBy = new Map();
    for (const s of sessions) if (!sessionBy.has(String(s.patient))) sessionBy.set(String(s.patient), s._id);

    const summaries = (
      await inBatches(patientIds, CONCURRENCY, (patientId) =>
        summaryFor({
          practiceId,
          patientId,
          enrollment: enrolmentBy.get(patientId) ?? null,
          day,
          kind,
          useAi,
        }),
      )
    ).filter(Boolean);

    const items = summaries.sort(bySeverity).map((s) =>
      serialise(s, {
        patient: userBy.get(String(s.patient)),
        sessionId: sessionBy.get(String(s.patient)),
        me: req.user._id,
      }),
    );

    res.json({
      day,
      scope,
      kind,
      // Counted from what is listed, so the heading and the rows below it
      // cannot disagree.
      counts: {
        patients: items.length,
        needsDoctor: items.filter((i) => i.needsDoctor).length,
        reviewed: items.filter((i) => i.reviewed).length,
      },
      items,
    });
  }),
);

/** One patient's recent days, for the top of their conversation. */
router.get(
  '/patients/:patientId',
  requireClinician,
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  validate({
    query: z.object({
      days: z.coerce.number().int().min(1).max(14).default(1),
      kind: kindQuery,
    }),
  }),
  audit('read', 'ConversationSummary'),
  asyncHandler(async (req, res) => {
    const { days, kind } = q(req);
    if (!mongoose.isValidObjectId(req.params.patientId)) throw notFound('Patient not found');
    const patient = await User.findOne({ _id: req.params.patientId, role: ROLES.PATIENT })
      .select('name avatarAssetId')
      .lean();
    if (!patient) throw notFound('Patient not found');

    const practiceId = await practiceOf(req);
    if (!practiceId) throw notFound('Patient not found');

    // The questions every patient read asks: same practice, and enrolled there.
    await assertSamePractice(req, patient._id);
    await enrollmentGate(req, patient._id);

    const useAi = await requestCan(req, CAPABILITIES.AI_ASSISTANT);
    const today = dayjs().tz(CLINIC_TZ);
    const dayList = Array.from({ length: days }, (_, i) => today.subtract(i, 'day').format('YYYY-MM-DD'));

    const summaries = (
      await inBatches(dayList, CONCURRENCY, (day) =>
        summaryFor({ practiceId, patientId: patient._id, enrollment: req.enrollment ?? null, day, kind, useAi }),
      )
    ).filter(Boolean);

    res.json({
      patientId: String(patient._id),
      kind,
      items: summaries.map((s) => serialise(s, { patient, sessionId: null, me: req.user._id })),
    });
  }),
);

/** "I have read this day." Per person, and cleared by anything written after it. */
router.post(
  '/:id/reviewed',
  requireClinician,
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  audit('update', 'ConversationSummary'),
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    if (!practiceId || !mongoose.isValidObjectId(req.params.id)) throw notFound('Summary not found');

    // This practice's summary, or not found — the same answer as one that does
    // not exist.
    const summary = await ConversationSummary.findOne({ _id: req.params.id, practice: practiceId })
      .select('_id patient')
      .lean();
    if (!summary) throw notFound('Summary not found');
    await enrollmentGate(req, summary.patient);

    await ConversationSummary.updateOne({ _id: summary._id }, { $pull: { reviewedBy: { user: req.user._id } } });
    await ConversationSummary.updateOne(
      { _id: summary._id },
      { $push: { reviewedBy: { user: req.user._id, at: new Date() } } },
    );
    res.status(204).end();
  }),
);

export default router;
