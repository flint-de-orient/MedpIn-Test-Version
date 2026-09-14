import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { PERMISSIONS } from '../models/Membership.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, conflict, badRequest, forbidden } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { User, ROLES } from '../models/User.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { ClinicalAlert, ALERT_SEVERITY } from '../models/ClinicalAlert.js';
import { Appointment } from '../models/Appointment.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { Medication } from '../models/Medication.js';
import { ChatSession } from '../models/ChatSession.js';
import { ChatMessage } from '../models/ChatMessage.js';
import {
  notifyPatientOfClinicianReply,
  notifyDieticianOfAssignment,
} from '../services/notifications.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { KnowledgeChunk } from '../models/KnowledgeChunk.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { FootAssessment } from '../models/FootAssessment.js';
import { LabResult } from '../models/LabResult.js';
import { buildAnalytes } from '../services/analyteCatalog.js';
import { FoodLog } from '../models/FoodLog.js';
import { Prescription } from '../models/Prescription.js';
import { toE164 } from '../utils/phone.js';
import { ClinicSettings, getClinicSettings } from '../models/ClinicSettings.js';
import { acknowledgeAlert, resolveAlert } from '../services/alerts.js';
import {
  computeAdherence,
  glucoseTrends,
  computeHealthScore,
  monitoringSignals,
  clinicAnalytics,
  isCheckInOverdue,
} from '../services/analytics.js';
import { buildPatientContext } from '../services/patientContext.js';
import { embed } from '../services/ai/gemini.js';
import { paged, pageParams } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { phoneFromToken } from '../services/otp.js';
import { resolveDoctor } from '../services/doctorContext.js';
import { enrolByPhone } from '../services/enrolByPhone.js';
import {
  practiceOf,
  assertSamePractice,
  practicePatients,
  practicePatientIds,
  departmentThreads,
  practiceMembers,
} from '../middleware/practiceScope.js';
import { enrollmentGate, recordWindow } from '../middleware/authorise.js';
import { practiceSessions, practiceMessages, sessionBelongsTo } from '../services/conversationPractice.js';
import { requireCapability } from '../middleware/requireCapability.js';
import { CAPABILITIES } from '../services/capabilities.js';
import { LabReport } from '../models/LabReport.js';
import { attachableAssetIds } from '../services/mediaAccess.js';
import { quotableMessageId, quotePreview, QUOTE_FIELDS } from '../services/quotedMessage.js';

const router = Router();
router.use(requireAuth, requireClinician);

// Clinic-wide analytics are recomputed at most this often. The dashboard polls
// every ~20s, but this aggregation over every reading changes slowly, so it is
// served from a short in-process cache rather than run on each hit — the one
// thing that would melt at 100k+ readings.
const ANALYTICS_TTL_MS = 120000;
let analyticsCache = { key: null, at: 0, data: null };

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

/**
 * Everything waiting, newest first — and it is not the same list for everyone.
 *
 * The bell used to count clinical alerts alone, while the overview endpoint was
 * already computing three other things a doctor is waiting on — unread care
 * messages, unread nutrition messages, and conversations flagged for review.
 * Those showed as cards on Home, so standing on any other tab the bell read
 * zero while patients waited for a reply. A bell that means "alerts only" but
 * looks like "everything" is a bell that gets misread.
 *
 * The front desk then inherited that same list wholesale, which was wrong in
 * both directions.
 *
 * Wrong to give them the clinical-review queue: a conversation flagged for
 * review is a quality check on the assistant's answers, it keeps for days, and
 * its only destination is a screen that does not exist in the desk's half of
 * the app. Each row was a tap onto a blank page and a number on a badge the
 * desk could never clear, which is how a bell teaches people to stop looking.
 *
 * Wrong to have then taken emergencies away with them. When a patient writes
 * "I have chest pain", the push already goes to the desk as well as the doctor
 * — deliberately, and it is the right call: the receptionist is the person
 * physically present, and what happens next is someone fetching the doctor,
 * ringing the patient back or calling an ambulance. A bell that stayed silent
 * about the one thing on it that cannot wait would be worse than the noisy one.
 *
 * So severity decides, not role alone. The desk gets what somebody has to act
 * on now — urgent and emergency alerts, unread messages, and appointment
 * requests waiting for a time. It does not get the routine clinical backlog.
 * (Requests are most of what a front desk does all day and were in no
 * notification list at all.)
 *
 * Ordered by what should be answered first. For the doctor: alerts, then the
 * messages behind them, then flagged reviews, which keep. For the desk:
 * requests, because somebody is waiting on an answer, then messages.
 */
router.get(
  '/notifications',
  asyncHandler(async (req, res) => {
    const face = (u) => ({
      patientId: u ? String(u._id) : '',
      patientName: u?.name ?? 'Unknown patient',
      avatarUrl: u?.avatarAssetId ? `/api/v1/uploads/${u.avatarAssetId}/raw` : null,
    });

    // Clinical work, and whether this caller does any.
    const isDesk = req.user.role === ROLES.STAFF;

    // Every collection below reaches a patient through a field called
    // `patient`, so one list serves all five. Empty when the caller has no
    // practice yet, which leaves each query exactly as it was.
    const scope = await practicePatients(req, 'patient');

    const [alerts, sessions, flagged, requests] = await Promise.all([
      ClinicalAlert.find({ ...(isDesk ? DESK_ALERTS : { status: 'open' }), ...scope })
        .sort({ createdAt: -1 })
        .limit(30)
        .populate('patient', 'name avatarAssetId')
        .lean(),
      // This practice's conversations, not every conversation its patients
      // have. See services/conversationPractice.js.
      ChatSession.find({ isArchived: false, ...(await practiceSessions(req)) }).select('_id kind patient').lean(),
      isDesk
        ? []
        : ChatSession.find({
            flaggedForReview: true,
            isArchived: false,
            // `$and`, not two spreads: both of these can be an `$or`, and the
            // second would silently replace the first.
            $and: [
              await practiceSessions(req),
              // The same narrowing as the list it counts, or the badge says
              // eleven and the screen shows four.
              await departmentThreads(req),
            ],
          })
            .sort({ lastMessageAt: -1 })
            .limit(20)
            .populate('patient', 'name avatarAssetId')
            .lean(),
      // Never filtered by date. A request from last Tuesday that nobody
      // answered is more urgent than one from this morning, not less.
      isDesk
        ? Appointment.find({ status: 'requested', ...scope })
            .sort({ createdAt: -1 })
            .limit(30)
            .populate('patient', 'name avatarAssetId')
            .lean()
        : [],
    ]);

    const kindBySession = new Map(sessions.map((x) => [String(x._id), x.kind ?? 'care']));

    const unread = await ChatMessage.find({
      role: 'user',
      seenByClinicAt: null,
      ...scope,
      // In this practice's conversations. A patient another practice also cares
      // for writes there too, and the bell previewed those words here.
      ...(await practiceMessages(req)),
    })
      .sort({ createdAt: -1 })
      .limit(40)
      .populate('patient', 'name avatarAssetId')
      .select('patient content createdAt session')
      .lean();

    const items = [
      ...alerts.map((a) => ({
        id: String(a._id),
        // Severity rides in the kind so the row can colour itself without a
        // second field the client has to interpret.
        kind: a.severity === 'emergency' || a.severity === 'urgent' ? 'urgent' : 'alert',
        ...face(a.patient),
        text: a.title ?? 'Clinical alert',
        at: a.createdAt,
        unread: true,
      })),
      ...unread.map((m) => {
        const text = (m.content ?? '').trim();
        return {
          id: String(m._id),
          kind: kindBySession.get(String(m.session)) === 'nutrition' ? 'nutrition' : 'message',
          ...face(m.patient),
          text: text.length > 0 ? text.slice(0, 200) : 'Sent an attachment',
          at: m.createdAt,
          unread: true,
        };
      }),
      ...flagged.map((f) => ({
        id: `review-${String(f._id)}`,
        kind: 'review',
        ...face(f.patient),
        text: 'Conversation flagged for review',
        at: f.lastMessageAt ?? null,
        unread: false,
      })),
      ...requests.map((a) => ({
        id: `request-${String(a._id)}`,
        kind: 'request',
        ...face(a.patient),
        // The day they asked for, and no time — a request carries a preferred
        // date only. Printing a time for it would tell the desk the patient
        // chose an hour they never chose.
        text: a.preferredFor
          ? `Asked for ${new Date(a.preferredFor).toLocaleDateString('en-IN', {
              day: 'numeric',
              month: 'short',
              timeZone: 'Asia/Kolkata',
            })}`
          : 'Asked for an appointment',
        at: a.createdAt,
        unread: true,
      })),
    ];

    // Requests first for the desk: alerts are the doctor's ordering, and with
    // none in this list the messages would otherwise sit above the one thing
    // somebody is actively waiting on.
    if (isDesk) {
      const rank = (i) => (i.kind === 'request' ? 0 : 1);
      items.sort((x, y) => rank(x) - rank(y));
    }

    // Counted, not measured off the rendered list.
    //
    // `unread` was items.filter(...).length, which is the length of arrays this
    // route deliberately caps at 30 alerts and 40 messages — so past those
    // limits the sheet under-reported. It also excluded flagged reviews, which
    // the header badge includes, so the two numbers disagreed with each other
    // on the same screen.
    //
    // These are the same three quantities the badge sums, queried directly, so
    // the bell and the sheet it opens can never say different things.
    const [alertTotal, unreadTotal, flaggedTotal, requestTotal] = await Promise.all([
      ClinicalAlert.countDocuments({ ...(isDesk ? DESK_ALERTS : { status: 'open' }), ...scope }),
      ChatMessage.countDocuments({ role: 'user', seenByClinicAt: null, ...scope, ...(await practiceMessages(req)) }),
      isDesk
        ? 0
        : ChatSession.countDocuments({
            flaggedForReview: true,
            isArchived: false,
            // The same filter as the flagged list above, department included,
            // or the badge counts threads the sheet does not show.
            $and: [await practiceSessions(req), await departmentThreads(req)],
          }),
      isDesk ? Appointment.countDocuments({ status: 'requested', ...scope }) : 0,
    ]);

    res.json({
      unread: alertTotal + unreadTotal + flaggedTotal + requestTotal,
      // What the list itself holds, so the client can say "showing 60 of 84"
      // rather than silently truncating.
      shown: Math.min(items.length, 60),
      counts: {
        alerts: alertTotal,
        messages: unreadTotal,
        flagged: flaggedTotal,
        requests: requestTotal,
      },
      items: items.slice(0, 60),
    });
  }),
);

/**
 * Marks patient messages across every thread as seen.
 *
 * Called when the doctor opens the list, never when something arrives: a badge
 * that clears on delivery is a badge that clears for nobody. Alerts are not
 * touched — those close when the doctor acts on them, which is a clinical
 * decision, not a side effect of glancing at a list.
 */
router.post(
  '/notifications/seen',
  asyncHandler(async (req, res) => {
    // This practice's patients only. Unscoped, closing one practice's bell
    // cleared every practice's badge, and stamped their patients' messages as
    // seen by a clinic that never read them.
    const result = await ChatMessage.updateMany(
      { role: 'user', seenByClinicAt: null, ...(await practicePatients(req, 'patient')) },
      { $set: { seenByClinicAt: new Date() } },
    );
    res.json({ cleared: result.modifiedCount ?? 0 });
  }),
);

router.get(
  '/overview',
  asyncHandler(async (req, res) => {
    const dayStart = dayjs().startOf('day').toDate();
    const dayEnd = dayjs().endOf('day').toDate();

    /**
     * The same patients, under the three field names this screen needs.
     *
     * `_id` on an account, `user` on a profile, `patient` on everything
     * clinical. All three come from one `distinct` cached on the request, and
     * all three are `{}` when the caller has no practice — which leaves every
     * headline reading exactly what it read before.
     */
    const userScope = await practicePatients(req, '_id');
    const profileScope = await practicePatients(req, 'user');
    const scope = await practicePatients(req, 'patient');

    const [
      patientCount,
      activeToday,
      alertCounts,
      appointmentsToday,
      completedToday,
      pendingReviews,
      unreadMessages,
      unreadNutrition,
      urgentUnread,
      riskGroups,
    ] = await Promise.all([
      User.countDocuments({ role: ROLES.PATIENT, isActive: true, ...userScope }),
      GlucoseReading.distinct('patient', { measuredAt: { $gte: dayStart }, ...scope }).then(
        (ids) => ids.length,
      ),
      ClinicalAlert.aggregate([
        { $match: { status: 'open', ...scope } },
        { $group: { _id: '$severity', count: { $sum: 1 } } },
      ]),
      Appointment.countDocuments({
        scheduledFor: { $gte: dayStart, $lte: dayEnd },
        status: { $nin: ['cancelled'] },
        ...scope,
      }),
      // Today's finished consultations — the "Completed" headline.
      Appointment.countDocuments({
        scheduledFor: { $gte: dayStart, $lte: dayEnd },
        status: 'completed',
        ...scope,
      }),
      // Conversations flagged for the doctor to read — the "Pending" headline.
      ChatSession.countDocuments({ flaggedForReview: true, isArchived: false, ...(await practiceSessions(req)) }),
      // Patient messages no one at the clinic has opened yet — "New messages".
      ChatMessage.countDocuments({ role: 'user', seenByClinicAt: null, ...scope, ...(await practiceMessages(req)) }),
      // How many of those are in a nutrition thread. The doctor's Patients tab
      // shows only the care conversation; nutrition lives behind Chat review's
      // Nutrition filter. Without the split, the headline counted messages the
      // doctor then could not find anywhere on the screen it was shown.
      unreadNutritionCount(await practiceSessions(req)),
      // How many unread messages the patient themselves marked urgent.
      //
      // The dashboard used to put the open *alert* count under "Unread
      // messages" as "2 urgent", which is a different fact about different
      // records — a clinic with two raised alerts and no urgent messages read
      // as two people waiting. This counts the messages.
      ChatMessage.countDocuments({
        role: 'user',
        seenByClinicAt: null,
        urgency: { $in: ['urgent', 'emergency'] },
        ...scope,
        ...(await practiceMessages(req)),
      }),
      // Only profiles belonging to an ACTIVE patient. A deactivated or removed
      // patient can leave a lingering profile behind, and counting those inflated
      // the risk donut past the real headcount (the "9 vs 7" on the dashboard).
      PatientProfile.aggregate([
        // An empty `$match` matches everything, so this reads as no filter at
        // all when the practice is unknown.
        { $match: profileScope },
        { $lookup: { from: 'users', localField: 'user', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $match: { 'u.isActive': true, 'u.role': ROLES.PATIENT } },
        { $group: { _id: '$riskBand', count: { $sum: 1 } } },
      ]),
    ]);

    const bySeverity = Object.fromEntries(alertCounts.map((a) => [a._id, a.count]));
    const byRisk = Object.fromEntries(riskGroups.map((r) => [r._id ?? 'low', r.count]));

    const [dietPatients, foodLogsToday, newPatientsToday, reviews, dieticianCount, unassignedCount] = await Promise.all([
      PatientProfile.countDocuments({ assignedDietician: { $ne: null }, ...profileScope }),
      FoodLog.countDocuments({ createdAt: { $gte: dayStart }, ...scope }),
      User.countDocuments({ role: ROLES.PATIENT, createdAt: { $gte: dayStart }, ...userScope }),
      nutritionReviews(profileScope, 4, await practiceSessions(req)),
      // Only worth asking about once there is a choice to make.
      //
      // With one dietician the fallbacks answer it: an unassigned patient is
      // covered by whoever is not carrying their own list, and nobody has to
      // decide anything. With two, "who is looking after this patient" stops
      // being obvious and starts being whoever replied first — a clinical
      // allocation arrived at by accident, and one the patient cannot be told
      // in advance because nobody has made it.
      // Scoped for the same reason the list is: a count of other people's
      // staff is a smaller leak than their names and still not this
      // practice's number.
      User.countDocuments({
        role: ROLES.DIETICIAN,
        isActive: true,
        ...(await practiceMembers(req, ROLES.DIETICIAN)),
      }),
      PatientProfile.countDocuments({
        $or: [{ assignedDietician: null }, { assignedDietician: { $exists: false } }],
        ...profileScope,
      }),
    ]);

    res.json({
      patientCount,
      newPatientsToday,
      activeToday,
      openAlerts: {
        emergency: bySeverity.emergency ?? 0,
        urgent: bySeverity.urgent ?? 0,
        warning: bySeverity.warning ?? 0,
        total: alertCounts.reduce((s, a) => s + a.count, 0),
      },
      appointmentsToday,
      completedToday,
      pendingReviews,
      unreadMessages,
      unreadNutrition,
      urgentUnread,
      riskDistribution: {
        low: byRisk.low ?? 0,
        moderate: byRisk.moderate ?? 0,
        high: byRisk.high ?? 0,
        critical: byRisk.critical ?? 0,
      },
      nutrition: {
        dietPatients,
        // The prompt, not the decision. Shown to the doctor only when there is
        // more than one dietician and somebody is unassigned; assigning is
        // his, and nothing here picks for him.
        needsDieticianAssignment: dieticianCount > 1 ? unassignedCount : 0,
        foodLogsToday,
        reviews,
      },
    });
  }),
);

/**
 * Clinic-wide analytics for the dashboard's population charts: the daily
 * low/in-range/high control trend, check-in engagement, and the roster
 * monitoring counts. Served from a short in-process cache so the dashboard's
 * frequent polling never runs the full aggregation more than once per TTL.
 */
router.get(
  '/analytics',
  /*
   * The figures a practice pays for.
   *
   * `/overview` stays open: counts of today's queue are how a clinic runs, and
   * withholding them would sell a plan that cannot see its own day. This is the
   * cohort and trend analysis on top of that, which is the thing Professional
   * adds over Essential.
   */
  requireCapability(CAPABILITIES.ADVANCED_ANALYTICS),
  asyncHandler(async (req, res) => {
    const days = Math.min(180, Math.max(7, Number(req.query.days) || 30));

    // The cache is process-wide, so the practice has to be part of the key.
    // Without it the first clinic to ask for 30 days answers for every clinic
    // that asks next — a leak with a time limit, which is the hardest kind to
    // reproduce and the easiest to dismiss.
    const scope = await practicePatients(req, 'patient');
    const userScope = await practicePatients(req, '_id');
    const key = `d${days}:p${(await practiceOf(req)) ?? 'none'}`;
    const now = Date.now();
    if (analyticsCache.key === key && now - analyticsCache.at < ANALYTICS_TTL_MS && analyticsCache.data) {
      return res.json({ ...analyticsCache.data, cached: true });
    }
    const data = await clinicAnalytics({ days, scope, userScope });
    analyticsCache = { key, at: now, data };
    res.json({ ...data, cached: false });
  }),
);

/**
 * What came back from the lab, across the practice.
 *
 * ---- Why this route exists ----------------------------------------------
 *
 * Lab reports were readable one patient at a time and nowhere else, which is
 * fine for a diabetes clinic where the doctor opens a record and looks. It is
 * not a screen a laboratory or a pathology department can work from: the
 * question there is "what came back abnormal", and answering it meant opening
 * every patient in turn.
 *
 * ---- And what it deliberately is not ------------------------------------
 *
 * Not a sample queue. There is no sample model in this platform, no ordering
 * workflow and no bench states, so "12 pending, 4 processing" would be four
 * numbers with nothing behind them — see the note at the top of uiConfig.js on
 * why a widget with no data is worse than an absent one.
 *
 * `reviewedBy` is on the model and nothing writes it, so "awaiting review" is
 * not offered either: every report would count as pending forever, which is a
 * staleness indicator that cannot detect staleness.
 *
 * What is here is what LabReport actually holds — the flags on its values, and
 * when the sample was taken.
 */
router.get(
  '/labs/overview',
  /*
   * Reading a result out, which the plan table separates from ordering one: a
   * diagnostic centre reports labs and does not prescribe, and that is a fact
   * about the organisation rather than about the money.
   */
  requireCapability(CAPABILITIES.LAB_RESULT),
  audit('read', 'LabReport'),
  asyncHandler(async (req, res) => {
    const scope = await practicePatients(req, 'patient');
    const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
    const since = dayjs().subtract(days, 'day').toDate();

    const [recent, flagged] = await Promise.all([
      LabReport.find(scope)
        .sort({ testedOn: -1 })
        .limit(20)
        .populate('patient', 'name')
        .select('title labName testedOn values patient')
        .lean(),
      /*
       * Counted over a window rather than over everything.
       *
       * A total since the practice opened only ever grows and says nothing
       * about now — the same failure as a chart axis that cannot reach zero.
       * The window is what makes it readable as "this is what the bench is
       * seeing", and it is sent back so the screen can say which window.
       */
      LabReport.aggregate([
        { $match: { ...scope, testedOn: { $gte: since } } },
        { $unwind: '$values' },
        { $group: { _id: '$values.flag', count: { $sum: 1 } } },
      ]),
    ]);

    /** A report's worst flag, which is what makes it worth surfacing. */
    const worst = (report) => {
      const flags = (report.values ?? []).map((v) => v.flag);
      if (flags.includes('critical')) return 'critical';
      if (flags.includes('high') || flags.includes('low')) return 'abnormal';
      return 'normal';
    };

    const shaped = recent.map((r) => ({
      id: String(r._id),
      title: r.title,
      labName: r.labName ?? null,
      testedOn: r.testedOn,
      patient: r.patient ? { id: String(r.patient._id), name: r.patient.name } : null,
      worstFlag: worst(r),
      /// Only the values that say something. A panel of forty normal results
      /// is a list nobody reads, with the abnormal one in the middle of it.
      abnormal: (r.values ?? [])
        .filter((v) => v.flag && v.flag !== 'normal')
        .map((v) => ({
          label: v.label ?? v.code ?? null,
          value: v.value ?? null,
          textValue: v.textValue ?? null,
          unit: v.unit ?? null,
          flag: v.flag,
        })),
    }));

    const by = Object.fromEntries(flagged.map((f) => [f._id ?? 'unflagged', f.count]));

    res.json({
      days,
      critical: shaped.filter((r) => r.worstFlag === 'critical'),
      recent: shaped,
      flags: {
        critical: by.critical ?? 0,
        high: by.high ?? 0,
        low: by.low ?? 0,
        normal: by.normal ?? 0,
        /// Values a report carried with no flag on them at all. Counted
        /// separately rather than folded into `normal`: an unflagged value has
        /// not been judged, and calling it normal is the app deciding it was.
        unflagged: by.unflagged ?? 0,
      },
    });
  }),
);

/**
 * Unread patient messages sitting in a nutrition thread.
 *
 * Split out because the two live in different places in the doctor's app: the
 * care conversation is on the Patients tab, the nutrition one only behind Chat
 * review's Nutrition filter. A single "12 unread" sent the doctor to a screen
 * where some of those twelve were not, with nothing to say where they were.
 */
async function unreadNutritionCount(scope = {}) {
  // Scoping the sessions is enough: the message count below is confined to the
  // ids this returns, so it inherits the restriction.
  const sessions = await ChatSession.find({ kind: 'nutrition', ...scope }).select('_id').lean();
  if (sessions.length === 0) return 0;
  return ChatMessage.countDocuments({
    role: 'user',
    seenByClinicAt: null,
    session: { $in: sessions.map((s) => s._id) },
  });
}

/**
 * The nutrition cards on the doctor's home: patients on a review cadence, worst
 * first, with where they are in the cycle and what their logging actually looks
 * like.
 *
 * The flag is derived from real food-log activity rather than from nutrient
 * analysis — the app records meals, not sodium, and a card that claimed
 * otherwise would be inventing a number the doctor might act on.
 */
async function nutritionReviews(profileScope = {}, limit = 4, sessionScope = {}) {
  // Every patient, on the clinic-wide cadence.
  //
  // This used to require `assignedDietician` and a per-patient
  // `dietReviewIntervalDays`. Both moved: one dietician covers everyone, and
  // the cadence became a clinic setting. Nothing sets those two fields any
  // more, so the query matched no one and the whole Nutrition Reviews section
  // silently disappeared from the doctor's home.
  const { dietReviewIntervalDays: intervalDays } = await getClinicSettings();

  const profiles = await PatientProfile.find(profileScope)
    // The face too: the card names a patient, and a coloured initial where a
    // photograph exists is a worse card for no reason.
    .populate('user', 'name isActive avatarAssetId')
    .lean();

  const weekAgo = dayjs().subtract(7, 'day').toDate();
  const cards = await Promise.all(
    profiles
      .filter((p) => p.user && p.user.isActive !== false)
      .map(async (p) => {
        const since = p.lastDietReviewAt ?? p.createdAt;
        const day = Math.min(dayjs().diff(dayjs(since), 'day'), intervalDays);
        const [mealsThisWeek, lastLog, session] = await Promise.all([
          FoodLog.countDocuments({ patient: p.user._id, createdAt: { $gte: weekAgo } }),
          // The photograph as well as the time. A food-log review is a
          // judgement about a meal, and the meal is the one thing the card
          // could not show.
          FoodLog.findOne({ patient: p.user._id })
            .sort({ createdAt: -1 })
            .select('createdAt photo')
            .lean(),
          // The thread the review is actually done in, so the card can open the
          // conversation rather than the record. Reviewing a food log means
          // reading what they logged and replying to it.
          // This practice's nutrition conversation, so the card opens one the
          // doctor can read. See services/conversationPractice.js.
          ChatSession.find({ patient: p.user._id, kind: 'nutrition', isArchived: false, ...sessionScope })
            .sort({ lastMessageAt: -1 })
            .select('_id')
            .lean()
            .then((rows) => rows[0] ?? null),
        ]);
        return {
          patientId: String(p.user._id),
          nutritionSessionId: session ? String(session._id) : null,
          name: p.user.name,
          avatarUrl: p.user.avatarAssetId ? `/api/v1/uploads/${p.user.avatarAssetId}/raw` : null,
          day,
          intervalDays,
          mealsThisWeek,
          lastLogAt: lastLog?.createdAt ?? null,
          lastLogPhotoUrl: lastLog?.photo ? `/api/v1/uploads/${lastLog.photo}/raw` : null,
        };
      }),
  );

  // Closest to (or past) their review date first: those are the ones the doctor
  // can still do something about today.
  cards.sort((a, b) => b.day / b.intervalDays - a.day / a.intervalDays);
  return cards.slice(0, limit);
}

/**
 * The doctor's Patients tab: three counts, the queue of what is outstanding, and
 * the newest meals logged across the clinic.
 *
 * One endpoint rather than three so the counts and the queue below them are
 * always describing the same moment.
 */
router.get(
  '/worklist',
  asyncHandler(async (req, res) => {
    const scope = await practicePatients(req, 'patient');
    const userScope = await practicePatients(req, '_id');

    const [patients, flaggedSessions, prescribedIds, recentMeals] = await Promise.all([
      User.find({ role: ROLES.PATIENT, isActive: true, ...userScope }).select('name createdAt').lean(),
      // Narrowed to this clinician's department where they have one, keeping
      // the threads that name none — a patient writes to a department and
      // anybody in it may answer, but most threads carry null and belong to
      // everybody.
      ChatSession.find({
        flaggedForReview: true,
        isArchived: false,
        // `$and`: both can be an `$or`, and a spread keeps only the second.
        $and: [await practiceSessions(req), await departmentThreads(req)],
      })
        .sort({ lastMessageAt: -1 })
        .limit(20)
        .populate('patient', 'name')
        .lean(),
      Prescription.distinct('patient', scope),
      FoodLog.find(scope)
        .sort({ createdAt: -1 })
        .limit(8)
        .populate('patient', 'name')
        .populate('photo', 'mimeType')
        .lean(),
    ]);

    const hasPlan = new Set(prescribedIds.map(String));
    // A patient with no prescription is the doctor's outstanding work; the
    // longest-waiting first, because that is the one going cold.
    const needsPlan = patients
      .filter((p) => !hasPlan.has(String(p._id)))
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    const queue = [
      ...flaggedSessions
        .filter((s) => s.patient)
        .map((s) => ({
          kind: 'review',
          patientId: String(s.patient._id),
          name: s.patient.name,
          days: dayjs().diff(dayjs(s.lastMessageAt ?? s.createdAt), 'day'),
        })),
      ...needsPlan.map((p) => ({
        kind: 'plan',
        patientId: String(p._id),
        name: p.name,
        days: dayjs().diff(dayjs(p.createdAt), 'day'),
      })),
    ];

    res.json({
      counts: {
        patients: patients.length,
        reviews: flaggedSessions.length,
        plans: needsPlan.length,
      },
      // Capped so the tab stays a worklist and not an archive; `counts` above
      // still reports the true totals, so a trimmed list never reads as "done".
      queue: queue.slice(0, 12),
      recentMeals: recentMeals
        // Skip bogus logs whose "photo" is not an image (a mis-filed voice note).
        .filter((f) => f.patient && (!f.photo || (f.photo.mimeType ?? '').startsWith('image/')))
        .map((f) => ({
          id: String(f._id),
          patientId: String(f.patient._id),
          patientName: f.patient.name,
          mealType: f.mealType,
          photoUrl: f.photo ? `/api/v1/uploads/${f.photo._id}/raw` : null,
          createdAt: f.createdAt,
        })),

    });
  }),
);

/**
 * Register a walk-in patient from the clinic side (the receptionist intake).
 *
 * Mirrors the dietician-creation route: some patients are enrolled at the desk
 * on a clinic phone rather than downloading the app first, and without this the
 * doctor has no way to start a record for them. Beyond name/phone the desk can
 * capture demographics (age/gender/address) and an optional vitals snapshot
 * (height/weight/BP/HR/SpO2/sugar) plus the presenting complaint, all in one
 * call, so the doctor opens a record that is already populated.
 */
router.post(
  '/patients',
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      // Normalised to E.164 first: a number stored as bare digits is an
      // account whose owner can never sign in, because login sends +91.
      phone: z
        .string()
        .trim()
        .transform(toE164)
        .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number')),
      // Proof from `/auth/otp/verify` that a code texted to this number came
      // back, when the desk took it. Optional on purpose: a patient whose
      // phone is flat or out of signal still has to be registerable, and the
      // clinical record is worth having even when the app login is not yet
      // usable. The number is checked against the token below rather than
      // trusted alongside it.
      phoneToken: z.string().min(20).optional(),
      // Age is what the desk usually knows; converted to an approximate DOB so
      // the rest of the app (which derives age from DOB) stays consistent. An
      // explicit dateOfBirth wins when provided.
      age: z.coerce.number().int().min(0).max(120).optional(),
      dateOfBirth: z.coerce.date().optional(),
      gender: z.enum(['male', 'female', 'other', 'undisclosed']).optional(),
      address: z.string().trim().max(300).optional(),
      complaints: z.string().trim().max(1000).optional(),
      // Optional intake vitals — all optional; a VitalRecord/GlucoseReading is
      // only written when at least one relevant value is present.
      heightCm: z.coerce.number().min(50).max(250).optional(),
      weightKg: z.coerce.number().min(10).max(400).optional(),
      systolic: z.coerce.number().min(50).max(300).optional(),
      diastolic: z.coerce.number().min(30).max(200).optional(),
      pulse: z.coerce.number().min(25).max(250).optional(),
      spo2: z.coerce.number().min(50).max(100).optional(),
      glucoseMgDl: z.coerce.number().min(10).max(900).optional(),
    }),
  }),
  audit('create', 'User'),
  asyncHandler(async (req, res) => {
    const b = req.body;

    // A number the desk has seen before is a link, not a collision. Priya at
    // Dr. Dey's counter and Amit at Dr. Sen's, both typing Rahul's number, are
    // two practices each needing a relationship with one person — and the old
    // `conflict` here turned the second of them into a dead end.
    //
    // Handled by `enrolByPhone`, which finds or creates the login, finds or
    // creates the body, and adds an enrolment. A first practice starts
    // immediately; a second needs the patient's own handset to answer a code,
    // because that one is reaching for a record it did not create.
    // A token vouches for one number. Taking the token and the phone as two
    // independent fields would let a desk verify one number and register
    // another, so the two have to agree before the token means anything.
    let phoneVerifiedAt = null;
    if (b.phoneToken) {
      if (phoneFromToken(b.phoneToken) !== b.phone) {
        throw badRequest('That verification was for a different number. Verify this one again.');
      }
      phoneVerifiedAt = new Date();
    }

    const dob = b.dateOfBirth ?? (b.age != null ? dayjs().subtract(b.age, 'year').toDate() : undefined);
    const practiceId = await practiceOf(req);

    /*
     * Every registration is an enrolment at the practice making it.
     *
     * A known number went through `enrolByPhone`; a new one did not. It made
     * the account and the profile and no enrolment, and every list here is the
     * practice's enrolled patients — so the patient the desk had just added
     * appeared nowhere, and the practice's patient limit never counted them.
     * Both now go through the one service, which finds or makes the login, adds
     * the enrolment, and checks the limit and the subscription before anything
     * is written.
     */
    if (practiceId) {
      const doctor = await resolveDoctor({ actingUser: req.user, practiceId });
      const { login, patient, enrollment, consentRequired, isNewLogin } = await enrolByPhone({
        phone: b.phone,
        name: b.name,
        practiceId,
        enrolledBy: req.user._id,
        primaryDoctor: doctor?._id ?? null,
        dateOfBirth: dob ?? null,
        gender: b.gender ?? 'undisclosed',
      });
      req.auditResourceId = login._id;

      if (!isNewLogin) {
        return res.status(200).json({
          id: String(patient._id),
          name: login.name,
          phone: b.phone,
          // The desk needs to know which of two quite different things happened.
          existing: true,
          enrollmentId: String(enrollment._id),
          consentRequired,
          message: consentRequired
            ? 'This patient already uses MedPin. We have texted them a code — ask them to read it out.'
            : 'This patient is already registered here.',
        });
      }

      // What the desk took, on the account the service has just made.
      await User.updateOne(
        { _id: login._id },
        {
          $set: {
            consent: {
              termsAcceptedAt: new Date(),
              dataProcessingAcceptedAt: new Date(),
              aiDisclaimerAcceptedAt: new Date(),
            },
            ...(phoneVerifiedAt ? { phoneVerifiedAt } : {}),
          },
        },
      );
      await writeIntake(login._id, b, doctor);

      return res.status(201).json({
        id: String(login._id),
        name: login.name,
        phone: login.phone,
        existing: false,
        enrollmentId: String(enrollment._id),
        consentRequired: false,
      });
    }

    // No practice on the caller: a platform with no memberships at all, which
    // has not been migrated. A member of staff with no practice on a migrated
    // platform is refused before reaching here (see unplacedStaff), so the old
    // behaviour, and its refusal of a known number, stands only for that case.
    if (await User.findByLoginPhone(b.phone).select('_id').lean()) {
      throw conflict('An account with this phone number already exists');
    }

    const user = new User({
      name: b.name,
      phone: b.phone,
      role: ROLES.PATIENT,
      phoneVerifiedAt,
      ...(dob ? { dateOfBirth: dob } : {}),
      ...(b.gender ? { gender: b.gender } : {}),
      consent: {
        termsAcceptedAt: new Date(),
        dataProcessingAcceptedAt: new Date(),
        aiDisclaimerAcceptedAt: new Date(),
      },
    });
    // No password. The patient signs in with a code texted to the number
    // above; there is nothing here to set, and a password the desk invents and
    // reads out is a credential in a waiting room.
    await user.save();

    // Assign the patient so dietician/care scoping and the worklist behave as
    // they do for a self-signed-up patient. A doctor registering someone takes
    // them on; the desk registering someone falls through to the head doctor.
    const doctor = await resolveDoctor({ actingUser: req.user });
    await writeIntake(user._id, b, doctor);

    res.status(201).json({ id: String(user._id), name: user.name, phone: user.phone });
  }),
);

/**
 * What the desk took at registration: the profile, and a vitals snapshot when
 * anything was measured.
 */
async function writeIntake(patientId, b, doctor) {
  await PatientProfile.create({
    user: patientId,
    ...(doctor ? { assignedDoctor: doctor._id } : {}),
    ...(b.address ? { address: b.address } : {}),
    ...(b.complaints ? { chiefComplaint: b.complaints } : {}),
    ...(b.heightCm != null ? { heightCm: b.heightCm } : {}),
    ...(b.weightKg != null ? { baselineWeightKg: b.weightKg } : {}),
  });

  // Intake vitals snapshot (source: clinic), written only when the desk
  // actually captured a measurement — an empty VitalRecord would be noise.
  const vitals = {};
  if (b.systolic != null) vitals.systolic = b.systolic;
  if (b.diastolic != null) vitals.diastolic = b.diastolic;
  if (b.pulse != null) vitals.pulse = b.pulse;
  if (b.spo2 != null) vitals.spo2 = b.spo2;
  if (b.weightKg != null) vitals.weightKg = b.weightKg;
  if (Object.keys(vitals).length) {
    await VitalRecord.create({ patient: patientId, ...vitals });
  }
  if (b.glucoseMgDl != null) {
    await GlucoseReading.create({
      patient: patientId,
      valueMgDl: b.glucoseMgDl,
      context: 'random',
      source: 'clinic',
    });
  }
}

/**
 * Record a consult-time vitals snapshot. Updates the profile's height / current
 * weight / presenting complaint and writes a VitalRecord (+ GlucoseReading) so
 * the measurements taken during the consult land in the patient's history and
 * trends. Every field is optional; nothing is written for a value left blank.
 */
router.post(
  '/patients/:id/vitals',
  validate({
    body: z.object({
      heightCm: z.coerce.number().min(50).max(250).optional(),
      weightKg: z.coerce.number().min(10).max(400).optional(),
      waistCm: z.coerce.number().min(30).max(250).optional(),
      systolic: z.coerce.number().min(50).max(300).optional(),
      diastolic: z.coerce.number().min(30).max(200).optional(),
      pulse: z.coerce.number().min(25).max(250).optional(),
      spo2: z.coerce.number().min(50).max(100).optional(),
      glucoseMgDl: z.coerce.number().min(10).max(900).optional(),
      complaint: z.string().trim().max(1000).optional(),
    }),
  }),
  audit('create', 'VitalRecord'),
  asyncHandler(async (req, res) => {
    const patient = await User.findOne({ _id: req.params.id, role: ROLES.PATIENT }).select('_id').lean();
    if (!patient) throw notFound('Patient not found');

    // The same two questions `resolvePatientScope` asks everywhere else, which
    // this router never went through. Both refuse only on positive evidence,
    // so a caller or patient with no practice yet is unaffected.
    await assertSamePractice(req, patient._id);
    await enrollmentGate(req, patient._id);

    const b = req.body;

    const profileSet = {};
    if (b.heightCm != null) profileSet.heightCm = b.heightCm;
    if (b.weightKg != null) profileSet.baselineWeightKg = b.weightKg;
    if (b.complaint != null) profileSet.chiefComplaint = b.complaint;
    if (Object.keys(profileSet).length) {
      await PatientProfile.updateOne({ user: patient._id }, { $set: profileSet }, { upsert: true });
    }

    const vitals = {};
    if (b.systolic != null) vitals.systolic = b.systolic;
    if (b.diastolic != null) vitals.diastolic = b.diastolic;
    if (b.pulse != null) vitals.pulse = b.pulse;
    if (b.spo2 != null) vitals.spo2 = b.spo2;
    if (b.weightKg != null) vitals.weightKg = b.weightKg;
    if (b.waistCm != null) vitals.waistCm = b.waistCm;
    if (Object.keys(vitals).length) await VitalRecord.create({ patient: patient._id, ...vitals });
    if (b.glucoseMgDl != null) {
      await GlucoseReading.create({
        patient: patient._id,
        valueMgDl: b.glucoseMgDl,
        context: 'random',
        source: 'clinic',
      });
    }

    res.status(201).json({ ok: true });
  }),
);

// ---------------------------------------------------------------------------
// Patient list + segmentation
// ---------------------------------------------------------------------------

/**
 * The list's patients in the order asked for, as ids, across the whole list.
 *
 * `risk`: highest score first. `recent`: the latest glucose reading first.
 * `inbox`: whoever is waiting on an unread message first, newest first; then
 * everybody else who has written, by their latest message; then the rest by
 * name. Ties fall back to the newest registration, or to name in the inbox, so
 * a page boundary does not move between two requests.
 */
async function orderPatients(req, candidates, sort, profileMap) {
  const byNewest = (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);
  const ids = candidates.map((c) => c._id);

  if (sort === 'risk') {
    const risk = (c) => profileMap.get(String(c._id))?.riskScore ?? 0;
    return [...candidates].sort((a, b) => risk(b) - risk(a) || byNewest(a, b)).map((c) => c._id);
  }

  if (sort === 'recent') {
    const latest = new Map(
      (
        await GlucoseReading.aggregate([
          { $match: { patient: { $in: ids } } },
          { $group: { _id: '$patient', at: { $max: '$measuredAt' } } },
        ])
      ).map((r) => [String(r._id), new Date(r.at).getTime()]),
    );
    const at = (c) => latest.get(String(c._id)) ?? -Infinity;
    return [...candidates].sort((a, b) => at(b) - at(a) || byNewest(a, b)).map((c) => c._id);
  }

  if (sort === 'inbox') {
    // This practice's care conversations, the same ones the rows read.
    const sessions = await ChatSession.find({
      $and: [{ patient: { $in: ids }, kind: { $ne: 'nutrition' } }, await practiceSessions(req)],
    })
      .select('_id patient lastMessageAt')
      .lean();
    const lastAt = new Map();
    for (const s of sessions) {
      if (!s.lastMessageAt) continue;
      const key = String(s.patient);
      const t = new Date(s.lastMessageAt).getTime();
      if (t > (lastAt.get(key) ?? -Infinity)) lastAt.set(key, t);
    }
    const unreadAt = new Map(
      (
        await ChatMessage.aggregate([
          {
            $match: {
              patient: { $in: ids },
              session: { $in: sessions.map((s) => s._id) },
              role: 'user',
              seenByClinicAt: null,
            },
          },
          { $group: { _id: '$patient', at: { $max: '$createdAt' } } },
        ])
      ).map((r) => [String(r._id), new Date(r.at).getTime()]),
    );
    const rank = (c) => {
      const key = String(c._id);
      if (unreadAt.has(key)) return [0, -unreadAt.get(key)];
      if (lastAt.has(key)) return [1, -lastAt.get(key)];
      return [2, 0];
    };
    return [...candidates]
      .sort((a, b) => {
        const [ga, ta] = rank(a);
        const [gb, tb] = rank(b);
        return ga - gb || ta - tb || String(a.name ?? '').localeCompare(String(b.name ?? ''));
      })
      .map((c) => c._id);
  }

  return [...candidates].sort(byNewest).map((c) => c._id);
}

router.get(
  '/patients',
  validate({
    query: pageParams.and(
      z.object({
        riskBand: z.enum(['low', 'moderate', 'high', 'critical']).optional(),
        search: z.string().max(120).optional(),
        sort: z.enum(['risk', 'name', 'recent', 'inbox']).default('risk'),
      }),
    ),
  }),
  audit('read', 'PatientList'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, riskBand, search, sort } = q(req);

    // This was `{ role: PATIENT, isActive: true }` — every patient on the
    // platform. Correct while there was one practice; with two it hands a
    // doctor the other clinic's register, by name, with risk bands against it.
    const scope = await practicePatients(req);

    const userFilter = { role: ROLES.PATIENT, isActive: true, ...scope };
    if (search) {
      // Escaped so a patient searching for "a.b" cannot inject a regex.
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      userFilter.$or = [{ name: new RegExp(safe, 'i') }, { phone: new RegExp(safe, 'i') }];
    }

    let profileFilter = {};
    if (riskBand) profileFilter = { riskBand };

    const matchingProfiles = await PatientProfile.find(profileFilter)
      .select('user riskScore riskBand checkInIntervalDays')
      .lean();
    const profileMap = new Map(matchingProfiles.map((p) => [p.user.toString(), p]));

    if (riskBand) {
      // Intersected, not assigned. A plain `userFilter._id = ...` here would
      // overwrite the practice scope set above, and filtering by risk band
      // would quietly widen the list to the whole platform — a narrowing
      // control that broadens is the worst kind of bug to notice.
      const byRisk = matchingProfiles.map((p) => String(p.user));
      const allowed = scope._id ? scope._id.$in.map(String) : null;
      userFilter._id = { $in: allowed ? byRisk.filter((id) => allowed.includes(id)) : byRisk };
    }

    /*
     * Put in order before it is cut into pages.
     *
     * Risk and reading order were applied to a page already taken newest-first,
     * so page one of "highest risk" was the newest patients in risk order, and
     * the patient who most needed seeing, registered last year, was on a page
     * the app never asked for. Every order is now worked out across the whole
     * list and the page is cut from it. Name order is the database's own.
     */
    // avatarAssetId included so a photo the patient sets is visible to the
    // clinic. Without it the field never left the database and the doctor's
    // list showed an initial for a patient who had uploaded a picture.
    const listFields = 'name phone createdAt avatarAssetId';
    let users;
    let total;
    if (sort === 'name') {
      [users, total] = await Promise.all([
        User.find(userFilter).sort({ name: 1 }).skip(skip).limit(limit).select(listFields).lean(),
        User.countDocuments(userFilter),
      ]);
    } else {
      const candidates = await User.find(userFilter).select('_id name createdAt').lean();
      total = candidates.length;
      const pageIds = (await orderPatients(req, candidates, sort, profileMap)).slice(skip, skip + limit);
      const found = await User.find({ _id: { $in: pageIds } }).select(listFields).lean();
      const byId = new Map(found.map((u) => [String(u._id), u]));
      users = pageIds.map((id) => byId.get(String(id))).filter(Boolean);
    }

    const ids = users.map((u) => u._id);

    // The doctor's own conversations with these patients. Everything below
    // that reads the thread is scoped through this, so the inbox and the
    // thread cannot disagree about what the last message was.
    const careSessionIds = (
      await ChatSession.find({ patient: { $in: ids }, kind: { $ne: 'nutrition' }, ...(await practiceSessions(req)) })
        .select('_id')
        .lean()
    ).map((x) => x._id);

    const [lastReadings, alertCounts, lastMessages, unreadCounts, signals, hba1cRows] = await Promise.all([
      GlucoseReading.aggregate([
        { $match: { patient: { $in: ids } } },
        { $sort: { measuredAt: -1 } },
        { $group: { _id: '$patient', measuredAt: { $first: '$measuredAt' }, value: { $first: '$valueMgDl' } } },
      ]),
      ClinicalAlert.aggregate([
        { $match: { patient: { $in: ids }, status: 'open' } },
        { $group: { _id: '$patient', count: { $sum: 1 } } },
      ]),
      // Newest turn per patient, whoever wrote it, so the row reads like an
      // inbox: what was last said and when, not merely that a thread exists.
      //
      // Scoped to the CARE threads. Matching on the patient alone pulled from
      // the nutrition conversation too, so the doctor's inbox previewed a line
      // the dietician had written — and opening the row did not show it,
      // because the thread endpoint has always filtered to care. An inbox that
      // previews a message the conversation does not contain is worse than one
      // that previews nothing.
      ChatMessage.aggregate([
        { $match: { patient: { $in: ids }, session: { $in: careSessionIds } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$patient',
            content: { $first: '$content' },
            role: { $first: '$role' },
            createdAt: { $first: '$createdAt' },
            urgency: { $first: '$triage.urgency' },
            attachments: { $first: '$attachments' },
          },
        },
      ]),
      // Unread means the patient wrote it and no clinician has opened the
      // thread since. `seenByClinicAt` is stamped when the thread is read, so
      // the badge and the patient's "Seen by the clinic" mark cannot disagree.
      // Same scope, for the same reason: a question a patient asked their
      // dietician is not the doctor's unread, and counting it gave a badge
      // that could not be cleared by reading the care thread.
      ChatMessage.aggregate([
        {
          $match: {
            patient: { $in: ids },
            session: { $in: careSessionIds },
            role: 'user',
            seenByClinicAt: null,
          },
        },
        { $group: { _id: '$patient', count: { $sum: 1 } } },
      ]),
      // Sparkline + trend + recency for each row's monitoring strip.
      monitoringSignals(ids),
      // Latest HbA1c + a short recent series per patient — the doctor anchors on
      // HbA1c, so the row can show that rather than day-to-day glucose.
      Hba1cRecord.aggregate([
        { $match: { patient: { $in: ids } } },
        { $sort: { testedOn: -1 } },
        {
          $group: {
            _id: '$patient',
            latest: { $first: '$percentage' },
            latestAt: { $first: '$testedOn' },
            values: { $push: '$percentage' },
          },
        },
      ]),
    ]);

    const readingMap = new Map(lastReadings.map((r) => [r._id.toString(), r]));
    const hba1cMap = new Map(hba1cRows.map((h) => [h._id.toString(), h]));
    const alertMap = new Map(alertCounts.map((a) => [a._id.toString(), a.count]));
    const messageMap = new Map(lastMessages.map((m) => [m._id.toString(), m]));
    const unreadMap = new Map(unreadCounts.map((u) => [u._id.toString(), u.count]));

    // The kind/mime of every newest-message attachment, so a media-only turn
    // previews as its TYPE — with plain text plus a `mediaType` the app renders
    // as a subtle icon (no emoji) — instead of a blank line or a transcript.
    const lastAttachmentIds = lastMessages.flatMap((m) => m.attachments ?? []);
    const assetMap = new Map(
      (await MediaAsset.find({ _id: { $in: lastAttachmentIds } })
        .select('_id kind mimeType')
        .lean()).map((a) => [a._id.toString(), a]),
    );
    // Returns { preview, mediaType } where mediaType is voice|photo|pdf|document|
    // file|null. A voice note always reads as a voice message; a caption
    // otherwise wins; media with no caption falls back to a plain type label.
    const mediaInfo = (m) => {
      const atts = (m?.attachments ?? []).map((a) => assetMap.get(a.toString())).filter(Boolean);
      if (atts.some((a) => a.kind === 'voice_note' || (a.mimeType || '').startsWith('audio/'))) {
        return { preview: 'Voice message', mediaType: 'voice' };
      }
      const doc = atts.find(
        (a) => (a.mimeType || '').startsWith('application/') || (a.mimeType || '').startsWith('text/'),
      );
      let mediaType = null;
      if (doc) mediaType = doc.mimeType === 'application/pdf' ? 'pdf' : 'document';
      else if (atts.some((a) => (a.mimeType || '').startsWith('image/'))) mediaType = 'photo';
      else if (atts.length) mediaType = 'file';

      const text = (m?.content || '').trim();
      if (text) return { preview: text.slice(0, 140), mediaType };
      switch (mediaType) {
        case 'pdf':
          return { preview: 'PDF document', mediaType };
        case 'document':
          return { preview: 'Document', mediaType };
        case 'photo':
          return { preview: 'Photo', mediaType };
        case 'file':
          return { preview: 'Attachment', mediaType };
        default:
          return { preview: '', mediaType: null };
      }
    };

    const items = users.map((u) => {
      const id = u._id.toString();
      const profile = profileMap.get(id);
      const reading = readingMap.get(id);
      const lastMsg = messageMap.get(id);
      const media = lastMsg ? mediaInfo(lastMsg) : null;
      return {
        id: u._id,
        name: u.name,
        phone: u.phone,
        // `lean()` skips the schema's toJSON, so build the URL by hand.
        avatarUrl: u.avatarAssetId ? `/api/v1/uploads/${u.avatarAssetId}/raw` : null,
        // Inbox fields. Null where a patient has never written — the row then
        // reads as a patient the clinic can start a conversation with, rather
        // than an empty message.
        lastMessage: lastMsg
          ? {
              // Trimmed server-side: a 4000-character message has no business
              // crossing the wire to fill a two-line preview. `mediaType` lets
              // the app draw a subtle icon for a media-only turn.
              preview: media.preview,
              mediaType: media.mediaType,
              role: lastMsg.role,
              at: lastMsg.createdAt,
              urgency: lastMsg.urgency ?? 'routine',
            }
          : null,
        unreadCount: unreadMap.get(id) ?? 0,
        riskScore: profile?.riskScore ?? 0,
        riskBand: profile?.riskBand ?? 'low',
        lastReadingAt: reading?.measuredAt ?? null,
        lastReadingValue: reading?.value ?? null,
        openAlertCount: alertMap.get(id) ?? 0,
        // Continuous-monitoring signals for the row's sparkline + trend badge.
        spark: signals.get(id)?.spark ?? [],
        trend: signals.get(id)?.direction ?? 'flat',
        trendDelta: signals.get(id)?.trendDelta ?? null,
        checkInIntervalDays: profile?.checkInIntervalDays ?? null,
        checkInOverdue: isCheckInOverdue(reading?.measuredAt ?? null, profile?.checkInIntervalDays),
        // Latest HbA1c + a short recent series (oldest→newest) for the row.
        hba1c: hba1cMap.get(id)?.latest ?? null,
        hba1cAt: hba1cMap.get(id)?.latestAt ?? null,
        hba1cSpark: (hba1cMap.get(id)?.values ?? []).slice(0, 6).reverse(),
      };
    });

    res.json(paged(items, { page, limit, total }));
  }),
);

router.get(
  '/patients/:id/summary',
  // A generated summary of a patient's course, rather than the record itself.
  // The record stays readable on every plan — see the note in lapse.js on
  // withholding insight versus withholding access.
  requireCapability(CAPABILITIES.ADVANCED_REPORTS),
  audit('read', 'PatientSummary'),
  asyncHandler(async (req, res) => {
    const patient = await User.findOne({ _id: req.params.id, role: ROLES.PATIENT }).lean();
    if (!patient) throw notFound('Patient not found');

    // The same two questions `resolvePatientScope` asks everywhere else, which
    // this router never went through. Both refuse only on positive evidence,
    // so a caller or patient with no practice yet is unaffected.
    await assertSamePractice(req, patient._id);
    await enrollmentGate(req, patient._id);

    req.patientId = patient._id;

    const [
      profile,
      healthScore,
      trends,
      adherence,
      alerts,
      latestHba1c,
      footAssessments,
      context,
      labResults,
      rxForTests,
      medicationCount,
      lastFasting,
      latestVitals,
    ] = await Promise.all([
      PatientProfile.findOne({ user: patient._id }).populate('assignedDietician', 'name phone').lean(),
      computeHealthScore(patient._id, { days: 30 }),
      glucoseTrends(patient._id, { days: 90 }),
      computeAdherence(patient._id, { days: 30 }),
      ClinicalAlert.find({ patient: patient._id }).sort({ createdAt: -1 }).limit(20).lean(),
      Hba1cRecord.find({ patient: patient._id }).sort({ testedOn: -1 }).limit(6).lean(),
      FootAssessment.find({ patient: patient._id }).sort({ assessedAt: -1 }).limit(5).lean(),
      buildPatientContext(patient._id),
      LabResult.find({ patient: patient._id })
        .sort({ createdAt: -1 })
        .limit(20)
        .populate('photo', 'mimeType originalName sizeBytes')
        .lean(),
      // What the doctor has already asked this patient to get done. Without
      // it the prescribing screen offered a fresh list of tests with no way
      // to see that HbA1c was ordered a fortnight ago and is still pending.
      Prescription.find({ patient: patient._id, isActive: true }).select('labTestsAdvised').lean(),
      // Medicines the patient is currently on, and their most recent fasting
      // reading — both surfaced as metric tiles on the doctor's profile.
      Medication.countDocuments({ patient: patient._id, isActive: true }),
      GlucoseReading.findOne({ patient: patient._id, context: 'fasting' })
        .sort({ measuredAt: -1 })
        .select('valueMgDl measuredAt')
        .lean(),
      // The most recent measured vitals, for the profile's physical-details.
      VitalRecord.findOne({ patient: patient._id })
        .sort({ recordedAt: -1 })
        .select('systolic diastolic pulse spo2 weightKg waistCm recordedAt')
        .lean(),
    ]);

    res.json({
      patient: {
        id: patient._id,
        name: patient.name,
        phone: patient.phone,
        avatarUrl: patient.avatarAssetId ? `/api/v1/uploads/${patient.avatarAssetId}/raw` : null,
        email: patient.email ?? null,
        language: patient.language,
        dateOfBirth: patient.dateOfBirth ?? null,
        gender: patient.gender,
        age: patient.dateOfBirth ? dayjs().diff(dayjs(patient.dateOfBirth), 'year') : null,
        // Desk-registration details, surfaced on the profile header.
        address: profile?.address ?? null,
        chiefComplaint: profile?.chiefComplaint ?? null,
      },
      // The rest of what the clinic knows about this person. All of it was
      // already stored and none of it was sent, so the doctor had to open the
      // patient's own app — or ask them again — for an allergy the clinic
      // recorded at registration.
      details: {
        diagnosedOn: profile?.diagnosedOn ?? null,
        heightCm: profile?.heightCm ?? null,
        comorbidities: profile?.comorbidities ?? [],
        allergies: profile?.allergies ?? [],
        footRiskCategory: profile?.footRiskCategory ?? null,
        emergencyContact: profile?.emergencyContact?.phone
          ? {
              name: profile.emergencyContact.name ?? null,
              phone: profile.emergencyContact.phone,
              relation: profile.emergencyContact.relation ?? null,
            }
          : null,
        targets: profile?.targets ?? null,
        mealTimes: profile?.mealTimes ?? null,
        notes: profile?.notes ?? null,
      },
      profile,
      healthScore,
      trends,
      // Carries expected/taken/percentage — the profile shows the raw doses.
      adherence,
      medicationCount,
      lastFasting: lastFasting ? { value: lastFasting.valueMgDl, at: lastFasting.measuredAt } : null,
      // Latest measured vitals for the profile's physical-details section.
      latestVitals: latestVitals
        ? {
            systolic: latestVitals.systolic ?? null,
            diastolic: latestVitals.diastolic ?? null,
            pulse: latestVitals.pulse ?? null,
            spo2: latestVitals.spo2 ?? null,
            weightKg: latestVitals.weightKg ?? null,
            waistCm: latestVitals.waistCm ?? null,
            at: latestVitals.recordedAt,
          }
        : null,
      hba1cHistory: latestHba1c.map((h) => ({ percentage: h.percentage, testedOn: h.testedOn })),
      footAssessments: footAssessments.map((f) => ({
        id: f._id,
        assessedAt: f.assessedAt,
        site: f.site,
        finalRiskLevel: f.finalRiskLevel,
      })),
      labResults: labResults.map((r) => {
        const asset = r.photo && typeof r.photo === 'object' ? r.photo : null;
        const photoId = asset ? asset._id : r.photo;
        return {
          id: String(r._id),
          testName: r.testName,
          note: r.note ?? '',
          photoUrl: photoId ? `/api/v1/uploads/${photoId}/raw` : null,
          // So the doctor's screen can tell a scan from a PDF, as the
          // patient's now does.
          mimeType: asset?.mimeType ?? null,
          originalName: asset?.originalName ?? null,
          // What was transcribed off the page, so the doctor sees the numbers
          // without opening the file — and sees plainly when a report could
          // not be read and still needs their eyes.
          analysisStatus: r.analysis?.status ?? null,
          analysisSummary: r.analysis?.summary ?? null,
          hba1cPercent: r.analysis?.hba1cPercent ?? null,
          abnormal: r.analysis?.abnormal ?? [],
          // Uniform value/range/flag list for the record's structured display.
          analytes: buildAnalytes(r.analysis),
          testedOn: r.analysis?.testedOn ?? null,
          createdAt: r.createdAt,
        };
      }),
      labTestsAdvised: [
        ...new Set((rxForTests ?? []).flatMap((p) => p.labTestsAdvised ?? []).filter(Boolean)),
      ],
      alerts: alerts.map(serialiseAlert),
      // The same summary the AI assistant sees — useful for the doctor to
      // understand why it answered the way it did.
      aiContext: context.text,
    });
  }),
);

/** Medication adherence for a chosen window (week/month/year), for the sheet's filter. */
router.get(
  '/patients/:id/adherence',
  requireCapability(CAPABILITIES.ADVANCED_REPORTS),
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(400).default(30) }) }),
  audit('read', 'Medication'),
  asyncHandler(async (req, res) => {
    const patient = await User.findOne({ _id: req.params.id, role: ROLES.PATIENT }).select('_id').lean();
    if (!patient) throw notFound('Patient not found');

    // The same two questions `resolvePatientScope` asks everywhere else, which
    // this router never went through. Both refuse only on positive evidence,
    // so a caller or patient with no practice yet is unaffected.
    await assertSamePractice(req, patient._id);
    await enrollmentGate(req, patient._id);

    res.json(await computeAdherence(patient._id, { days: q(req).days }));
  }),
);


// ---------------------------------------------------------------------------
// Alerts
// ---------------------------------------------------------------------------

router.get(
  '/alerts',
  validate({
    query: pageParams.and(
      z.object({
        status: z.enum(['open', 'acknowledged', 'resolved', 'dismissed']).optional(),
        severity: z.enum(ALERT_SEVERITY).optional(),
      }),
    ),
  }),
  audit('read', 'ClinicalAlert'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, status, severity } = q(req);
    const filter = {
      ...(status ? { status } : {}),
      ...(severity ? { severity } : {}),
      ...(await practicePatients(req, 'patient')),
    };

    const [items, total] = await Promise.all([
      ClinicalAlert.find(filter)
        .sort({ severity: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('patient', 'name phone avatarAssetId gender dateOfBirth')
        .lean(),
      ClinicalAlert.countDocuments(filter),
    ]);

    // Address and risk band come from the profile, fetched once for the whole
    // page rather than per alert — a screen of twenty alerts should not be
    // twenty extra round trips, and several of them are usually the same
    // patient anyway.
    const patientIds = [...new Set(items.map((a) => String(a.patient?._id ?? a.patient)))];
    const profiles = await PatientProfile.find({ user: { $in: patientIds } })
      .select('user address riskBand')
      .lean();
    const byPatient = new Map(profiles.map((pr) => [String(pr.user), pr]));

    res.json(
      paged(
        items.map((a) => serialiseAlert(a, byPatient.get(String(a.patient?._id ?? a.patient)))),
        { page, limit, total },
      ),
    );
  }),
);

/**
 * The open alerts a front desk is shown.
 *
 * Severity, not role. Everything here is something a receptionist can do
 * something about in the next minute: fetch the doctor, ring the patient back,
 * call an ambulance. A moderate alert about a fortnight of high readings is
 * real clinical work and none of it is theirs.
 */
const DESK_ALERTS = { status: 'open', severity: { $in: ['urgent', 'emergency'] } };

/**
 * ---- What the front desk may not do ---------------------------------------
 *
 * Every route in this file sat behind `requireClinician`, which admits STAFF.
 * That is right for the desk's actual work — registering a walk-in, taking a
 * height and weight, reading the care inbox, clearing message badges — and it
 * was quietly wrong for everything else in here.
 *
 * A front-desk account could reassign a patient's dietician (which, in a clinic
 * with two, decides who may see that patient at all), edit and approve the
 * knowledge base the assistant answers patients from, post into a review thread
 * under the clinician's name, create dietician
 * accounts, and change clinic settings. None of that is a receptionist's job
 * and none of it was refused.
 *
 * It was never a deliberate grant. `requireClinician` is the file-level guard
 * and STAFF arrived later, so each of these inherited an audience written
 * before that role existed. The `/staff` routes added afterwards were
 * doctor-only from the start; these are now brought in line with them.
 *
 * Nothing the doctor could do has changed — `requireDoctor` is a subset.
 */
router.post(
  '/alerts/:id/acknowledge',
  // Triage, not admin: saying an alert has been seen is a clinical claim.
  requireDoctor,
  audit('update', 'ClinicalAlert'),
  asyncHandler(async (req, res) => {
    // Another practice's alert is not found — see services/alerts.js.
    const alert = await acknowledgeAlert(req.params.id, req.user._id, await practicePatients(req, 'patient'));
    if (!alert) throw notFound('Alert not found');
    res.json({ alert: serialiseAlert(alert) });
  }),
);

router.post(
  '/alerts/:id/resolve',
  // "This patient no longer needs a doctor" is a clinical judgement. The desk
  // can see every alert and escalate one; closing it is not theirs.
  requireDoctor,
  validate({ body: z.object({ notes: z.string().max(2000).optional() }) }),
  audit('update', 'ClinicalAlert'),
  asyncHandler(async (req, res) => {
    const alert = await resolveAlert(
      req.params.id,
      req.user._id,
      req.body.notes,
      await practicePatients(req, 'patient'),
    );
    if (!alert) throw notFound('Alert not found');
    res.json({ alert: serialiseAlert(alert) });
  }),
);

// ---------------------------------------------------------------------------
// AI chat monitoring
// ---------------------------------------------------------------------------

router.get(
  '/chat-review',
  validate({
    query: pageParams.and(
      z.object({
        urgency: z.enum(['routine', 'advice', 'urgent', 'emergency']).optional(),
        kind: z.enum(['care', 'nutrition']).optional(),
      }),
    ),
  }),
  audit('read', 'ChatSession'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, urgency, kind } = q(req);
    // `flagged` is read from the raw query rather than the zod schema: pageParams
    // is `.passthrough()`, so an intersected `z.coerce.boolean()` would keep the
    // string on one side and a boolean on the other and fail to merge. Defaults
    // to true (only flagged threads), false only when explicitly "false".
    const flagged = req.query.flagged !== 'false';
    const filter = {
      // This practice's conversations, not every conversation its patients
      // have: a patient another practice also cares for has a conversation
      // there too, and it was listed here. See services/conversationPractice.js.
      ...(await practiceSessions(req)),
      ...(flagged ? { flaggedForReview: true } : {}),
      ...(urgency ? { highestUrgency: urgency } : {}),
      // `nutrition` is an equality match; `care` has to be `$ne: 'nutrition'`
      // because sessions created before `kind` existed carry no value at all —
      // a Mongoose default never backfills. See ChatSession.kind.
      ...(kind === 'nutrition'
        ? { kind: 'nutrition' }
        : kind === 'care'
          ? { kind: { $ne: 'nutrition' } }
          : {}),
    };

    const [items, total] = await Promise.all([
      ChatSession.find(filter)
        .sort({ lastMessageAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('patient', 'name phone avatarAssetId')
        .lean(),
      ChatSession.countDocuments(filter),
    ]);

    // Unread patient messages per conversation, so the doctor can see which
    // rows are new rather than opening each in turn to find out. Counted only
    // for the page being returned, not the whole collection.
    const unreadBySession = new Map(
      (
        await ChatMessage.aggregate([
          {
            $match: {
              session: { $in: items.map((s) => s._id) },
              role: 'user',
              seenByClinicAt: null,
            },
          },
          { $group: { _id: '$session', count: { $sum: 1 } } },
        ])
      ).map((u) => [u._id.toString(), u.count]),
    );

    // Newest turn per session — whoever wrote it — so each row reads like an
    // inbox entry (what was last said, by whom, and when), matching the
    // Patients tab rather than showing only the static thread title.
    const lastMessages = await ChatMessage.aggregate([
      { $match: { session: { $in: items.map((s) => s._id) } } },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$session',
          content: { $first: '$content' },
          role: { $first: '$role' },
          createdAt: { $first: '$createdAt' },
          attachments: { $first: '$attachments' },
        },
      },
    ]);
    const lastMsgBySession = new Map(lastMessages.map((m) => [m._id.toString(), m]));

    // Resolve media-only turns to a type label + icon hint, exactly as the
    // Patients inbox does, so a photo or voice note previews as its kind
    // instead of an empty line.
    const attachmentIds = lastMessages.flatMap((m) => m.attachments ?? []);
    const assetMap = new Map(
      (await MediaAsset.find({ _id: { $in: attachmentIds } }).select('_id kind mimeType').lean()).map((a) => [
        a._id.toString(),
        a,
      ]),
    );
    const mediaInfo = (m) => {
      const atts = (m?.attachments ?? []).map((a) => assetMap.get(a.toString())).filter(Boolean);
      if (atts.some((a) => a.kind === 'voice_note' || (a.mimeType || '').startsWith('audio/'))) {
        return { preview: 'Voice message', mediaType: 'voice' };
      }
      const doc = atts.find(
        (a) => (a.mimeType || '').startsWith('application/') || (a.mimeType || '').startsWith('text/'),
      );
      let mediaType = null;
      if (doc) mediaType = doc.mimeType === 'application/pdf' ? 'pdf' : 'document';
      else if (atts.some((a) => (a.mimeType || '').startsWith('image/'))) mediaType = 'photo';
      else if (atts.length) mediaType = 'file';
      const text = (m?.content || '').trim();
      if (text) return { preview: text.slice(0, 140), mediaType };
      switch (mediaType) {
        case 'pdf':
          return { preview: 'PDF document', mediaType };
        case 'document':
          return { preview: 'Document', mediaType };
        case 'photo':
          return { preview: 'Photo', mediaType };
        case 'file':
          return { preview: 'Attachment', mediaType };
        default:
          return { preview: '', mediaType: null };
      }
    };

    res.json(
      paged(
        items.map((s) => {
          const lastMsg = lastMsgBySession.get(s._id.toString());
          const media = lastMsg ? mediaInfo(lastMsg) : null;
          return {
            id: s._id,
            patientId: s.patient?._id,
            patientName: s.patient?.name ?? null,
            // `lean()` skips the schema's toJSON, so build the avatar URL by hand.
            avatarUrl: s.patient?.avatarAssetId ? `/api/v1/uploads/${s.patient.avatarAssetId}/raw` : null,
            title: s.title,
            // `care` (assistant + doctor) or `nutrition` (the dietician's own
            // thread). Both are reviewable; the doctor needs to know which one
            // they are reading before they judge what was said in it.
            kind: s.kind ?? 'care',
            language: s.language,
            messageCount: s.messageCount,
            highestUrgency: s.highestUrgency,
            flaggedForReview: s.flaggedForReview,
            reviewedAt: s.reviewedAt ?? null,
            unreadCount: unreadBySession.get(s._id.toString()) ?? 0,
            lastMessageAt: s.lastMessageAt,
            // The newest turn, trimmed, so the row shows what was actually said
            // (and by whom) rather than the thread title. Null on an empty thread.
            lastMessage: lastMsg
              ? {
                  preview: media.preview,
                  mediaType: media.mediaType,
                  role: lastMsg.role,
                  at: lastMsg.createdAt,
                }
              : null,
          };
        }),
        { page, limit, total },
      ),
    );
  }),
);

router.get(
  '/chat-review/:sessionId',
  audit('read', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const session = await ChatSession.findById(req.params.sessionId).populate('patient', 'name phone').lean();
    if (!session) throw notFound('Conversation not found');

    // A thread arrives by session id rather than patient id, which is the only
    // reason it looked like a different kind of route. It is not: the thread
    // belongs to somebody, and the question is the same one.
    if (session.patient?._id) {
      await assertSamePractice(req, session.patient._id);
      await enrollmentGate(req, session.patient._id);
    }
    // And the conversation has to be this practice's. A patient another
    // practice also cares for has a conversation there too, and passing the two
    // checks above opened it by id. See services/conversationPractice.js.
    if (!(await sessionBelongsTo(session, req.enrollment))) throw notFound('Conversation not found');

    req.patientId = session.patient?._id;

    // Attachments are populated because a food photo *is* the message: without
    // them the doctor sees an empty bubble above the assistant's reply and has
    // no way to judge whether that reply was right about the meal.
    const messages = await ChatMessage.find({ session: session._id, ...recordWindow(req, 'createdAt') })
      .sort({ seq: 1 })
      .populate('sender', 'name role avatarAssetId')
      .populate('attachments', 'kind mimeType transcript originalName sizeBytes')
      .populate('replyTo', QUOTE_FIELDS)
      .lean();

    res.json({
      session: {
        id: session._id,
        patientId: session.patient?._id,
        patientName: session.patient?.name ?? null,
        // Without this the conversation header could not tell a nutrition
        // thread from a care one and labelled every thread "Care chat".
        kind: session.kind ?? 'care',
        title: session.title,
        highestUrgency: session.highestUrgency,
        language: session.language,
      },
      messages: messages.map((m) => {
        // Deleted for everyone: a tombstone, same as the patient/doctor threads.
        if (m.deletedForEveryoneAt) {
          return {
            id: m._id,
            seq: m.seq,
            role: m.role,
            content: '',
            deletedForEveryone: true,
            pinned: false,
            replyToId: null,
            replyPreview: null,
            urgency: 'routine',
            citations: [],
            attachments: [],
            senderName: m.sender && typeof m.sender === 'object' ? (m.sender.name ?? null) : null,
            createdAt: m.createdAt,
          };
        }
        return {
          id: m._id,
          seq: m.seq,
          role: m.role,
          content: m.content,
          deletedForEveryone: false,
          // Pin / reply state, so the review screen acts on the conversation the
          // same way the patient and doctor threads do.
          pinned: Boolean(m.pinnedAt),
          replyToId: m.replyTo ? String(m.replyTo._id ?? m.replyTo) : null,
          // None for a quote from another conversation or one taken back. See
          // quotePreview.
          replyPreview: quotePreview(m),
          urgency: m.triage?.urgency ?? 'routine',
          matchedRules: m.triage?.matchedRules ?? [],
          ruleDriven: m.triage?.ruleDriven ?? false,
          // Which approved chunks grounded the answer — the audit trail for
          // "why did the assistant say that?".
          citations: (m.citations ?? []).map((c) => ({ id: c.chunk, title: c.title, score: c.score })),
          isFallback: m.isFallback ?? false,
          flaggedByPatient: m.flaggedByPatient ?? false,
          modelVersion: m.modelVersion ?? null,
          latencyMs: m.latencyMs ?? null,
          senderName: m.sender && typeof m.sender === 'object' ? (m.sender.name ?? null) : null,
          senderRole: m.sender && typeof m.sender === 'object' ? (m.sender.role ?? null) : null,
        // The dietician's own photo, so their turns carry a face rather than a
        // generic role icon.
        senderAvatarUrl:
          m.sender && typeof m.sender === 'object' && m.sender.avatarAssetId
            ? `/api/v1/uploads/${m.sender.avatarAssetId}/raw`
            : null,
          attachments: (m.attachments ?? []).map((a) => {
            const id = (a?._id ?? a).toString?.() ?? a;
            return {
              id,
              url: `/api/v1/uploads/${id}/raw`,
              kind: a?.kind ?? null,
              mimeType: a?.mimeType ?? null,
              originalName: a?.originalName ?? null,
              sizeBytes: a?.sizeBytes ?? null,
              // A voice note's transcript is what triage actually read, so the
              // doctor should see the same text the rules did.
              transcript: a?.transcript ?? null,
            };
          }),
          createdAt: m.createdAt,
        };
      }),
    });
  }),
);

router.post(
  '/chat-review/:sessionId/reviewed',
  // Declaring a conversation clinically reviewed is the doctor's judgement.
  requireDoctor,
  audit('update', 'ChatSession'),
  asyncHandler(async (req, res) => {
    // Read first. `findByIdAndUpdate` writes before there is anything to ask
    // the question about, and marking another practice's conversation reviewed
    // is a write into their record that also hides it from them.
    const session = await ChatSession.findById(req.params.sessionId);
    if (!session) throw notFound('Conversation not found');

    if (session.patient) {
      await assertSamePractice(req, session.patient);
      await enrollmentGate(req, session.patient);
    }
    // This practice's conversation only. See services/conversationPractice.js.
    if (!(await sessionBelongsTo(session, req.enrollment))) throw notFound('Conversation not found');

    session.flaggedForReview = false;
    session.reviewedBy = req.user._id;
    session.reviewedAt = new Date();
    await session.save();

    res.status(204).end();
  }),
);

/**
 * Reply into ANY of a patient's conversations by session id — care OR nutrition.
 * This is how a doctor steps into a dietician↔patient nutrition thread to guide
 * it; the care-only `/chat/patients/:id/clinician-message` path can't reach a
 * nutrition session. Posts `role: 'clinician'` and notifies the patient.
 */
router.post(
  '/chat-review/:sessionId/message',
  // This posts into the thread AS the clinician. A receptionist's words
  // arriving under the doctor's name is not a permission slip, it is a
  // false record of who gave the advice.
  requireDoctor,
  validate({
    body: z
      .object({
        // Optional so the doctor can reply into the thread with a photo or voice
        // note alone, the same as the Patients-tab composer.
        content: z.string().trim().max(4000).optional().default(''),
        attachments: z.array(z.string()).max(5).default([]),
        replyTo: z.string().optional(),
      })
      .refine((b) => b.content.trim().length > 0 || b.attachments.length > 0, {
        message: 'Add a message or attach a photo',
        path: ['content'],
      }),
  }),
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const session = await ChatSession.findById(req.params.sessionId);
    if (!session || session.isArchived || !session.patient) throw notFound('Conversation not found');

    // Writing into a conversation is the sharpest of these: the message is
    // attributed to this doctor and the patient sees it as clinical advice.
    await assertSamePractice(req, session.patient);
    await enrollmentGate(req, session.patient);
    // Into this practice's conversation only. See services/conversationPractice.js.
    if (!(await sessionBelongsTo(session, req.enrollment))) throw notFound('Conversation not found');

    // The patient's files or the doctor's own, and a quote from this same
    // conversation. See services/mediaAccess.js and services/quotedMessage.js.
    req.body.attachments = await attachableAssetIds(req.body.attachments, {
      patientId: session.patient,
      uploaderIds: [req.user._id],
    });
    req.body.replyTo = await quotableMessageId(req.body.replyTo, {
      patientId: session.patient,
      kind: session.kind === 'nutrition' ? 'nutrition' : 'care',
    });

    const last = await ChatMessage.findOne({ session: session._id }).sort({ seq: -1 }).select('seq').lean();
    const message = await ChatMessage.create({
      session: session._id,
      patient: session.patient,
      seq: (last?.seq ?? -1) + 1,
      role: 'clinician',
      sender: req.user._id,
      content: req.body.content,
      language: session.language,
      attachments: req.body.attachments,
      replyTo: req.body.replyTo || undefined,
    });
    await ChatSession.findByIdAndUpdate(session._id, {
      lastMessageAt: message.createdAt,
      $inc: { messageCount: 1 },
      flaggedForReview: false,
    });
    notifyPatientOfClinicianReply(session.patient, req.user, req.body.content, {
      threadKind: session.kind === 'nutrition' ? 'nutrition' : 'care',
    }).catch(() => {});

    res.status(201).json({ ok: true, sessionId: String(session._id) });
  }),
);

// ---------------------------------------------------------------------------
// Knowledge base curation
// ---------------------------------------------------------------------------

const knowledgeSchema = z.object({
  docId: z.string().max(120),
  title: z.string().min(1).max(300),
  section: z.string().max(300).optional(),
  content: z.string().min(20).max(8000),
  language: z.enum(['en', 'bn', 'hi']).default('en'),
  category: z.enum([
    'diabetes_basics', 'hypoglycaemia', 'hyperglycaemia', 'insulin', 'oral_medication',
    'diet', 'exercise', 'foot_care', 'eye_care', 'kidney', 'hypertension',
    'sick_day_rules', 'emergency', 'clinic_info', 'general',
  ]),
  tags: z.array(z.string().max(40)).max(20).default([]),
  sourceCitation: z.string().max(500).optional(),
});

/**
 * Which passages a doctor reads: the shared corpus and their practice's own.
 *
 * ---- Why a practice and not a role ---------------------------------------
 *
 * `requireDoctor` was the whole guard, and every passage was created with no
 * practice because nothing set one. No practice means *shared* — `rag.js`
 * serves it to every practice's assistant. So any doctor on the platform could
 * write a passage, approve it themselves and have every practice's assistant
 * cite it to patients, and could rewrite or retire the passages all of them
 * depend on.
 *
 * Now a practice reads the shared passages and its own, and changes only its
 * own. Shared passages are the platform's clinical content; the seed changes
 * them, and a practice does not.
 */
async function readableKnowledge(req) {
  const mine = await practiceOf(req);
  return mine ? { $or: [{ practice: null }, { practice: mine }] } : { practice: null };
}

/** The filter for one passage this doctor's practice wrote — never a shared one. */
async function ownKnowledge(req) {
  const mine = await practiceOf(req);
  // With no practice, nothing is theirs. `{ practice: mine }` with `mine` null
  // would select the shared corpus: exactly the rows this exists to protect.
  if (!mine) throw notFound('Knowledge entry not found');
  return { _id: req.params.id, practice: mine };
}

router.get(
  '/knowledge',
  // The knowledge base is what the assistant answers patients from.
  // Editing it changes clinical advice given at scale, unattended.
  requireDoctor,
  validate({
    query: pageParams.and(
      z.object({
        status: z.enum(['draft', 'pending_review', 'approved', 'retired']).optional(),
        category: z.string().optional(),
        language: z.enum(['en', 'bn', 'hi']).optional(),
      }),
    ),
  }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, status, category, language } = q(req);
    const filter = {
      ...(status ? { status } : {}),
      ...(category ? { category } : {}),
      ...(language ? { language } : {}),
      ...(await readableKnowledge(req)),
    };
    const [items, total] = await Promise.all([
      KnowledgeChunk.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      KnowledgeChunk.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseChunk), { page, limit, total }));
  }),
);

router.post(
  '/knowledge',
  // The knowledge base is what the assistant answers patients from. Editing it
  // changes clinical advice given at scale, unattended — see the note above
  // the desk-privilege sweep. Same false pass as /settings: the guard landed
  // on the GET.
  requireDoctor,
  audit('create', 'KnowledgeChunk'),
  validate({ body: knowledgeSchema }),
  asyncHandler(async (req, res) => {
    // Stamped with the practice, or it is shared and served to every practice's
    // assistant. See `readableKnowledge`.
    const practice = await practiceOf(req);
    if (!practice) throw forbidden('Knowledge can only be written from within a practice.');
    const chunk = await KnowledgeChunk.create({ ...req.body, practice, status: 'pending_review' });
    // Embed in the background — the doctor should not wait on the API, and the
    // chunk is not retrievable until approved anyway.
    embedChunk(chunk._id, req.body.content, req.body.title).catch((err) =>
      logger.error({ err: err?.message }, 'knowledge embedding failed'),
    );
    res.status(201).json({ chunk: serialiseChunk(chunk) });
  }),
);

router.patch(
  '/knowledge/:id',
  // See POST /knowledge.
  requireDoctor,
  audit('update', 'KnowledgeChunk'),
  validate({ body: knowledgeSchema.partial() }),
  asyncHandler(async (req, res) => {
    const chunk = await KnowledgeChunk.findOne(await ownKnowledge(req));
    if (!chunk) throw notFound('Knowledge entry not found');

    const contentChanged = req.body.content && req.body.content !== chunk.content;
    Object.assign(chunk, req.body);
    if (contentChanged) {
      // Edited content must be re-approved — otherwise a chunk approved as safe
      // could be silently rewritten and still serve patients.
      chunk.status = 'pending_review';
      chunk.version += 1;
      chunk.approvedBy = undefined;
      chunk.approvedAt = undefined;
    }
    await chunk.save();

    if (contentChanged) {
      embedChunk(chunk._id, chunk.content, chunk.title).catch(() => {});
    }
    res.json({ chunk: serialiseChunk(chunk) });
  }),
);

router.post(
  '/knowledge/:id/approve',
  // Approval is the step that puts a passage in front of patients.
  requireDoctor,
  requireClinician,
  audit('update', 'KnowledgeChunk'),
  asyncHandler(async (req, res) => {
    const chunk = await KnowledgeChunk.findOne(await ownKnowledge(req)).select('+embedding');
    if (!chunk) throw notFound('Knowledge entry not found');

    // Refuse to approve something that cannot actually be retrieved.
    if (!chunk.embedding?.length) {
      await embedChunk(chunk._id, chunk.content, chunk.title);
    }

    chunk.status = 'approved';
    chunk.approvedBy = req.user._id;
    chunk.approvedAt = new Date();
    await chunk.save();

    res.json({ chunk: serialiseChunk(chunk) });
  }),
);

router.post(
  '/knowledge/:id/retire',
  // See POST /knowledge.
  requireDoctor,
  audit('update', 'KnowledgeChunk'),
  asyncHandler(async (req, res) => {
    const chunk = await KnowledgeChunk.findOneAndUpdate(
      await ownKnowledge(req),
      { status: 'retired' },
      { new: true },
    );
    if (!chunk) throw notFound('Knowledge entry not found');
    res.json({ chunk: serialiseChunk(chunk) });
  }),
);

async function embedChunk(id, content, title) {
  const vector = await embed(content, { taskType: 'RETRIEVAL_DOCUMENT', title });
  await KnowledgeChunk.updateOne(
    { _id: id },
    { embedding: vector, embeddingModel: process.env.GEMINI_EMBED_MODEL, embeddedAt: new Date() },
  );
}

// ---------------------------------------------------------------------------

/**
 * One alert, with enough of the patient attached to act on it.
 *
 * [profile] is optional and supplied by the list route, which loads the whole
 * page's profiles in one query. Without it the alert still serialises — the
 * single-alert routes have no profile to hand — it simply carries no address.
 */
function serialiseAlert(a, profile) {
  const patient = a.patient && typeof a.patient === 'object' && a.patient.name ? a.patient : null;
  return {
    id: a._id,
    patientId: patient?._id ?? a.patient,
    patientName: patient?.name ?? null,
    patientPhone: patient?.phone ?? null,
    // So the doctor recognises who this is about before reading the title.
    patientAvatarUrl: patient?.avatarAssetId
      ? `/api/v1/uploads/${patient.avatarAssetId}/raw`
      : null,
    patientGender: patient?.gender ?? null,
    patientAge: patient?.dateOfBirth
      ? dayjs().diff(dayjs(patient.dateOfBirth), 'year')
      : null,
    patientAddress: profile?.address ?? null,
    patientRiskBand: profile?.riskBand ?? null,
    severity: a.severity,
    type: a.type,
    title: a.title,
    detail: a.detail ?? null,
    status: a.status,
    matchedRules: a.matchedRules ?? [],
    source: a.source,
    acknowledgedAt: a.acknowledgedAt ?? null,
    resolvedAt: a.resolvedAt ?? null,
    resolutionNotes: a.resolutionNotes ?? null,
    createdAt: a.createdAt,
  };
}

const serialiseChunk = (c) => ({
  id: c._id,
  docId: c.docId,
  title: c.title,
  section: c.section ?? null,
  content: c.content,
  language: c.language,
  category: c.category,
  tags: c.tags ?? [],
  status: c.status,
  version: c.version,
  hasEmbedding: Boolean(c.embeddedAt),
  // The platform's shared content, which a practice reads and cannot change.
  // The app hides the controls the server would refuse.
  isShared: c.practice == null,
  sourceCitation: c.sourceCitation ?? null,
  approvedAt: c.approvedAt ?? null,
  updatedAt: c.updatedAt,
});

// ---------------------------------------------------------------------------
// Dietician assignment
// ---------------------------------------------------------------------------

/**
 * Dieticians the doctor can assign a patient to.
 *
 * Scoped, and it was not. This read was `{ role: DIETICIAN, isActive: true }`
 * with nothing else in it — every dietician on the platform, by name and phone
 * number, to any doctor who asked. A practice created minutes earlier, with no
 * patients and no staff of its own, opened this screen onto somebody else's
 * dietician.
 */
router.get(
  '/dieticians',
  // Creating a clinical account outright.
  requireDoctor,
  asyncHandler(async (req, res) => {
    const scope = await practiceMembers(req, ROLES.DIETICIAN);
    const items = await User.find({ role: ROLES.DIETICIAN, isActive: true, ...scope })
      .select('name phone avatarAssetId')
      .sort({ name: 1 })
      .lean();
    res.json({
      items: items.map((d) => ({
        id: String(d._id),
        name: d.name,
        phone: d.phone,
        avatarAssetId: d.avatarAssetId ? String(d.avatarAssetId) : null,
        // Every other avatar in the app is consumed as a ready URL. Sending
        // only the asset id here meant the doctor's list could never draw the
        // dietician's own photo, however recently they had changed it.
        avatarUrl: d.avatarAssetId ? `/api/v1/uploads/${d.avatarAssetId}/raw` : null,
      })),
    });
  }),
);

/**
 * Clinic-wide settings. Read by the doctor's Dieticians screen.
 *
 * The review cadence lives here rather than on each patient for the same reason
 * dietician assignment does not: one or two dieticians and hundreds of
 * patients. Set once, it covers everyone.
 */
router.get(
  '/settings',
  // Clinic-wide configuration.
  requireDoctor,
  asyncHandler(async (req, res) => {
    const settings = await getClinicSettings();
    res.json({ dietReviewIntervalDays: settings.dietReviewIntervalDays });
  }),
);

router.patch(
  '/settings',
  // Clinic-wide configuration, changed by the doctor and nobody else.
  //
  // Missing until now. The privilege sweep added it to the GET of the same
  // name, and the test matched that one and reported this as guarded.
  requireDoctor,
  validate({
    body: z.object({
      dietReviewIntervalDays: z.coerce.number().int().min(1).max(90).optional(),
    }),
  }),
  audit('update', 'ClinicSettings'),
  asyncHandler(async (req, res) => {
    const update = {};
    if (req.body.dietReviewIntervalDays != null) {
      update.dietReviewIntervalDays = req.body.dietReviewIntervalDays;
    }

    const settings = await ClinicSettings.findOneAndUpdate(
      { key: 'clinic' },
      { $set: update, $setOnInsert: { key: 'clinic' } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    ).lean();

    res.json({ dietReviewIntervalDays: settings.dietReviewIntervalDays });
  }),
);





/**
 * Assign (or clear) a patient's dietician and how often the food log should be
 * reviewed. `dieticianId: null` unassigns; `reviewIntervalDays: null` clears the
 * cadence.
 */
router.patch(
  '/patients/:id/dietician',
  // Who provides a patient's nutrition care, and — when a clinic has more
  // than one — which dietician may see them at all. That is a clinical
  // decision and an access-control one, and the desk was making both.
  requireDoctor,
  validate({
    body: z.object({
      dieticianId: z.string().nullable().optional(),
      reviewIntervalDays: z.number().int().min(1).max(30).nullable().optional(),
    }),
  }),
  audit('update', 'PatientProfile'),
  asyncHandler(async (req, res) => {
    // Reassigning somebody else's patient to a dietician is a write, and it was
    // reachable by any signed-in clinician who knew an id. Guarded before
    // anything is read or changed.
    await assertSamePractice(req, req.params.id);
    await enrollmentGate(req, req.params.id);

    const { dieticianId, reviewIntervalDays } = req.body;
    const update = {};
    /// Set when this request puts the patient on a dietician's list, so the
    /// push goes out only on a real assignment — not when the doctor is merely
    /// changing the review interval on a patient they already look after.
    let newlyAssignedTo = null;

    if (dieticianId !== undefined) {
      if (dieticianId) {
        /*
         * One of this practice's dieticians. The patient is checked above and
         * the dietician was not — and the dietician routes trust the
         * assignment, so naming another practice's dietician here handed them
         * this patient's record. `$and`: the member filter is keyed on `_id`.
         */
        const d = await User.findOne({
          $and: [
            { _id: dieticianId, role: ROLES.DIETICIAN, isActive: true },
            await practiceMembers(req, ROLES.DIETICIAN),
          ],
        })
          .select('_id')
          .lean();
        if (!d) throw notFound('Dietician not found');
        update.assignedDietician = d._id;
        newlyAssignedTo = d._id;
      } else {
        update.assignedDietician = null;
      }
    }
    if (reviewIntervalDays !== undefined) update.dietReviewIntervalDays = reviewIntervalDays;

    const profile = await PatientProfile.findOneAndUpdate({ user: req.params.id }, { $set: update }, { new: true })
      .populate('assignedDietician', 'name phone')
      .lean();
    if (!profile) throw notFound('Patient not found');

    if (newlyAssignedTo) {
      const patient = await User.findById(req.params.id).select('name').lean();
      // Fire-and-forget: the assignment is already saved, and a push that
      // fails must not fail the doctor's request.
      notifyDieticianOfAssignment(newlyAssignedTo, patient?.name ?? 'A patient').catch(() => {});
    }

    res.json({
      assignedDietician: profile.assignedDietician
        ? { id: String(profile.assignedDietician._id), name: profile.assignedDietician.name, phone: profile.assignedDietician.phone }
        : null,
      reviewIntervalDays: profile.dietReviewIntervalDays ?? null,
    });
  }),
);

export default router;
