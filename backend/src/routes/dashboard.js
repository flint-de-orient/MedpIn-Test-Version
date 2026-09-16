import { Router } from 'express';
import dayjs from 'dayjs';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { requireRecordAccess } from '../middleware/authorise.js';
import { asyncHandler } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { computeHealthScore, computeAdherence, glucoseTrends } from '../services/analytics.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { Appointment } from '../models/Appointment.js';
import { ClinicalAlert } from '../models/ClinicalAlert.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { MedicationLog } from '../models/MedicationLog.js';
import { Medication } from '../models/Medication.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { Prescription } from '../models/Prescription.js';
import { lastGivenPlan } from '../services/dietPlanLookup.js';
import { FoodLog } from '../models/FoodLog.js';
import { getClinicSettings } from '../models/ClinicSettings.js';
import { conditionsFor } from '../services/patientConditions.js';
import { patientsForLogin } from '../services/patientsForLogin.js';

const router = Router({ mergeParams: true });
// Whose patient this is, then what this person may do with them: the patient's own dashboard.
// `resolvePatientScope` answers the first and was, until now, the only thing
// asked — so EDIT_RECORD was granted by every preset and enforced by nothing.
router.use(requireAuth, resolvePatientScope, requireRecordAccess());

/**
 * One call powers the entire home screen. Everything fans out in parallel —
 * the mobile client on a patchy connection should pay one round trip, not ten.
 */
router.get(
  '/',
  audit('read', 'Dashboard'),
  asyncHandler(async (req, res) => {
    const patientId = req.patientId;

    const [healthScore, trends, adherence, latest, nextAppointment, openAlerts, profile, latestHba1c, todayPending] =
      await Promise.all([
        computeHealthScore(patientId, { days: 30 }),
        glucoseTrends(patientId, { days: 7 }),
        computeAdherence(patientId, { days: 30 }),
        GlucoseReading.findOne({ patient: patientId }).sort({ measuredAt: -1 }).lean(),
        // Bookings that are still ahead, and requests that have no time yet.
        //
        // The filter was `scheduledFor: { $gte: now }`, and a request has no
        // scheduledFor at all — so it matched nothing and the patient who
        // asked for an appointment this morning saw "No upcoming appointment"
        // on their own Home screen. From where they sit, the request went
        // nowhere.
        //
        // Sorted so a confirmed booking outranks a pending request: a time you
        // have been given is more use than one you are waiting for.
        Appointment.findOne({
          patient: patientId,
          $or: [
            {
              status: { $in: ['confirmed', 'checked_in'] },
              scheduledFor: { $gte: new Date() },
            },
            { status: 'requested' },
          ],
        })
          .sort({ scheduledFor: 1, preferredFor: 1 })
          .lean(),
        ClinicalAlert.find({ patient: patientId, status: 'open' })
          .sort({ severity: -1, createdAt: -1 })
          .limit(5)
          .lean(),
        PatientProfile.findOne({ user: patientId }).lean(),
        Hba1cRecord.findOne({ patient: patientId }).sort({ testedOn: -1 }).lean(),
        countPendingDosesToday(patientId),
      ]);

    const reminders = {
      footScreeningDue: isDue(profile?.lastFootScreeningAt, profile?.footRiskCategory === 'low' ? 90 : 14),
      eyeScreeningDue: isDue(profile?.lastEyeScreeningAt, 365),
      hba1cDue: isDue(latestHba1c?.testedOn, 90),
    };

    res.json({
      healthScore,
      glucose: {
        latest: latest
          ? { value: latest.valueMgDl, context: latest.context, at: latest.measuredAt, flag: latest.flag }
          : null,
        sevenDayAverage: trends.stats?.average ?? null,
        timeInRangePercent: trends.stats?.timeInRangePercent ?? null,
        sparkline: trends.series.map((s) => ({ at: s.at, value: s.value })),
      },
      adherence: { percentage: adherence.percentage, todayPending },
      nextAppointment: nextAppointment
        ? {
            id: nextAppointment._id,
            scheduledFor: nextAppointment.scheduledFor ?? null,
            // The day asked for, when there is no time yet. The card shows it
            // as "Requested for ..." rather than inventing an hour.
            preferredFor: nextAppointment.preferredFor ?? null,
            mode: nextAppointment.mode,
            status: nextAppointment.status,
          }
        : null,
      openAlerts: openAlerts.map((a) => ({
        id: a._id,
        severity: a.severity,
        type: a.type,
        title: a.title,
        createdAt: a.createdAt,
      })),
      recommendations: buildRecommendations({ healthScore, trends, adherence, reminders, latest }),
      reminders,
      ...(await careSummary(patientId, profile, latestHba1c, req.user?.email ?? null)),

      // Which cards this patient's Home shows, and who else this phone looks
      // after. Folded in here for the same reason careSummary is: the screen
      // renders as one thing, and a patient on a patchy connection should not
      // watch half of it arrive.
      //
      // Both fall back to today's answer when their tables are empty, so this
      // is additive on a deployment that has not migrated.
      ...(await homeShape(patientId, profile, req.user?._id)),
    });
  }),
);

/**
 * What this patient's Home is made of, and whose Home it is.
 *
 * ---- Cards come from conditions -----------------------------------------
 *
 * Diabetes brings the sugar chart and the HbA1c tile; hypertension brings
 * blood pressure; asthma would bring peak flow. No condition brings no cards,
 * which is the honest answer to a screen full of empty sections — a patient
 * with nothing recorded should be asked what to track, not shown four charts
 * with no lines in them.
 *
 * ---- The switcher is a list, and usually of one -------------------------
 *
 * Always sent, never counted here. One patient renders as no switcher at all;
 * three render as a chooser. Only the screen decides which, because the day a
 * grandmother is added the server should not need changing.
 */
async function homeShape(patientId, profile, loginId) {
  const [shape, people] = await Promise.all([
    conditionsFor(patientId, { profile }),
    loginId ? patientsForLogin(loginId) : Promise.resolve([]),
  ]);

  return {
    homeCards: shape.homeCards,
    conditions: shape.conditions,
    // Everyone this login is responsible for, the holder first. A reminder or
    // a card must be able to name its person: "Aarav · Syrup 5ml", never "time
    // for your medicine", on a phone carrying three people's prescriptions.
    people,
  };
}

/**
 * The "what my care looks like" half of the home screen: who I am clinically,
 * what I have been told to eat, what I am taking, and what I have logged.
 *
 * Folded into the dashboard call rather than added as a second endpoint — the
 * screen renders as one thing, and a patient on a patchy connection should not
 * watch half of it arrive.
 */
async function careSummary(patientId, profile, latestHba1c, email) {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [latestWeight, latestBp, upcomingFollowUp, plan, medications, foodLogs, settings] = await Promise.all([
    VitalRecord.findOne({ patient: patientId, weightKg: { $ne: null } })
      .sort({ recordedAt: -1 })
      .select('weightKg')
      .lean(),
    // Latest recorded blood pressure — a meaningful vital for a patient who may
    // also be hypertensive, captured at registration and clinic visits.
    VitalRecord.findOne({ patient: patientId, systolic: { $ne: null } })
      .sort({ recordedAt: -1 })
      .select('systolic diastolic')
      .lean(),
    // The soonest upcoming follow-up the doctor wrote on a prescription — "when
    // is my next visit", which a patient most wants to see on their home screen.
    Prescription.findOne({ patient: patientId, followUpOn: { $gte: startOfToday } })
      .sort({ followUpOn: 1 })
      .select('followUpOn')
      .lean(),
    // Only a plan the dietician actually sent. A draft they are still editing
    // is not something the patient should be following — and if the dietician
    // has just started writing a replacement, this keeps showing the plan the
    // patient is still on rather than emptying their screen mid-rewrite.
    lastGivenPlan(patientId, { populate: 'name' }),
    Medication.find({ patient: patientId, isActive: true })
      .select('name strength dose schedule instructions')
      .lean(),
    FoodLog.find({ patient: patientId }).sort({ createdAt: -1 }).limit(12).populate('photo', 'mimeType').lean(),
    getClinicSettings(),
  ]);

  const weightKg = latestWeight?.weightKg ?? profile?.baselineWeightKg ?? null;
  const heightCm = profile?.heightCm ?? null;
  const bmi =
    weightKg && heightCm ? Number((weightKg / ((heightCm / 100) * (heightCm / 100))).toFixed(1)) : null;

  const hba1cMax = profile?.targets?.hba1cMax ?? 7;

  return {
    profile: {
      diabetesType: profile?.diabetesType ?? null,
      // The clinic's own risk assessment, shown to the patient on their home
      // screen at the clinic's request. Worth noting this is a number the
      // doctor set, not a judgement the app made.
      riskBand: profile?.riskBand ?? null,
      // Contact details, so the patient can see what the clinic will use to
      // reach them — and notice when it is wrong before a report is posted to
      // an old address.
      email: email ?? null,
      address: profile?.address ?? null,
      heightCm,
      weightKg,
      bmi,
      bloodPressure:
        latestBp?.systolic != null
          ? {
              systolic: latestBp.systolic,
              diastolic: latestBp.diastolic ?? null,
              // Against this patient's own targets, not a textbook threshold.
              isHigh:
                latestBp.systolic > (profile?.targets?.systolicMax ?? 140) ||
                (latestBp.diastolic ?? 0) > (profile?.targets?.diastolicMax ?? 90),
            }
          : null,
      allergies: profile?.allergies ?? [],
      reviewIntervalDays: profile?.dietReviewIntervalDays ?? settings.dietReviewIntervalDays,
    },
    // The doctor's next-visit instruction (soonest upcoming prescription
    // follow-up), so "when do I come back?" is answered on the home screen.
    followUpOn: upcomingFollowUp?.followUpOn ?? null,
    latestHba1c: latestHba1c
      ? {
          percentage: latestHba1c.percentage,
          testedOn: latestHba1c.testedOn,
          // Against this patient's own target, not a textbook number — the
          // doctor sets a different ceiling for a frail patient than a young one.
          isHigh: latestHba1c.percentage > hba1cMax,
        }
      : null,
    dietPlan: plan
      ? {
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
          sharedAt: plan.sharedAt,
        }
      : null,
    medications: medications.map((m) => ({
      id: String(m._id),
      name: m.name,
      strength: m.strength ?? '',
      dose: m.dose ?? '',
      instructions: m.instructions ?? '',
      times: (m.schedule ?? []).map((s) => s.time).filter(Boolean),
    })),
    // A food log whose "photo" is not an image is bogus — a voice note or
    // document mis-filed as a meal (the old nutrition-voice bug). Drop those so
    // a broken image never renders, then take the newest 6.
    recentFoodLogs: foodLogs
      .filter((f) => !f.photo || (f.photo.mimeType ?? '').startsWith('image/'))
      .slice(0, 6)
      .map((f) => ({
        id: String(f._id),
        mealType: f.mealType,
        note: f.note ?? '',
        photoUrl: f.photo ? `/api/v1/uploads/${f.photo._id}/raw` : null,
        createdAt: f.createdAt,
      })),
  };
}

function isDue(lastAt, intervalDays) {
  if (!lastAt) return true;
  return dayjs().diff(dayjs(lastAt), 'day') >= intervalDays;
}

async function countPendingDosesToday(patientId) {
  const day = dayjs();
  const meds = await Medication.find({ patient: patientId, isActive: true }).select('schedule daysOfWeek').lean();
  if (!meds.length) return 0;

  const logs = await MedicationLog.find({
    patient: patientId,
    scheduledFor: { $gte: day.startOf('day').toDate(), $lte: day.endOf('day').toDate() },
    status: { $in: ['taken', 'skipped'] },
  })
    .select('scheduledFor medication')
    .lean();

  const done = new Set(logs.map((l) => `${l.medication}|${dayjs(l.scheduledFor).format('HH:mm')}`));

  let pending = 0;
  for (const med of meds) {
    if (med.daysOfWeek?.length && !med.daysOfWeek.includes(day.day())) continue;
    for (const slot of med.schedule ?? []) {
      if (!done.has(`${med._id}|${slot.time}`)) pending += 1;
    }
  }
  return pending;
}

/**
 * Rule-based, not model-generated. The home screen must render instantly and
 * identically every time — an LLM call here would add latency and variance for
 * no clinical benefit.
 */
function buildRecommendations({ healthScore, trends, adherence, reminders, latest }) {
  const recs = [];

  if (adherence.percentage != null && adherence.percentage < 80) {
    recs.push({
      code: 'IMPROVE_ADHERENCE',
      title: 'Take your medicines on time',
      body: `You have taken ${adherence.percentage}% of your doses this month. Setting reminders can help you stay on track.`,
      priority: adherence.percentage < 60 ? 'high' : 'medium',
    });
  }

  if (trends.stats && trends.stats.timeInRangePercent < 50) {
    recs.push({
      code: 'LOW_TIME_IN_RANGE',
      title: 'Your sugar is often above target',
      // "your doctor": these lines are the same for every practice's patients,
      // and they named the founding clinic's doctor to all of them.
      body: `Only ${trends.stats.timeInRangePercent}% of your recent readings were in range. Discuss this with your doctor at your next visit.`,
      priority: 'high',
    });
  }

  if (trends.stats && trends.stats.coefficientOfVariation > 36) {
    recs.push({
      code: 'HIGH_VARIABILITY',
      title: 'Your sugar levels are swinging a lot',
      body: 'Large ups and downs can be as important as the average. Try to keep meal times and medicine times consistent.',
      priority: 'medium',
    });
  }

  if (!latest || dayjs().diff(dayjs(latest.measuredAt), 'day') >= 3) {
    recs.push({
      code: 'LOG_MORE',
      title: 'Record a blood sugar reading',
      body: 'It has been a few days since your last reading. Regular readings help your doctor adjust your treatment.',
      priority: 'medium',
    });
  }

  if (reminders.footScreeningDue) {
    recs.push({
      code: 'FOOT_CHECK_DUE',
      title: 'Check your feet',
      body: 'A foot check is due. Take a photo in the Foot Care section so it can be reviewed.',
      priority: 'medium',
    });
  }

  if (reminders.eyeScreeningDue) {
    recs.push({
      code: 'EYE_CHECK_DUE',
      title: 'Annual eye check is due',
      body: 'Diabetic eye problems can be treated early if found early. Book an eye examination.',
      priority: 'medium',
    });
  }

  if (reminders.hba1cDue) {
    recs.push({
      code: 'HBA1C_DUE',
      title: 'HbA1c test is due',
      body: 'This blood test shows your average sugar over the last three months. It is usually done every 3 months.',
      priority: 'medium',
    });
  }

  if (!recs.length && healthScore.score != null && healthScore.score >= 80) {
    recs.push({
      code: 'DOING_WELL',
      title: 'You are doing well',
      body: 'Your readings and medicine routine look good. Keep it up.',
      priority: 'low',
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return recs.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);
}

export default router;
