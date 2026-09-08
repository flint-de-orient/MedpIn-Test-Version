import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound, conflict, forbidden } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Department } from '../models/Department.js';
import { DoctorDepartment } from '../models/DoctorDepartment.js';
import { User, ROLES } from '../models/User.js';
import { PERMISSIONS } from '../models/Membership.js';
import { requirePermission, membershipOf } from '../middleware/authorise.js';
import { practiceOf, practiceMembers } from '../middleware/practiceScope.js';
import { requireCapability } from '../middleware/requireCapability.js';
import { CAPABILITIES } from '../services/capabilities.js';

/**
 * Specialties, and which doctors practise in them.
 *
 * Its own file rather than another few hundred lines in `doctor.js`, which is
 * already two thousand long. A modular monolith stays modular by the boring
 * method: when a subject gets its own models, it gets its own router.
 *
 * ---- Every route here took its tenant from the caller -------------------
 *
 * This router shipped before anything called it, so nothing exercised it and
 * nothing reviewed it. All six routes decided which practice they were
 * operating on by reading the request:
 *
 *   GET   /                  `req.query.practice`  — any practice's list
 *   POST  /                  `req.body.practice`   — into any practice
 *   PATCH /:id               nothing at all        — edit anybody's row
 *   POST  /doctors/:id       `req.body.practice`   — assign into any practice
 *   DELETE /doctors/:id/...  nothing at all        — unassign anybody's doctor
 *
 * The worst was the fallback on POST. It read
 * `req.body.practice ?? req.user.practice ?? null`, and `User` has no
 * `practice` field — it lives on the membership. So a department created
 * without one in the body got `null`, and `null` here does not mean unknown.
 * It means *shared with every practice on the platform*. One clinic adding
 * "Diabetic Foot Clinic" would have put it on everybody's list, and no screen
 * anywhere would have shown who did it.
 *
 * The practice now comes from the membership on every route and is never read
 * from the request. A cross-practice id is refused rather than quietly scoped
 * away: it is a bug or an attempt, and doing nothing silently tells the caller
 * neither.
 */
const router = Router();
router.use(requireAuth, requireClinician);

/**
 * Refuse when the named person is demonstrably not one of yours.
 *
 * Permissive on unknown, like the read guards: a caller with no practice, or a
 * subject with no membership, is somebody the backfill has not reached rather
 * than an intruder. It narrows the moment both sides are known.
 */
/**
 * Your own record, or you administer departments.
 *
 * Both of these routes had `requireDoctor` and nothing else, so any doctor
 * could move any colleague into or out of a department — including out of one
 * they run. A blanket MANAGE_DEPARTMENT would be the obvious fix and the wrong
 * one: a doctor setting their own primary specialty is not an administrative
 * act, and needing the head for it is how a letterhead stays wrong for a month.
 *
 * So: your own is yours. Somebody else's needs the permission.
 */
async function mayChangeDepartmentsOf(req, userId) {
  if (String(req.user._id) === String(userId)) return true;

  const membership = await membershipOf(req);
  // No membership is no evidence, the same as everywhere else. It narrows the
  // moment there is a row to read.
  if (!membership) return true;
  return membership.can(PERMISSIONS.MANAGE_DEPARTMENT);
}

async function assertColleague(req, userId) {
  const scope = await practiceMembers(req, null, '_id');
  // `{}` is the permissive answer — no practice, or no memberships anywhere.
  if (!scope._id) return;

  const ids = scope._id.$in.map(String);
  if (!ids.includes(String(userId))) {
    throw notFound('Doctor not found');
  }
}

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
    // From the membership, not the query string. `?practice=` was an invitation
    // to read somebody else's list by editing a URL.
    const items = await Department.find(visibleTo(await practiceOf(req)))
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
  requirePermission(PERMISSIONS.MANAGE_DEPARTMENT),
  // Both layers, because they answer different questions. The permission says
  // this person administers departments; the capability says this practice has
  // them at all. A solo clinic's owner holds MANAGE_DEPARTMENT and still has
  // nothing to manage — see [services/capabilities.js].
  requireCapability(CAPABILITIES.DEPARTMENT),
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
      // No `practice`. A schema that accepts a field the handler ignores is a
      // field somebody will send and expect to have mattered.
      homeCards: z.array(z.string().max(40)).max(12).optional(),
      sortIndex: z.number().int().min(0).max(9999).optional(),
    }),
  }),
  audit('create', 'Department'),
  asyncHandler(async (req, res) => {
    const { key, names, homeCards, sortIndex } = req.body;

    /**
     * Which practice this belongs to, and why a missing one is refused.
     *
     * Everywhere else here an unknown practice permits, because the question is
     * "may this person see that" and absence is not evidence of a mismatch.
     * This is a different question. A department has to belong to something,
     * and the only value available when the practice is unknown is `null` —
     * which in this collection does not mean unknown. It means shared with
     * every practice there is.
     *
     * Permissive-on-unknown is about not locking people out of their own data.
     * It is not a licence to write into everybody else's.
     */
    const practice = await practiceOf(req);
    if (!practice) {
      throw badRequest(
        'This account is not linked to a practice yet, so there is nothing to add the department to.',
      );
    }

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
      practice,
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
  requirePermission(PERMISSIONS.MANAGE_DEPARTMENT),
  // Both layers, because they answer different questions. The permission says
  // this person administers departments; the capability says this practice has
  // them at all. A solo clinic's owner holds MANAGE_DEPARTMENT and still has
  // nothing to manage — see [services/capabilities.js].
  requireCapability(CAPABILITIES.DEPARTMENT),
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

    // And it has to be yours. The shared check above stopped one practice
    // renaming a specialty for everybody; it did nothing about one practice
    // renaming another practice's own. `notFound` rather than `forbidden`,
    // because confirming the id exists is itself an answer.
    const mine = await practiceOf(req);
    if (mine && String(dept.practice) !== String(mine)) {
      throw notFound('Department not found');
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
    // Your own colleagues only. This answered for any doctor id on the
    // platform, which is a small leak beside the writes below and still tells
    // one practice what another one's specialties are.
    await assertColleague(req, req.params.id);

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
      // No `practice`. See the note at the top of the file.
    }),
  }),
  audit('update', 'User'),
  asyncHandler(async (req, res) => {
    const practice = await practiceOf(req);
    await assertColleague(req, req.params.id);
    if (!(await mayChangeDepartmentsOf(req, req.params.id))) {
      throw forbidden('Only somebody who manages departments can change another doctor’s.');
    }

    const doctor = await User.findOne({ _id: req.params.id, role: ROLES.DOCTOR })
      .select('_id')
      .lean();
    if (!doctor) throw notFound('Doctor not found');

    // Shared specialties, or this practice's own. A department belonging to
    // somebody else is not a department this doctor can practise in, and the
    // assignment row would have carried the other practice's id.
    const dept = await Department.findOne({
      _id: req.body.departmentId,
      $or: [{ practice: null }, ...(practice ? [{ practice }] : [])],
    })
      .select('_id')
      .lean();
    if (!dept) throw notFound('Department not found');

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
    await assertColleague(req, req.params.id);
    if (!(await mayChangeDepartmentsOf(req, req.params.id))) {
      throw forbidden('Only somebody who manages departments can change another doctor’s.');
    }

    const updated = await DoctorDepartment.findOneAndUpdate(
      { doctor: req.params.id, department: req.params.departmentId, endedOn: null },
      { $set: { endedOn: new Date(), isPrimary: false } },
    );
    if (!updated) throw notFound('That doctor is not in that department');
    res.status(204).end();
  }),
);

export default router;
