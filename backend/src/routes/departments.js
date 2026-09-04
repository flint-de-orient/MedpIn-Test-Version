import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound, conflict } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Department } from '../models/Department.js';
import { DoctorDepartment } from '../models/DoctorDepartment.js';
import { User, ROLES } from '../models/User.js';

/**
 * Specialties, and which doctors practise in them.
 *
 * Its own file rather than another few hundred lines in `doctor.js`, which is
 * already two thousand long. A modular monolith stays modular by the boring
 * method: when a subject gets its own models, it gets its own router.
 *
 * ---- Nothing here changes an existing screen ----------------------------
 *
 * Every route is new. No prescription grows a department line, no header
 * changes, no list is filtered differently. The clinic that is running today
 * carries on exactly as it is, and this sits beside it until there is a second
 * practice to need it.
 */
const router = Router();
router.use(requireAuth, requireClinician);

/** Shared specialties plus this practice's own, in display order. */
const visibleTo = (practice) => ({
  isActive: true,
  $or: [{ practice: null }, ...(practice ? [{ practice }] : [])],
});

/**
 * Every department this caller may use.
 *
 * Readable by any clinician — the desk needs it to say which doctor a patient
 * is booked with, and a dietician needs it to know who wrote a plan.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const language = req.query.language ?? req.user.language ?? 'en';
    const items = await Department.find(visibleTo(req.query.practice))
      .sort({ sortIndex: 1, 'names.en': 1 })
      .lean();

    res.json({
      items: items.map((d) =>
        Department.hydrate(d).toPublic(language),
      ),
    });
  }),
);

/**
 * Add a specialty this practice runs.
 *
 * Doctor-only: a department carries the Home cards its patients see, so
 * creating one is a decision about what the app shows a sick person.
 *
 * The shared specialties cannot be created here — they ship with the platform
 * and belong to everyone. What this is for is "Diabetic Foot Clinic", the thing
 * one practice runs and nobody else has a name for.
 */
router.post(
  '/',
  requireDoctor,
  validate({
    body: z.object({
      key: z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z][a-z0-9_]{1,48}$/, 'Use lower-case letters, digits and underscores'),
      names: z.object({
        en: z.string().trim().min(2).max(80),
        bn: z.string().trim().max(80).optional(),
        hi: z.string().trim().max(80).optional(),
      }),
      practice: z.string().optional(),
      homeCards: z.array(z.string().max(40)).max(12).optional(),
      sortIndex: z.number().int().min(0).max(9999).optional(),
    }),
  }),
  audit('create', 'Department'),
  asyncHandler(async (req, res) => {
    const { key, names, practice, homeCards, sortIndex } = req.body;

    // Checked against the shared rows too, not just this practice's. A practice
    // defining `cardiology` alongside the platform's would leave its doctors
    // two departments with one name and no way to tell them apart.
    if (!(await Department.keyIsAvailable(key, practice ?? null))) {
      throw conflict('A department with that key already exists.');
    }

    const created = await Department.create({
      key,
      names,
      // Never null from this route: null means shared, and shared rows are the
      // platform's. A practice creating one would be editing every clinic's list.
      practice: practice ?? req.user.practice ?? null,
      homeCards: homeCards ?? [],
      // Empty, and not settable here. Red flags are written by a clinician in
      // that specialty, reviewed, and seeded — not typed into a create form.
      triageRules: [],
      sortIndex: sortIndex ?? 500,
      isSeed: false,
    });

    res.status(201).json({ department: created.toPublic(req.user.language ?? 'en') });
  }),
);

/**
 * Rename one, reorder it, or retire it.
 *
 * A shared department cannot be edited from here. One practice renaming
 * "Cardiologist" would rename it on every other practice's letterhead.
 */
router.patch(
  '/:id',
  requireDoctor,
  validate({
    body: z.object({
      names: z
        .object({
          en: z.string().trim().min(2).max(80).optional(),
          bn: z.string().trim().max(80).optional(),
          hi: z.string().trim().max(80).optional(),
        })
        .optional(),
      homeCards: z.array(z.string().max(40)).max(12).optional(),
      sortIndex: z.number().int().min(0).max(9999).optional(),
      isActive: z.boolean().optional(),
    }),
  }),
  audit('update', 'Department'),
  asyncHandler(async (req, res) => {
    const dept = await Department.findById(req.params.id);
    if (!dept) throw notFound('Department not found');
    if (dept.practice == null) {
      throw badRequest('This is a shared specialty and cannot be edited here.');
    }

    const { names, homeCards, sortIndex, isActive } = req.body;
    if (names) dept.names = { ...dept.names.toObject?.() ?? dept.names, ...names };
    if (homeCards) dept.homeCards = homeCards;
    if (sortIndex != null) dept.sortIndex = sortIndex;
    if (isActive != null) dept.isActive = isActive;

    await dept.save();
    res.json({ department: dept.toPublic(req.user.language ?? 'en') });
  }),
);

/** The departments a doctor currently practises in. */
router.get(
  '/doctors/:id',
  asyncHandler(async (req, res) => {
    const rows = await DoctorDepartment.find({ doctor: req.params.id, endedOn: null })
      .populate('department')
      .lean();

    const language = req.user.language ?? 'en';
    res.json({
      items: rows
        .filter((r) => r.department)
        .map((r) => ({
          ...Department.hydrate(r.department).toPublic(language),
          isPrimary: Boolean(r.isPrimary),
        })),
    });
  }),
);

/**
 * Put a doctor in a department, or take them out.
 *
 * `isPrimary` decides what prints under their name when they hold several. A
 * doctor in three departments with no primary would have the letterhead pick
 * whichever row came back first — a different one on different days.
 */
router.post(
  '/doctors/:id',
  requireDoctor,
  validate({
    body: z.object({
      departmentId: z.string(),
      isPrimary: z.boolean().optional(),
      practice: z.string().optional(),
    }),
  }),
  audit('update', 'User'),
  asyncHandler(async (req, res) => {
    const doctor = await User.findOne({ _id: req.params.id, role: ROLES.DOCTOR })
      .select('_id')
      .lean();
    if (!doctor) throw notFound('Doctor not found');

    const dept = await Department.findById(req.body.departmentId).select('_id').lean();
    if (!dept) throw notFound('Department not found');

    const practice = req.body.practice ?? null;

    if (req.body.isPrimary) {
      // Exactly one primary per doctor per practice. Cleared before the write
      // rather than after, so a failure between the two leaves none rather
      // than two — and none is a letterhead with no specialty, which is what
      // it says today.
      await DoctorDepartment.updateMany(
        { doctor: doctor._id, practice },
        { $set: { isPrimary: false } },
      );
    }

    const row = await DoctorDepartment.findOneAndUpdate(
      { doctor: doctor._id, department: dept._id, practice },
      { $set: { isPrimary: Boolean(req.body.isPrimary), endedOn: null } },
      { upsert: true, new: true },
    );

    res.status(201).json({ id: String(row._id), isPrimary: row.isPrimary });
  }),
);

/** Take a doctor out of a department. Ended, never deleted — see the model. */
router.delete(
  '/doctors/:id/:departmentId',
  requireDoctor,
  audit('update', 'User'),
  asyncHandler(async (req, res) => {
    const updated = await DoctorDepartment.findOneAndUpdate(
      { doctor: req.params.id, department: req.params.departmentId, endedOn: null },
      { $set: { endedOn: new Date(), isPrimary: false } },
    );
    if (!updated) throw notFound('That doctor is not in that department');
    res.status(204).end();
  }),
);

export default router;
