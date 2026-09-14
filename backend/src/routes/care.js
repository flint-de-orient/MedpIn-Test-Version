import { Router } from 'express';
import dayjs from 'dayjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { FootAssessment, FOOT_SITES } from '../models/FootAssessment.js';
import { EyeReport, DR_GRADES } from '../models/EyeReport.js';
import { LabReport } from '../models/LabReport.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { KnowledgeChunk } from '../models/KnowledgeChunk.js';
import { classifyFootSymptoms } from '../services/triage/engine.js';
import { assessFootImages, explainEyeReport } from '../services/ai/vision.js';
import { loadAssetsForAi } from './uploads.js';
import { buildPatientContext } from '../services/patientContext.js';
import { raiseAlert } from '../services/alerts.js';
import { recomputePatientRisk } from '../services/analytics.js';
import { paged, pageParams } from '../utils/pagination.js';
import { recordWindow } from '../middleware/authorise.js';
import { requireCapability } from '../middleware/requireCapability.js';
import { CAPABILITIES } from '../services/capabilities.js';
import { practiceForPatient, practicesOfPatient, practiceOf } from '../middleware/practiceScope.js';
import { attachableAssetIds } from '../services/mediaAccess.js';
import { ROLES } from '../models/User.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolvePatientScope);

const RISK_ORDER = ['low', 'moderate', 'high', 'urgent'];
const higherRisk = (a, b) => (RISK_ORDER.indexOf(a ?? 'low') >= RISK_ORDER.indexOf(b ?? 'low') ? a : b);

/** Screening cadence by risk — the follow-up the patient is reminded about. */
const FOLLOW_UP_DAYS = { urgent: 1, high: 3, moderate: 14, low: 90 };

// ---------------------------------------------------------------------------
// Diabetic foot
// ---------------------------------------------------------------------------

router.post(
  '/foot/assessments',
  validate({
    body: z.object({
      site: z.enum(FOOT_SITES),
      images: z.array(z.string()).max(5).default([]),
      woundKey: z.string().optional(),
      assessedAt: z.coerce.date().default(() => new Date()),
      symptoms: z
        .object({
          pain: z.enum(['none', 'mild', 'moderate', 'severe']).default('none'),
          numbness: z.boolean().default(false),
          discharge: z.boolean().default(false),
          foulSmell: z.boolean().default(false),
          swelling: z.boolean().default(false),
          blackTissue: z.boolean().default(false),
          fever: z.boolean().default(false),
          durationDays: z.number().min(0).max(3650).optional(),
        })
        .default({}),
    }),
  }),
  audit('create', 'FootAssessment'),
  asyncHandler(async (req, res) => {
    // This patient's photographs, or ones the caller took for them. The model
    // describes whatever it is shown, and the description is filed here.
    req.body.images = await attachableAssetIds(req.body.images, {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const { site, images, symptoms, assessedAt } = req.body;

    // Deterministic rules run first and always.
    const ruleResult = classifyFootSymptoms(symptoms);

    const [aiImages, context] = await Promise.all([
      images.length ? loadAssetsForAi(images) : Promise.resolve([]),
      buildPatientContext(req.patientId),
    ]);

    const aiAssessment = aiImages.length
      ? await assessFootImages({
          images: aiImages,
          symptoms,
          language: req.user.language ?? 'en',
          patientContext: context.text,
          practiceId: await practiceForPatient(req.patientId),
        })
      : null;

    // The higher of the two wins. A model that says "low" cannot override a
    // rule that says "urgent".
    const finalRiskLevel = higherRisk(ruleResult.riskLevel, aiAssessment?.riskLevel);

    const assessment = await FootAssessment.create({
      patient: req.patientId,
      // Reuse the wound key when tracking the same wound over time.
      woundKey: req.body.woundKey ?? crypto.randomUUID(),
      site,
      images,
      assessedAt,
      symptoms,
      aiAssessment: aiAssessment ?? undefined,
      ruleRiskLevel: ruleResult.riskLevel,
      finalRiskLevel,
      followUpDueOn: dayjs(assessedAt).add(FOLLOW_UP_DAYS[finalRiskLevel] ?? 30, 'day').toDate(),
    });

    let alert = null;
    if (finalRiskLevel === 'urgent' || finalRiskLevel === 'high') {
      alert = await raiseAlert({
        patientId: req.patientId,
        severity: finalRiskLevel === 'urgent' ? 'emergency' : 'urgent',
        type: 'foot_infection',
        title: `Diabetic foot assessment: ${finalRiskLevel} risk (${site.replace('_', ' ')})`,
        detail: [
          `Rule-based risk: ${ruleResult.riskLevel} (${ruleResult.matchedRules.join(', ') || 'no rules fired'})`,
          aiAssessment ? `AI risk: ${aiAssessment.riskLevel} (confidence ${aiAssessment.confidence})` : 'No image assessment',
          aiAssessment?.observations ? `Observations: ${aiAssessment.observations}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        source: { kind: 'foot', ref: assessment._id },
        matchedRules: ruleResult.matchedRules,
      });
      assessment.alert = alert._id;
      await assessment.save();
    }

    await PatientProfile.updateOne(
      { user: req.patientId },
      { footRiskCategory: finalRiskLevel, lastFootScreeningAt: assessedAt },
    );
    recomputePatientRisk(req.patientId).catch(() => {});

    res.status(201).json({
      assessment: serialiseFoot(assessment),
      alert: alert ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title } : null,
    });
  }),
);

router.get(
  '/foot/assessments',
  validate({ query: pageParams }),
  audit('read', 'FootAssessment'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.patientId, ...recordWindow(req, 'assessedAt') };
    const [items, total] = await Promise.all([
      FootAssessment.find(filter).sort({ assessedAt: -1 }).skip(skip).limit(limit).lean(),
      FootAssessment.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseFoot), { page, limit, total }));
  }),
);

router.get(
  '/foot/assessments/:id',
  audit('read', 'FootAssessment'),
  asyncHandler(async (req, res) => {
    const a = await FootAssessment.findOne({
      _id: req.params.id,
      patient: req.patientId,
      ...recordWindow(req, 'assessedAt'),
    }).lean();
    if (!a) throw notFound('Assessment not found');
    res.json({ assessment: serialiseFoot(a) });
  }),
);

/** Wound progression over time — the "is this healing?" view. */
router.get(
  '/foot/wounds/:woundKey/progression',
  audit('read', 'FootAssessment'),
  asyncHandler(async (req, res) => {
    const items = await FootAssessment.find({
      patient: req.patientId,
      ...recordWindow(req, 'assessedAt'),
      woundKey: req.params.woundKey,
    })
      .sort({ assessedAt: 1 })
      .lean();
    if (!items.length) throw notFound('No assessments found for this wound');

    const first = items[0];
    const latest = items[items.length - 1];
    const direction =
      RISK_ORDER.indexOf(latest.finalRiskLevel) < RISK_ORDER.indexOf(first.finalRiskLevel)
        ? 'improving'
        : RISK_ORDER.indexOf(latest.finalRiskLevel) > RISK_ORDER.indexOf(first.finalRiskLevel)
          ? 'worsening'
          : 'unchanged';

    res.json({
      woundKey: req.params.woundKey,
      site: first.site,
      firstAssessedAt: first.assessedAt,
      daysOpen: dayjs(latest.assessedAt).diff(dayjs(first.assessedAt), 'day'),
      direction,
      timeline: items.map((a) => ({
        id: a._id,
        assessedAt: a.assessedAt,
        finalRiskLevel: a.finalRiskLevel,
        images: a.images,
        observations: a.aiAssessment?.observations ?? null,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Eye care
// ---------------------------------------------------------------------------

const EYE_FOLLOW_UP_MONTHS = { urgent: 1, soon: 3, routine: 12 };

router.post(
  '/eye/reports',
  validate({
    body: z.object({
      reportDate: z.coerce.date(),
      files: z.array(z.string()).max(5).default([]),
      reportedGrade: z.enum(DR_GRADES).default('unknown'),
      hasMacularOedema: z.boolean().default(false),
      examinedBy: z.string().max(160).optional(),
      rawReportText: z.string().max(20000).optional(),
      visualAcuity: z
        .object({ leftEye: z.string().max(20).optional(), rightEye: z.string().max(20).optional() })
        .optional(),
    }),
  }),
  audit('create', 'EyeReport'),
  asyncHandler(async (req, res) => {
    // This patient's files, or ones the caller uploaded for them. The model
    // explains whatever it is shown and the explanation is filed here.
    req.body.files = await attachableAssetIds(req.body.files, {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const [aiImages, context] = await Promise.all([
      req.body.files.length ? loadAssetsForAi(req.body.files) : Promise.resolve([]),
      buildPatientContext(req.patientId),
    ]);

    const aiExplanation = await explainEyeReport({
      reportText: req.body.rawReportText,
      images: aiImages,
      reportedGrade: req.body.reportedGrade,
      language: req.user.language ?? 'en',
      patientContext: context.text,
      practiceId: await practiceForPatient(req.patientId),
    });

    const urgency = aiExplanation?.referralUrgency ?? 'routine';
    const report = await EyeReport.create({
      ...req.body,
      patient: req.patientId,
      aiExplanation: aiExplanation ?? undefined,
      nextScreeningDueOn: dayjs(req.body.reportDate).add(EYE_FOLLOW_UP_MONTHS[urgency], 'month').toDate(),
    });

    let alert = null;
    if (urgency === 'urgent' || ['severe_npdr', 'pdr'].includes(req.body.reportedGrade)) {
      alert = await raiseAlert({
        patientId: req.patientId,
        severity: 'urgent',
        type: 'other',
        title: `Eye report needs review: ${req.body.reportedGrade.replace(/_/g, ' ')}`,
        detail: aiExplanation?.summary ?? 'Advanced retinopathy recorded — ophthalmology referral may be needed.',
        source: { kind: 'eye', ref: report._id },
      });
    }

    await PatientProfile.updateOne({ user: req.patientId }, { lastEyeScreeningAt: req.body.reportDate });

    res.status(201).json({
      report: serialiseEye(report),
      alert: alert ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title } : null,
    });
  }),
);

router.get(
  '/eye/reports',
  validate({ query: pageParams }),
  audit('read', 'EyeReport'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.patientId, ...recordWindow(req, 'createdAt') };
    const [items, total] = await Promise.all([
      EyeReport.find(filter).sort({ reportDate: -1 }).skip(skip).limit(limit).lean(),
      EyeReport.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseEye), { page, limit, total }));
  }),
);

router.get(
  '/eye/reports/:id',
  audit('read', 'EyeReport'),
  asyncHandler(async (req, res) => {
    const r = await EyeReport.findOne({
      _id: req.params.id,
      patient: req.patientId,
      ...recordWindow(req, 'createdAt'),
    }).lean();
    if (!r) throw notFound('Report not found');
    res.json({ report: serialiseEye(r) });
  }),
);

/** Static patient education, served from the approved knowledge base. */
router.get(
  '/eye/education',
  validate({
    query: z.object({
      language: z.enum(['en', 'bn', 'hi']).optional(),
      topic: z.string().max(60).default('retinopathy'),
    }),
  }),
  asyncHandler(async (req, res) => {
    const language = q(req).language ?? req.user.language ?? 'en';

    /*
     * Shared guidance, and this patient's own practices' — never another's.
     *
     * Read with no practice filter, this served every practice's approved
     * passages, and a practice's passages are its own clinical voice: its
     * clinic hours, its referral arrangements, its wording. A patient reads the
     * practices caring for them; staff read their own practice's.
     */
    const practices =
      req.user.role === ROLES.PATIENT
        ? await practicesOfPatient(req.patientId)
        : [await practiceOf(req)].filter(Boolean);
    const scope = { practice: { $in: [null, ...practices] } };

    let items = await KnowledgeChunk.find({ status: 'approved', category: 'eye_care', language, ...scope })
      .select('title section content sourceCitation')
      .limit(20)
      .lean();

    if (!items.length && language !== 'en') {
      items = await KnowledgeChunk.find({ status: 'approved', category: 'eye_care', language: 'en', ...scope })
        .select('title section content sourceCitation')
        .limit(20)
        .lean();
    }

    res.json({
      language,
      items: items.map((i) => ({
        id: i._id,
        title: i.title,
        section: i.section ?? null,
        content: i.content,
        source: i.sourceCitation ?? null,
      })),
    });
  }),
);

// ---------------------------------------------------------------------------
// Lab reports
// ---------------------------------------------------------------------------

router.post(
  '/labs',
  // Filing a result is the other half of ordering the investigation. A practice
  // whose type or plan does not include labs has no business holding them.
  requireCapability(CAPABILITIES.LAB_ORDER),
  validate({
    body: z.object({
      title: z.string().min(1).max(200),
      labName: z.string().max(160).optional(),
      testedOn: z.coerce.date(),
      files: z.array(z.string()).max(10).default([]),
      values: z
        .array(
          z.object({
            code: z.string().max(60).optional(),
            label: z.string().max(160).optional(),
            value: z.number().optional(),
            textValue: z.string().max(120).optional(),
            unit: z.string().max(40).optional(),
            refLow: z.number().optional(),
            refHigh: z.number().optional(),
          }),
        )
        .max(80)
        .default([]),
    }),
  }),
  audit('create', 'LabReport'),
  asyncHandler(async (req, res) => {
    // This patient's reports, or ones the caller uploaded for them.
    req.body.files = await attachableAssetIds(req.body.files, {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });

    // Flag out-of-range values up front so the UI does not have to.
    const values = req.body.values.map((v) => {
      let flag;
      if (v.value != null && v.refLow != null && v.refHigh != null) {
        flag = v.value < v.refLow ? 'low' : v.value > v.refHigh ? 'high' : 'normal';
      }
      return { ...v, flag };
    });

    const report = await LabReport.create({ ...req.body, values, patient: req.patientId });
    res.status(201).json({ report: serialiseLab(report) });
  }),
);

router.get(
  '/labs',
  /*
   * Reading results is its own capability, separate from ordering them.
   *
   * A diagnostic centre reports labs and never prescribes; a clinic on the
   * cheapest plan orders them. They are two different questions and the
   * resolver has always answered them separately — this route simply never
   * asked, so the paywall was a hidden button and the URL was open.
   */
  requireCapability(CAPABILITIES.LAB_RESULT),
  validate({ query: pageParams }),
  audit('read', 'LabReport'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.patientId, ...recordWindow(req, 'testedOn') };
    const [items, total] = await Promise.all([
      LabReport.find(filter).sort({ testedOn: -1 }).skip(skip).limit(limit).lean(),
      LabReport.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseLab), { page, limit, total }));
  }),
);

router.get(
  '/labs/:id',
  requireCapability(CAPABILITIES.LAB_RESULT),
  audit('read', 'LabReport'),
  asyncHandler(async (req, res) => {
    const r = await LabReport.findOne({
      _id: req.params.id,
      patient: req.patientId,
      ...recordWindow(req, 'testedOn'),
    }).lean();
    if (!r) throw notFound('Report not found');
    res.json({ report: serialiseLab(r) });
  }),
);

// ---------------------------------------------------------------------------

const serialiseFoot = (a) => ({
  id: a._id,
  woundKey: a.woundKey,
  site: a.site,
  images: a.images ?? [],
  assessedAt: a.assessedAt,
  symptoms: a.symptoms,
  ruleRiskLevel: a.ruleRiskLevel,
  finalRiskLevel: a.finalRiskLevel,
  aiAssessment: a.aiAssessment
    ? {
        riskLevel: a.aiAssessment.riskLevel,
        wagnerGradeEstimate: a.aiAssessment.wagnerGradeEstimate ?? null,
        observations: a.aiAssessment.observations,
        recommendations: a.aiAssessment.recommendations,
        confidence: a.aiAssessment.confidence,
      }
    : null,
  clinicianReview: a.clinicianReview?.reviewedAt
    ? {
        riskLevel: a.clinicianReview.riskLevel,
        notes: a.clinicianReview.notes,
        reviewedAt: a.clinicianReview.reviewedAt,
      }
    : null,
  followUpDueOn: a.followUpDueOn ?? null,
});

const serialiseEye = (r) => ({
  id: r._id,
  reportDate: r.reportDate,
  files: r.files ?? [],
  reportedGrade: r.reportedGrade,
  hasMacularOedema: r.hasMacularOedema,
  examinedBy: r.examinedBy ?? null,
  visualAcuity: r.visualAcuity ?? null,
  aiExplanation: r.aiExplanation?.summary
    ? {
        summary: r.aiExplanation.summary,
        whatItMeans: r.aiExplanation.whatItMeans,
        recommendedActions: r.aiExplanation.recommendedActions,
        referralUrgency: r.aiExplanation.referralUrgency,
      }
    : null,
  nextScreeningDueOn: r.nextScreeningDueOn ?? null,
});

const serialiseLab = (r) => ({
  id: r._id,
  title: r.title,
  labName: r.labName ?? null,
  testedOn: r.testedOn,
  files: r.files ?? [],
  values: r.values ?? [],
  aiSummary: r.aiSummary ?? null,
});

export default router;
