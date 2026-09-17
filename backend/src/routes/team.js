import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate } from '../middleware/validate.js';
import { AppError, asyncHandler, badRequest, conflict, forbidden, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS, presetFor } from '../models/Membership.js';
import { Practice } from '../models/Practice.js';
import { billingBlocks } from '../services/billing/lapse.js';
import { noticeUsage } from '../services/billing/usageNotice.js';
import { Department } from '../models/Department.js';
import { Clinic } from '../models/Clinic.js';
import { User, ROLES, CLINICIAN_ROLES } from '../models/User.js';
import { practiceOf } from '../middleware/practiceScope.js';
import { joinPractice, membersOf } from '../services/memberships.js';
import { phoneFromToken, requestOtp, verifyOtp, signPhoneToken } from '../services/otp.js';
import { toE164 } from '../utils/phone.js';
import { dieticianArrived } from '../services/dieticianAssignment.js';

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

/**
 * The roles a practice can hire. Patients are enrolled, not employed.
 *
 * From CLINICIAN_ROLES rather than written out again. This was its own list of
 * three, and four roles were added to the platform without it — so the
 * laboratory roles existed, held the right permissions, had their own
 * dashboard, and could not be given to anybody. A role nobody can be hired
 * into is a role that does not exist.
 */
const HIREABLE = [...CLINICIAN_ROLES];

/**
 * Whether somebody may change who works here — MANAGE_STAFF aside.
 *
 * ---- A doctor, or whoever owns the practice ------------------------------
 *
 * This was doctor-only, written when every owner was a doctor. Then a practice
 * could be approved with its manager as the owner — the contact who said on the
 * application that they were not the doctor — and the People screen showed that
 * manager "Add someone", because they hold MANAGE_STAFF, and refused them the
 * moment they pressed it. A practice whose owner could not add its own doctor,
 * told by email to go and do exactly that.
 *
 * Owning the practice is what admits them, not the role. A manager somebody
 * else hired holds the same preset and is still refused, so this is no wider for
 * anybody who could not already run the practice.
 *
 * One rule for the route and for `canManage`, so the screen never offers a
 * button the route turns down.
 */
function mayChangeWhoWorksHere(user, membership) {
  return user?.role === ROLES.DOCTOR || Boolean(membership?.isOwner);
}

async function requireDoctorOrOwner(req, res, next) {
  try {
    if (mayChangeWhoWorksHere(req.user, null)) return next();
    const practiceId = await practiceOf(req);
    const membership = practiceId
      ? await Membership.findOne(Membership.currentFilter(req.user._id, practiceId))
          .select('isOwner')
          .lean()
      : null;
    if (mayChangeWhoWorksHere(req.user, membership)) return next();
    return next(forbidden('This action requires a different role'));
  } catch (err) {
    return next(err);
  }
}

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
          // What a change to this row is made against. See PATCH /team/:id.
          version: r.__v ?? 0,
        })),

      // What the reader may do, so the screen does not have to guess from the
      // role. Absent a membership this is false rather than true — offering a
      // button that 403s is worse than not offering it, and unlike a *read*
      // guard nothing is lost by being cautious about an affordance.
      canManage: membership
        ? membership.can(PERMISSIONS.MANAGE_STAFF) && mayChangeWhoWorksHere(req.user, membership)
        : false,

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

/** The refusal for a change made against a version of somebody's job that no longer stands. */
function memberChanged() {
  return new AppError(
    409,
    'MEMBER_CHANGED',
    'Somebody else changed this person’s role or access a moment ago. Open them again to see what it is now.',
  );
}

/** What each role is called in a sentence about somebody's account. */
const ROLE_WORDS = Object.freeze({
  [ROLES.DOCTOR]: 'doctor',
  [ROLES.STAFF]: 'front-desk',
  [ROLES.DIETICIAN]: 'dietician',
  [ROLES.DOCTOR_ASSISTANT]: 'doctor’s assistant',
  [ROLES.LAB_MANAGER]: 'laboratory manager',
  [ROLES.LAB_TECHNICIAN]: 'laboratory technician',
  [ROLES.PRACTICE_MANAGER]: 'practice manager',
});
const roleWord = (role) => ROLE_WORDS[role] ?? String(role).replace(/_/g, ' ');

const hirePhone = z
  .string()
  .trim()
  .transform(toE164)
  .pipe(z.string().regex(/^\+?[1-9]\d{7,14}$/, 'Enter a valid phone number'));

/**
 * Text a hiring code to the number of the person being added.
 *
 * ---- Its own purpose, and only for somebody who may hire ----------------
 *
 * The hire sheet used the registration code, and registration refuses a number
 * that already has an account — so a doctor who already used MedPin, or a
 * receptionist moving from another clinic, could never be added. This code
 * works for any number. It proves only that the person in front of the
 * practice holds it, which is all a hire needs; what their account may become
 * here is decided when they are added.
 *
 * Behind the same guards as the hire itself, so nobody else can use it to send
 * texts to numbers of their choosing.
 */
router.post(
  '/phone/otp',
  requireDoctorOrOwner,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({ body: z.object({ phone: hirePhone }) }),
  audit('create', 'PhoneVerification'),
  asyncHandler(async (req, res) => {
    res.json(await requestOtp({ phone: req.body.phone, purpose: 'hire' }));
  }),
);

/** Spend a hiring code for the proof `POST /team` takes. */
router.post(
  '/phone/verify',
  requireDoctorOrOwner,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({ phone: hirePhone, code: z.string().trim().regex(/^\d{4,8}$/) }),
  }),
  audit('update', 'PhoneVerification'),
  asyncHandler(async (req, res) => {
    await verifyOtp({ phone: req.body.phone, purpose: 'hire', code: req.body.code });
    res.json({ phoneToken: signPhoneToken(req.body.phone) });
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
  requireDoctorOrOwner,
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
      /*
       * Accepted only to be refused by name. See the handler.
       *
       * Left out of the schema, zod would strip it and the hire would succeed
       * without it — so an older build of the app, whose sheet still has a
       * "Set a password" switch, would tell the doctor a counter handset now
       * had a password that nothing had set.
       */
      password: z.unknown().optional(),
      departmentId: z.string().optional(),
      locationId: z.string().optional(),
      qualifications: z.string().trim().max(120).optional(),
      registrationNo: z.string().trim().max(60).optional(),
    }),
  }),
  audit('create', 'User'),
  asyncHandler(async (req, res) => {
    /*
     * Nobody chooses a colleague's password (§30).
     *
     * The sheet offered one "for a handset that lives on a counter with no
     * personal phone". What it made was a credential chosen by somebody else,
     * known to them, and passed along by word of mouth — for an account that
     * may read every patient at the practice. Staff sign in with a code texted
     * to their own number, as everybody else does. Refused before anything is
     * written, and by name, so the person adding them is told rather than
     * left believing a password exists.
     *
     * Passwords that already exist keep working; see POST /auth/login.
     */
    if (req.body.password != null && req.body.password !== '') {
      throw new AppError(
        400,
        'PASSWORD_NOT_ALLOWED',
        'Passwords are no longer set for colleagues. They sign in with a code texted to their own number.',
      );
    }

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

    /*
     * Somebody who already uses MedPin keeps their account.
     *
     * This refused every number with an account, so a doctor who already had
     * one — at another practice, or from before — could never be added, and
     * neither could a receptionist moving clinics. An account keeps one role
     * everywhere, and a patient's account never becomes staff: that would put
     * their own record under whoever manages this practice.
     *
     * The proof above came from a code the person read out, so saying what
     * their account is tells nobody anything they did not already know.
     */
    const existing = await User.findByLoginPhone(phone);
    if (existing) {
      // Anybody who is not staff is a patient: the only account that works at
      // no practice. Asked as "not staff" so this route never names the role it
      // must never create.
      if (!CLINICIAN_ROLES.includes(existing.role)) {
        throw conflict(
          'That number belongs to a patient account. A patient cannot also be added as staff; use a different number.',
        );
      }
      if (existing.role !== b.role) {
        const was = roleWord(existing.role);
        throw conflict(`That number belongs to a ${was} account. Add them as a ${was}, or use a different number.`);
      }
      if (!existing.isActive) {
        throw conflict('That account has been switched off, so it cannot be added. Ask MedPin support to turn it back on.');
      }
      const here = await Membership.findOne({ user: existing._id, practice: practiceId }).lean();
      if (here && here.status === MEMBERSHIP_STATUS.ACTIVE && !here.endedOn) {
        throw conflict('They already work here.');
      }

      const joined = await joinPractice({
        user: existing._id,
        practice: practiceId,
        role: b.role,
        addedBy: req.user._id,
        department: department?._id ?? null,
        location: location?._id ?? null,
      });
      req.auditResourceId = existing._id;
      await dieticianArrived(practiceId, joined.role);

      noticeUsage(
        practiceId,
        'staff',
        await Membership.countDocuments({ practice: practiceId, status: MEMBERSHIP_STATUS.ACTIVE, endedOn: null }),
      ).catch(() => {});

      return res.status(201).json({
        id: String(joined._id),
        userId: String(existing._id),
        name: existing.name,
        phone: existing.phone,
        role: joined.role,
        // Their name, number, password and qualifications are their own and
        // stay as they were. What this practice added is the membership.
        existing: true,
      });
    }

    // A number that is on another account as its second number is not free to
    // become a new login.
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
    // No password. See the refusal at the top of this handler.
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
    await dieticianArrived(practiceId, membership.role);

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

    req.auditResourceId = user._id;
    res.status(201).json({
      id: String(membership._id),
      userId: String(user._id),
      name: user.name,
      phone: user.phone,
      role: membership.role,
      existing: false,
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
  requireDoctorOrOwner,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  validate({
    body: z.object({
      role: z.enum(HIREABLE).optional(),
      departmentId: z.string().nullable().optional(),
      locationId: z.string().nullable().optional(),
      status: z.enum([MEMBERSHIP_STATUS.ACTIVE, MEMBERSHIP_STATUS.SUSPENDED]).optional(),
      // The `version` the People screen was showing. Optional: older builds
      // send none, and are still protected from a change made at the same
      // moment, just not from one made while their screen was open.
      version: z.number().int().min(0).optional(),
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

    /*
     * The version this change is made against.
     *
     * Two people managing one practice can open the same person at once, and
     * whole-row saves meant the second to press Save silently undid the first:
     * a suspension reverted by a department change, a role flipped back. The
     * write below lands only on the version read here — and, when the screen
     * says which version it was showing, only on that one — so the second
     * change is refused with MEMBER_CHANGED and the person making it looks
     * again. A row written before versions has none, which reads as null and
     * is still matched exactly once.
     */
    const version = membership.__v ?? null;
    if (req.body.version !== undefined && req.body.version !== (version ?? 0)) throw memberChanged();

    // Before anything below rewrites it: whether they arrive as a dietician.
    const previousRole = membership.role;

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

    /*
     * A role change reaches the account.
     *
     * It changed the membership alone, and the doctor picker, the dietician
     * picker and every doctor-only route read the account's role — so somebody
     * made a dietician here stayed front desk everywhere that mattered. An
     * account keeps one role everywhere, so while they hold a current
     * membership at another practice in a different role, the change is
     * refused rather than made half-way.
     */
    if (req.body.role && req.body.role !== membership.role) {
      const elsewhere = await Membership.exists({
        user: membership.user,
        practice: { $ne: membership.practice },
        status: MEMBERSHIP_STATUS.ACTIVE,
        endedOn: null,
        role: { $ne: req.body.role },
      });
      if (elsewhere) {
        throw conflict(
          'They work at another practice in their current role, and an account keeps one role everywhere. ' +
            'Change it there first, or add them with a different number.',
        );
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

    /*
     * Bringing somebody back brings them back.
     *
     * This set the status and left `endedOn`, so a member who had left was
     * saved as active, still shown as having left, and still refused
     * everything, because a current membership is one with no end date. Coming
     * back takes a place as a hire does, so the practice's limit and a lapsed
     * subscription are checked the same way.
     */
    const returning =
      req.body.status === MEMBERSHIP_STATUS.ACTIVE &&
      (membership.status !== MEMBERSHIP_STATUS.ACTIVE || membership.endedOn != null);
    if (returning) {
      const lapsed = await billingBlocks(membership.practice, 'ADD_MEMBER');
      if (lapsed) {
        throw conflict(
          'Adding people is paused while the subscription payment is outstanding. ' +
            'Everyone already here keeps working as normal.',
        );
      }
      const practice = await Practice.findById(membership.practice);
      const current = await Membership.countDocuments({
        practice: membership.practice,
        status: MEMBERSHIP_STATUS.ACTIVE,
        endedOn: null,
      });
      const over = practice?.overLimit('staff', current);
      if (over) {
        throw conflict(
          `This practice is at its limit of ${over.cap} people. Remove somebody, or ask about a larger plan.`,
        );
      }
      membership.endedOn = null;
    }
    if (req.body.status) membership.status = req.body.status;

    const becameDietician = req.body.role === ROLES.DIETICIAN && previousRole !== ROLES.DIETICIAN;

    // Validated as `save()` would, then written only onto the version read
    // above. See the note there.
    await membership.validate();
    const changes = membership.getChanges();
    let savedVersion = version ?? 0;
    if (Object.keys(changes).length) {
      const written = await Membership.updateOne(
        { _id: membership._id, __v: version },
        { ...changes, $inc: { __v: 1 } },
      );
      if (!written.matchedCount) throw memberChanged();
      savedVersion = (version ?? 0) + 1;
    }

    if (req.body.role) {
      await User.updateOne({ _id: membership.user, role: { $ne: req.body.role } }, { $set: { role: req.body.role } });
    }
    // Arriving as a dietician — back from a suspension, back after leaving, or
    // moved into the role — is arriving. Leaving is deliberately not: the
    // patients a departed dietician held stay theirs on the record until the
    // doctor chooses, and nobody else is handed them. See dieticianArrived.
    if ((returning || becameDietician) && membership.isCurrent()) {
      await dieticianArrived(membership.practice, membership.role);
    }
    res.json({ membership: { ...membership.toPublic(), version: savedVersion } });
  }),
);

export default router;
