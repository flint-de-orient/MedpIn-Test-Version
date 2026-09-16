import { Router } from 'express';
import multer from 'multer';
import dayjs from 'dayjs';
import { z } from 'zod';
import { inClinicTz, clinicDateTime } from '../utils/clinicTime.js';
import { requireAuth, resolvePatientScope } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { requireRecordAccess, requirePermission } from '../middleware/authorise.js';
import { PERMISSIONS } from '../models/Membership.js';
import { asyncHandler, notFound, badRequest, forbidden, AppError } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Medication, MED_FORMS, PRESCRIPTION_STATE, TAKING_STATE } from '../models/Medication.js';
import { Membership } from '../models/Membership.js';
import { ROLES } from '../models/User.js';
import {
  PRESCRIPTION_STANDS,
  prescriptionStateOf,
  takingStateOf,
  isPatientOwned,
  openPatientStop,
  occursOn,
  effectiveEnd,
  doseExpected,
  LATE_AFTER_MINUTES,
  completeEndedCourses,
  stopTaking,
  resumeTaking,
  stopByDoctor,
} from '../services/medicationLifecycle.js';
import { raiseAlert } from '../services/alerts.js';
import mongoose from 'mongoose';
import { MedicationLog } from '../models/MedicationLog.js';
import { computeAdherence } from '../services/analytics.js';
import { extractPrescription } from '../services/ai/vision.js';
import { buildSchedule, scheduleText, relationFromText } from '../services/medicationSchedule.js';
import { normaliseScannedItems } from '../services/prescriptionItems.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { AiUnavailableError } from '../services/ai/gemini.js';
import { MedicineBrand, brandSlug } from '../models/MedicineBrand.js';
import { notifyPatientOfMedicineChange } from '../services/notifications.js';
import { practiceOfPatient, practiceOf, practicesOf } from '../middleware/practiceScope.js';

const router = Router({ mergeParams: true });
// Whose patient this is, then what this person may do with them: the medicine list and its doses.
// `resolvePatientScope` answers the first and was, until now, the only thing
// asked — so EDIT_RECORD was granted by every preset and enforced by nothing.
router.use(requireAuth, resolvePatientScope, requireRecordAccess());

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

/** The medicine, on this patient's list, or 404. */
async function findMedicine(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw notFound('Medication not found');
  const med = await Medication.findOne({ _id: req.params.id, patient: req.patientId });
  if (!med) throw notFound('Medication not found');
  return med;
}

/**
 * Whether this clinician's practice may change this medicine.
 *
 * Its own practice's prescriptions only. Another practice reads the whole list
 * — what a patient is on predates any one practice, see recordWindow.test.js —
 * and may change none of it: practice B stopping practice A's anticoagulant is
 * the failure this exists for.
 *
 * A medicine the patient added themselves is theirs, and no clinician's to
 * change. A row written before medicines carried their practice is decided by
 * whoever prescribed it — the practices they work or worked at — never by
 * "any practice that can see this patient".
 */
async function practiceMayChange(req, med) {
  if (isPatientOwned(med)) return false;
  const mine = await practicesOf(req);
  if (med.practice) return mine.includes(String(med.practice));
  const theirs = await Membership.find({ user: med.prescribedBy }).select('practice').lean();
  return theirs.some((m) => mine.includes(String(m.practice)));
}

/** Refuses a clinician who may not change this medicine, saying which kind of no. */
async function assertPracticeMayChange(req, med) {
  if (await practiceMayChange(req, med)) return;
  if (isPatientOwned(med)) {
    throw new AppError(
      403,
      'PATIENT_OWNED',
      'The patient added this medicine themselves. Advise them about it; it is theirs to change.',
    );
  }
  // Not this practice's prescription. Said as not found, as every other
  // practice's record is.
  throw notFound('Medication not found');
}

const prescriptionEnded = (med) =>
  new AppError(
    409,
    'PRESCRIPTION_ENDED',
    `This prescription has already ${prescriptionStateOf(med) === PRESCRIPTION_STATE.COMPLETED ? 'completed' : 'ended'}. Prescribe it again to restart it.`,
  );


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
  validate({
    query: z.object({
      includeInactive: z.coerce.boolean().default(false),
      /*
       * active  — being taken now: what reminders are armed for (the default,
       *           and all that older builds of the app know about)
       * current — every prescription that stands, including the ones the
       *           patient has stopped taking: the doctor's list
       * all     — history too: completed, stopped and cancelled
       */
      view: z.enum(['active', 'current', 'all']).optional(),
    }),
  }),
  audit('read', 'Medication'),
  asyncHandler(async (req, res) => {
    // A course that ran out yesterday leaves the list today, whether or not
    // anything else has looked at it since.
    await completeEndedCourses({ patient: req.patientId });

    const view = q(req).view ?? (q(req).includeInactive ? 'all' : 'active');
    const filter = { patient: req.patientId };
    if (view === 'active') filter.isActive = true;
    if (view === 'current') filter.$and = [PRESCRIPTION_STANDS];

    const [items, standing] = await Promise.all([
      Medication.find(filter).sort({ createdAt: -1 }).lean(),
      Medication.find({ patient: req.patientId, $and: [PRESCRIPTION_STANDS] })
        .select('name strength practice')
        .lean(),
    ]);
    // Checked against the clinic's brand list on the way out, so a doctor
    // opening a record sees a wrong strength without anyone running a script.
    const shaped = withSameMedicine(items, standing);
    res.json({
      items: (await withBrandCheck(actingOnBehalf(req) ? await withChangeable(req, shaped) : shaped)).map(serialise),
    });
  }),
);

/**
 * For a clinician: which of these their practice may change — so the app offers
 * Stop only where the server would allow it, and says whose each of the rest
 * is. The same rule as practiceMayChange, asked once for the whole list.
 */
async function withChangeable(req, items) {
  const mine = new Set(await practicesOf(req));
  const legacy = [...new Set(items.filter((m) => !m.practice && m.prescribedBy).map((m) => String(m.prescribedBy)))];
  const prescriberPractices = new Map();
  if (legacy.length) {
    for (const row of await Membership.find({ user: { $in: legacy } }).select('user practice').lean()) {
      const key = String(row.user);
      prescriberPractices.set(key, [...(prescriberPractices.get(key) ?? []), String(row.practice)]);
    }
  }
  return items.map((m) => ({
    ...m,
    changeableByYou:
      !isPatientOwned(m) &&
      (m.practice
        ? mine.has(String(m.practice))
        : (prescriberPractices.get(String(m.prescribedBy)) ?? []).some((p) => mine.has(p))),
  }));
}

/** "Metformin", "metformin ", "METFORMIN" — one medicine. */
const medicineKey = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * The other prescriptions on this list for the same medicine.
 *
 * Two practices can each prescribe metformin, and a new prescription can add
 * 1000 mg beside a 500 mg nobody stopped. Neither is merged — which to keep is
 * a clinical decision, and silently collapsing two prescriptions is how one
 * practice's disappears — so each row says what else stands beside it.
 */
function withSameMedicine(items, standing) {
  return items.map((m) => {
    const others = standing.filter(
      (o) => String(o._id) !== String(m._id) && medicineKey(o.name) === medicineKey(m.name),
    );
    if (!others.length) return m;
    return {
      ...m,
      alsoOnList: others.map((o) => ({
        id: String(o._id),
        strength: o.strength ?? null,
        samePractice: Boolean(m.practice && o.practice && String(m.practice) === String(o.practice)),
      })),
    };
  });
}

router.post(
  '/',
  /*
   * Changing what somebody takes is a prescribing act, whoever types it.
   *
   * EDIT_RECORD comes from the router and is right for noting a weight or
   * logging a dose; it is not the grant for adding a drug, changing a dose or
   * stopping a course. A patient acting on their own list has no membership
   * and passes, as everywhere else — their own stop is their own to make, and
   * C3 splits it from the doctor's properly.
   */
  requirePermission(PERMISSIONS.PRESCRIBE),
  validate({ body: medicationSchema }),
  audit('create', 'Medication'),
  asyncHandler(async (req, res) => {
    const clinician = actingOnBehalf(req);
    const med = await Medication.create({
      ...req.body,
      patient: req.patientId,
      prescribedBy: clinician ? req.user._id : undefined,
      // The practice whose prescription this is — and none, for a medicine the
      // patient typed in themselves, which was recorded as a clinic's.
      practice: clinician ? await practiceOf(req) : null,
      source: clinician ? 'clinic' : 'manual',
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
        practiceId: await practiceOfPatient(req.patientId),
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
    // Split, tidied and de-duplicated before anything is written.
    //
    // A line naming two drugs is two medicines; the same drug on two lines is
    // one medicine taken twice. Both were wrong here, and the second was the
    // quieter failure: keyed by name alone, the later write overwrote the
    // earlier and a dose vanished with no error anywhere.
    const items = normaliseScannedItems(parsed.items);

    // Nothing is written yet.
    //
    // This route used to create the medicines and arm their reminders before
    // the patient had read a word: the sheet that says "Added 4 medicines" was
    // a receipt, not a question. A misread strength or a mistaken hour was
    // already a live alarm by the time anyone could see it, and on this very
    // prescription three tablets were scheduled for eight in the morning.
    //
    // So the scan proposes and the patient disposes: what comes back here is a
    // preview with the times worked out, and POST /scan/confirm writes it.
    res.json({
      readable: true,
      preview: true,
      created: [],
      items: items.map((item) => ({
          name: item.name,
          strength: item.strength ?? null,
          dose: item.dose ?? null,
          frequency: item.frequency ?? null,
          // The doctor's own words about when. Shown beside the time on the
          // review sheet so the patient checks a sentence against their paper
          // rather than an hour they have no way to verify.
          whenText: item.whenText ?? null,
          instructions: item.instructions ?? null,
          relationToMeal: item.relationToMeal ?? null,
          durationDays: item.durationDays ?? null,
          schedule: buildSchedule(
            scheduleText(item),
            mealTimes,
            // Derived from the doctor's own words when the model did not classify
            // it, so "AF Lunch" stops arriving as "Anytime".
            item.relationToMeal ?? relationFromText(scheduleText(item)) ?? 'any',
          ),
      })),
      prescriber,
      note: parsed.note ?? null,
    });
  }),
);

/**
 * Write the medicines the patient has just looked at.
 *
 * Takes the reviewed items back rather than the photograph. Re-reading the
 * picture here would run the model a second time and could return a different
 * list from the one on screen — the patient would be approving one thing and
 * saving another, which is the whole failure this split exists to prevent.
 *
 * The patient may have dropped a row they did not recognise, so what arrives is
 * the truth about what they agreed to.
 */
router.post(
  '/scan/confirm',
  validate({
    body: z.object({
      items: z
        .array(
          z.object({
            name: z.string().trim().min(1).max(160),
            strength: z.string().max(60).nullish(),
            dose: z.string().max(60).nullish(),
            instructions: z.string().max(600).nullish(),
            durationDays: z.number().int().positive().max(3650).nullish(),
            schedule: z.array(scheduleSlot).max(8).default([]),
          }),
        )
        .min(1)
        .max(30),
      prescriber: z
        .object({
          name: z.string().max(160).nullish(),
          speciality: z.string().max(160).nullish(),
          clinic: z.string().max(160).nullish(),
          writtenOn: z.coerce.date().nullish(),
        })
        .nullish(),
    }),
  }),
  audit('create', 'Medication'),
  asyncHandler(async (req, res) => {
    const prescriber = req.body.prescriber
      ? {
          name: req.body.prescriber.name || undefined,
          speciality: req.body.prescriber.speciality || undefined,
          clinic: req.body.prescriber.clinic || undefined,
          writtenOn: req.body.prescriber.writtenOn || undefined,
        }
      : undefined;

    const clinician = actingOnBehalf(req);
    const practice = clinician ? await practiceOf(req) : null;

    const created = [];
    for (const item of req.body.items) {
      const med = await Medication.findOneAndUpdate(
        // Strength is part of the key. Metformin 500 and metformin 1000 are
        // different prescriptions, and matching on the name alone let the
        // second silently replace the first.
        //
        // So are where it came from and whose it is. Keyed on name, strength
        // and `isActive` alone, a patient photographing an old paper
        // prescription matched the clinic's own metformin and rewrote it as a
        // scan — the doctor's prescription became the patient's, with no
        // prescriber — and a scan filed at one practice matched another's.
        {
          patient: req.patientId,
          name: item.name,
          strength: item.strength ?? null,
          source: 'scan',
          practice,
          $and: [PRESCRIPTION_STANDS],
        },
        {
          $set: {
            patient: req.patientId,
            name: item.name,
            strength: item.strength ?? undefined,
            dose: item.dose ?? undefined,
            form: /insulin/i.test(item.name) ? 'insulin' : 'tablet',
            schedule: item.schedule,
            startDate: new Date(),
            endDate: item.durationDays
              ? dayjs().add(item.durationDays, 'day').toDate()
              : undefined,
            instructions: item.instructions ?? undefined,
            prescribedBy: req.user.role === 'patient' ? undefined : req.user._id,
            // Marked as read off a photograph, not issued here. Without it a
            // scanned medicine is indistinguishable from one the doctor wrote
            // in the app, and the doctor needs to know a tablet is not his
            // before changing anything about it.
            source: 'scan',
            practice,
            externalPrescriber: prescriber,
            prescriptionState: PRESCRIPTION_STATE.ACTIVE,
            takingState: TAKING_STATE.TAKING,
            isActive: true,
          },
        },
        { upsert: true, setDefaultsOnInsert: true, new: true },
      );
      created.push(serialise(med));
    }

    // Once for the batch, not once per medicine — a scanned prescription is a
    // single act. Only when a clinician scanned it: a patient photographing
    // their own prescription does not need telling what they just did.
    if (created.length > 0 && actingOnBehalf(req)) {
      notifyPatientOfMedicineChange(req.patientId, req.user, 'added');
    }

    res.status(201).json({ created });
  }),
);

/**
 * Change a medicine.
 *
 * ---- Whose change it is --------------------------------------------------------
 *
 * The patient may re-time the reminders on a medicine their doctor prescribed —
 * that is when their alarm rings, not what was prescribed — and may stop or
 * restart taking it. Nothing else: the dose, strength, dates and name are the
 * prescription, and a patient's edit used to rewrite them in place. On a
 * medicine the patient added themselves, everything is theirs.
 *
 * A clinician changes only their own practice's prescriptions, and only while
 * they stand. `isActive` is not a field to set: false is a stop, recorded as
 * whose, and true on a stopped prescription is refused — restarting one is a
 * new prescription.
 */
router.patch(
  '/:id',
  requirePermission(PERMISSIONS.PRESCRIBE),
  validate({ body: medicationSchema.partial().extend({ isActive: z.boolean().optional() }) }),
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    const med = await findMedicine(req);
    const clinician = actingOnBehalf(req);
    const { isActive, ...fields } = req.body;

    if (clinician) {
      await assertPracticeMayChange(req, med);
    } else if (!isPatientOwned(med)) {
      const doctors = Object.keys(fields).filter((k) => k !== 'schedule');
      if (doctors.length) {
        throw new AppError(
          403,
          'DOCTOR_OWNED',
          `Your doctor prescribed this medicine, so only they can change its ${doctors.join(', ')}. You can change your reminder times, or stop taking it.`,
        );
      }
    }

    let current = med;
    if (Object.keys(fields).length) {
      // History is not edited. A completed or stopped prescription stays what
      // it was; changing it now would change what the record says was taken.
      if (prescriptionStateOf(med) !== PRESCRIPTION_STATE.ACTIVE) throw prescriptionEnded(med);

      const update = { ...fields };
      // A hand-set schedule is a manual override — stop a later meal-time change
      // from moving it, and drop the meal-slot anchor on those entries.
      if (Array.isArray(update.schedule)) {
        update.timesCustomized = true;
        update.schedule = update.schedule.map((s) => ({ time: s.time, relationToMeal: s.relationToMeal ?? 'any' }));
      }
      current = await Medication.findOneAndUpdate(
        { _id: med._id, patient: req.patientId, $and: [PRESCRIPTION_STANDS] },
        { $set: update },
        { new: true, runValidators: true },
      );
      if (!current) throw prescriptionEnded(med);
    }

    if (isActive === false) {
      current = clinician
        ? ((await stopByDoctor({
            medicationId: med._id,
            patientId: req.patientId,
            by: req.user._id,
            reason: 'Stopped by the doctor.',
          })) ?? current)
        : ((await stopTaking({ medicationId: med._id, patientId: req.patientId })) ?? current);
    } else if (isActive === true && !current.isActive) {
      if (clinician) throw prescriptionEnded(current);
      const resumed = await resumeTaking({ medicationId: med._id, patientId: req.patientId });
      if (!resumed) throw prescriptionEnded(current);
      current = resumed;
    }

    if (clinician) notifyPatientOfMedicineChange(req.patientId, req.user, isActive === false ? 'stopped' : 'changed');
    res.json({ medication: serialise(current) });
  }),
);

/**
 * "Stop" — by whoever presses it, recorded as theirs.
 *
 * Older builds of the app send this for both: the patient's Stop button and the
 * doctor's. A patient's is a stop in taking, and leaves the prescription as it
 * was written. A clinician's stops the prescription. Idempotent — a retry of a
 * stop that already happened is answered the same way.
 */
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.PRESCRIBE),
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    const med = await findMedicine(req);

    if (!actingOnBehalf(req)) {
      const stopped = await stopTaking({ medicationId: med._id, patientId: req.patientId });
      if (stopped) await tellTheirDoctor(req, stopped, null);
      return res.status(204).end();
    }

    await assertPracticeMayChange(req, med);
    const stopped = await stopByDoctor({
      medicationId: med._id,
      patientId: req.patientId,
      by: req.user._id,
      reason: 'Stopped by the doctor.',
    });
    // Stopping matters more than starting, not less: a patient who keeps
    // taking something the doctor withdrew is the worse outcome, and their
    // reminders for it have just disappeared without explanation.
    if (stopped) notifyPatientOfMedicineChange(req.patientId, req.user, 'stopped');
    res.status(204).end();
  }),
);

/**
 * The patient stops taking a medicine.
 *
 * Their prescription is left exactly as the doctor wrote it; the stop is
 * recorded as the patient's, with their reason, and the reminders stop. The
 * doctor who owns the prescription is told — see tellTheirDoctor.
 */
router.post(
  '/:id/stop-taking',
  validate({ body: z.object({ reason: z.string().trim().max(300).optional() }) }),
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    if (actingOnBehalf(req)) {
      throw forbidden('Only the patient stops taking a medicine. A clinician stops the prescription.');
    }
    const med = await findMedicine(req);
    const stopped = await stopTaking({ medicationId: med._id, patientId: req.patientId, reason: req.body.reason });
    if (stopped) {
      await tellTheirDoctor(req, stopped, req.body.reason ?? null);
      return res.json({ medication: serialise(stopped) });
    }

    const now = await Medication.findById(med._id).lean();
    // Pressed twice, or on two phones: already stopped is the answer asked for.
    if (now.takingState === TAKING_STATE.STOPPED_BY_PATIENT) return res.json({ medication: serialise(now) });
    throw prescriptionEnded(now);
  }),
);

/** The patient starts taking it again, while the prescription still stands. */
router.post(
  '/:id/resume-taking',
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    if (actingOnBehalf(req)) throw forbidden('Only the patient starts taking a medicine again.');
    const med = await findMedicine(req);
    const resumed = await resumeTaking({ medicationId: med._id, patientId: req.patientId });
    if (resumed) return res.json({ medication: serialise(resumed) });

    const now = await Medication.findById(med._id).lean();
    if (now.isActive) return res.json({ medication: serialise(now) });
    throw prescriptionEnded(now);
  }),
);

/** A clinician stops their practice's prescription, and says why. */
router.post(
  '/:id/stop',
  requirePermission(PERMISSIONS.PRESCRIBE),
  validate({ body: z.object({ reason: z.string().trim().min(5).max(500) }) }),
  audit('update', 'Medication'),
  asyncHandler(async (req, res) => {
    if (!actingOnBehalf(req)) {
      throw forbidden('A patient stops taking a medicine — see stop-taking. Stopping the prescription is the doctor’s.');
    }
    const med = await findMedicine(req);
    await assertPracticeMayChange(req, med);

    const stopped = await stopByDoctor({
      medicationId: med._id,
      patientId: req.patientId,
      by: req.user._id,
      reason: req.body.reason,
    });
    if (!stopped) throw prescriptionEnded(await Medication.findById(med._id).lean());

    notifyPatientOfMedicineChange(req.patientId, req.user, 'stopped');
    res.json({ medication: serialise(stopped) });
  }),
);

/**
 * Tell the practice whose prescription it is that the patient stopped taking it.
 *
 * An open alert on their dashboard — not a push: a patient stopping a tablet is
 * something to take up at the next contact, not a page. Never deduplicated
 * away: two medicines stopped in one sitting are two things the doctor needs to
 * know. Not raised for a medicine the patient added themselves, which no
 * practice prescribed.
 *
 * Best-effort, as every notification is: the stop is the record.
 */
async function tellTheirDoctor(req, med, reason) {
  if (isPatientOwned(med)) return;
  const label = [med.name, med.strength].filter(Boolean).join(' ');
  await raiseAlert({
    patientId: req.patientId,
    severity: 'warning',
    type: 'medication_nonadherence',
    title: `Stopped taking ${label}`,
    detail: reason ? `The patient stopped taking ${label}. Reason given: ${reason}` : `The patient stopped taking ${label}. No reason was given.`,
    source: { kind: 'adherence', ref: med._id },
    dedupeWindowMinutes: 0,
  }).catch(() => {});
}

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

    await completeEndedCourses({ patient: req.patientId });
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
      // Days of the week and the every-other-day interval, both — the interval
      // was never asked, so an alternate-day tablet was due, and then missed,
      // every day.
      if (!occursOn(med, day)) continue;

      for (const slot of med.schedule ?? []) {
        const scheduledFor = clinicDateTime(dayStr, slot.time);
        // Not before it was prescribed, and not after its course ends: a
        // prescription written at eleven has no eight o'clock dose that day.
        if (!doseExpected(med, scheduledFor.toDate())) continue;
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
          late: Boolean(log?.takenLate),
          logId: log?._id ?? null,
          medicationOwnedBy: isPatientOwned(med) ? 'patient' : 'practice',
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
      for (let d = start; !d.isAfter(nowClinic); d = d.add(1, 'day')) {
        const dayStr = d.format('YYYY-MM-DD');
        for (const slot of med.schedule) {
          const scheduledFor = clinicDateTime(dayStr, slot.time);
          if (scheduledFor.isAfter(nowRaw)) continue; // not yet due
          // Inside the prescription's life — its start, and the earliest of its
          // end date, a doctor's stop or its voiding — on a day it falls, and
          // not while the patient had stopped taking it. A dose they were not
          // meant to take is not a dose they missed.
          if (!doseExpected(med, scheduledFor.toDate())) continue;
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
            late: Boolean(log?.takenLate),
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
    const med = await findMedicine(req);
    const at = new Date(req.body.scheduledFor);

    /*
     * A dose that exists. Anything was accepted: a time the medicine is never
     * taken, a day it is not due, a date after the doctor stopped it — each one
     * a row that adherence then counted, and a patient recording "taken" for a
     * course that had ended was indistinguishable from one still on it.
     *
     * An as-needed medicine has no schedule, so any time up to now is a dose.
     * Late recording is allowed: yesterday's evening tablet, logged this
     * morning, is still yesterday's evening tablet.
     */
    if (at.getTime() > Date.now() + 12 * 60 * 60 * 1000) {
      throw badRequest('That dose is more than twelve hours away.');
    }
    if (!med.asNeeded) {
      const local = inClinicTz(at);
      const onSchedule = (med.schedule ?? []).some((s) => s.time === local.format('HH:mm'));
      const end = effectiveEnd(med);
      if (!onSchedule || !occursOn(med, local) || (med.startDate && at < new Date(med.startDate)) || (end && at > end)) {
        throw badRequest('That is not one of this medicine’s doses.');
      }
    }

    // Taken, but outside the grace period: recorded as late, not as on time.
    const takenAt = req.body.status === 'taken' ? (req.body.takenAt ?? new Date()) : undefined;
    const takenLate = Boolean(takenAt && takenAt.getTime() - at.getTime() > LATE_AFTER_MINUTES * 60 * 1000);

    // Upsert on (medication, scheduledFor) so a flaky connection retrying the
    // same tap does not create duplicate doses.
    const log = await MedicationLog.findOneAndUpdate(
      { medication: med._id, scheduledFor: req.body.scheduledFor },
      {
        $set: {
          ...req.body,
          patient: req.patientId,
          medication: med._id,
          takenAt,
          takenLate,
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
  // The doctor's side and the patient's, separately. isActive above is still
  // exact — both of these allow it — for every build that reads only that.
  prescriptionState: prescriptionStateOf(m),
  takingState: takingStateOf(m),
  ownedBy: isPatientOwned(m) ? 'patient' : 'practice',
  completedAt: m.completedAt ?? null,
  stoppedByDoctor: m.stoppedByDoctor?.at
    ? { at: m.stoppedByDoctor.at, reason: m.stoppedByDoctor.reason ?? null }
    : null,
  cancelled: m.cancelled?.at ? { at: m.cancelled.at, reason: m.cancelled.reason ?? null } : null,
  stoppedTaking: (() => {
    const stop = openPatientStop(m);
    return stop && m.takingState === TAKING_STATE.STOPPED_BY_PATIENT ? { at: stop.at, reason: stop.reason ?? null } : null;
  })(),
  alsoOnList: m.alsoOnList ?? [],
  // Whether the clinician asking may change it. Null when the patient asks.
  changeableByYou: m.changeableByYou ?? null,
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
  late: Boolean(l.takenLate),
  takenAt: l.takenAt ?? null,
  unitsAdministered: l.unitsAdministered ?? null,
  injectionSite: l.injectionSite ?? null,
  skipReason: l.skipReason ?? null,
});

export default router;
