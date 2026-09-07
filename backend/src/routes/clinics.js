import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireClinician } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, badRequest } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Clinic } from '../models/Clinic.js';
import { practiceOf } from '../middleware/practiceScope.js';
import { User, ROLES } from '../models/User.js';
import { generateSlots } from '../services/scheduling.js';
import { forgetClinicIdentity } from '../services/clinicIdentity.js';
import { dayjs, DATE_RE, TIME_RE } from '../utils/clinicTime.js';
import { resolveDoctor } from '../services/doctorContext.js';

const router = Router();
router.use(requireAuth);

const isClinician = (req) => req.user.role !== ROLES.PATIENT;

const timeStr = z.string().regex(TIME_RE, 'time must be HH:mm');
const windowShape = z
  .object({ start: timeStr, end: timeStr })
  .refine((w) => w.start < w.end, { message: 'window end must be after start' });

const weeklyHourShape = z
  .object({ dayOfWeek: z.number().int().min(0).max(6), start: timeStr, end: timeStr })
  .refine((w) => w.start < w.end, { message: 'window end must be after start' });

const overrideShape = z.object({
  date: z.string().regex(DATE_RE),
  isClosed: z.boolean().default(false),
  windows: z.array(windowShape).max(6).default([]),
  note: z.string().max(200).optional(),
});

const clinicBody = z.object({
  name: z.string().min(1).max(160),
  addressLine: z.string().max(400).optional(),
  city: z.string().max(120).optional(),
  phone: z.string().max(40).optional(),
  altPhone: z.string().max(40).optional(),
  mapUrl: z.string().max(600).optional(),
  // The brand the patient meets — see models/Clinic.js. Editable here so a
  // clinic can rename itself or change its number without a redeploy, which is
  // what living in an env var prevented.
  tagline: z.string().max(160).optional(),
  doctorDisplayName: z.string().max(160).optional(),
  registrationNo: z.string().max(60).optional(),
  logoLightAssetId: z.string().optional(),
  logoDarkAssetId: z.string().optional(),
  logoNeedsDarkChip: z.boolean().optional(),
  slotMinutes: z.number().int().min(5).max(120).default(15),
  weeklyHours: z.array(weeklyHourShape).max(50).default([]),
  overrides: z.array(overrideShape).max(120).default([]),
  isActive: z.boolean().default(true),
  sortIndex: z.number().int().optional(),
});

/** List clinics. Patients see only active ones; clinicians see everything. */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter = isClinician(req) ? {} : { isActive: true };
    const clinics = await Clinic.find(filter).sort({ sortIndex: 1, name: 1 });
    res.json({ items: clinics.map((c) => c.toPublic()) });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic || (!isClinician(req) && !clinic.isActive)) throw notFound('Clinic not found');
    res.json({ clinic: clinic.toPublic() });
  }),
);

/** Bookable slots for a clinic on a clinic-local date. */
router.get(
  '/:id/slots',
  validate({
    query: z.object({
      date: z.string().regex(DATE_RE),
      // Whose diary. Optional, and absent it falls back to the building's
      // hours — which is every request until a location has more than one
      // doctor sitting in it.
      doctorId: z.string().optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic || (!isClinician(req) && !clinic.isActive)) throw notFound('Clinic not found');

    const { date, doctorId } = q(req);
    if (!dayjs(date, 'YYYY-MM-DD', true).isValid()) throw badRequest('Invalid date');

    const slots = await generateSlots(clinic, date, { doctorId: doctorId ?? null });
    res.json({
      clinicId: clinic._id,
      date,
      slotMinutes: clinic.slotMinutes,
      slots,
    });
  }),
);

router.post(
  '/',
  requireClinician,
  validate({ body: clinicBody }),
  audit('create', 'Clinic'),
  asyncHandler(async (req, res) => {
    // A doctor adding a clinic is adding their own, which is the case the old
    // lookup missed: it went hunting for "the doctor" while one was making the
    // request. Staff adding one falls through to the practice's head doctor.
    const doctor = await resolveDoctor({ actingUser: req.user });
    /**
     * A location belongs to a practice, not to a doctor.
     *
     * `doctor` stays because the slot engine and the letterhead still read it,
     * and a location with two doctors has one building. But without `practice`
     * a new branch is invisible to every practice-scoped query — it would not
     * appear in the operator console's count, and the practice that opened it
     * would not see it in its own list.
     */
    const practiceId = await practiceOf(req);
    const clinic = await Clinic.create({
      ...req.body,
      doctor: doctor?._id,
      ...(practiceId ? { practice: practiceId } : {}),
    });
    res.status(201).json({ clinic: clinic.toPublic() });
  }),
);

router.patch(
  '/:id',
  requireClinician,
  validate({ body: clinicBody.partial() }),
  audit('update', 'Clinic'),
  asyncHandler(async (req, res) => {
    const clinic = await Clinic.findById(req.params.id);
    if (!clinic) throw notFound('Clinic not found');
    Object.assign(clinic, req.body);
    await clinic.save();
    // The identity resolver caches for a minute. Without this the person who
    // just renamed the clinic is shown the old name back, which reads as the
    // save having failed.
    forgetClinicIdentity();
    res.json({ clinic: clinic.toPublic() });
  }),
);

/**
 * Soft-delete: mark inactive rather than remove, so appointments already booked
 * here keep a valid clinic reference and history stays intact.
 */
router.delete(
  '/:id',
  requireClinician,
  audit('update', 'Clinic'),
  asyncHandler(async (req, res) => {
    const clinic = await Clinic.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!clinic) throw notFound('Clinic not found');
    res.json({ clinic: clinic.toPublic() });
  }),
);

export default router;
