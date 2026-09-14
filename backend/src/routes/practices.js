import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../models/Practice.js';
import { Clinic } from '../models/Clinic.js';
import { User, ROLES, CLINICIAN_ROLES } from '../models/User.js';
import { Membership, PERMISSIONS } from '../models/Membership.js';
import { requirePermission } from '../middleware/authorise.js';
import { forgetClinicIdentity } from '../services/clinicIdentity.js';
import {
  joinByPhone,
  joinPractice,
  leavePractice,
  membersOf,
  isOwnerOf,
} from '../services/memberships.js';
import { phoneFromToken } from '../services/otp.js';
import { toE164 } from '../utils/phone.js';
import { callablePhone } from '../services/clinicContact.js';
import { badRequest, forbidden } from '../middleware/errors.js';

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

const EMPTY_COUNTS = Object.freeze({ doctors: 0, staff: 0, dieticians: 0 });

/** Role counts from a membership aggregate, or null when there are none yet. */
function countsFrom(rows) {
  if (!rows?.length) return null;
  return {
    doctors: rows.find((r) => r._id === ROLES.DOCTOR)?.count ?? 0,
    staff: rows.find((r) => r._id === ROLES.STAFF)?.count ?? 0,
    dieticians: rows.find((r) => r._id === ROLES.DIETICIAN)?.count ?? 0,
  };
}

/**
 * Has the membership backfill run at all?
 *
 * Cached once true, because a collection that has rows does not go back to
 * having none. The same helper shape as [middleware/practiceScope.js], and for
 * the same reason: it is the only honest way to tell "not migrated yet" from
 * "this practice genuinely has nobody".
 */
let _membershipsExist = false;
async function membershipsExist() {
  if (_membershipsExist) return true;
  _membershipsExist = (await Membership.estimatedDocumentCount()) > 0;
  return _membershipsExist;
}

/** The pre-membership answer: every active clinician on the deployment. */
async function countsFromRoles() {
  const rows = await User.aggregate([
    // Everybody who works here, from the one list. Written out as three, this
    // undercounted a practice the moment it hired anybody else — and the count
    // is what the plan's staff cap is checked against.
    { $match: { role: { $in: [...CLINICIAN_ROLES] }, isActive: true } },
    { $group: { _id: '$role', count: { $sum: 1 } } },
  ]);
  return countsFrom(rows) ?? { doctors: 0, staff: 0, dieticians: 0 };
}

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
    /*
     * The caller's own current membership, and nothing else.
     *
     * This fell back to the practice owning the platform's first active clinic
     * whenever the caller had no membership — so an account whose membership
     * had ended, or never existed, was shown the founding practice's
     * letterhead, plan, locations and headcount, and the edit sheet beneath it
     * saved onto that practice. No membership is no practice. The screen
     * already has an answer for that, and "whichever clinic was created first"
     * is never it.
     */
    const membership = await Membership.findOne({
      user: req.user.id ?? req.user._id,
      status: 'active',
      endedOn: null,
    })
      .populate('practice')
      .lean();

    const practice =
      membership?.practice && typeof membership.practice === 'object'
        ? membership.practice
        : null;

    if (!practice) return res.json({ practice: null });

    const [locations, people] = await Promise.all([
      Clinic.find({ practice: practice._id }).sort({ sortIndex: 1, createdAt: 1 }).lean(),
      Membership.aggregate([
        { $match: { practice: practice._id, status: 'active', endedOn: null } },
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
      /*
       * Memberships when the backfill has run; the platform-wide role count
       * only until then.
       *
       * The fallback used to fire whenever *this* practice had no membership
       * rows, which was right for exactly as long as no practice had any. Once
       * the backfill ran it meant something else: a practice with nobody in it
       * reported every clinician on the deployment, so a newly created one
       * would show the founding clinic's headcount as its own.
       *
       * Zero is a true answer, and the collection being empty is what
       * distinguishes it from an unmigrated database.
       */
      people:
        countsFrom(people) ?? ((await membershipsExist()) ? EMPTY_COUNTS : await countsFromRoles()),
    });
  }),
);

/* ------------------------------------------------------------------ people */

/**
 * Who works here.
 *
 * ---- Why this is not the same as `/doctor/staff` -----------------------
 *
 * That route lists every account on the platform with the staff role, because
 * it was written when there was one clinic and "every staff account" and "this
 * clinic's staff" were the same set. They stop being the same the moment a
 * second practice exists, and this is the one that asks the right question.
 */
router.get(
  '/:id/members',
  requireClinician,
  audit('read', 'Membership'),
  asyncHandler(async (req, res) => {
    await assertBelongs(req, req.params.id);

    const rows = await membersOf(req.params.id);
    res.json({
      items: rows.map((m) => ({
        id: String(m._id),
        userId: String(m.user?._id ?? m.user),
        name: m.user?.name ?? 'Unknown',
        phone: m.user?.phone ?? null,
        role: m.role,
        isOwner: Boolean(m.isOwner),
        status: m.status,
        endedOn: m.endedOn ?? null,
        qualifications: m.user?.qualifications ?? null,
        registrationNo: m.user?.registrationNo ?? null,
        permissions: m.permissions?.length ? m.permissions : [],
        startedOn: m.startedOn,
      })),
    });
  }),
);

/**
 * Add a colleague.
 *
 * ---- The number must have been answered, not typed ---------------------
 *
 * `phoneToken` is proof from the OTP flow that the handset replied. The reason
 * is the same one `/doctor/staff` gives for its own token and applies harder
 * here: a doctor added to a practice can open every patient in it, and one
 * mistyped digit gives that to whoever owns the number that was typed instead.
 *
 * ---- An existing account is joined, not duplicated ---------------------
 *
 * Dr. Dey working at a second practice is a second membership. Creating a
 * second Dr. Dey would give him two sets of patients and two logins, and the
 * two would drift apart from the first day.
 */
router.post(
  '/:id/members',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(120),
      phone: z
        .string()
        .trim()
        .transform(toE164)
        .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number')),
      phoneToken: z.string().min(20),
      role: z.enum([...CLINICIAN_ROLES]),
      /// Another owner. A practice with two heads survives one of them leaving,
      /// which the single-owner case deliberately cannot.
      isOwner: z.boolean().optional(),
      qualifications: z.string().trim().max(120).optional(),
      registrationNo: z.string().trim().max(60).optional(),
    }),
  }),
  audit('create', 'Membership'),
  asyncHandler(async (req, res) => {
    await assertOwner(req, req.params.id);

    // The token vouches for one number. Taking both as independent fields would
    // let somebody verify one and add another.
    if (phoneFromToken(req.body.phoneToken) !== req.body.phone) {
      throw badRequest('That verification was for a different number. Verify this one again.');
    }

    // Only an owner makes an owner. Otherwise somebody with MANAGE_STAFF can
    // promote themselves by adding a second account they control.
    if (req.body.isOwner && !(await isOwnerOf(req.user._id, req.params.id))) {
      throw forbidden('Only an owner can make somebody else an owner.');
    }

    const { user, membership, createdUser } = await joinByPhone({
      phone: req.body.phone,
      name: req.body.name,
      practice: req.params.id,
      role: req.body.role,
      isOwner: Boolean(req.body.isOwner),
      addedBy: req.user._id,
      qualifications: req.body.qualifications,
      registrationNo: req.body.registrationNo,
    });

    res.status(201).json({
      member: {
        id: String(membership._id),
        userId: String(user._id),
        name: user.name,
        phone: user.phone,
        role: membership.role,
        isOwner: membership.isOwner,
        status: membership.status,
      },
      // Whether they can sign in already, or are hearing about this for the
      // first time when they next try.
      accountCreated: createdUser,
    });
  }),
);

/**
 * End a membership.
 *
 * They keep their account and any other practice they work at. This says only
 * that they no longer work here, which is why it is not a delete.
 */
router.delete(
  '/:id/members/:membershipId',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  audit('delete', 'Membership'),
  asyncHandler(async (req, res) => {
    await assertOwner(req, req.params.id);

    if (String(req.params.membershipId) === String(req.membership?._id)) {
      throw badRequest('You cannot remove yourself from your own practice.');
    }

    await leavePractice(req.params.membershipId, { practice: req.params.id });
    res.json({ ok: true });
  }),
);

/**
 * Is the caller in this practice at all?
 *
 * Permissive on unknown, like every other guard here: a clinician with no
 * membership predates the model rather than being an intruder, and refusing
 * them would take the screen away from the clinic running today.
 */
async function assertBelongs(req, practiceId) {
  const mine = await Membership.findOne(
    Membership.currentFilter(req.user._id, practiceId),
  ).lean();
  if (mine) {
    req.membership = mine;
    return;
  }

  const any = await Membership.findOne(Membership.currentFilter(req.user._id)).lean();
  if (!any) return; // no membership anywhere — the pre-migration state

  throw forbidden('That practice is not yours.');
}

/** And may they manage it? */
async function assertOwner(req, practiceId) {
  await assertBelongs(req, practiceId);
  // `requirePermission(MANAGE_STAFF)` has already run; this is the practice
  // half of the question, which that cannot answer.
}

/**
 * A doctor opening their own practice.
 *
 * ---- Why this is the primary way one comes into existence --------------
 *
 * The operator can create a practice too, and has to be able to: a doctor who
 * is not on the platform yet cannot create anything. But a doctor who is
 * already here needs nobody's permission to open a clinic, and routing that
 * through a support request is a queue in front of the thing the product is
 * for.
 *
 * ---- No separate head-doctor account ------------------------------------
 *
 * The caller becomes the owner of what they just made. Being head of a practice
 * is a property of a membership, not a kind of account — the same doctor heading
 * two practices is one person with two memberships, and a second account would
 * be a second set of patients and a second login to keep in step.
 *
 * ---- It arrives unverified ----------------------------------------------
 *
 * Anybody with a doctor account can make one, so making one proves nothing. It
 * is `onboarding` and `unverified` until an operator checks the registration
 * against the council register, exactly as one created from the console is.
 */
router.post(
  '/',
  requireDoctor,
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160),
      tagline: z.string().trim().max(160).optional(),
      registrationNo: z.string().trim().max(60).optional(),
    }),
  }),
  audit('create', 'Practice'),
  asyncHandler(async (req, res) => {
    const practice = await Practice.create({
      ...req.body,
      // The doctor's own name and number are already on their account; the
      // letterhead takes them rather than asking again, because a solo practice
      // has one of each and asking twice is how the two drift apart.
      doctorDisplayName: req.user.name,
      registrationNo: req.body.registrationNo || req.user.registrationNo || undefined,
      headDoctor: req.user._id,
      status: PRACTICE_STATUS.ONBOARDING,
      verification: VERIFICATION.UNVERIFIED,
    });

    await joinPractice({
      user: req.user._id,
      practice: practice._id,
      role: ROLES.DOCTOR,
      isOwner: true,
      addedBy: req.user._id,
    });

    res.status(201).json({ practice: practice.toPublic() });
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
  // The letterhead is practice administration, not a clinical act.
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      name: z.string().trim().min(2).max(160).optional(),
      tagline: z.string().trim().max(160).nullable().optional(),
      doctorDisplayName: z.string().trim().max(160).nullable().optional(),
      registrationNo: z.string().trim().max(60).nullable().optional(),
      logoLightAssetId: z.string().nullable().optional(),
      logoDarkAssetId: z.string().nullable().optional(),
      logoNeedsDarkChip: z.boolean().optional(),
      // The number patients ring. Null or empty clears it.
      emergencyPhone: z.string().trim().max(40).nullable().optional(),
    }),
  }),
  audit('update', 'Practice'),
  asyncHandler(async (req, res) => {
    /*
     * Theirs, first. `requirePermission(MANAGE_STAFF)` answers whether the
     * caller may edit a letterhead at their own practice; it cannot answer
     * whether `:id` is that practice, and these fields print on the
     * prescriptions of whichever practice it is. Refused the same way for a
     * practice that does not exist, so the refusal confirms nothing.
     */
    await assertOwner(req, req.params.id);

    const practice = await Practice.findById(req.params.id);
    if (!practice) throw notFound('Practice not found');

    /*
     * A number somebody can actually ring, or nothing.
     *
     * Stored in E.164 so every screen dials the same string, and refused when
     * it is a placeholder or a word: this is the number on a patient's
     * emergency card, and "+91-0000000000" there rings nowhere at the one
     * moment it matters.
     */
    if (req.body.emergencyPhone === '') req.body.emergencyPhone = null;
    if (req.body.emergencyPhone != null) {
      const phone = callablePhone(toE164(req.body.emergencyPhone));
      if (!phone) {
        throw badRequest('Enter a phone number your patients can ring, including the area or country code.');
      }
      req.body.emergencyPhone = phone;
    }

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
