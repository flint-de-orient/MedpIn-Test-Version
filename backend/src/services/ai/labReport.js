import path from 'node:path';
import fs from 'node:fs/promises';
import { generateFromImage, AiUnavailableError } from './gemini.js';
import { MediaAsset } from '../../models/MediaAsset.js';
import { Hba1cRecord } from '../../models/Hba1cRecord.js';
import { GlucoseReading } from '../../models/GlucoseReading.js';
import { LabResult } from '../../models/LabResult.js';
import { PatientProfile } from '../../models/PatientProfile.js';
import { classifyGlucose } from '../triage/engine.js';
import { raiseAlert } from '../alerts.js';
import { recomputePatientRisk } from '../analytics.js';
import { env } from '../../config/env.js';
import { clinicIdentity } from '../clinicIdentity.js';
import { logger } from '../../config/logger.js';
import { countAiCall } from './allowance.js';
import { practiceOfPatient } from '../../middleware/practiceScope.js';

/**
 * Reading a lab report and filing what is on it.
 *
 * The patient uploads a photo or a PDF; until now that was all it was — an
 * image sitting in a list. Nobody's HbA1c moved, no risk band changed, and the
 * doctor had to open every report and retype the numbers to make them count.
 *
 * What the model is allowed to do here is narrow on purpose: transcribe values
 * that are printed on the page. It does not interpret them, does not decide
 * urgency, and does not diagnose. Everything downstream — the risk band, the
 * health score, the alerts — is computed by the same deterministic code that
 * has always computed it, from numbers that now arrive automatically instead
 * of by hand. A model that could only mis-read a number cannot mis-rank a
 * patient.
 */

/// Gemini reads PDFs natively as inline data, which matters because most labs
/// email a PDF and photographing that on screen loses half the page.
const READABLE = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);

const LAB_SCHEMA = {
  type: 'object',
  properties: {
    hba1cPercent: { type: 'number' },
    fastingGlucoseMgDl: { type: 'number' },
    postPrandialGlucoseMgDl: { type: 'number' },
    totalCholesterol: { type: 'number' },
    ldl: { type: 'number' },
    hdl: { type: 'number' },
    triglycerides: { type: 'number' },
    creatinine: { type: 'number' },
    testedOn: { type: 'string' },
    abnormal: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
    isLabReport: { type: 'boolean' },
  },
  required: ['isLabReport', 'summary'],
};

// A function, not a const: the module loads once and a practice is per
// request. Built fresh each call so a second clinic's reports are
// transcribed for that clinic.
const buildSystem = (clinicName) => `You transcribe pathology reports for ${clinicName}. You are a reader, not a clinician.

Rules:
1. Report ONLY values printed on the page. Never estimate, never infer a value from another, never fill a gap with a typical figure. A field you cannot read is simply absent.
2. Units matter. Glucose and lipids in mg/dL. If the report is in mmol/L, convert: glucose mmol/L x 18 = mg/dL; cholesterol/LDL/HDL mmol/L x 38.67; triglycerides mmol/L x 88.57. Creatinine in mg/dL.
3. HbA1c is a percentage. If the report gives IFCC mmol/mol instead, convert: (mmol/mol x 0.09148) + 2.152.
4. testedOn is the collection or report date printed on the page, as YYYY-MM-DD. Absent if not printed. Do NOT use today's date.
5. abnormal lists only values the report itself marks out of range (H, L, flagged, bold, or outside a printed reference interval). Do not judge normality yourself.
6. summary is one plain sentence naming what the report covers and the headline values. No advice, no interpretation, no reassurance.
7. If the image is not a pathology report at all — a prescription, a selfie, a blank page — set isLabReport false and say so in summary.`;

async function assetBuffer(asset) {
  const root = path.resolve(process.cwd(), env.UPLOAD_DIR);
  const full = path.join(root, asset.storageKey);
  return fs.readFile(full);
}

/**
 * Reads [assetId] and returns the transcribed values, or null when the file
 * cannot be read at all.
 */
export async function extractLabValues(assetId, practiceId = null) {
  const asset = await MediaAsset.findById(assetId).lean();
  if (!asset) return null;
  if (!READABLE.has(asset.mimeType)) {
    return { status: 'unsupported', summary: `Cannot read a ${asset.mimeType} report automatically.` };
  }

  const buffer = await assetBuffer(asset);
  const result = await generateFromImage({
    system: buildSystem((await clinicIdentity(null, { practiceId })).clinicName || env.CLINIC_NAME),
    prompt: 'Transcribe this pathology report.',
    images: [{ mimeType: asset.mimeType, base64: buffer.toString('base64') }],
    responseSchema: LAB_SCHEMA,
  });

  // Metered after the call: a failed request cost the practice nothing.
  // Tokens and a per-kind count, never the reply allowance — see allowance.js.
  countAiCall(practiceId, 'labReport', result?.usage);

  const parsed = result?.json ?? safeParse(result?.text);
  if (!parsed) return { status: 'failed', summary: 'Could not read this report.' };
  return { status: 'done', ...parsed, modelVersion: result?.modelVersion ?? null };
}

function safeParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/// Values outside these are almost certainly a misread rather than a real
/// result, and a misread that reaches the record moves a risk band. Anything
/// out of range is dropped and left for the doctor to enter.
const PLAUSIBLE = {
  hba1cPercent: [3, 20],
  fastingGlucoseMgDl: [20, 800],
  postPrandialGlucoseMgDl: [20, 900],
  creatinine: [0.1, 20],
};

function within(field, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  const range = PLAUSIBLE[field];
  if (!range) return value >= 0;
  return value >= range[0] && value <= range[1];
}

/**
 * Analyses an uploaded report and files what it finds into the patient's
 * record, then recomputes their risk.
 *
 * Deliberately not awaited by the upload request: the patient should see their
 * report listed the moment it uploads, not after a vision round-trip. Every
 * failure path leaves the LabResult in place with an analysis status saying
 * what happened, so a report is never lost because the reader was down.
 */
export async function analyseLabResult(labResultId) {
  const doc = await LabResult.findById(labResultId);
  if (!doc || !doc.photo) return;

  try {
    /*
     * The practice the result belongs to, resolved from the patient on the
     * row rather than threaded in.
     *
     * This path is fired and forgotten from the route — `analyseLabResult(id)
     * .catch(() => {})` — so there is no request in scope to carry a practice.
     * Resolving it here is what stops a whole class of AI spend being
     * invisible: every lab photo a patient uploads goes through this.
     */
    const extracted = await extractLabValues(doc.photo, await practiceOfPatient(doc.patient));
    if (!extracted) {
      doc.set('analysis.status', 'failed');
      await doc.save();
      return;
    }

    if (extracted.status !== 'done' || extracted.isLabReport === false) {
      doc.set('analysis.status', extracted.status === 'unsupported' ? 'unsupported' : 'failed');
      doc.set('analysis.summary', extracted.summary ?? null);
      doc.set('analysis.analysedAt', new Date());
      await doc.save();
      return;
    }

    // The date on the page, when it has one and it is not in the future — a
    // report can be weeks old, and filing it as today would let a stale number
    // move the patient's current risk band.
    const printed = extracted.testedOn ? new Date(extracted.testedOn) : null;
    const testedOn =
      printed && !Number.isNaN(printed.valueOf()) && printed <= new Date() ? printed : doc.createdAt;

    doc.set('analysis', {
      status: 'done',
      summary: extracted.summary ?? null,
      hba1cPercent: within('hba1cPercent', extracted.hba1cPercent) ? extracted.hba1cPercent : undefined,
      fastingGlucoseMgDl: within('fastingGlucoseMgDl', extracted.fastingGlucoseMgDl)
        ? extracted.fastingGlucoseMgDl
        : undefined,
      postPrandialGlucoseMgDl: within('postPrandialGlucoseMgDl', extracted.postPrandialGlucoseMgDl)
        ? extracted.postPrandialGlucoseMgDl
        : undefined,
      totalCholesterol: extracted.totalCholesterol,
      ldl: extracted.ldl,
      hdl: extracted.hdl,
      triglycerides: extracted.triglycerides,
      creatinine: within('creatinine', extracted.creatinine) ? extracted.creatinine : undefined,
      testedOn,
      abnormal: Array.isArray(extracted.abnormal) ? extracted.abnormal.slice(0, 20) : [],
      analysedAt: new Date(),
      modelVersion: extracted.modelVersion ?? null,
    });
    await doc.save();

    await fileValues(doc, testedOn);

    // Everything the doctor, the patient and the dietician read — risk band,
    // health score — comes off the record this just wrote to, so all three
    // panels move together without any of them being told about lab reports.
    await recomputePatientRisk(doc.patient);
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) {
      logger.error({ err: err?.message, labResultId }, 'lab report analysis failed');
    }
    try {
      doc.set('analysis.status', 'failed');
      doc.set('analysis.analysedAt', new Date());
      await doc.save();
    } catch {
      // The report itself is already saved; a failed status write is not worth
      // a second failure.
    }
  }
}

/**
 * Writes the transcribed values into the records the rest of the app already
 * reads, rather than inventing a parallel store the dashboards would not know
 * about.
 */
async function fileValues(doc, testedOn) {
  const a = doc.analysis;

  if (a.hba1cPercent != null) {
    // One record per report, not per upload: re-uploading the same page should
    // not double-count in the HbA1c history the doctor reads as a trend.
    const already = await Hba1cRecord.findOne({ patient: doc.patient, reportFile: doc.photo });
    if (!already) {
      await Hba1cRecord.create({
        patient: doc.patient,
        percentage: a.hba1cPercent,
        testedOn,
        reportFile: doc.photo,
        notes: `Read automatically from ${doc.testName}`,
      });
    }
  }

  // A lab's fasting/post-meal glucose is a real reading and belongs on the
  // same trend as the patient's own meter. Marked `clinic` so the doctor can
  // tell which came from a lab.
  const readings = [
    ['fasting', a.fastingGlucoseMgDl],
    ['post_meal', a.postPrandialGlucoseMgDl],
  ].filter(([, v]) => v != null);

  if (readings.length === 0) return;

  const profile = await PatientProfile.findOne({ user: doc.patient }).select('targets').lean();
  const targets = profile?.targets ?? {};

  for (const [context, valueMgDl] of readings) {
    const already = await GlucoseReading.findOne({
      patient: doc.patient,
      valueMgDl,
      context,
      measuredAt: testedOn,
    });
    if (already) continue;

    // Classified and escalated exactly as a reading typed in by the patient
    // is. A 380 printed on a lab report is the same emergency as a 380 off a
    // meter, and it must not depend on which way it reached the clinic.
    const assessment = classifyGlucose(valueMgDl, context, targets);
    const reading = await GlucoseReading.create({
      patient: doc.patient,
      valueMgDl,
      context,
      measuredAt: testedOn,
      source: 'clinic',
      flag: assessment.flag,
      notes: `From ${doc.testName} report`,
    });

    if (assessment.urgency === 'emergency' || assessment.urgency === 'urgent') {
      const alert = await raiseAlert({
        patientId: doc.patient,
        severity: assessment.urgency === 'emergency' ? 'emergency' : 'urgent',
        type: assessment.alertType ?? 'abnormal_trend',
        title: assessment.summary,
        detail: `Read from an uploaded ${doc.testName} report: ${valueMgDl} mg/dL (${context}).`,
        source: { kind: 'glucose', ref: reading._id },
        matchedRules: [assessment.rule],
      });
      reading.triggeredAlert = alert._id;
      await reading.save();
    }
  }
}
