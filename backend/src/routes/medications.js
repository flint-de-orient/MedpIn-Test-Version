import { Router } from 'express';
import multer from 'multer';
import dayjs from 'dayjs';
import { z } from 'zod';
import { inClinicTz, clinicDateTime } from '../utils/clinicTime.js';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, badRequest } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Medication, MED_FORMS } from '../models/Medication.js';
import { MedicationLog } from '../models/MedicationLog.js';
import { computeAdherence } from '../services/analytics.js';
import { extractPrescription } from '../services/ai/vision.js';
import { buildSchedule } from '../services/medicationSchedule.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { AiUnavailableError } from '../services/ai/gemini.js';
import { MedicineBrand, brandSlug } from '../models/MedicineBrand.js';
import { notifyPatientOfMedicineChange } from '../services/notifications.js';

const router = Router({ mergeParams: true });
router.use(requireAuth, resolvePatientScope);

/**
 * True when a clinician is acting on a patient's record rather than the
 * patient acting on their own.
 *
 * The whole point of the notification below. This route is patient-scoped —
 * a patient adds their own medicines through it too — and telling someone
 * "your doctor updated your medicines" about a row they just typed in
 * themselves would be worse than saying nothing.
 */
function actingOnBehalf(req) {
  return req.user.role !== 'patient' && String(req.user._id) !== String(req.patientId);
}


// Prescription photo upload for scanning. Kept in memory — the bytes go
// straight to the vision model and are never persisted.
const scanUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(badRequest('Only image files are allowed'));
  },
});

const scheduleSlot = z.object({
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Time must be HH:mm'),
  relationToMeal: z.enum(['before_meal', 'after_meal', 'with_meal', 'any']).default('any'),
});

const medicationSchema = z.object({
  name: z.string().trim().min(1).max(160),
  genericName: z.string().max(160).optional(),
  form: z.enum(MED_FORMS).default('tablet'),
  strength: z.string().max(60).optional(),
  dose: z.string().max(60).optional(),
  schedule: z.array(scheduleSlot).min(1, 'At least one dose time is required').max(8),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  startDate: z.coerce.date().default(() => new Date()),
  endDate: z.coerce.date().optional(),
  instructions: z.string().max(600).optional(),
});

router.get(
  '/',
  validate({ query: z.object({ includeInactive: z.coerce.boolean().default(false) }) }),
  audit('read', 'Medication'),
  asyncHandler(async (req, res) => {
    const filter = { patient: req.patientId };
    if (!q(req).includeInactive) filter.isActive = true;
    const items = await Medication.find(filter).sort({ createdAt: -1 }).lean();
    // Checked against the clinic's brand list on the way out, so a doctor
    // opening a record sees a wrong strength without anyone running a script.
    res.json({ items: (await withBrandCheck(items)).map(serialise) });
  }),
);

router.post(
  '/',
  validate({ body: medicationSchema }),
  audit('create', 'Medication'),
  asyncHandler(async (req, res) => {
    const med = await Medication.create({
      ...req.body,
      patient: req.patientId,
      prescribedBy: req.user.role === 'patient' ? undefined : req.user._id,
    });
    if (actingOnBehalf(req)) notifyPatientOfMedicineChange(req.patientId, req.user, 'added');
    res.status(201).json({ medication: serialise(med) });
  }),
);

/**
 * Scan a prescription photo into medicines.
 *
 * The photograph is read by the vision model and every legible medicine is
 * created in the tracker, with reminder times derived from its frequency — so a
 * patient photographs a paper prescription and their daily reminders are set
 * without typing anything. Unreadable photos return `readable: false` so the app
 * can ask for a clearer one rather than inventing medicines.
 */
router.post(
  '/scan',
  scanUpload.single('file'),
  audit('create', 'Medication'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw badRequest('Attach a prescription photo');

    let parsed;
    try {
      parsed = await extractPrescription({
        images: [{ mimeType: req.file.mimetype, base64: req.file.buffer.toString('base64') }],
      });
    } catch (err) {
      if (err instanceof AiUnavailableError) {
        return res.status(503).json({
          error: { code: 'AI_UNAVAILABLE', message: 'Could not read the prescription right now. Please try again.' },
        });
      }
      throw err;
    }

    if (!parsed || !parsed.readable || !parsed.items.length) {
      return res.json({ readable: false, created: [], note: parsed?.note ?? null });
    }

    const profile = await PatientProfile.findOne({ user: req.patientId }).select('mealTimes').lean();
    const mealTimes = profile?.mealTimes;

    // The letterhead, kept as a label. Never used to decide which medicines to
    // keep: a list missing the drug another specialist added is more dangerous
    // than a list carrying an unfamiliar name, because the interaction it hides
    // is invisible until it does harm.
    const p = parsed.prescriber ?? {};
    const written = p.writtenOn ? new Date(p.writtenOn) : null;
    const prescriber = {
      name: p.name || undefined,
      speciality: p.speciality || undefined,
      clinic: p.clinic || undefined,
      writtenOn: written && !Number.isNaN(written.getTime()) ? written : undefined,
    };
    const created = [];
    for (const item of parsed.items) {
      if (!item?.name) continue;
      // Upsert by name so re-scanning the same prescription (or a medicine the
      // patient already takes) updates that medicine rather than duplicating it.
      const med = await Medication.findOneAndUpdate(
        { patient: req.patientId, name: item.name, isActive: true },
        {
          $set: {
            patient: req.patientId,
            name: item.name,
            strength: item.strength,
            dose: item.dose,
            form: /insulin/i.test(item.name) ? 'insulin' : 'tablet',
            schedule: buildSchedule(item.frequency, mealTimes, item.relationToMeal ?? 'any'),
            startDate: new Date(),
            endDate: item.durationDays ? dayjs().add(item.durationDays, 'day').toDate() : undefined,
            instructions: item.instructions,
            prescribedBy: req.user.role === 'patient' ? undefined : req.user._id,
            // Marked as read off a photograph, not issued here.
            //
            // Without this a scanned medicine was indistinguishable from one
            // the doctor wrote in the app: prescribedBy was null either way,
            // and the tracker showed a cardiologist's tablet beside Dr. Dey's
            // own with nothing to tell them apart. The doctor needs to see it —
            // that is the point of a complete list — but needs to know it is
            // not theirs before changing anything about it.
            source: 'scan',
            externalPrescriber: prescriber,
            isActive: true,
          },
        },
        { upsert: true, setDefaultsOnInsert: true, new: true },
      );
      created.push(serialise(med));
    }

    // Once for the batch, not once per medicine — a scanned prescription is a
    // single act, and the coalescing window downstream would merge them anyway.
    // Only when a clinician scanned it: a patient photographing their own
    // prescription does not need telling what they just did.
    if (created.length > 0 && actingOnBehalf(req)) {
      notifyPatientOfMedicineChange(req.patientId, req.user, 'added');
    }

    res.status(201).json({ readable: true, created });
  }),
);

router.patch(
  '/:id',
  validate({ body: medicationSchema.partial().extend({ isActive: z.boolean().optional() }) }),
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    const update = { ...req.body };
    // A hand-set schedule is a manual override — stop a later meal-time change
    // from moving it, and drop the meal-slot anchor on those entries.
    if (Array.isArray(update.schedule)) {
      update.timesCustomized = true;
      update.schedule = update.schedule.map((s) => ({ time: s.time, relationToMeal: s.relationToMeal ?? 'any' }));
    }
    const med = await Medication.findOneAndUpdate(
      { _id: req.params.id, patient: req.patientId },
      { $set: update },
      { new: true, runValidators: true },
    );
    if (!med) throw notFound('Medication not found');
    if (actingOnBehalf(req)) notifyPatientOfMedicineChange(req.patientId, req.user, 'changed');
    res.json({ medication: serialise(med) });
  }),
);

router.delete(
  '/:id',
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    // Soft delete: adherence history for past doses must remain interpretable.
    const med = await Medication.findOneAndUpdate(
      { _id: req.params.id, patient: req.patientId },
      { isActive: false, endDate: new Date() },
    );
    if (!med) throw notFound('Medication not found');
    // Stopping matters more than starting, not less: a patient who keeps
    // taking something the doctor withdrew is the worse outcome, and their
    // reminders for it have just disappeared without explanation.
    if (actingOnBehalf(req)) notifyPatientOfMedicineChange(req.patientId, req.user, 'stopped');
    res.status(204).end();
  }),
);

/**
 * Today's dose slots, expanded from each medication's schedule and joined
 * against what has already been logged.
 */
router.get(
  '/schedule/today',
  validate({ query: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }) }),
  asyncHandler(async (req, res) => {
    // Dose times are clinic wall-clock ("08:00" means 08:00 in Kolkata), so the
    // day and every slot in it must be built in that zone. Reasoning in the
    // server's own zone made a UTC-hosted API place this morning's dose 5½
    // hours off and, in the small hours, on the wrong calendar day entirely —
    // which is how a dose still nine minutes away was reported as missed.
    const day = q(req).date ? clinicDateTime(q(req).date, '00:00') : inClinicTz(new Date());
    const dayStr = day.format('YYYY-MM-DD');
    const dayStart = day.startOf('day');
    const dayEnd = day.endOf('day');

    const meds = await Medication.find({
      patient: req.patientId,
      isActive: true,
      startDate: { $lte: dayEnd.toDate() },
      $or: [{ endDate: null }, { endDate: { $gte: dayStart.toDate() } }],
    }).lean();

    const logs = await MedicationLog.find({
      patient: req.patientId,
      scheduledFor: { $gte: dayStart.toDate(), $lte: dayEnd.toDate() },
    }).lean();

    const logKey = (medId, when) => `${medId}|${inClinicTz(when).format('HH:mm')}`;
    const logMap = new Map(logs.map((l) => [logKey(l.medication, l.scheduledFor), l]));

    const now = dayjs();
    const slots = [];

    for (const med of meds) {
      if (med.daysOfWeek?.length && !med.daysOfWeek.includes(day.day())) continue;

      for (const slot of med.schedule ?? []) {
        const scheduledFor = clinicDateTime(dayStr, slot.time);
        const log = logMap.get(logKey(med._id, scheduledFor.toDate()));

        // A dose is only "missed" once a grace period has elapsed, so the UI
        // does not scold a patient for being ten minutes late.
        const overdue = now.diff(scheduledFor, 'minute') > 120;
        const status = log ? log.status : overdue ? 'missed' : 'pending';

        slots.push({
          medicationId: med._id,
          name: med.name,
          form: med.form,
          strength: med.strength ?? null,
          dose: med.dose ?? null,
          time: slot.time,
          scheduledFor: scheduledFor.toDate(),
          relationToMeal: slot.relationToMeal,
          instructions: med.instructions ?? null,
          status,
          logId: log?._id ?? null,
        });
      }
    }

    slots.sort((a, b) => a.time.localeCompare(b.time));
    res.json({ date: day.format('YYYY-MM-DD'), slots });
  }),
);

/**
 * The patient's dose history over the last N days: every elapsed scheduled dose
 * (across current and stopped medicines) marked taken / skipped / missed, so the
 * patient can see exactly what they took and when. Missed = a slot that has come
 * and gone with no log — computed here rather than relying on materialised rows.
 */
router.get(
  '/schedule/history',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }) }),
  asyncHandler(async (req, res) => {
    const days = q(req).days;
    const nowClinic = inClinicTz(new Date());
    const nowRaw = dayjs();
    const start = nowClinic.subtract(days - 1, 'day').startOf('day');

    // History includes stopped medicines too, so a course that has since ended
    // still shows the doses the patient did (or didn't) take while on it.
    const meds = await Medication.find({
      patient: req.patientId,
      startDate: { $lte: nowClinic.toDate() },
    }).lean();

    const logs = await MedicationLog.find({
      patient: req.patientId,
      scheduledFor: { $gte: start.toDate() },
    }).lean();
    const logKey = (medId, when) => `${medId}|${inClinicTz(when).format('YYYY-MM-DDTHH:mm')}`;
    const logMap = new Map(logs.map((l) => [logKey(l.medication, l.scheduledFor), l]));

    const doses = [];
    for (const med of meds) {
      if (!med.schedule?.length) continue;
      const medStart = dayjs(med.startDate);
      const medEnd = med.endDate ? dayjs(med.endDate) : null;
      for (let d = start; !d.isAfter(nowClinic); d = d.add(1, 'day')) {
        if (med.daysOfWeek?.length && !med.daysOfWeek.includes(d.day())) continue;
        const dayStr = d.format('YYYY-MM-DD');
        for (const slot of med.schedule) {
          const scheduledFor = clinicDateTime(dayStr, slot.time);
          if (scheduledFor.isAfter(nowRaw)) continue; // not yet due
          if (scheduledFor.isBefore(medStart)) continue;
          if (medEnd && scheduledFor.isAfter(medEnd)) continue;
          const log = logMap.get(logKey(med._id, scheduledFor.toDate()));
          doses.push({
            medicationId: med._id,
            name: med.name,
            form: med.form,
            strength: med.strength ?? null,
            time: slot.time,
            relationToMeal: slot.relationToMeal,
            scheduledFor: scheduledFor.toDate(),
            status: log ? log.status : 'missed',
            takenAt: log?.takenAt ?? null,
          });
        }
      }
    }
    doses.sort((a, b) => new Date(b.scheduledFor) - new Date(a.scheduledFor));
    res.json({ days, doses });
  }),
);

router.post(
  '/:id/log',
  validate({
    body: z.object({
      scheduledFor: z.coerce.date(),
      status: z.enum(['taken', 'skipped', 'missed']),
      takenAt: z.coerce.date().optional(),
      actualDose: z.string().max(60).optional(),
      unitsAdministered: z.number().min(0).max(500).optional(),
      injectionSite: z
        .enum(['abdomen', 'left_thigh', 'right_thigh', 'left_arm', 'right_arm', 'buttock', 'other'])
        .optional(),
      skipReason: z.string().max(300).optional(),
    }),
  }),
  audit('create', 'MedicationLog'),
  asyncHandler(async (req, res) => {
    const med = await Medication.findOne({ _id: req.params.id, patient: req.patientId });
    if (!med) throw notFound('Medication not found');

    // Upsert on (medication, scheduledFor) so a flaky connection retrying the
    // same tap does not create duplicate doses.
    const log = await MedicationLog.findOneAndUpdate(
      { medication: med._id, scheduledFor: req.body.scheduledFor },
      {
        $set: {
          ...req.body,
          patient: req.patientId,
          medication: med._id,
          takenAt: req.body.status === 'taken' ? (req.body.takenAt ?? new Date()) : undefined,
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.status(201).json({ log: serialiseLog(log) });
  }),
);

router.get(
  '/adherence',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }) }),
  asyncHandler(async (req, res) => {
    res.json(await computeAdherence(req.patientId, { days: q(req).days }));
  }),
);

/// Just the figures, so "500/1" and "500/1 mg" are one strength.
const figuresOf = (v) => String(v ?? '').replace(/[^0-9./]/g, '');

/**
 * Attaches what the clinic's brand list says this product contains, when the
 * strength on the record disagrees with it.
 *
 * The prescribing check catches new mistakes and the audit script cleans up old
 * ones, but neither shows a doctor opening a record today that a strength is
 * wrong. This does — as a fact on the row, not a correction to it. `expected`
 * is what the records hold; what is stored is left exactly as written.
 */
export async function withBrandCheck(items) {
  const names = [...new Set(items.map((m) => brandSlug(m.name)).filter(Boolean))];
  if (names.length === 0) return items;

  const brands = await MedicineBrand.find({ slug: { $in: names } })
    .select('slug strengthLabel strengthUnit composition')
    .lean();
  if (brands.length === 0) return items;
  const bySlug = new Map(brands.map((b) => [b.slug, b]));

  return items.map((m) => {
    const b = bySlug.get(brandSlug(m.name));
    if (!b?.strengthLabel) return m;
    const expected = b.strengthUnit ? `${b.strengthLabel} ${b.strengthUnit}` : b.strengthLabel;
    const has = (m.strength ?? '').trim();
    // An empty strength is incomplete, not contradictory — both are worth
    // showing, and the client words them differently.
    if (has.length > 0 && figuresOf(has) === figuresOf(expected)) return m;
    return {
      ...m,
      strengthExpected: expected,
      strengthComposition: (b.composition ?? [])
        .map((c) => `${c.ingredient} ${c.amount} ${c.unit ?? 'mg'}`)
        .join(' + '),
    };
  });
}

const serialise = (m) => ({
  id: m._id,
  name: m.name,
  genericName: m.genericName ?? null,
  form: m.form,
  strength: m.strength ?? null,
  dose: m.dose ?? null,
  schedule: (m.schedule ?? []).map((s) => ({ time: s.time, slot: s.slot ?? null, relationToMeal: s.relationToMeal })),
  daysOfWeek: m.daysOfWeek ?? [],
  route: m.route ?? 'oral',
  asNeeded: !!m.asNeeded,
  stat: !!m.stat,
  dayInterval: m.dayInterval ?? 1,
  startDate: m.startDate,
  endDate: m.endDate ?? null,
  isActive: m.isActive,
  instructions: m.instructions ?? null,
  // Present only when the brand list disagrees with what is stored.
  strengthExpected: m.strengthExpected ?? null,
  strengthComposition: m.strengthComposition ?? null,
  // Where it came from, so the app can say so rather than presenting every
  // medicine as though this clinic prescribed it.
  source: m.source ?? 'clinic',
  externalPrescriber:
    m.externalPrescriber && (m.externalPrescriber.name || m.externalPrescriber.clinic)
      ? {
          name: m.externalPrescriber.name ?? null,
          speciality: m.externalPrescriber.speciality ?? null,
          clinic: m.externalPrescriber.clinic ?? null,
          writtenOn: m.externalPrescriber.writtenOn ?? null,
        }
      : null,
});

const serialiseLog = (l) => ({
  id: l._id,
  medicationId: l.medication,
  scheduledFor: l.scheduledFor,
  status: l.status,
  takenAt: l.takenAt ?? null,
  unitsAdministered: l.unitsAdministered ?? null,
  injectionSite: l.injectionSite ?? null,
  skipReason: l.skipReason ?? null,
});

export default router;
