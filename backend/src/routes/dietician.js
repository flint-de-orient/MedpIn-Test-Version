import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireDietician } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { User, ROLES } from '../models/User.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { Medication } from '../models/Medication.js';
import { Prescription } from '../models/Prescription.js';
import { LabResult } from '../models/LabResult.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { FoodLog } from '../models/FoodLog.js';
import { buildAnalytes } from '../services/analyteCatalog.js';
import { ChatSession } from '../models/ChatSession.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { DietPlan } from '../models/DietPlan.js';
import { DietPlanRevision } from '../models/DietPlanRevision.js';
import { notifyPatientOfClinicianReply } from '../services/notifications.js';
import { dayjs } from '../utils/clinicTime.js';
import { getClinicSettings } from '../models/ClinicSettings.js';
import { buildAttention } from '../services/nutritionAttention.js';
import { normaliseTestName } from '../utils/testNames.js';
import { practicePatients, practiceOfMember } from '../middleware/practiceScope.js';
import { attachableAssetIds } from '../services/mediaAccess.js';
import { quotableMessageId, quotePreview, QUOTE_FIELDS } from '../services/quotedMessage.js';
import {
  callerEnrolment,
  enrolmentAt,
  practiceSessions,
  relationshipSessions,
  sessionForEnrolment,
} from '../services/conversationPractice.js';

/**
 * The dietician panel API. A dietician only ever sees the patients a doctor has
 * assigned to them, and only the nutrition-relevant slice of the record: the
 * medical status and the doctor's active medicine list. Food advice is given by
 * the dietician directly in the patient's care thread (never auto-generated).
 */
const router = Router();
router.use(requireAuth, requireDietician);

/**
 * A food-log review is due when the review interval has elapsed.
 *
 * The clinic-wide default applies unless this patient's record overrides it —
 * so a cadence set once in the doctor's panel covers every patient, and a
 * patient who needs closer watching can still be set apart.
 */
function reviewDue(p, defaultDays) {
  const interval = p.dietReviewIntervalDays ?? defaultDays;
  if (!interval) return false;
  const since = p.lastDietReviewAt ?? p.createdAt;
  return dayjs().diff(dayjs(since), 'day') >= interval;
}

/**
 * Whole days, oldest first, as `YYYY-MM-DD` keys. Used by both fourteen-day
 * series so the buckets line up.
 */
function dayKeys(count, endExclusive = dayjs().add(1, 'day').startOf('day')) {
  const out = [];
  for (let i = count; i >= 1; i -= 1) out.push(endExclusive.subtract(i, 'day').format('YYYY-MM-DD'));
  return out;
}

/**
 * Share of the caseload's glucose readings that landed in range, per day, over
 * [days] — plus the same figure for the [days] before it, so the header can say
 * whether nutrition is going the right way rather than only where it stands.
 *
 * Derived from `flag`, which the server already stamps on every reading against
 * the clinic's own bands. Recomputing "in range" here would be a second copy of
 * a clinical threshold, and the copy that goes stale when the bands change.
 *
 * A day with no readings is a hole, not a zero: nobody testing is not the same
 * as everybody testing badly, and plotting it as 0% would draw a cliff into the
 * chart every Sunday.
 */
async function nutritionOverview(ids, days = 14) {
  if (ids.length === 0) return { inTargetPercent: null, deltaPercent: null, series: [] };

  const from = dayjs().startOf('day').subtract(days * 2 - 1, 'day').toDate();
  const readings = await GlucoseReading.find({
    patient: { $in: ids },
    measuredAt: { $gte: from },
  })
    .select('measuredAt flag')
    .lean();

  const bucket = new Map();
  for (const r of readings) {
    const key = dayjs(r.measuredAt).format('YYYY-MM-DD');
    const cell = bucket.get(key) ?? { total: 0, inRange: 0 };
    cell.total += 1;
    if (r.flag === 'in_range') cell.inRange += 1;
    bucket.set(key, cell);
  }

  const pct = (cell) => (cell && cell.total > 0 ? Math.round((cell.inRange / cell.total) * 100) : null);
  const windowPct = (keys) => {
    let total = 0;
    let inRange = 0;
    for (const k of keys) {
      const cell = bucket.get(k);
      if (!cell) continue;
      total += cell.total;
      inRange += cell.inRange;
    }
    return total > 0 ? Math.round((inRange / total) * 100) : null;
  };

  const all = dayKeys(days * 2);
  const previous = all.slice(0, days);
  const current = all.slice(days);

  const now = windowPct(current);
  const before = windowPct(previous);

  return {
    inTargetPercent: now,
    // Only a comparison against a period that actually had readings means
    // anything. "+86%" against an empty fortnight would be an artefact.
    deltaPercent: now !== null && before !== null ? now - before : null,
    series: current.map((key) => ({ day: key, percent: pct(bucket.get(key)) })),
  };
}

/**
 * What has just happened across the caseload, newest first.
 *
 * Three streams merged and cut to [limit]: a patient wrote in their nutrition
 * thread, a patient logged a meal, a plan went out. Deliberately *not* a fourth
 * copy of the worklist — this answers "what changed while I was away", which is
 * a different question from "what do I owe", and the rest of the screen already
 * answers the second one.
 */
async function recentActivity(ids, byId, limit = 6, sessionScope = {}) {
  if (ids.length === 0) return [];

  const since = dayjs().subtract(7, 'day').toDate();
  // This practice's nutrition conversations. See services/conversationPractice.js.
  const sessions = await ChatSession.find({ kind: 'nutrition', patient: { $in: ids }, ...sessionScope })
    .select('_id patient')
    .lean();

  const [messages, logs, plans] = await Promise.all([
    sessions.length > 0
      ? ChatMessage.find({
          role: 'user',
          session: { $in: sessions.map((x) => x._id) },
          createdAt: { $gte: since },
        })
          .sort({ createdAt: -1 })
          .limit(limit)
          .select('patient createdAt')
          .lean()
      : [],
    FoodLog.find({ patient: { $in: ids }, createdAt: { $gte: since } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('patient createdAt')
      .lean(),
    DietPlan.find({ patient: { $in: ids }, sharedAt: { $gte: since } })
      .sort({ sharedAt: -1 })
      .limit(limit)
      .select('patient sharedAt')
      .lean(),
  ]);

  const name = (patientId) => byId.get(String(patientId))?.user?.name ?? null;

  const rows = [
    ...messages.map((m) => ({
      id: `msg-${String(m._id)}`,
      kind: 'message',
      patientName: name(m.patient),
      // "replied", because every one of these is a patient answering in a
      // thread the clinic started.
      text: 'replied',
      at: m.createdAt,
    })),
    ...logs.map((l) => ({
      id: `log-${String(l._id)}`,
      kind: 'food_log',
      patientName: name(l.patient),
      text: 'submitted a food log',
      at: l.createdAt,
    })),
    ...plans.map((p) => ({
      id: `plan-${String(p.patient)}-${new Date(p.sharedAt).getTime()}`,
      kind: 'plan',
      patientName: name(p.patient),
      // "sent to", not "accepted by": nothing in the schema records a patient
      // accepting a plan, and claiming they did would be inventing consent.
      text: 'diet plan sent',
      at: p.sharedAt,
    })),
  ]
    // A row whose patient is not on this caseload cannot be acted on, and
    // naming someone else's patient here would be a scope leak.
    .filter((r) => r.patientName)
    .sort((a, b) => new Date(b.at) - new Date(a.at))
    .slice(0, limit);

  return rows;
}

/**
 * The patients this dietician may see.
 *
 * A clinic has one or two dieticians and hundreds of patients, so requiring an
 * explicit assignment per patient made the default "this patient has nutrition
 * care from nobody" and left it to the doctor to remember, one patient at a
 * time. The default is now the clinic's actual intent: the dietician covers
 * everyone.
 *
 * Assignment survives as a *restriction* rather than a grant — if any patient
 * has been explicitly assigned to this dietician, they see only those. That
 * keeps a lever for the day there is a second dietician or a locum, with no
 * schema change and nothing to migrate.
 */
async function scopeFilter(req) {
  /*
   * The patients assigned to this dietician, at this practice. Nothing else.
   *
   * It used to fall back to the whole practice when nobody had been assigned,
   * which read as "the clinic's dietician covers everyone" — true of the
   * clinic it was written for, and a default that widens access in every
   * clinic it was not. A second dietician, a locum, or somebody who has
   * finished with a patient all inherited the practice until a person
   * remembered to restrict them, and nothing in the record said who was
   * supposed to be looking after whom.
   *
   * The default now lives where it can be recorded: a practice with exactly
   * one dietician assigns them to each patient as the patient joins, so the
   * caseload is what the assignments say. See services/dieticianAssignment.js,
   * and scripts/backfillDieticianAssignments.js for the ones that predate it.
   *
   * Still intersected with the practice, so an assignment that reaches outside
   * it grants nothing.
   */
  const practice = await practicePatients(req, 'user');
  const assigned = await PatientProfile.find({ assignedDietician: req.user._id, ...practice })
    .select('user')
    .lean();
  return { user: { $in: assigned.map((p) => p.user) } };
}

/** Guard: the id must be a patient this dietician may see. Returns the profile. */
async function requireAssigned(req) {
  const scope = await scopeFilter(req);
  /*
   * `$and`, not a spread. The scope is keyed on `user` as well, so
   * `{ user: req.params.id, ...scope }` replaced the requested patient with the
   * dietician's own list: the guard found one of their patients whatever id
   * was asked for, and the handler went on to read the one asked for.
   */
  const profile = await PatientProfile.findOne({ $and: [{ user: req.params.id }, scope] }).lean();
  if (!profile) throw notFound('Patient not found or not in your list');
  return profile;
}

/**
 * The dietician's day in one call: how many patients, how many reviews are due,
 * how many still have no plan, plus the two lists worth acting on.
 *
 * Computed server-side rather than assembled by the app from three endpoints:
 * the counts must agree with each other, and three round-trips over a clinic's
 * mobile connection is three chances to show a half-loaded dashboard.
 */
/**
 * Unread patient messages across the nutrition threads of [patientIds].
 *
 * `seenByClinicAt` is the clinic's single read marker rather than a per-user
 * one, so this is "nobody here has looked at it", not "this dietician has not".
 * For a caseload with one dietician on it those are the same thing; a badge
 * that quietly meant something narrower would be worse than this.
 */
async function urgentNutritionCount(patientIds, sessionScope = {}) {
  if (patientIds.length === 0) return 0;
  const sessions = await ChatSession.find({ kind: 'nutrition', patient: { $in: patientIds }, ...sessionScope })
    .select('_id')
    .lean();
  if (sessions.length === 0) return 0;
  return ChatMessage.countDocuments({
    role: 'user',
    seenByClinicAt: null,
    urgency: { $in: ['urgent', 'emergency'] },
    session: { $in: sessions.map((s) => s._id) },
  });
}

async function unreadNutritionCount(patientIds, sessionScope = {}) {
  if (patientIds.length === 0) return 0;
  const sessions = await ChatSession.find({ kind: 'nutrition', patient: { $in: patientIds }, ...sessionScope })
    .select('_id')
    .lean();
  if (sessions.length === 0) return 0;
  return ChatMessage.countDocuments({
    role: 'user',
    seenByClinicAt: null,
    session: { $in: sessions.map((s) => s._id) },
  });
}

/**
 * What is waiting for this dietician, newest first.
 *
 * Three things, in the order they matter: a patient has written and nobody at
 * the clinic has opened it; a review has lapsed; a patient has no plan yet. All
 * three already drive numbers on the dashboard — this is the same work as a
 * list, so tapping the bell shows what the count was counting rather than
 * dropping the dietician on a screen to work it out for themselves.
 *
 * Scoped to their own caseload throughout. A notification about somebody else's
 * patient is one the reader cannot act on.
 */
/**
 * For each of [sessions], the other dietician already answering it.
 *
 * The list is not filtered by ownership the way push notifications are, and
 * deliberately: a push is an interruption and sending two people the same one
 * is waste, but this list is also the worklist. Hiding a patient's unread
 * message from everyone except whoever answered last would mean that if that
 * person is away, nobody sees it at all — which is worse than seeing it twice.
 *
 * So the row stays and says who has it instead. "Romit Dey is answering" is
 * something a reader can act on; the same row with no label is a second
 * dietician drafting a reply to a question that is already being handled.
 */
async function handledByOther(sessions, meId) {
  if (sessions.length === 0) return new Map();

  const replies = await ChatMessage.aggregate([
    {
      $match: {
        session: { $in: sessions.map((s) => s._id) },
        role: 'clinician',
        sender: { $ne: null },
      },
    },
    { $sort: { seq: -1 } },
    { $group: { _id: '$session', sender: { $first: '$sender' } } },
  ]);

  // Only other dieticians. A doctor answering in the nutrition thread is not
  // someone this dietician should stand down for, and neither is themselves.
  const senderIds = replies
    .map((r) => r.sender)
    .filter((id) => String(id) !== String(meId));
  if (senderIds.length === 0) return new Map();

  const others = await User.find({
    _id: { $in: senderIds },
    role: ROLES.DIETICIAN,
    isActive: true,
  })
    .select('name')
    .lean();
  const nameById = new Map(others.map((u) => [String(u._id), u.name]));

  const bySession = new Map();
  for (const r of replies) {
    const name = nameById.get(String(r.sender));
    if (name) bySession.set(String(r._id), name);
  }
  return bySession;
}

router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const [profiles, settings] = await Promise.all([
      PatientProfile.find(await scopeFilter(req))
        .populate('user', 'name avatarAssetId isActive')
        .lean(),
      getClinicSettings(),
    ]);
    const defaultDays = settings.dietReviewIntervalDays;
    const assigned = profiles.filter((p) => p.user && p.user.isActive !== false);
    const byId = new Map(assigned.map((p) => [String(p.user._id), p]));
    const ids = assigned.map((p) => p.user._id);

    const face = (p) => ({
      patientId: String(p.user._id),
      patientName: p.user.name,
      avatarUrl: p.user.avatarAssetId ? `/api/v1/uploads/${p.user.avatarAssetId}/raw` : null,
    });

    let messages = [];
    if (ids.length > 0) {
      // This practice's nutrition conversations: a patient another practice
      // also cares for writes to that practice's dietician too.
      const sessions = await ChatSession.find({ kind: 'nutrition', patient: { $in: ids }, ...(await practiceSessions(req)) })
        .select('_id patient')
        .lean();
      if (sessions.length > 0) {
        const [unread, handledBy] = await Promise.all([
          ChatMessage.find({
            role: 'user',
            seenByClinicAt: null,
            session: { $in: sessions.map((x) => x._id) },
          })
            .sort({ createdAt: -1 })
            .limit(30)
            .select('patient session content createdAt attachments')
            .lean(),
          handledByOther(sessions, req.user._id),
        ]);

        messages = unread
          .map((m) => {
            const profile = byId.get(String(m.patient));
            if (!profile) return null;
            const text = (m.content ?? '').trim();
            return {
              id: String(m._id),
              kind: 'message',
              ...face(profile),
              // A photo with no caption is still something to look at, so it
              // gets a description rather than an empty line.
              text: text.length > 0 ? text.slice(0, 200) : 'Sent a photo',
              at: m.createdAt,
              unread: true,
              // Null unless another dietician is already in this conversation.
              handledBy: handledBy.get(String(m.session)) ?? null,
            };
          })
          .filter(Boolean);
      }
    }

    const reviews = assigned
      .filter((p) => reviewDue(p, defaultDays))
      .map((p) => ({
        id: `review-${String(p.user._id)}`,
        kind: 'review',
        ...face(p),
        text: 'Food-log review is due',
        at: p.lastDietReviewAt ?? p.createdAt,
        unread: false,
      }));

    const planBy = new Map(
      (await DietPlan.find({ patient: { $in: ids } }).select('patient sharedAt').lean()).map((x) => [
        String(x.patient),
        x,
      ]),
    );
    const plans = assigned
      .filter((p) => {
        const plan = planBy.get(String(p.user._id));
        return !plan || !plan.sharedAt;
      })
      .map((p) => ({
        id: `plan-${String(p.user._id)}`,
        kind: 'plan',
        ...face(p),
        text: 'Waiting for a diet plan',
        at: p.createdAt,
        unread: false,
      }));

    // Newest first within each group, and the groups in the order above: an
    // unread question is a person waiting for an answer, which outranks work
    // that has been outstanding for days and will keep.
    const byNewest = (a, b) => new Date(b.at ?? 0) - new Date(a.at ?? 0);

    // Counted, not measured off the rendered list. `messages` is capped at 30
    // above, so past that the sheet under-reported while the dashboard badge —
    // which uses a real count — kept saying the true figure. Two numbers for
    // one fact, disagreeing on the same screen.
    const unread = await unreadNutritionCount(ids, await practiceSessions(req));

    res.json({
      unread,
      counts: { messages: unread, reviews: reviews.length, plans: plans.length },
      items: [...messages.sort(byNewest), ...reviews.sort(byNewest), ...plans.sort(byNewest)].slice(0, 50),
    });
  }),
);

/**
 * Marks this dietician's unread patient messages as seen.
 *
 * Called when they open the list, not when a notification arrives: the badge
 * should clear because somebody looked, never because something was delivered.
 */
router.post(
  '/notifications/seen',
  asyncHandler(async (req, res) => {
    const profiles = await PatientProfile.find(await scopeFilter(req)).select('user').lean();
    const ids = profiles.map((p) => p.user);
    if (ids.length === 0) return res.json({ cleared: 0 });

    // This practice's conversations only: clearing a badge here says nothing
    // about whether anybody read what the patient wrote to another practice.
    const sessions = await ChatSession.find({ kind: 'nutrition', patient: { $in: ids }, ...(await practiceSessions(req)) })
      .select('_id')
      .lean();
    if (sessions.length === 0) return res.json({ cleared: 0 });

    const result = await ChatMessage.updateMany(
      { role: 'user', seenByClinicAt: null, session: { $in: sessions.map((x) => x._id) } },
      { $set: { seenByClinicAt: new Date() } },
    );
    res.json({ cleared: result.modifiedCount ?? 0 });
  }),
);

/**
 * The in-target share on its own, over an arbitrary window.
 *
 * Separate from /dashboard so changing the period costs one small query
 * instead of recomputing the attention list, the plan status and the activity
 * feed — none of which the period affects.
 */
router.get(
  '/nutrition-overview',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(180).default(14) }) }),
  asyncHandler(async (req, res) => {
    const profiles = await PatientProfile.find(await scopeFilter(req))
      .populate('user', 'isActive')
      .lean();
    const ids = profiles
      .filter((p) => p.user && p.user.isActive !== false)
      .map((p) => p.user._id);
    res.json(await nutritionOverview(ids, req.query.days));
  }),
);

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const [profiles, settings] = await Promise.all([
      PatientProfile.find(await scopeFilter(req)).populate('user', 'name phone avatarAssetId isActive').lean(),
      getClinicSettings(),
    ]);
    const defaultDays = settings.dietReviewIntervalDays;
    const assigned = profiles.filter((p) => p.user && p.user.isActive !== false);
    const ids = assigned.map((p) => p.user._id);

    const [plans, recentLogs, unreadMessages, urgentMessages, weekLogs, overview] =
      await Promise.all([
        DietPlan.find({ patient: { $in: ids } }).select('patient updatedAt sharedAt').lean(),
        FoodLog.find({ patient: { $in: ids } })
          .sort({ createdAt: -1 })
          .limit(12)
          .populate('patient', 'name')
          .populate('photo', 'mimeType')
          .select('patient mealType note photo createdAt reviewedAt')
          .lean(),
        unreadNutritionCount(ids, await practiceSessions(req)),
        urgentNutritionCount(ids, await practiceSessions(req)),
        // A week of logs across the caseload, for the adherence read. Only the
        // two fields the calculation needs — this is every meal every patient
        // photographed, and pulling notes and photo refs for it would be the
        // heaviest query on the screen for no gain.
        ids.length > 0
          ? FoodLog.find({
              patient: { $in: ids },
              createdAt: { $gte: dayjs().startOf('day').subtract(6, 'day').toDate() },
            })
              .select('patient createdAt reviewedAt')
              .sort({ createdAt: -1 })
              .lean()
          : [],
        nutritionOverview(ids),
      ]);
    const planBy = new Map(plans.map((p) => [String(p.patient), p]));
    const profileById = new Map(assigned.map((p) => [String(p.user._id), p]));
    const activity = await recentActivity(ids, profileById, 6, await practiceSessions(req));

    const logsByPatient = new Map();
    for (const l of weekLogs) {
      const key = String(l.patient);
      const list = logsByPatient.get(key);
      if (list) list.push(l);
      else logsByPatient.set(key, [l]);
    }

    const brief = (p) => ({
      id: String(p.user._id),
      name: p.user.name,
      avatarUrl: p.user.avatarAssetId ? `/api/v1/uploads/${p.user.avatarAssetId}/raw` : null,
      riskBand: p.riskBand ?? 'low',
      diabetesType: p.diabetesType ?? null,
      reviewIntervalDays: p.dietReviewIntervalDays ?? defaultDays,
      lastReviewAt: p.lastDietReviewAt ?? null,
      // How long this has been waiting: since the last review if there was one,
      // otherwise since the record started. Reads correctly for both queues —
      // "review due 12d" and "no plan, 12d" are the same measurement.
      sinceDays: dayjs().diff(dayjs(p.lastDietReviewAt ?? p.createdAt), 'day'),
    });

    const due = assigned.filter((p) => reviewDue(p, defaultDays));
    // A plan that exists but was never sent is still work outstanding — the
    // patient cannot follow instructions they have not been given.
    const noPlan = assigned.filter((p) => {
      const plan = planBy.get(String(p.user._id));
      return !plan || !plan.sharedAt;
    });

    const weekAgo = dayjs().subtract(7, 'day');
    res.json({
      counts: {
        patients: assigned.length,
        // Real, not decorative: how many of those records were opened this
        // week. Rendered only when it is non-zero.
        newThisWeek: assigned.filter((p) => dayjs(p.createdAt).isAfter(weekAgo)).length,
        reviewsDue: due.length,
        plansMissing: noPlan.length,
        // Patient messages in the nutrition threads nobody at the clinic has
        // opened yet, scoped to this dietician's own caseload — a badge
        // counting somebody else's patients is a badge they cannot clear.
        unreadMessages,
        // Of those unread, the ones the triage marked as needing a person
        // sooner. A single number for "messages" hides the one that matters.
        urgentMessages,
      },
      reviewsDue: due.map(brief),
      plansMissing: noPlan.map(brief),
      // Where every plan stands, which was previously only inferable by
      // counting what was *missing*. Active means sent; draft means written and
      // not sent — the patient cannot follow a plan still sitting here.
      planStatus: {
        active: plans.filter((p) => p.sharedAt).length,
        draft: plans.filter((p) => !p.sharedAt).length,
        // Not an expiry — a plan does not expire, its review falls due. Three
        // days is the window in which it is still worth planning around.
        reviewDueSoon: assigned.filter((p) => {
          const interval = p.dietReviewIntervalDays ?? defaultDays;
          if (!interval || !p.lastDietReviewAt) return false;
          const left = interval - dayjs().diff(dayjs(p.lastDietReviewAt), 'day');
          return left >= 0 && left <= 3;
        }).length,
      },
      nutritionOverview: overview,
      attention: buildAttention({ assigned, defaultDays, logsByPatient, planBy }),
      activity,
      recentLogs: recentLogs
        // Skip bogus logs whose "photo" is not an image (a mis-filed voice note).
        .filter((f) => f.patient && (!f.photo || (f.photo.mimeType ?? '').startsWith('image/')))
        .map((f) => {
          return {
            id: String(f._id),
            patientId: String(f.patient._id),
            patientName: f.patient.name,
            mealType: f.mealType,
            note: f.note ?? '',
            photoUrl: f.photo ? `/api/v1/uploads/${f.photo._id}/raw` : null,
            createdAt: f.createdAt,
            // The meal's own state now, not one inferred from a date on the
            // patient's profile. That inference marked three plates read
            // because a dietician replied about the fourth.
            needsReview: !f.reviewedAt,
            reviewedAt: f.reviewedAt ?? null,
            mealStatus: f.mealStatus ?? null,
          };
        }),
    });
  }),
);

/** The dietician's worklist: patients assigned to them. */
router.get(
  '/patients',
  asyncHandler(async (req, res) => {
    const [profiles, settings] = await Promise.all([
      PatientProfile.find(await scopeFilter(req))
        .populate('user', 'name phone avatarAssetId isActive dateOfBirth')
        .sort({ updatedAt: -1 })
        .lean(),
      getClinicSettings(),
    ]);
    const defaultDays = settings.dietReviewIntervalDays;

    const items = profiles
      .filter((p) => p.user && p.user.isActive !== false)
      .map((p) => ({
        id: String(p.user._id),
        name: p.user.name,
        phone: p.user.phone,
        avatarUrl: p.user.avatarAssetId ? `/api/v1/uploads/${p.user.avatarAssetId}/raw` : null,
        diabetesType: p.diabetesType ?? null,
        riskBand: p.riskBand ?? 'low',
        reviewIntervalDays: p.dietReviewIntervalDays ?? defaultDays,
        lastReviewAt: p.lastDietReviewAt ?? null,
        reviewDue: reviewDue(p, defaultDays),
        // Energy and protein targets are set by age as much as by weight, so
        // the worklist carries it rather than making the dietician open each
        // record to find out who they are planning for.
        dateOfBirth: p.user.dateOfBirth ?? null,
      }));

    res.json({ items });
  }),
);

/** Nutrition view of one patient: medical status + the doctor's medicine list. */
router.get(
  '/patients/:id/overview',
  asyncHandler(async (req, res) => {
    const profile = await requireAssigned(req);
    const user = await User.findById(req.params.id)
      .select('name phone gender dateOfBirth language avatarAssetId')
      .lean();
    if (!user) throw notFound('Patient not found');

    // The full clinical picture, live from the doctor's own record — medicines,
    // advice, vitals, the uploaded reports. A dietician planning around metformin
    // needs to know it was stopped last week; a pending HbA1c is the difference
    // between "your control is fine" and a number nobody has yet.
    const [meds, prescriptions, labResults, allResultNames, latestHba1c, weekLogs, vitals, latestGlucose] =
      await Promise.all([
      Medication.find({ patient: req.params.id, isActive: true })
        .select('name strength dose schedule instructions')
        .lean(),
      Prescription.find({ patient: req.params.id, isActive: true })
        .sort({ issuedOn: -1 })
        .select('labTestsAdvised generalAdvice diagnosis issuedOn followUpOn doctor')
        .populate('doctor', 'name')
        .lean(),
      LabResult.find({ patient: req.params.id })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('photo', 'mimeType originalName sizeBytes')
        .lean(),
      // Every report's name, not just the ten most recent. The list above is
      // capped because it is what gets rendered; using that same capped list to
      // decide which advised tests have come back meant an eleventh upload
      // pushed the oldest one out and its test went back to "awaiting result"
      // even though the patient had sent it.
      LabResult.find({ patient: req.params.id }).select('testName').lean(),
      // Two, not one: a lone figure says where the patient is, and a
      // dietician's question is which way they are going. The previous result
      // is the cheapest possible answer to that and it is already on record.
      Hba1cRecord.find({ patient: req.params.id }).sort({ testedOn: -1 }).limit(2).lean(),
      FoodLog.find({
        patient: req.params.id,
        createdAt: { $gte: dayjs().startOf('day').subtract(6, 'day').toDate() },
      })
        .select('createdAt')
        .lean(),
      VitalRecord.find({ patient: req.params.id }).sort({ recordedAt: -1 }).limit(40).lean(),
      GlucoseReading.findOne({ patient: req.params.id }).sort({ measuredAt: -1 }).lean(),
    ]);

    // Presence per day, not a count of meals: four snacks on one Tuesday is
    // one day of logging, and the figure is meant to say how engaged the
    // patient is rather than how hungry.
    const loggedDays = new Set(
      weekLogs.map((l) => dayjs(l.createdAt).format('YYYY-MM-DD')),
    ).size;

    const advised = [...new Set(prescriptions.flatMap((p) => p.labTestsAdvised ?? []).filter(Boolean))];
    const reported = new Set(allResultNames.map((r) => normaliseTestName(r.testName)));

    // Each measurement shown as its OWN most-recent real reading, with the date
    // it was actually taken — never blended, never invented. A field the patient
    // has never recorded is simply absent: honest emptiness over a fake zero.
    // The newest reading, plus the one before it. The previous value is what
    // lets the panel say which way a measure is moving; without it any arrow on
    // the screen would be decoration pointing in a direction nobody measured.
    const latest = (field) => {
      const i = vitals.findIndex((v) => v[field] != null);
      if (i === -1) return null;
      const prev = vitals.slice(i + 1).find((v) => v[field] != null);
      return { value: vitals[i][field], at: vitals[i].recordedAt, previous: prev ? prev[field] : null };
    };
    const bpIndex = vitals.findIndex((v) => v.systolic != null || v.diastolic != null);
    const bpRec = bpIndex === -1 ? undefined : vitals[bpIndex];
    const bpPrev =
      bpIndex === -1
        ? undefined
        : vitals.slice(bpIndex + 1).find((v) => v.systolic != null || v.diastolic != null);
    const weight = latest('weightKg');
    const heightCm = profile.heightCm ?? null;
    const bmi = weight && heightCm ? Number((weight.value / (heightCm / 100) ** 2).toFixed(1)) : null;

    res.json({
      patient: {
        id: String(user._id),
        name: user.name,
        phone: user.phone,
        avatarUrl: user.avatarAssetId ? `/api/v1/uploads/${user.avatarAssetId}/raw` : null,
        gender: user.gender ?? null,
        dateOfBirth: user.dateOfBirth ?? null,
        language: user.language ?? 'en',
      },
      medical: {
        diabetesType: profile.diabetesType ?? null,
        riskBand: profile.riskBand ?? 'low',
        heightCm,
        diagnosedOn: profile.diagnosedOn ?? null,
        chiefComplaint: profile.chiefComplaint ?? null,
        allergies: profile.allergies ?? [],
        targets: profile.targets ?? {},
      },
      // Latest real vitals/measurements, each dated. Absent = never recorded.
      vitals: {
        bloodPressure: bpRec
          ? {
              systolic: bpRec.systolic ?? null,
              diastolic: bpRec.diastolic ?? null,
              flag: bpRec.flag ?? null,
              at: bpRec.recordedAt,
              previousSystolic: bpPrev?.systolic ?? null,
            }
          : null,
        pulse: latest('pulse'),
        spo2: latest('spo2'),
        weightKg: weight,
        waistCm: latest('waistCm'),
        temperatureC: latest('temperatureC'),
        bmi,
        glucose: latestGlucose
          ? { valueMgDl: latestGlucose.valueMgDl, context: latestGlucose.context ?? null, flag: latestGlucose.flag ?? null, at: latestGlucose.measuredAt }
          : null,
      },
      medications: meds.map((m) => ({
        id: String(m._id),
        name: m.name,
        strength: m.strength ?? '',
        dose: m.dose ?? '',
        instructions: m.instructions ?? '',
        times: (m.schedule ?? []).map((s) => s.time).filter(Boolean),
      })),
      // The doctor's advice + diagnosis over time, newest first — so the dietician
      // plans with the clinical reasoning in view, not just the medicine list.
      advice: prescriptions
        .filter((p) => (p.generalAdvice && p.generalAdvice.trim()) || (p.diagnosis && p.diagnosis.length))
        .map((p) => ({
          id: String(p._id),
          issuedOn: p.issuedOn,
          diagnosis: p.diagnosis ?? [],
          generalAdvice: p.generalAdvice ?? '',
          followUpOn: p.followUpOn ?? null,
          doctorName: p.doctor?.name ?? null,
        })),
      labTests: {
        // Whether a result is back matters more than the list itself: an
        // advised-but-missing test is why a plan may be built on stale numbers.
        advised: advised.map((name) => ({ name, reported: reported.has(normaliseTestName(name)) })),
        // The uploaded reports themselves — summary, out-of-range analytes, the
        // file to open — the SAME flat shape the doctor's panel sends, so the
        // dietician reuses the doctor's LabReport model and "out of range" reads
        // identically in both panels.
        recent: labResults.map((r) => {
          const asset = r.photo && typeof r.photo === 'object' ? r.photo : null;
          const photoId = asset ? asset._id : r.photo;
          return {
            id: String(r._id),
            testName: r.testName,
            note: r.note ?? '',
            photoUrl: photoId ? `/api/v1/uploads/${photoId}/raw` : null,
            mimeType: asset?.mimeType ?? null,
            originalName: asset?.originalName ?? null,
            analysisStatus: r.analysis?.status ?? null,
            analysisSummary: r.analysis?.summary ?? null,
            hba1cPercent: r.analysis?.hba1cPercent ?? null,
            abnormal: r.analysis?.abnormal ?? [],
            analytes: buildAnalytes(r.analysis),
            testedOn: r.analysis?.testedOn ?? null,
            createdAt: r.createdAt,
          };
        }),
        // Days out of the last seven on which the patient logged anything.
        // Presence, not count: somebody who photographs four snacks on Tuesday
        // has not logged four days. This is the one adherence figure the data
        // actually supports — meal-plan adherence and goal progress would need
        // a definition and a target that do not exist yet.
        foodLogDaysThisWeek: loggedDays,
        latestHba1c: latestHba1c[0]
          ? {
              percentage: latestHba1c[0].percentage,
              testedOn: latestHba1c[0].testedOn,
              // Null when there is nothing to compare against. A direction
              // nobody can compute is not shown at all, rather than guessed.
              previous: latestHba1c[1]?.percentage ?? null,
              previousOn: latestHba1c[1]?.testedOn ?? null,
            }
          : null,
      },
      reviewIntervalDays: profile.dietReviewIntervalDays ?? null,
      lastReviewAt: profile.lastDietReviewAt ?? null,
    });
  }),
);

/** The patient's food log for the dietician to review. */
router.get(
  '/patients/:id/food-log',
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const items = await FoodLog.find({ patient: req.params.id })
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('photo', 'mimeType')
      .lean();
    res.json({
      items: items
          .filter((f) => !f.photo || (f.photo.mimeType ?? '').startsWith('image/'))
          .map((f) => ({
            id: String(f._id),
            mealType: f.mealType,
            note: f.note ?? '',
            photoUrl: f.photo ? `/api/v1/uploads/${f.photo._id}/raw` : null,
            createdAt: f.createdAt,
            reviewedAt: f.reviewedAt ?? null,
            mealStatus: f.mealStatus ?? null,
          })),
    });
  }),
);


/** The patient's current diet plan, or null if none has been written yet. */
router.get(
  '/patients/:id/diet',
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const plan = await DietPlan.findOne({ patient: req.params.id })
      .populate('dietician', 'name')
      .lean();
    res.json({ plan: plan ? serialisePlan(plan) : null });
  }),
);

/**
 * Write or rewrite the plan. Upsert rather than versioned history: the patient
 * needs one current answer to "what do I eat", and a dietician correcting a
 * portion size should not create a second document the patient might find.
 */
router.put(
  '/patients/:id/diet',
  validate({
    body: z.object({
      goal: z.string().trim().max(500).optional().default(''),
      meals: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(60),
            time: z.string().trim().max(40).optional().default(''),
            items: z.array(z.string().trim().max(200)).max(20).default([]),
            notes: z.string().trim().max(500).optional().default(''),
          }),
        )
        .max(10)
        .default([]),
      avoid: z.array(z.string().trim().max(120)).max(30).default([]),
      notes: z.string().trim().max(2000).optional().default(''),
    }),
  }),
  audit('update', 'DietPlan'),
  asyncHandler(async (req, res) => {
    await requireAssigned(req);

    // Drop meals the dietician left blank rather than storing empty rows the
    // patient would see as gaps in their day.
    const meals = req.body.meals
      .map((m) => ({ ...m, items: m.items.filter((i) => i.trim().length > 0) }))
      .filter((m) => m.items.length > 0 || m.notes.trim().length > 0);

    const plan = await DietPlan.findOneAndUpdate(
      { patient: req.params.id },
      {
        patient: req.params.id,
        dietician: req.user._id,
        goal: req.body.goal,
        meals,
        avoid: req.body.avoid.filter((a) => a.trim().length > 0),
        notes: req.body.notes,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ plan: serialisePlan({ ...plan.toObject(), dietician: { name: req.user.name } }) });
  }),
);

/**
 * Plans this patient has been on before, newest first.
 *
 * Answers the question a dietician actually asks when a target has not been
 * met: what were we doing, and for how long.
 */
router.get(
  '/patients/:id/diet/history',
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const revisions = await DietPlanRevision.find({ patient: req.params.id })
      .sort({ replacedAt: -1 })
      .limit(20)
      .populate('dietician', 'name')
      .lean();

    res.json({
      revisions: revisions.map((r) => ({
        id: String(r._id),
        ...serialisePlan(r),
        replacedAt: r.replacedAt ?? null,
        startedAt: r.startedAt ?? null,
      })),
    });
  }),
);

/**
 * Start a fresh plan, keeping the outgoing one as history.
 *
 * Not a second live plan: `DietPlan` stays one document per patient, because
 * the patient needs one current answer to "what do I eat" and two live plans
 * would be two answers. The current plan is copied into the history and the
 * working document is cleared, so the dietician writes the new one on a blank
 * page with the old one still readable behind them.
 *
 * A plan that was never sent is not archived — it was a draft, and filing
 * drafts as care given would make the history lie about what the patient was
 * actually told.
 */
router.post(
  '/patients/:id/diet/new',
  audit('create', 'DietPlan'),
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const current = await DietPlan.findOne({ patient: req.params.id }).lean();
    if (!current) throw notFound('There is no plan to replace yet');

    let archived = false;
    if (current.sharedAt) {
      await DietPlanRevision.create({
        patient: current.patient,
        dietician: current.dietician,
        goal: current.goal,
        meals: current.meals,
        avoid: current.avoid,
        notes: current.notes,
        sharedAt: current.sharedAt,
        startedAt: current.createdAt ?? null,
        replacedAt: new Date(),
      });
      archived = true;
    }

    // Cleared rather than deleted: the unique index means one document per
    // patient, and dropping it would lose the row every other read expects.
    await DietPlan.updateOne(
      { _id: current._id },
      {
        $set: { dietician: req.user._id, goal: '', meals: [], avoid: [], notes: '' },
        $unset: { sharedAt: 1 },
      },
    );

    res.status(201).json({ archived });
  }),
);

/**
 * Send the plan into the patient's care thread.
 *
 * Deliberately a separate action from saving. A dietician mid-edit should not
 * be notifying the patient on every keystroke, and a plan only counts as given
 * once the patient has actually been handed it.
 */
router.post(
  '/patients/:id/diet/send',
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const plan = await DietPlan.findOne({ patient: req.params.id }).lean();
    if (!plan) throw notFound('Write a plan before sending it');

    const content = formatPlan(plan, req.user.name);
    const message = await postToCareThread(req.params.id, req.user, content);

    await DietPlan.updateOne({ _id: plan._id }, { sharedAt: new Date() });
    await PatientProfile.updateOne({ user: req.params.id }, { lastDietReviewAt: new Date() });
    notifyPatientOfClinicianReply(req.params.id, req.user, content, {
      threadKind: 'nutrition',
    }).catch(() => {});

    res.status(201).json({ id: String(message._id) });
  }),
);

/** The care conversation with the patient (shared with the assistant/doctor). */
router.get(
  '/patients/:id/thread',
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    // This practice's nutrition conversation with the patient, not the newest
    // one they have anywhere. See services/conversationPractice.js.
    const enrollment = await callerEnrolment(req, req.params.id);
    const session = await ChatSession.findOne({
      ...(await relationshipSessions({ patientId: req.params.id, enrollment, kind: 'nutrition' })),
      isArchived: false,
    }).sort({ lastMessageAt: -1 });
    if (!session) return res.json({ items: [], assistantEnabled: true });

    const messages = await ChatMessage.find({ session: session._id })
      .sort({ seq: 1 })
      .limit(300)
      .populate('sender', 'name avatarAssetId')
      .populate('attachments', 'kind mimeType transcript originalName sizeBytes')
      .populate('replyTo', QUOTE_FIELDS)
      .lean();

    res.json({
      assistantEnabled: session.assistantEnabled !== false,
      items: messages.map((m) => {
        // Deleted for everyone: a tombstone, same as the patient/doctor threads.
        if (m.deletedForEveryoneAt) {
          return {
            id: String(m._id),
            role: m.role,
            content: '',
            attachments: [],
            senderName: m.sender?.name ?? null,
            deletedForEveryone: true,
            pinned: false,
            replyToId: null,
            replyPreview: null,
            createdAt: m.createdAt,
          };
        }
        return {
          id: String(m._id),
          role: m.role,
          content: m.content ?? '',
          deletedForEveryone: false,
          // Pin / reply state, so the dietician's screen can show and act on
          // them the same way the patient and doctor threads do.
          pinned: Boolean(m.pinnedAt),
          replyToId: m.replyTo ? String(m.replyTo._id ?? m.replyTo) : null,
          // None for a quote from another conversation or one taken back. See
          // quotePreview.
          replyPreview: quotePreview(m),
          // The same shape the patient's own thread sends. Bare ids left the
          // dietician's screen unable to tell a food photo from a voice note
          // from a PDF, so it rendered all three as the words "1 attachment" —
          // in the one conversation whose whole point is looking at food.
          attachments: (m.attachments ?? []).map((a) => {
            const id = (a?._id ?? a).toString?.() ?? a;
            return {
              id,
              url: `/api/v1/uploads/${id}/raw`,
              kind: a?.kind ?? null,
              mimeType: a?.mimeType ?? null,
              originalName: a?.originalName ?? null,
              sizeBytes: a?.sizeBytes ?? null,
              transcript: a?.transcript ?? null,
            };
          }),
          senderName: m.sender?.name ?? null,
          senderAvatarUrl: m.sender?.avatarAssetId
            ? `/api/v1/uploads/${m.sender.avatarAssetId}/raw`
            : null,
          createdAt: m.createdAt,
        };
      }),
    });
  }),
);

/** The dietician replies to the patient — lands in the patient's care thread. */
/**
 * Mark one meal read, or put it back.
 *
 * Deliberately separate from replying. A dietician scanning a week of plates
 * needs to be able to say "these three are fine, this one we should talk
 * about" — with review welded to the reply, saying that was impossible: any
 * message cleared the lot.
 *
 * Replying still clears everything outstanding (see the message route). This
 * is the finer instrument, not a replacement.
 */
router.post(
  '/patients/:id/food-log/:logId/review',
  validate(
    z.object({
      reviewed: z.boolean().default(true),
      // Feedback on this specific meal. Posting it and marking the meal read
      // are one act, so they are one request: two calls from the client could
      // leave a meal ticked with the comment never sent, which is the worst of
      // the three possible outcomes — it looks handled and the patient heard
      // nothing.
      note: z.string().trim().max(1000).optional(),
      // The dietician's verdict, optional: ticking a plate without a word
      // about it is still a review, and forcing a category on every meal
      // would make the queue something to clear rather than read.
      status: z.enum(['on_track', 'review', 'concern']).nullish(),
    }),
  ),
  audit('update', 'FoodLog'),
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const log = await FoodLog.findOne({ _id: req.params.logId, patient: req.params.id });
    // Scoped by patient as well as id: a log id alone would let an assigned
    // dietician mark a meal belonging to somebody else's patient.
    if (!log) throw notFound('That meal is not on this record');

    const reviewed = req.body.reviewed !== false;
    const note = (req.body.note ?? '').trim();

    // Send before marking. If posting fails the meal stays in the queue, which
    // is recoverable; marking first and then failing to send loses the meal
    // from the worklist with the patient none the wiser.
    if (reviewed && note.length > 0) {
      const meal = log.mealType && log.mealType !== 'other' ? log.mealType : 'meal';
      const when = dayjs(log.createdAt).format('D MMM, h:mm A');
      // Quoted so the patient knows which plate is being talked about. They
      // may have logged four that day and "try less rice" answers none of them
      // on its own.
      const content = `About your ${meal} on ${when}:

${note}`;
      // The photograph goes with it. A date and a time name the meal only if
      // the patient can still remember it; the picture is the thing they
      // actually recognise, and it is already on the record — attaching it
      // costs nothing and removes the guesswork entirely.
      await postToCareThread(
        req.params.id,
        req.user,
        content,
        log.photo ? [log.photo] : [],
      );
      notifyPatientOfClinicianReply(req.params.id, req.user, note, {
        threadKind: 'nutrition',
      }).catch(() => {});
    }

    log.reviewedAt = reviewed ? new Date() : null;
    log.reviewedBy = reviewed ? req.user._id : null;
    // Un-reviewing clears the verdict too: a tag left behind on a meal that is
    // back in the queue would claim somebody had judged it.
    if (!reviewed) log.mealStatus = null;
    else if (req.body.status !== undefined) log.mealStatus = req.body.status;
    await log.save();

    res.json({
      id: String(log._id),
      reviewedAt: log.reviewedAt,
      needsReview: !log.reviewedAt,
      messageSent: reviewed && note.length > 0,
    });
  }),
);

/** Mark every outstanding meal on this record read, in one go. */
router.post(
  '/patients/:id/food-log/review-all',
  audit('update', 'FoodLog'),
  asyncHandler(async (req, res) => {
    await requireAssigned(req);
    const result = await FoodLog.updateMany(
      { patient: req.params.id, reviewedAt: null },
      { reviewedAt: new Date(), reviewedBy: req.user._id },
    );
    res.json({ reviewed: result.modifiedCount ?? 0 });
  }),
);

router.post(
  '/patients/:id/message',
  validate({
    body: z
      .object({
        content: z.string().trim().max(4000).optional().default(''),
        attachments: z.array(z.string()).max(5).default([]),
        // Threaded reply: the message this one answers.
        replyTo: z.string().optional(),
      })
      .refine((b) => b.content.trim().length > 0 || b.attachments.length > 0, {
        message: 'Add a message or attach a photo',
        path: ['content'],
      }),
  }),
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    await requireAssigned(req);

    // The patient's files or the dietician's own, and a quote from the
    // nutrition thread this lands in. See services/mediaAccess.js and
    // services/quotedMessage.js.
    req.body.attachments = await attachableAssetIds(req.body.attachments, {
      patientId: req.params.id,
      uploaderIds: [req.user._id],
    });
    req.body.replyTo = await quotableMessageId(req.body.replyTo, { patientId: req.params.id, kind: 'nutrition' });

    const message = await postToCareThread(
      req.params.id,
      req.user,
      req.body.content,
      req.body.attachments,
      req.body.replyTo,
    );

    // Two different things, both true when a dietician writes back: the review
    // cycle restarts, and every meal still sitting unread has now been
    // answered. Before, only the first was recorded and the second was
    // inferred from it — which is why replying about one plate silently
    // cleared the rest.
    const now = new Date();
    await PatientProfile.updateOne({ user: req.params.id }, { lastDietReviewAt: now });
    await FoodLog.updateMany(
      { patient: req.params.id, reviewedAt: null },
      { reviewedAt: now, reviewedBy: req.user._id },
    );
    notifyPatientOfClinicianReply(req.params.id, req.user, req.body.content, {
      threadKind: 'nutrition',
    }).catch(() => {});

    res.status(201).json({ id: String(message._id) });
  }),
);

/**
 * Append a dietician message to the patient's care thread, creating the session
 * if this is the first thing anyone has said. Shared by the reply box and by
 * "send plan" so both land in the same thread with the same role and sequence.
 */
async function postToCareThread(patientId, sender, content, attachments = [], replyTo) {
  // The writer's own practice's conversation with the patient. This took the
  // newest nutrition session, which was whichever practice wrote last — so one
  // practice's dietician wrote into the conversation another practice's
  // dietician was holding. See services/conversationPractice.js.
  const enrollment = await enrolmentAt(await practiceOfMember(sender._id), patientId);
  const patient = await User.findById(patientId).select('language').lean();
  const session = await sessionForEnrolment({
    patientId,
    enrollment,
    kind: 'nutrition',
    language: patient?.language ?? 'en',
    title: 'Nutrition',
  });

  const last = await ChatMessage.findOne({ session: session._id }).sort({ seq: -1 }).select('seq').lean();
  const message = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq: (last?.seq ?? -1) + 1,
    role: 'dietician',
    sender: sender._id,
    content,
    language: session.language,
    attachments,
    replyTo: replyTo || undefined,
  });

  await ChatSession.findByIdAndUpdate(session._id, {
    lastMessageAt: message.createdAt,
    $inc: { messageCount: 1 },
  });

  return message;
}

function serialisePlan(plan) {
  return {
    goal: plan.goal ?? '',
    meals: (plan.meals ?? []).map((m) => ({
      name: m.name,
      time: m.time ?? '',
      items: m.items ?? [],
      notes: m.notes ?? '',
    })),
    avoid: plan.avoid ?? [],
    notes: plan.notes ?? '',
    dieticianName: plan.dietician?.name ?? null,
    sharedAt: plan.sharedAt ?? null,
    updatedAt: plan.updatedAt ?? null,
  };
}

/**
 * Render the plan as the patient will read it in their thread.
 *
 * Plain text with headings rather than a card the app has to know how to draw:
 * it survives translation, it is copyable, and it still makes sense if the
 * patient screenshots it for someone at home who does the cooking.
 */
function formatPlan(plan, dieticianName) {
  const lines = [`Your diet plan — from ${dieticianName}`];
  if (plan.goal) lines.push('', `Goal: ${plan.goal}`);

  for (const meal of plan.meals ?? []) {
    lines.push('', meal.time ? `${meal.name} (${meal.time})` : meal.name);
    for (const item of meal.items ?? []) lines.push(`• ${item}`);
    if (meal.notes) lines.push(meal.notes);
  }

  if (plan.avoid?.length) {
    lines.push('', 'Best avoided:');
    for (const item of plan.avoid) lines.push(`• ${item}`);
  }
  if (plan.notes) lines.push('', plan.notes);

  lines.push('', 'Ask me here if anything does not suit you — we can change it.');
  return lines.join('\n');
}

export default router;
