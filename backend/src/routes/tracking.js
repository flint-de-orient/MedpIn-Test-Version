import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { GlucoseReading, GLUCOSE_CONTEXTS } from '../models/GlucoseReading.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { LifestyleLog, LIFESTYLE_KINDS } from '../models/LifestyleLog.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { classifyGlucose, classifyBloodPressure } from '../services/triage/engine.js';
import { raiseAlert } from '../services/alerts.js';
import { glucoseTrends, recomputePatientRisk } from '../services/analytics.js';
import { paged, pageParams, dateRange } from '../utils/pagination.js';
import { logger } from '../config/logger.js';
import { recordWindow } from '../middleware/authorise.js';
import { attachableAssetId } from '../services/mediaAccess.js';

// mergeParams so :patientId from the parent mount is visible here.
const router = Router({ mergeParams: true });

router.use(requireAuth, resolvePatientScope);

async function targetsFor(patientId) {
  const profile = await PatientProfile.findOne({ user: patientId }).select('targets').lean();
  return profile?.targets ?? {};
}

// ---------------------------------------------------------------------------
// Glucose
// ---------------------------------------------------------------------------

router.post(
  '/glucose',
  validate({
    body: z.object({
      valueMgDl: z.number().min(10).max(900),
      context: z.enum(GLUCOSE_CONTEXTS).default('random'),
      measuredAt: z.coerce.date().default(() => new Date()),
      source: z.enum(['manual', 'cgm', 'clinic']).default('manual'),
      notes: z.string().max(500).optional(),
    }),
  }),
  audit('create', 'GlucoseReading'),
  asyncHandler(async (req, res) => {
    const targets = await targetsFor(req.patientId);
    const assessment = classifyGlucose(req.body.valueMgDl, req.body.context, targets);

    const reading = await GlucoseReading.create({
      ...req.body,
      patient: req.patientId,
      flag: assessment.flag,
    });

    // A dangerous reading escalates the moment it is recorded — the patient
    // does not have to also open the chat for the clinic to find out.
    let alert = null;
    if (assessment.urgency === 'emergency' || assessment.urgency === 'urgent') {
      alert = await raiseAlert({
        patientId: req.patientId,
        severity: assessment.urgency === 'emergency' ? 'emergency' : 'urgent',
        type: assessment.alertType ?? 'abnormal_trend',
        title: assessment.summary,
        detail: `Recorded ${req.body.valueMgDl} mg/dL (${req.body.context}) at ${dayjs(reading.measuredAt).format('DD MMM YYYY, h:mm A')}.`,
        source: { kind: 'glucose', ref: reading._id },
        matchedRules: [assessment.rule],
      });
      reading.triggeredAlert = alert._id;
      await reading.save();
    }

    recomputePatientRisk(req.patientId).catch((err) => logger.error({ err }, 'risk recompute failed'));

    res.status(201).json({
      reading: serialiseGlucose(reading),
      assessment: {
        flag: assessment.flag,
        urgency: assessment.urgency,
        summary: assessment.summary,
      },
      alert: alert ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title } : null,
    });
  }),
);

router.get(
  '/glucose',
  validate({ query: pageParams.and(z.object({ context: z.enum(GLUCOSE_CONTEXTS).optional() })) }),
  audit('read', 'GlucoseReading'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, from, to, context } = q(req);
    const filter = {
      patient: req.patientId,
      ...recordWindow(req, 'measuredAt'),
      ...dateRange('measuredAt', { from, to }),
      ...(context ? { context } : {}),
    };
    const [items, total] = await Promise.all([
      GlucoseReading.find(filter).sort({ measuredAt: -1 }).skip(skip).limit(limit).lean(),
      GlucoseReading.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseGlucose), { page, limit, total }));
  }),
);

router.get(
  '/glucose/trends',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  asyncHandler(async (req, res) => {
    res.json(await glucoseTrends(req.patientId, { days: q(req).days }));
  }),
);

router.delete(
  '/glucose/:id',
  audit('update', 'GlucoseReading'),
  asyncHandler(async (req, res) => {
    const deleted = await GlucoseReading.findOneAndDelete({ _id: req.params.id, patient: req.patientId });
    if (!deleted) throw notFound('Reading not found');
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------
// HbA1c
// ---------------------------------------------------------------------------

router.post(
  '/hba1c',
  validate({
    body: z.object({
      percentage: z.number().min(3).max(20),
      testedOn: z.coerce.date(),
      labName: z.string().max(160).optional(),
      notes: z.string().max(500).optional(),
      reportFile: z.string().optional(),
    }),
  }),
  audit('create', 'Hba1cRecord'),
  asyncHandler(async (req, res) => {
    // The report behind the number has to be this patient's.
    req.body.reportFile = await attachableAssetId(req.body.reportFile, {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const record = await Hba1cRecord.create({ ...req.body, patient: req.patientId });
    recomputePatientRisk(req.patientId).catch(() => {});
    res.status(201).json({ record: serialiseHba1c(record) });
  }),
);

router.get(
  '/hba1c',
  validate({ query: pageParams }),
  audit('read', 'Hba1cRecord'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.patientId, ...recordWindow(req, 'testedOn') };
    const [items, total] = await Promise.all([
      Hba1cRecord.find(filter).sort({ testedOn: -1 }).skip(skip).limit(limit),
      Hba1cRecord.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseHba1c), { page, limit, total }));
  }),
);

// ---------------------------------------------------------------------------
// Vitals
// ---------------------------------------------------------------------------

router.post(
  '/vitals',
  validate({
    body: z
      .object({
        systolic: z.number().min(50).max(300).optional(),
        diastolic: z.number().min(30).max(200).optional(),
        pulse: z.number().min(25).max(250).optional(),
        weightKg: z.number().min(10).max(400).optional(),
        waistCm: z.number().min(30).max(250).optional(),
        spo2: z.number().min(50).max(100).optional(),
        temperatureC: z.number().min(30).max(45).optional(),
        recordedAt: z.coerce.date().default(() => new Date()),
        notes: z.string().max(500).optional(),
      })
      // Blood pressure is meaningless as half a reading.
      .refine((v) => (v.systolic == null) === (v.diastolic == null), {
        message: 'Systolic and diastolic must be provided together',
        path: ['diastolic'],
      })
      .refine((v) => Object.keys(v).some((k) => !['recordedAt', 'notes'].includes(k)), {
        message: 'At least one measurement is required',
      }),
  }),
  audit('create', 'VitalRecord'),
  asyncHandler(async (req, res) => {
    const assessment = classifyBloodPressure(req.body.systolic, req.body.diastolic);

    const record = await VitalRecord.create({
      ...req.body,
      patient: req.patientId,
      flag: assessment?.flag,
    });

    let alert = null;
    if (assessment && (assessment.urgency === 'emergency' || assessment.urgency === 'urgent')) {
      alert = await raiseAlert({
        patientId: req.patientId,
        severity: assessment.urgency === 'emergency' ? 'emergency' : 'urgent',
        type: assessment.alertType ?? 'other',
        title: assessment.summary,
        detail: `Recorded at ${dayjs(record.recordedAt).format('DD MMM YYYY, h:mm A')}.`,
        source: { kind: 'vital', ref: record._id },
        matchedRules: [assessment.rule],
      });
    }

    recomputePatientRisk(req.patientId).catch(() => {});

    res.status(201).json({
      record: serialiseVital(record),
      assessment: assessment
        ? { flag: assessment.flag, urgency: assessment.urgency, summary: assessment.summary }
        : null,
      alert: alert ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title } : null,
    });
  }),
);

router.get(
  '/vitals',
  validate({ query: pageParams }),
  audit('read', 'VitalRecord'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, from, to } = q(req);
    const filter = {
      patient: req.patientId,
      ...recordWindow(req, 'recordedAt'),
      ...dateRange('recordedAt', { from, to }),
    };
    const [items, total] = await Promise.all([
      VitalRecord.find(filter).sort({ recordedAt: -1 }).skip(skip).limit(limit).lean(),
      VitalRecord.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseVital), { page, limit, total }));
  }),
);

router.get(
  '/vitals/weight-trend',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(730).default(90) }) }),
  asyncHandler(async (req, res) => {
    const since = dayjs().subtract(q(req).days, 'day').toDate();
    const [records, profile] = await Promise.all([
      VitalRecord.find({
        patient: req.patientId,
        ...recordWindow(req, 'recordedAt'),
        recordedAt: { $gte: since },
        weightKg: { $ne: null },
      })
        .sort({ recordedAt: 1 })
        .select('weightKg recordedAt')
        .lean(),
      PatientProfile.findOne({ user: req.patientId }).select('heightCm').lean(),
    ]);

    const h = profile?.heightCm ? profile.heightCm / 100 : null;
    res.json({
      days: q(req).days,
      series: records.map((r) => ({
        at: r.recordedAt,
        weightKg: r.weightKg,
        bmi: h ? Number((r.weightKg / (h * h)).toFixed(1)) : null,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Lifestyle: diet / exercise / water / sleep
// ---------------------------------------------------------------------------

const lifestyleSchema = z
  .object({
    kind: z.enum(LIFESTYLE_KINDS),
    loggedAt: z.coerce.date().default(() => new Date()),
    notes: z.string().max(500).optional(),

    mealType: z.enum(['breakfast', 'lunch', 'dinner', 'snack']).optional(),
    foodItems: z
      .array(
        z.object({
          name: z.string().max(160),
          quantity: z.string().max(60).optional(),
          carbsGrams: z.number().min(0).max(1000).optional(),
          calories: z.number().min(0).max(5000).optional(),
        }),
      )
      .max(30)
      .optional(),

    activityType: z
      .enum(['walking', 'running', 'cycling', 'yoga', 'gym', 'swimming', 'household', 'other'])
      .optional(),
    durationMinutes: z.number().min(0).max(1440).optional(),
    intensity: z.enum(['light', 'moderate', 'vigorous']).optional(),
    steps: z.number().min(0).max(200000).optional(),
    caloriesBurned: z.number().min(0).max(10000).optional(),

    volumeMl: z.number().min(0).max(10000).optional(),

    sleepHours: z.number().min(0).max(24).optional(),
    sleepQuality: z.enum(['poor', 'fair', 'good']).optional(),
  })
  .superRefine((v, ctx) => {
    const required = { meal: 'foodItems', exercise: 'durationMinutes', water: 'volumeMl', sleep: 'sleepHours' }[v.kind];
    if (v[required] == null || (Array.isArray(v[required]) && v[required].length === 0)) {
      ctx.addIssue({ code: 'custom', path: [required], message: `${required} is required for kind "${v.kind}"` });
    }
  });

router.post(
  '/lifestyle',
  validate({ body: lifestyleSchema }),
  audit('create', 'LifestyleLog'),
  asyncHandler(async (req, res) => {
    const body = { ...req.body, patient: req.patientId };

    if (body.kind === 'meal' && body.foodItems?.length) {
      body.totalCarbsGrams = body.foodItems.reduce((s, f) => s + (f.carbsGrams ?? 0), 0);
      body.totalCalories = body.foodItems.reduce((s, f) => s + (f.calories ?? 0), 0);
    }

    const log = await LifestyleLog.create(body);
    res.status(201).json({ log: serialiseLifestyle(log) });
  }),
);

router.get(
  '/lifestyle',
  validate({ query: pageParams.and(z.object({ kind: z.enum(LIFESTYLE_KINDS).optional() })) }),
  audit('read', 'LifestyleLog'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, from, to, kind } = q(req);
    const filter = {
      patient: req.patientId,
      ...recordWindow(req, 'loggedAt'),
      ...dateRange('loggedAt', { from, to }),
      ...(kind ? { kind } : {}),
    };
    const [items, total] = await Promise.all([
      LifestyleLog.find(filter).sort({ loggedAt: -1 }).skip(skip).limit(limit).lean(),
      LifestyleLog.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseLifestyle), { page, limit, total }));
  }),
);

router.get(
  '/lifestyle/summary',
  validate({ query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }),
  asyncHandler(async (req, res) => {
    const day = q(req).date ? dayjs(q(req).date) : dayjs();
    const [logs, profile] = await Promise.all([
      LifestyleLog.find({
        patient: req.patientId,
        ...recordWindow(req, 'loggedAt'),
        loggedAt: { $gte: day.startOf('day').toDate(), $lte: day.endOf('day').toDate() },
      }).lean(),
      PatientProfile.findOne({ user: req.patientId }).select('targets').lean(),
    ]);

    const of = (kind) => logs.filter((l) => l.kind === kind);
    const waterMl = of('water').reduce((s, l) => s + (l.volumeMl ?? 0), 0);
    const goalMl = profile?.targets?.dailyWaterMl ?? 2500;
    const exercise = of('exercise');
    const meals = of('meal');

    res.json({
      date: day.format('YYYY-MM-DD'),
      water: { totalMl: waterMl, goalMl, percent: Math.min(100, Math.round((waterMl / goalMl) * 100)) },
      exercise: {
        totalMinutes: exercise.reduce((s, l) => s + (l.durationMinutes ?? 0), 0),
        sessions: exercise.length,
        steps: exercise.reduce((s, l) => s + (l.steps ?? 0), 0),
      },
      meals: {
        count: meals.length,
        totalCarbsGrams: meals.reduce((s, l) => s + (l.totalCarbsGrams ?? 0), 0),
        totalCalories: meals.reduce((s, l) => s + (l.totalCalories ?? 0), 0),
      },
      sleep: { hours: of('sleep').reduce((s, l) => s + (l.sleepHours ?? 0), 0) || null },
    });
  }),
);

router.delete(
  '/lifestyle/:id',
  asyncHandler(async (req, res) => {
    const deleted = await LifestyleLog.findOneAndDelete({ _id: req.params.id, patient: req.patientId });
    if (!deleted) throw notFound('Entry not found');
    res.status(204).end();
  }),
);

// ---------------------------------------------------------------------------

const serialiseGlucose = (r) => ({
  id: r._id,
  valueMgDl: r.valueMgDl,
  context: r.context,
  measuredAt: r.measuredAt,
  source: r.source,
  flag: r.flag,
  notes: r.notes ?? null,
});

const serialiseHba1c = (r) => ({
  id: r._id,
  percentage: r.percentage,
  testedOn: r.testedOn,
  labName: r.labName ?? null,
  estimatedAverageGlucose: Math.round(28.7 * r.percentage - 46.7),
  notes: r.notes ?? null,
});

const serialiseVital = (r) => ({
  id: r._id,
  systolic: r.systolic ?? null,
  diastolic: r.diastolic ?? null,
  pulse: r.pulse ?? null,
  weightKg: r.weightKg ?? null,
  spo2: r.spo2 ?? null,
  temperatureC: r.temperatureC ?? null,
  recordedAt: r.recordedAt,
  flag: r.flag ?? null,
});

const serialiseLifestyle = (l) => ({
  id: l._id,
  kind: l.kind,
  loggedAt: l.loggedAt,
  mealType: l.mealType ?? null,
  foodItems: l.foodItems ?? [],
  totalCarbsGrams: l.totalCarbsGrams ?? null,
  totalCalories: l.totalCalories ?? null,
  activityType: l.activityType ?? null,
  durationMinutes: l.durationMinutes ?? null,
  intensity: l.intensity ?? null,
  steps: l.steps ?? null,
  volumeMl: l.volumeMl ?? null,
  sleepHours: l.sleepHours ?? null,
  notes: l.notes ?? null,
});

export default router;
