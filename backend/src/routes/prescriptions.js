import { Router } from 'express';
import dayjs from 'dayjs';
import { z } from 'zod';
import { requireAuth, resolvePatientScope, requireClinician, requireDoctor } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Prescription } from '../models/Prescription.js';
import { Medication } from '../models/Medication.js';
import { notifyPatientOfPrescription } from '../services/notifications.js';
import { buildSchedule } from '../services/medicationSchedule.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { ensurePrescriptionPdf } from '../services/prescriptionPdf.js';
import { paged, pageParams } from '../utils/pagination.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolvePatientScope);

/** Sequential per-year reference, e.g. AKD-2026-000412. */
async function nextReference() {
  const year = dayjs().year();
  const count = await Prescription.countDocuments({
    referenceNo: new RegExp(`^AKD-${year}-`),
  });
  return `AKD-${year}-${String(count + 1).padStart(6, '0')}`;
}

router.get(
  '/',
  validate({ query: pageParams }),
  audit('read', 'Prescription'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.patientId };
    const [items, total] = await Promise.all([
      Prescription.find(filter).sort({ issuedOn: -1 }).skip(skip).limit(limit).populate('doctor', 'name').lean(),
      Prescription.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialise), { page, limit, total }));
  }),
);

router.get(
  '/:id',
  audit('read', 'Prescription'),
  asyncHandler(async (req, res) => {
    const p = await Prescription.findOne({ _id: req.params.id, patient: req.patientId })
      .populate('doctor', 'name')
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
      // Mirror the prescribed items into the patient's medication tracker.
      syncToMedications: z.boolean().default(true),
    }),
  }),
  audit('create', 'Prescription'),
  asyncHandler(async (req, res) => {
    const { syncToMedications, appointmentId, ...body } = req.body;

    const prescription = await Prescription.create({
      ...body,
      patient: req.patientId,
      doctor: req.user._id,
      appointment: appointmentId,
      referenceNo: await nextReference(),
    });

    if (body.supersedes) {
      await Prescription.updateOne({ _id: body.supersedes }, { isActive: false });
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
          schedule: asNeeded || stat ? [] : buildSchedule(item.frequency, mealTimes, item.relationToMeal),
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
    const p = await Prescription.findOne({ _id: req.params.id, patient: req.patientId }).lean();
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

export default router;
