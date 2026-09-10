import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, conflict, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../models/Membership.js';
import { Practice } from '../models/Practice.js';
import { billingBlocks } from '../services/billing/lapse.js';
import { noticeUsage } from '../services/billing/usageNotice.js';
import { Department } from '../models/Department.js';
import { Clinic } from '../models/Clinic.js';
import { User, ROLES } from '../models/User.js';
import { practiceOf } from '../middleware/practiceScope.js';
import { joinPractice, membersOf } from '../services/memberships.js';
import { phoneFromToken } from '../services/otp.js';

/**
 * Who works here, in one place.
 *
 * ---- Why this replaces three screens ------------------------------------
 *
 * A doctor's app had Front desk, Clinic care and Practice, and between them
 * they answered one question badly: who works at this practice and what may
 * they do. Each screen knew about one role, each had its own creation form, and
 * none of them could show a department or a location — because a membership
 * carried neither until now.
 *
 * The shape that was missing is not "a list of staff". It is:
 *
 *   person → role → department → location → permissions → status
 *
 * which is one row, and the reason it was three screens is that the role was
 * baked into the route rather than being a column.
 *
 * ---- And there was no way to add a doctor ------------------------------
 *
 * Four routes in this codebase create a user: two make patients, one makes a
 * desk account, one makes a dietician. A practice that hired a second doctor
 * had to ask the platform operator to do it from the console. A polyclinic
 * could not be staffed by the people running it, which is most of what a
 * polyclinic is.
 *
 * ---- The caps are enforced here ----------------------------------------
 *
 * `Practice.overLimit` has existed since plans did and was called for patients
 * only, so the staff and location numbers on every plan were decoration. A cap
 * is a brake on growth: it stops the next person being added and touches
 * nobody already here.
 */
const router = Router();
router.use(requireAuth, requireClinician);

/** The roles a practice can hire. Patients are enrolled, not employed. */
const HIREABLE = [ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN];

/**
 * Everyone at this practice, with every dimension the screens need.
 *
 * Readable by any clinician: the desk needs to know which doctor is in, and a
 * dietician needs to know who wrote a plan. What a reader may *change* is a
 * different question, answered by `canManage` in the payload rather than by
 * hiding the list.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);

    // No practice is the pre-backfill account. An empty list would tell them
    // their clinic has nobody in it; this says the truth instead.
    if (!practiceId) {
      return res.json({ items: [], canManage: false, practice: null, limits: null });
    }

    const [rows, practice, departments, locations, membership] = await Promise.all([
      membersOf(practiceId),
      Practice.findById(practiceId).select('limits plan').lean(),
      Department.find({ $or: [{ practice: null }, { practice: practiceId }], isActive: true })
        .select('key names')
        .lean(),
      Clinic.find({ practice: practiceId }).select('name').lean(),
      Membership.findOne(Membership.currentFilter(req.user._id, practiceId)),
    ]);

    const deptName = new Map(departments.map((d) => [String(d._id), d.names?.en ?? d.key]));
    const locName = new Map(locations.map((c) => [String(c._id), c.name]));

    const active = rows.filter(
      (r) => r.status === MEMBERSHIP_STATUS.ACTIVE && !r.endedOn && r.user?.isActive,
    );

    res.json({
      items: rows
        // A membership whose user row is gone is a dangling reference, not a
        // person. It would render as a blank name with working buttons.
        .filter((r) => r.user)
        .map((r) => ({
          id: String(r._id),
          userId: String(r.user._id),
          name: r.user.name,
          phone: r.user.phone,
          role: r.role,
          isOwner: Boolean(r.isOwner),
          department: r.department
            ? { id: String(r.department), name: deptName.get(String(r.department)) ?? null }
            : null,
          location: r.location
            ? { id: String(r.location), name: locName.get(String(r.location)) ?? null }
            : null,
          // The resolved grant, not the stored one. An empty array on the row
          // means "the role's preset applies", and sending the empty array
          // would make every screen re-derive that.
          permissions: r.permissions?.length
            ? r.permissions
            : presetFor({ role: r.role, isOwner: r.isOwner }),
          usingPreset: !r.permissions?.length,
          // Two ways to be gone, and they are different: a membership that
          // ended is somebody who left, an inactive account is somebody
          // switched off. The screen says which.
          status: !r.user.isActive
            ? 'disabled'
            : r.endedOn
              ? 'left'
              : r.status,
          startedOn: r.startedOn,
          endedOn: r.endedOn ?? null,
        })),

      // What the reader may do, so the screen does not have to guess from the
      // role. Absent a membership this is false rather than true — offering a
      // button that 403s is worse than not offering it, and unlike a *read*
      // guard nothing is lost by being cautious about an affordance.
      canManage: membership ? membership.can(PERMISSIONS.MANAGE_STAFF) : false,

      // For the pickers on the edit sheet, so the screen needs one request.
      departments: departments.map((d) => ({
        id: String(d._id),
        name: d.names?.en ?? d.key,
      })),
      locations: locations.map((c) => ({ id: String(c._id), name: c.name })),

      // Shown beside the count, so somebody adding the fortieth person sees the
      // cap before they fill in a form rather than after.
      limits: {
        staff: practice?.limits?.staff ?? null,
        used: active.length,
      },
    });
  }),
);

/**
 * Hire somebody.
 *
 * One route for all three roles, because the differences between them are a
 * column and a permission preset rather than a workflow. Three routes is how
 * `/doctor/dieticians` came to be the only one that forgot to create a
 * membership — the paths drifted because nothing held them together.
 */
router.post(
  '/',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      role: z.enum(HIREABLE),
      name: z.string().trim().min(2).max(120),
      /**
       * Proof the number was answered, not a number.
       *
       * A regex tests the shape of a phone number and nothing about who holds
       * it. One mistyped digit and the account belongs to whoever owns the
       * number typed instead — and for a doctor that account can prescribe.
       */
      phoneToken: z.string().min(20),
      // Optional for everyone. A texted code is how people sign in; a password
      // is for a handset that lives on a counter with no personal phone to
      // receive one on.
      password: z.string().min(8, 'At least 8 characters').max(128).optional(),
      departmentId: z.string().optional(),
      locationId: z.string().optional(),
      qualifications: z.string().trim().max(120).optional(),
      registrationNo: z.string().trim().max(60).optional(),
    }),
  }),
  audit('create', 'User'),
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    if (!practiceId) {
      throw badRequest('This account is not linked to a practice yet.');
    }

    const b = req.body;
    const phone = phoneFromToken(b.phoneToken);

    /**
     * The cap, before anything is written.
     *
     * `overLimit` returns null when no cap is set, which is every practice
     * until somebody types a number in — so this does nothing at all for the
     * clinic running today and bites only where a limit was agreed.
     */
    const practice = await Practice.findById(practiceId);
    const current = await Membership.countDocuments({
      practice: practiceId,
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
    });
    const lapsed = await billingBlocks(practiceId, 'ADD_MEMBER');
    if (lapsed) {
      throw conflict(
        'Adding people is paused while the subscription payment is outstanding. ' +
          'Everyone already here keeps working as normal.',
      );
    }

    const over = practice?.overLimit('staff', current);
    if (over) {
      throw conflict(
        `This practice is at its limit of ${over.cap} people. Remove somebody, or ask about a larger plan.`,
      );
    }

    // Both optional, and both checked against this practice. An id from
    // somewhere else would file the person under another practice's
    // department, which is the shape of leak this codebase keeps finding.
    const [department, location] = await Promise.all([
      b.departmentId
        ? Department.findOne({
            _id: b.departmentId,
            $or: [{ practice: null }, { practice: practiceId }],
          })
            .select('_id')
            .lean()
        : null,
      b.locationId
        ? Clinic.findOne({ _id: b.locationId, practice: practiceId }).select('_id').lean()
        : null,
    ]);
    if (b.departmentId && !department) throw notFound('Department not found');
    if (b.locationId && !location) throw notFound('Location not found');

    if (await User.phoneTaken(phone)) {
      throw conflict('An account with this phone number already exists');
    }

    const user = new User({
      name: b.name,
      phone,
      role: b.role,
      phoneVerifiedAt: new Date(),
      ...(b.qualifications ? { qualifications: b.qualifications } : {}),
      ...(b.registrationNo ? { registrationNo: b.registrationNo } : {}),
      consent: {
        termsAcceptedAt: new Date(),
        dataProcessingAcceptedAt: new Date(),
        aiDisclaimerAcceptedAt: new Date(),
      },
    });
    if (b.password) await user.setPassword(b.password);
    await user.save();

    let membership;
    try {
      membership = await joinPractice({
        user: user._id,
        practice: practiceId,
        role: b.role,
        addedBy: req.user._id,
        department: department?._id ?? null,
        location: location?._id ?? null,
      });
    } catch (err) {
      // The account without the membership is the exact bug this route exists
      // to stop repeating: it would belong to nobody, appear in no list, and
      // hold a phone number that now cannot be reused.
      await User.deleteOne({ _id: user._id });
      throw err;
    }

    /*
     * After the add, never before.
     *
     * A notice alongside a refusal would be a second message about something the
     * person is already reading. This fires on the way past 80, 90 and 100 per
     * cent, once each — see billing/usageNotice.js.
     *
     * Deliberately not awaited. A push that is slow, or a provider that is down,
     * must not hold up the response to somebody registering a patient with them
     * standing at the desk.
     */
    noticeUsage(
      practiceId,
      'staff',
      await Membership.countDocuments({
        practice: practiceId,
        status: MEMBERSHIP_STATUS.ACTIVE,
        endedOn: null,
      }),
    ).catch(() => {});

    res.status(201).json({
      id: String(membership._id),
      userId: String(user._id),
      name: user.name,
      phone: user.phone,
      role: membership.role,
    });
  }),
);

/**
 * Change what somebody is here: their department, their location, their role.
 *
 * Not their name or their number — those belong to the person and are edited
 * from their own profile. This route is about the job, not the human.
 */
router.patch(
  '/:id',
  requireDoctor,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      role: z.enum(HIREABLE).optional(),
      departmentId: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      status: z.enum([MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.SUSPENDED]).optional(),
    }),
  }),
  audit('update', 'Membership'),
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    const membership = await Membership.findById(req.params.id);
    if (!membership) throw notFound('Not found');

    // Theirs, not somebody else's. `notFound` rather than a refusal, because
    // confirming the id exists is itself an answer.
    if (practiceId && String(membership.practice) !== String(practiceId)) {
      throw notFound('Not found');
    }

    /**
     * The owner is not demoted or suspended from here.
     *
     * Somebody has to be able to administer a practice. Letting a manager
     * suspend the owner is how a clinic ends up with nobody who can add
     * anybody, and the recovery for that is a phone call to us.
     */
    if (membership.isOwner && (req.body.role || req.body.status)) {
      throw badRequest('The practice owner cannot be changed from here.');
    }

    if (req.body.departmentId !== undefined) {
      if (req.body.departmentId === null) {
        membership.department = null;
      } else {
        const d = await Department.findOne({
          _id: req.body.departmentId,
          $or: [{ practice: null }, ...(practiceId ? [{ practice: practiceId }] : [])],
        })
          .select('_id')
          .lean();
        if (!d) throw notFound('Department not found');
        membership.department = d._id;
      }
    }

    if (req.body.locationId !== undefined) {
      if (req.body.locationId === null) {
        membership.location = null;
      } else {
        const c = await Clinic.findOne({
          _id: req.body.locationId,
          ...(practiceId ? { practice: practiceId } : {}),
        })
          .select('_id')
          .lean();
        if (!c) throw notFound('Location not found');
        membership.location = c._id;
      }
    }

    if (req.body.role) {
      membership.role = req.body.role;
      // The grant follows the role unless somebody has customised it. A
      // dietician promoted to doctor keeping the desk preset would be a doctor
      // who cannot prescribe, and the fix for that would be invisible.
      if (!membership.permissions?.length) {
        membership.permissions = presetFor({ role: req.body.role, isOwner: membership.isOwner });
      }
    }

    if (req.body.status) membership.status = req.body.status;

    await membership.save();
    res.json({ membership: membership.toPublic() });
  }),
);

export default router;
