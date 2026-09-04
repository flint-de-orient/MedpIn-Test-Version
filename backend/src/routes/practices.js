import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Practice } from '../models/Practice.js';
import { Clinic } from '../models/Clinic.js';
import { User, ROLES } from '../models/User.js';
import { forgetClinicIdentity } from '../services/clinicIdentity.js';

/**
 * The practice a clinician belongs to, and how complete it is.
 *
 * ---- Why completeness is computed here ----------------------------------
 *
 * The obvious version of this endpoint returns the practice row and lets the
 * screen decide what is missing. That puts a clinical rule — what a
 * prescription must legally carry — inside a Flutter widget, where the next
 * person to touch the layout can delete it without knowing what it was for.
 *
 * A registration number is not profile decoration. It prints under the
 * signature, and a prescription without one is not a valid document. So the
 * server says what is missing and why it matters, and the screen renders that
 * answer rather than inventing its own.
 */
const router = Router();
router.use(requireAuth, requireClinician);

/**
 * What a prescription needs before it is worth printing.
 *
 * `blocking` marks the fields whose absence makes the document invalid rather
 * than merely plain. The distinction matters on the screen: a missing tagline
 * is a nag, a missing registration number is a legal problem, and showing both
 * in the same grey list teaches people to ignore the list.
 */
const READINESS = [
  { key: 'name', blocking: true, label: 'Practice name', prints: 'the top line of the letterhead' },
  {
    key: 'registrationNo',
    blocking: true,
    label: 'Registration number',
    prints: 'under the signature, where the council number must appear',
  },
  {
    key: 'doctorDisplayName',
    blocking: true,
    label: 'Doctor’s printed name',
    prints: 'beside the signature',
  },
  {
    key: 'logoLightAssetId',
    blocking: false,
    label: 'Logo',
    prints: 'the letterhead mark, and the app’s header',
  },
  { key: 'tagline', blocking: false, label: 'Tagline', prints: 'the line under the name' },
];

function readinessOf(practice) {
  const missing = READINESS.filter((f) => !practice?.[f.key]).map((f) => ({
    key: f.key,
    label: f.label,
    prints: f.prints,
    blocking: f.blocking,
  }));

  return {
    missing,
    // A prescription can be issued when nothing blocking is absent. Said
    // positively because that is the question the doctor is actually asking.
    canPrintPrescription: missing.every((m) => !m.blocking),
    complete: missing.length === 0,
  };
}

/**
 * The caller's practice, its locations, and who works in it.
 *
 * One request rather than four. This screen is opened between patients, and
 * four round trips on a clinic's connection is four chances to show a spinner.
 */
router.get(
  '/mine',
  asyncHandler(async (req, res) => {
    // Through the clinician's clinic, since membership does not exist yet.
    // When it does, this becomes a Membership lookup and nothing else here
    // changes — which is why the shape is "the practice" and not "the clinic".
    const clinic = await Clinic.findOne({ isActive: true })
      .sort({ sortIndex: 1, createdAt: 1 })
      .populate('practice')
      .lean();

    const practice =
      clinic?.practice && typeof clinic.practice === 'object' ? clinic.practice : null;

    if (!practice) {
      // Not an error. It is every deployment that has not run the backfill,
      // and the screen has a real answer for it.
      return res.json({ practice: null, needsBackfill: true });
    }

    const [locations, people] = await Promise.all([
      Clinic.find({ practice: practice._id }).sort({ sortIndex: 1, createdAt: 1 }).lean(),
      User.aggregate([
        { $match: { role: { $in: [ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN] }, isActive: true } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]),
    ]);

    res.json({
      practice: Practice.hydrate(practice).toPublic(),
      readiness: readinessOf(practice),
      locations: locations.map((c) => ({
        id: String(c._id),
        name: c.name,
        city: c.city ?? null,
        isActive: c.isActive,
        // Whether this location has its own brand, or inherits the practice's.
        // Shown so a doctor can tell why two branches print differently.
        overridesBrand: Boolean(c.tagline || c.registrationNo || c.logoLightAssetId),
        weeklyHourCount: (c.weeklyHours ?? []).length,
      })),
      people: {
        doctors: people.find((p) => p._id === ROLES.DOCTOR)?.count ?? 0,
        staff: people.find((p) => p._id === ROLES.STAFF)?.count ?? 0,
        dieticians: people.find((p) => p._id === ROLES.DIETICIAN)?.count ?? 0,
      },
    });
  }),
);

/**
 * Edit the practice's brand.
 *
 * Doctor-only: this is what prints on a legal document.
 *
 * Note what is absent — `status` and `verification` are not editable here. A
 * practice marking itself verified is not verification, and a practice that
 * could set its own status could un-suspend itself.
 */
router.patch(
  '/:id',
  requireDoctor,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160).optional(),
      tagline: z.string().trim().max(160).nullable().optional(),
      doctorDisplayName: z.string().trim().max(160).nullable().optional(),
      registrationNo: z.string().trim().max(60).nullable().optional(),
      logoLightAssetId: z.string().nullable().optional(),
      logoDarkAssetId: z.string().nullable().optional(),
      logoNeedsDarkChip: z.boolean().optional(),
    }),
  }),
  audit('update', 'Practice'),
  asyncHandler(async (req, res) => {
    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    for (const [k, v] of Object.entries(req.body)) practice[k] = v;
    await practice.save();

    // The identity cache holds the practice's fields for up to a minute. Left
    // alone, the doctor saves a new registration number and the next
    // prescription prints the old one.
    forgetClinicIdentity();

    res.json({ practice: practice.toPublic(), readiness: readinessOf(practice) });
  }),
);

export default router;
