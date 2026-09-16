import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { LabResult } from '../models/LabResult.js';
import { Prescription } from '../models/Prescription.js';
import { analyseLabResult } from '../services/ai/labReport.js';
import { buildAnalytes } from '../services/analyteCatalog.js';
import { withdrawLabResult } from '../services/readingCorrections.js';
import { RECORD_STATE } from '../models/plugins/clinicalRecord.js';
import { recomputePatientRisk } from '../services/analytics.js';
import { reportedNames, isReported } from '../utils/testNames.js';
import { recordWindow, requireRecordAccess } from '../middleware/authorise.js';
import { attachableAssetId } from '../services/mediaAccess.js';

/**
 * The patient's lab tests: the tests the doctor advised (pulled from active
 * prescriptions) and the reports the patient has uploaded against them.
 * Mounted at /patients/:patientId/lab-tests.
 */
const router = Router({ mergeParams: true });
// Whose patient this is, then what this person may do with them: lab results and HbA1c.
// `resolvePatientScope` answers the first and was, until now, the only thing
// asked — so EDIT_RECORD was granted by every preset and enforced by nothing.
router.use(requireAuth, resolvePatientScope, requireRecordAccess());

function serialiseResult(r) {
  // `photo` is populated, so a report that is a PDF can say so. The field name
  // is historical — the upload sheet has always offered documents too, and the
  // client drew every one of them as an image, which is why a PDF report showed
  // a broken-picture icon.
  const asset = r.photo && typeof r.photo === 'object' ? r.photo : null;
  const photoId = asset ? asset._id : r.photo;
  return {
    id: String(r._id),
    testName: r.testName,
    note: r.note ?? '',
    photoUrl: photoId ? `/api/v1/uploads/${photoId}/raw` : null,
    mimeType: asset?.mimeType ?? null,
    originalName: asset?.originalName ?? null,
    sizeBytes: asset?.sizeBytes ?? null,
    // What was read off the page. `status` is sent as well as the values so a
    // report that could not be parsed reads as "needs a human", not as a
    // report with nothing on it.
    analysis: r.analysis?.status
      ? {
          status: r.analysis.status,
          summary: r.analysis.summary ?? null,
          hba1cPercent: r.analysis.hba1cPercent ?? null,
          fastingGlucoseMgDl: r.analysis.fastingGlucoseMgDl ?? null,
          postPrandialGlucoseMgDl: r.analysis.postPrandialGlucoseMgDl ?? null,
          ldl: r.analysis.ldl ?? null,
          hdl: r.analysis.hdl ?? null,
          triglycerides: r.analysis.triglycerides ?? null,
          creatinine: r.analysis.creatinine ?? null,
          testedOn: r.analysis.testedOn ?? null,
          abnormal: r.analysis.abnormal ?? [],
          // Uniform value/range/flag list built from the extracted numbers.
          analytes: buildAnalytes(r.analysis),
        }
      : null,
    createdAt: r.createdAt,
  };
}

router.get(
  '/',
  audit('read', 'LabResult'),
  asyncHandler(async (req, res) => {
    const [prescriptions, results] = await Promise.all([
      // Bounded like every other prescription read. What a practice advised
      // before this one was enrolled is that practice's clinical reasoning, and
      // "Vitamin D, HbA1c, lipid profile" is a diagnosis said out loud.
      Prescription.find({
        patient: req.patientId,
        isActive: true,
        ...recordWindow(req, 'issuedOn'),
      })
        .select('labTestsAdvised')
        .lean(),
      LabResult.find({
        patient: req.patientId,
        // `createdAt`, not `analysis.testedOn`. The window asks whether this
        // record existed during the practice's relationship with the patient,
        // and upload time answers that; the printed test date can be six weeks
        // earlier, and is missing entirely on a report the parser could not read
        // — a filter on it would hide those from everybody.
        ...recordWindow(req, 'createdAt'),
      })
        .sort({ createdAt: -1 })
        .limit(100)
        .populate('photo', 'mimeType originalName sizeBytes')
        .lean(),
    ]);
    const advised = [...new Set(prescriptions.flatMap((p) => p.labTestsAdvised ?? []).filter(Boolean))];

    // Whether each advised test has a report, decided here rather than in the
    // app. The client used to compare the two names with `==`, so "Vitamin D"
    // and the lab's "Vitamin D (25-Hydroxy)" were different tests and an
    // uploaded report never ticked off the advice it answered.
    //
    // `advised` keeps its old shape alongside this: a patient running an older
    // build still gets the list it expects.
    const reported = reportedNames(results);
    const advisedStatus = advised.map((name) => ({
      name,
      reported: isReported(name, reported),
    }));

    res.json({ advised, advisedStatus, results: results.map(serialiseResult) });
  }),
);

router.post(
  '/',
  validate({
    body: z
      .object({
        testName: z.string().trim().min(1).max(200),
        note: z.string().trim().max(1000).optional().default(''),
        photo: z.string().optional(),
      })
      .refine((b) => Boolean(b.photo) || b.note.trim().length > 0, { message: 'Add a photo or a note', path: ['photo'] }),
  }),
  audit('create', 'LabResult'),
  asyncHandler(async (req, res) => {
    // The patient's own report. The reader transcribes it into this patient's
    // HbA1c and glucose history, so somebody else's file here would move this
    // patient's numbers.
    const photo = await attachableAssetId(req.body.photo || undefined, {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const entry = await LabResult.create({
      patient: req.patientId,
      testName: req.body.testName,
      note: req.body.note,
      photo: photo || undefined,
    });
    // Populated before serialising so the row the client renders right after
    // upload knows whether it is a picture or a PDF, exactly as a reloaded one
    // does. Without it the first render of a freshly uploaded PDF is a broken
    // thumbnail that only fixes itself on the next refresh.
    await entry.populate('photo', 'mimeType originalName sizeBytes');

    // Read in the background. The patient sees their report listed at once
    // rather than waiting on a vision round-trip, and every failure path
    // leaves the report itself in place with a status saying what happened.
    if (entry.photo) {
      analyseLabResult(entry._id).catch(() => {});
    }

    res.status(201).json({ result: serialiseResult(entry.toObject()) });
  }),
);

/**
 * Withdraws a report uploaded by mistake.
 *
 * The values read off it go too. A wrong report that has already been
 * transcribed has moved this patient's HbA1c history, their glucose trend and
 * therefore their risk band — withdrawing only the report would leave the
 * numbers behind, still driving what all three panels show.
 *
 * Withdrawn, not deleted, and only what this report created: the old delete
 * removed every clinic glucose reading sharing its value and date, including
 * one the desk typed from the same printout. See services/readingCorrections.js.
 */
router.delete(
  '/:id',
  validate({ body: z.object({ reason: z.string().trim().min(3).max(300).optional() }).optional() }),
  audit('update', 'LabResult'),
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Report not found');
    const inReach = { _id: req.params.id, patient: req.patientId, ...recordWindow(req, 'createdAt') };
    const entry = await LabResult.findOne(inReach);
    if (!entry) {
      // Already withdrawn: a retry of the same removal gets the same answer.
      const withdrawn = await LabResult.exists({ ...inReach, recordState: RECORD_STATE.VOIDED });
      if (withdrawn) return res.status(204).end();
      throw notFound('Report not found');
    }

    await withdrawLabResult({
      entry,
      by: req.user._id,
      byRole: req.user.role,
      reason: req.body?.reason ?? (req.user.role === 'patient' ? 'Removed by the patient.' : 'Removed by the clinic.'),
    });

    // The record this fed has changed, so the band computed from it must be
    // recomputed — otherwise a withdrawn report leaves the patient sitting in a
    // risk band nothing on their record supports any more.
    recomputePatientRisk(req.patientId).catch(() => {});

    res.status(204).end();
  }),
);

export default router;
