import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { requireAuth, resolvePatientScope, requireClinician, requireDoctor } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, badRequest } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Prescription } from '../models/Prescription.js';
import { Medication } from '../models/Medication.js';
import { notifyPatientOfPrescription } from '../services/notifications.js';
import { buildSchedule, scheduleText, relationFromText } from '../services/medicationSchedule.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { extractPrescription } from '../services/ai/vision.js';
import { normaliseScannedItems } from '../services/prescriptionItems.js';
import { loadAssetsForAi } from './uploads.js';
import { compareNames, needsConfirmation } from '../utils/nameMatch.js';
import { AiUnavailableError } from '../services/ai/gemini.js';
import { User, ROLES } from '../models/User.js';
import { ensurePrescriptionPdf } from '../services/prescriptionPdf.js';
import { paged, pageParams } from '../utils/pagination.js';
import { resolveDoctor } from '../services/doctorContext.js';
import { PERMISSIONS } from '../models/Membership.js';
import { requirePermission, recordWindow } from '../middleware/authorise.js';
import { requireCapability } from '../middleware/requireCapability.js';
import { CAPABILITIES } from '../services/capabilities.js';
import { practiceOfPatient } from '../middleware/practiceScope.js';
import { RECORD_STATE } from '../models/plugins/clinicalRecord.js';
import { nextInSequence } from '../services/sequence.js';
import { idempotencyKey, isReplayOf, isKeyCollision } from '../middleware/idempotency.js';
import { attachableAssetIds } from '../services/mediaAccess.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolvePatientScope);

/**
 * Sequential per-year reference, e.g. AKD-2026-000412.
 *
 * ---- Drawn from a counter, not counted -----------------------------------
 *
 * This was `countDocuments(this year) + 1`, against a unique index. Two
 * prescriptions issued in the same second both counted the same number; the
 * index refused the second, the error handler called it "an account with that
 * referenceNo already exists", and the prescription was never written. Eight
 * issued at once lost seven.
 *
 * The counter starts where the printed references left off — the highest
 * this year, not the count — so the first number it issues follows the last
 * one a patient was handed rather than repeating one from January.
 */
async function nextReference() {
  const year = dayjs().year();
  const prefix = `AKD-${year}-`;

  const n = await nextInSequence(`prescription:${year}`, {
    seed: async () => {
      // Zero-padded to six digits, so the highest string is the highest number.
      const last = await Prescription.findOne({ referenceNo: new RegExp(`^${prefix}\\d{6}$`) })
        .sort({ referenceNo: -1 })
        .select('referenceNo')
        .lean();
      return last ? Number(last.referenceNo.slice(prefix.length)) : 0;
    },
  });

  return `${prefix}${String(n).padStart(6, '0')}`;
}

router.get(
  '/',
  validate({ query: pageParams }),
  audit('read', 'Prescription'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    // Bounded by the asking practice's enrolment. Without this a clinic that
    // enrolled the patient in September lists a prescription written in May by
    // somebody else — the door was guarded and the shelves were not.
    const filter = { patient: req.patientId, ...recordWindow(req, 'issuedOn') };
    const [items, total] = await Promise.all([
      Prescription.find(filter)
        .sort({ issuedOn: -1 })
        .skip(skip)
        .limit(limit)
        .populate('doctor', 'name')
        .populate('uploadedBy', 'name')
        .populate('scanFile', 'mimeType')
        .lean(),
      Prescription.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialise), { page, limit, total }));
  }),
);

router.get(
  '/:id',
  audit('read', 'Prescription'),
  asyncHandler(async (req, res) => {
    const p = await Prescription.findOne({
      _id: req.params.id,
      patient: req.patientId,
      // The same bound on a direct fetch. A list that hides a row while its own
      // URL still serves it is a filter, not a rule.
      ...recordWindow(req, 'issuedOn'),
    })
      .populate('doctor', 'name')
      .populate('uploadedBy', 'name')
      .populate('scanFile', 'mimeType')
      .lean();
    if (!p) throw notFound('Prescription not found');
    res.json({ prescription: serialise(p) });
  }),
);

router.post(
  '/',
  // The doctor's own act. Staff may look one up and print it; writing one is
  // not theirs, and the record names whoever posted it as the prescriber.
  requireDoctor,
  requirePermission(PERMISSIONS.PRESCRIBE),
  // The permission says this person prescribes; the capability says this
  // practice does at all. A diagnostic centre's pathologist holds PRESCRIBE
  // from the clinician preset and must still not issue one — that is about
  // what the organisation is licensed to do, not who it employs.
  requireCapability(CAPABILITIES.PRESCRIPTION),
  // Before validation: the fingerprint is of what the client sent. See
  // middleware/idempotency.js for why the parsed body cannot be used here.
  idempotencyKey(),
  validate({
    body: z.object({
      appointmentId: z.string().optional(),
      issuedOn: z.coerce.date().default(() => new Date()),
      validUntil: z.coerce.date().optional(),
      complaint: z.string().max(1000).optional(),
      diagnosis: z.array(z.string().max(300)).max(20).default([]),
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(160),
            strength: z.string().max(60).optional(),
            dose: z.string().max(60).optional(),
            frequency: z.string().max(120).optional(),
            durationDays: z.number().int().min(1).max(365).optional(),
            relationToMeal: z.enum(['before_meal', 'after_meal', 'with_meal', 'any']).default('any'),
            route: z.enum(['oral', 'iv', 'sc', 'im', 'topical', 'inhaled']).default('oral'),
            instructions: z.string().max(400).optional(),
          }),
        )
        // No minimum. A visit can end in tests, diet advice or reassurance with
        // nothing to dispense, and the doctor confirms that case in the consult
        // form before it gets here. Requiring an item made the API reject a
        // prescription the doctor had already deliberately confirmed.
        .default([]),
      labTestsAdvised: z.array(z.string().max(200)).max(30).default([]),
      generalAdvice: z.string().max(4000).optional(),
      followUpOn: z.coerce.date().optional(),
      supersedes: z.string().optional(),
      /*
       * Why the one being replaced was replaced.
       *
       * Optional, and that is a deliberate compromise: `endAs` refuses without
       * a reason, and the consult screen has no field to type one in. Required
       * here, every doctor on the current app would be unable to re-prescribe
       * until they updated it. So the route derives an honest default naming
       * the replacement, and the app can send a better one as soon as it has
       * somewhere to ask.
       */
      supersedeReason: z.string().trim().min(5).max(500).optional(),
      // Mirror the prescribed items into the patient's medication tracker.
      syncToMedications: z.boolean().default(true),
    }),
  }),
  audit('create', 'Prescription'),
  asyncHandler(async (req, res) => {
    const { syncToMedications, appointmentId, supersedeReason, ...body } = req.body;

    /*
     * The same request again — a tap retried after a timeout whose first
     * attempt was written. Answered with the prescription that exists, before
     * anything else is looked at: the supersede check below would otherwise
     * refuse the retry, because the first attempt already ended the old one.
     */
    const replay = async () => {
      if (!req.idempotency) return null;
      const existing = await Prescription.findOne({
        doctor: req.user._id,
        idempotencyKey: req.idempotency.key,
      }).populate('doctor', 'name');
      return isReplayOf(req, existing) ? existing : null;
    };
    const already = await replay();
    if (already) {
      return res.status(201).set('Idempotent-Replayed', 'true').json({ prescription: serialise(already) });
    }

    /*
     * The prescription being replaced, read through the same scope as every
     * other read on this router — and before anything is written.
     *
     * It was `updateOne({ _id: body.supersedes }, { isActive: false })`: no
     * patient, no practice, no record window, with the id supplied by whoever
     * sent the request. Any account holding PRESCRIBE could switch off a
     * prescription for a patient it had never met at a practice it does not
     * work for, and the patient's app — and anybody dispensing against it —
     * would be told the prescription no longer stood.
     *
     * Checked before the create rather than after it, because a refusal that
     * leaves the new prescription written and the old one standing is a
     * half-applied clinical act: two live prescriptions out of one visit.
     */
    let superseded = null;
    if (body.supersedes) {
      superseded = await Prescription.findOne({
        _id: body.supersedes,
        patient: req.patientId,
        ...recordWindow(req, 'issuedOn'),
      });
      if (!superseded) throw notFound('Prescription not found');
      if (!superseded.isCurrent()) {
        // Two doctors pressing the same button, or one retrying on a bad
        // connection. The second must not overwrite the first's reason.
        throw badRequest(`That prescription is already ${superseded.recordState}.`);
      }
    }

    let prescription;
    try {
      prescription = await Prescription.create({
        ...body,
        patient: req.patientId,
        doctor: req.user._id,
        appointment: appointmentId,
        referenceNo: await nextReference(),
        idempotencyKey: req.idempotency?.key ?? null,
        idempotencyHash: req.idempotency?.hash ?? null,
      });
    } catch (err) {
      /*
       * Two copies of one request in the same instant: both found nothing
       * above, and the unique index refused this one. The other has written it;
       * this answers with what it wrote, and does not supersede or sync twice.
       */
      if (!isKeyCollision(err)) throw err;
      const raced = await replay();
      if (!raced) throw err;
      return res.status(201).set('Idempotent-Replayed', 'true').json({ prescription: serialise(raced) });
    }

    if (superseded) {
      /*
       * Through the record lifecycle, not a bare flag. `isActive: false` left
       * a pharmacist unable to tell a prescription replaced by a better one
       * from a prescription voided as issued in error, and named nobody.
       */
      superseded.endAs(RECORD_STATE.SUPERSEDED, {
        by: req.user._id,
        reason: supersedeReason ?? `Replaced by prescription ${prescription.referenceNo}.`,
        replacedBy: prescription._id,
      });
      await superseded.save();
    }

    // Keep the patient's diabetes type in step with the doctor's diagnosis, so
    // the profile badge reflects what was actually diagnosed rather than the
    // sign-up default.
    const dxType = deriveDiabetesType(prescription.diagnosis);
    if (dxType) {
      await PatientProfile.updateOne({ user: req.patientId }, { $set: { diabetesType: dxType } });
    }

    if (syncToMedications) {
      await syncMedications(prescription, req.patientId, req.user._id);
    }

    // Let the patient know at once so their Medicines tab and reminders refresh.
    notifyPatientOfPrescription(req.patientId, req.user).catch(() => {});

    res.status(201).json({ prescription: serialise(await prescription.populate('doctor', 'name')) });
  }),
);

/** Map a free-text diagnosis list to a diabetes type for the patient profile. */
function deriveDiabetesType(diagnoses = []) {
  const text = diagnoses.join(' ').toLowerCase();
  if (/type\s*1|t1dm/.test(text)) return 'type1';
  if (/gestational|gdm/.test(text)) return 'gestational';
  if (/prediabet|pre-?\s*dm/.test(text)) return 'prediabetes';
  if (/type\s*2|t2dm/.test(text)) return 'type2';
  return null;
}

async function syncMedications(prescription, patientId, doctorId) {
  const profile = await PatientProfile.findOne({ user: patientId }).select('mealTimes').lean();
  const mealTimes = profile?.mealTimes;
  for (const item of prescription.items) {
    // Special dosing is carried in the frequency shorthand (PRN/SOS/Stat/EOD);
    // derive the flags so the tracker and the device scheduler treat them right.
    const f = String(item.frequency ?? '').toLowerCase();
    const asNeeded = /\b(prn|sos)\b/.test(f);
    const stat = /\bstat\b/.test(f);
    const dayInterval = /\b(eod|qod)\b/.test(f) ? 2 : 1;

    await Medication.findOneAndUpdate(
      { patient: patientId, name: item.name, isActive: true },
      {
        $set: {
          patient: patientId,
          name: item.name,
          strength: item.strength,
          dose: item.dose,
          form: /insulin/i.test(item.name) ? 'insulin' : 'tablet',
          // PRN/Stat carry no recurring schedule, so they arm no reminders.
          schedule: asNeeded || stat ? [] : buildSchedule(scheduleText(item), mealTimes, item.relationToMeal ?? relationFromText(scheduleText(item)) ?? 'any'),
          route: item.route ?? 'oral',
          asNeeded,
          stat,
          dayInterval,
          startDate: prescription.issuedOn,
          endDate: item.durationDays
            ? dayjs(prescription.issuedOn).add(item.durationDays, 'day').toDate()
            : undefined,
          instructions: item.instructions,
          prescribedBy: doctorId,
          prescription: prescription._id,
          isActive: true,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }
}

/**
 * The prescription as a downloadable PDF. Generated once by pdfkit and cached as
 * a `prescription_pdf` MediaAsset owned by the patient (so every panel can fetch
 * it), then streamed from disk. `resolvePatientScope` already gates this: the
 * patient reaches their own, a clinician reaches any.
 */
router.get(
  '/:id/pdf',
  audit('export', 'Prescription'),
  asyncHandler(async (req, res) => {
    // The window applies hardest here. This route does not describe a
    // prescription, it hands the document over — a leak past the list and the
    // fetch would be caught by a reader; a leak here is a PDF on somebody's
    // disk.
    const p = await Prescription.findOne({
      _id: req.params.id,
      patient: req.patientId,
      ...recordWindow(req, 'issuedOn'),
    }).lean();
    if (!p) throw notFound('Prescription not found');

    const { asset, filePath } = await ensurePrescriptionPdf(p);
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${asset.originalName ?? 'prescription.pdf'}"`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(filePath);
  }),
);

function serialise(p) {
  return {
    id: p._id,
    source: p.source ?? 'composed',
    // A scanned prescription is read by opening the image, so the client needs
    // the asset directly rather than the generated-PDF route, which has
    // nothing to generate from.
    scanUrl: p.scanFile ? `/api/v1/uploads/${p.scanFile._id ?? p.scanFile}/raw` : null,
    // The client needs to know what it is about to open. A photographed
    // prescription comes back as WebP (the upload path re-encodes images, which
    // is also what strips the GPS coordinates out of it); one supplied as a PDF
    // stays a PDF. Saving it to disk under the wrong extension is how a phone
    // ends up with no app that will open the file.
    scanMimeType: p.scanFile?.mimeType ?? null,
    uploadedByName: p.uploadedBy?.name ?? null,
    referenceNo: p.referenceNo,
    issuedOn: p.issuedOn,
    validUntil: p.validUntil ?? null,
    doctorName: p.doctor?.name ?? null,
    complaint: p.complaint ?? null,
    diagnosis: p.diagnosis ?? [],
    items: p.items ?? [],
    labTestsAdvised: p.labTestsAdvised ?? [],
    generalAdvice: p.generalAdvice ?? null,
    followUpOn: p.followUpOn ?? null,
    isActive: p.isActive,
    pdfUrl: `/api/v1/patients/${p.patient}/prescriptions/${p._id}/pdf`,
  };
}

/**
 * Read a photographed prescription, without filing anything.
 *
 * The desk photographs the paper and this says what is on it: whose name is
 * printed, the date it was written, the medicines, the tests advised and the
 * advice. Nothing is saved — POST /scan does that, with whatever the desk
 * confirms.
 *
 * ---- The name is the point -------------------------------------------------
 *
 * Filing this patient's slip onto that patient's chart is the one mistake here
 * that harms somebody, and it is invisible afterwards: a misfiled prescription
 * looks exactly as correct as a right one. So the printed name comes back with
 * a verdict against the record the desk has open, and the app makes them
 * confirm a mismatch out loud.
 *
 * The name is never used to *find* a patient. A human chose the record before
 * the photograph was taken; a lookup by read name would eventually put two
 * Rahul Dases on one chart.
 *
 * ---- And the date --------------------------------------------------------
 *
 * The prescription has a date on it. Asking the desk to type one — while they
 * are holding the paper it is printed on — was work invented by the app, and
 * during a pilot where a week's slips are photographed in one sitting it is
 * also the field most likely to be got wrong.
 */
router.post(
  '/scan/read',
  requireClinician,
  validate({ body: z.object({ assetId: z.string() }) }),
  audit('read', 'MediaAsset'),
  asyncHandler(async (req, res) => {
    // This patient's file, or one the caller uploaded. The reader hands back the
    // medicines, diagnosis and printed name of whatever it is pointed at.
    const [assetId] = await attachableAssetIds([req.body.assetId], {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const images = await loadAssetsForAi([assetId], { max: 1 });
    if (!images.length) {
      throw badRequest('That file is not an image this can read.');
    }

    let parsed;
    try {
      parsed = await extractPrescription({
        images,
        practiceId: await practiceOfPatient(req.patientId),
      });
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        return res.status(503).json({
          error: {
            code: 'AI_UNAVAILABLE',
            message: 'Could not read the prescription right now. File it and add the details later.',
          },
        });
      }
      throw err;
    }

    const patient = await User.findById(req.patientId).select('name').lean();

    if (!parsed || !parsed.readable) {
      // Not an error. A blurred photograph or a slip with no letterhead is
      // still worth filing — the image is the record — so the app falls back
      // to asking for a date and files it with no structured detail.
      return res.json({
        readable: false,
        note: parsed?.note ?? null,
        name: { verdict: 'unknown', onPaper: null, onFile: patient?.name ?? null },
      });
    }

    const name = compareNames(parsed.patient?.name, patient?.name);
    const written = parsed.prescriber?.writtenOn
      ? new Date(parsed.prescriber.writtenOn)
      : null;

    res.json({
      readable: true,
      note: parsed.note ?? null,
      name: {
        ...name,
        onFile: patient?.name ?? null,
        mustConfirm: needsConfirmation(name.verdict),
      },
      // Null when the page carries no date, and then the app asks. A date the
      // model could not read is not a date to invent.
      issuedOn:
        written && !Number.isNaN(written.getTime()) && written <= new Date()
          ? written
          : null,
      // Split, tidied and de-duplicated exactly as the patient-side scan does:
      // a line naming two drugs is two medicines, and the same drug twice is
      // one taken twice.
      items: normaliseScannedItems(parsed.items),
      diagnosis: parsed.diagnosis ?? [],
      labTests: parsed.labTests ?? [],
      advice: parsed.advice ?? null,
      prescriber: parsed.prescriber ?? null,
    });
  }),
);

/**
 * File a paper prescription against a patient.
 *
 * The clinic's pilot runs on paper: the doctor writes fifty prescriptions by
 * hand and the desk photographs each one. Without this the app has a
 * prescription list that stays empty for every patient in the pilot, and a
 * patient asking "what did he give me" has nothing to look at.
 *
 * `requireClinician`, so the front desk may do it — and that is not a
 * contradiction of prescribing being doctor-only. Writing a prescription and
 * filing one the doctor already wrote and signed are different acts. The
 * record keeps them apart: `doctor` is whose prescription it is, `uploadedBy`
 * is who put it in the system, and `source: 'scanned'` says the medicines were
 * never typed, so nothing downstream reads the empty `items` as a patient on
 * no medication.
 */
router.post(
  '/scan',
  requireClinician,
  validate({
    body: z.object({
      assetId: z.string(),
      issuedOn: z.coerce.date().optional(),
      note: z.string().max(1000).optional(),
      // What /scan/read found and the desk confirmed. All optional: an
      // unreadable photograph still files, as an image with no detail, which
      // is strictly better than refusing to record it at all.
      items: z
        .array(
          z.object({
            name: z.string().min(1).max(160),
            strength: z.string().max(60).optional(),
            dose: z.string().max(60).optional(),
            frequency: z.string().max(120).optional(),
            durationDays: z.number().int().min(1).max(365).optional(),
            relationToMeal: z
              .enum(['before_meal', 'after_meal', 'with_meal', 'any'])
              .optional(),
            instructions: z.string().max(400).optional(),
          }),
        )
        .max(30)
        .optional(),
      diagnosis: z.array(z.string().max(300)).max(20).optional(),
      labTestsAdvised: z.array(z.string().max(200)).max(30).optional(),
      generalAdvice: z.string().max(4000).optional(),
    }),
  }),
  audit('create', 'Prescription'),
  asyncHandler(async (req, res) => {
    const [assetId] = await attachableAssetIds([req.body.assetId], {
      patientId: req.patientId,
      uploaderIds: [req.user._id],
    });
    const asset = await MediaAsset.findOne({
      _id: assetId,
      deletedAt: null,
    });
    if (!asset) throw notFound('That file was not found');

    // The doctor whose prescription this is — the field that says who is
    // answerable for it. `required`, so an ambiguous answer is an error rather
    // than a coin flip over an attribution on a legal document.
    const doctor = await resolveDoctor({ actingUser: req.user, required: true });
    if (!doctor) throw notFound('No doctor account to file this against');

    const created = await Prescription.create({
      patient: req.patientId,
      doctor: doctor._id,
      referenceNo: await nextReference(),
      // The date on the paper, when the desk knows it. A prescription filed a
      // week late and stamped today would put the visit on the wrong day in
      // every list that sorts by it.
      issuedOn: req.body.issuedOn ?? new Date(),
      source: 'scanned',
      scanFile: asset._id,
      uploadedBy: req.user._id,
      // Read off the page rather than typed. `source` stays 'scanned' either
      // way: these medicines were transcribed by a model from handwriting, and
      // anything downstream deciding what a patient is on has to know that
      // this list was never entered by the doctor who wrote it.
      items: req.body.items ?? [],
      diagnosis: req.body.diagnosis ?? [],
      labTestsAdvised: req.body.labTestsAdvised ?? [],
      generalAdvice:
        req.body.generalAdvice?.trim() || req.body.note?.trim() || undefined,
    });

    const full = await Prescription.findById(created._id)
      .populate('doctor', 'name')
      .populate('uploadedBy', 'name')
      .populate('scanFile', 'mimeType')
      .lean();
    res.status(201).json({ prescription: serialise(full) });
  }),
);

export default router;
