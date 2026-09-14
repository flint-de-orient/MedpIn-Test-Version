import { Router } from 'express';
import { z } from 'zod';

import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, conflict } from '../middleware/errors.js';
import { AdminAuditLog } from '../models/AdminAuditLog.js';
import {
  PracticeApplication,
  APPLICATION_STATUS,
  OPEN_STATUSES,
} from '../models/PracticeApplication.js';
import { User, ROLES } from '../models/User.js';
import { provisionPractice } from '../services/provisionPractice.js';
import { applicationDecisionEmail, mailConfigured, sendMail } from '../services/mailer.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';

/**
 * The queue of practices asking to exist.
 *
 * Mounted inside admin.js, behind `requireAdmin`, exactly as the billing
 * surface is — so there is one guard rather than one per file and no route
 * here can be reached without an operator session.
 *
 * ---- Approving is the only thing that creates anything ------------------
 *
 * Everything else moves a status and writes a note. Approve calls
 * [services/provisionPractice.js], which is the same path an operator uses to
 * create a practice by hand: the licence-clash check, the practice row, the
 * head doctor attached immediately, and the compensating delete if that fails.
 *
 * A second implementation here would be how one route forgets the head doctor.
 *
 * ---- Every decision is one conditional write ----------------------------
 *
 * Each of these read the application, checked it was undecided, then saved.
 * Two operators acting at once both passed the check: two approvals made two
 * practices, and a rejection landing during an approval could write "rejected"
 * over a practice that had just been created. So a decision is now a single
 * update that only matches an undecided application, and whoever arrives second
 * finds nothing to match and is told why.
 */
const router = Router();

/**
 * A reason, on every decision.
 *
 * Approve included. "Approved" with nothing beside it is a decision nobody can
 * review six months later, and the applicant reads the note on a rejection or
 * a request for more information — so it is the one field this surface refuses
 * to default.
 */
const decision = z.object({ note: z.string().trim().min(3).max(1000) });

/**
 * How long an approval holds the application while the practice is made.
 *
 * Provisioning is a handful of writes and takes well under a second. Five
 * minutes is long past any approval that is going to finish, and short enough
 * that one which died half-way does not keep the application from the next
 * operator for longer than it takes to notice.
 */
const APPROVAL_LEASE_MS = 5 * 60 * 1000;

/** Nothing here is ever deleted; the queue is filtered instead. */
router.get(
  '/applications',
  validate({
    query: z.object({
      status: z.enum(Object.values(APPLICATION_STATUS)).optional(),
      /// "Everything still open", which is what an operator actually wants and
      /// is three statuses rather than one.
      open: z.coerce.boolean().optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  }),
  asyncHandler(async (req, res) => {
    const { status, open, limit } = q(req);

    const filter = status
      ? { status }
      : open
        ? { status: { $in: OPEN_STATUSES } }
        : {};

    const [rows, byStatus] = await Promise.all([
      PracticeApplication.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      // Unfiltered, for the same reason the billing chips are: counting within
      // the current filter shows the selected one's total beside every other
      // reading zero, which looks like an answer.
      PracticeApplication.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

    const counts = Object.fromEntries(byStatus.map((r) => [r._id, r.n]));
    counts.all = byStatus.reduce((sum, r) => sum + r.n, 0);
    counts.open = OPEN_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);

    res.json({
      counts,
      items: rows.map((r) => ({
        id: String(r._id),
        reference: r.reference,
        status: r.status,
        practiceName: r.practiceName,
        practiceType: r.practiceType,
        specialty: r.specialty,
        city: r.city,
        state: r.state,
        contactName: r.contactName,
        contactEmail: r.contactEmail,
        // Whether the decision this review produces will actually arrive.
        contactEmailVerified: Boolean(r.contactEmailVerifiedAt),
        contactIsPrimaryDoctor: r.contactIsPrimaryDoctor !== false,
        contactPhone: r.contactPhone,
        reviewer: r.reviewerEmail,
        submittedOn: r.createdAt,
        practice: r.practice ? String(r.practice) : null,
      })),
    });
  }),
);

router.get(
  '/applications/:id',
  asyncHandler(async (req, res) => {
    const a = await PracticeApplication.findById(req.params.id).lean();
    if (!a) throw notFound('Application not found');

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.read',
      resource: 'PracticeApplication',
      resourceId: a._id,
      req,
    });

    res.json({ application: full(a) });
  }),
);

/**
 * "I am looking at this one."
 *
 * Advisory, not a lock. It stops two operators reviewing the same application
 * at the same time and does not stop a third from deciding — a hard lock on a
 * queue this size would mostly be a thing somebody has to release after going
 * home.
 *
 * Two conditional updates rather than a read and a save. A save writes the
 * status it read, and a claim that read "submitted" a moment before an approval
 * finished would have written "under review" back over "approved".
 */
router.post(
  '/applications/:id/claim',
  asyncHandler(async (req, res) => {
    const claimed = await PracticeApplication.findOneAndUpdate(
      { _id: req.params.id, status: { $in: OPEN_STATUSES } },
      {
        $set: { reviewer: req.admin._id, reviewerEmail: req.admin.email },
        $push: {
          history: {
            action: 'opened',
            admin: req.admin._id,
            adminEmail: req.admin.email,
            note: null,
            at: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!claimed) throw await refusal(req.params.id);

    // Submitted becomes under review. Any other open state is left where it is.
    const a =
      (await PracticeApplication.findOneAndUpdate(
        { _id: claimed._id, status: APPLICATION_STATUS.SUBMITTED },
        { $set: { status: APPLICATION_STATUS.UNDER_REVIEW } },
        { new: true },
      )) ?? claimed;

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.claim',
      resource: 'PracticeApplication',
      resourceId: a._id,
      req,
    });

    res.json({ application: full(a.toObject()) });
  }),
);

/**
 * Send it back with a question.
 *
 * The note reaches the applicant — by email, and on the status page — so the
 * validator requires it and the copy on the console says who reads it.
 */
router.post(
  '/applications/:id/request-info',
  validate({ body: decision }),
  asyncHandler(async (req, res) => {
    const a = await decide(req, APPLICATION_STATUS.MORE_INFO, 'more_info');

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.more_info',
      resource: 'PracticeApplication',
      resourceId: a._id,
      reason: req.body.note,
      req,
    });

    res.json({ application: full(a.toObject()) });
    tellApplicant(
      a,
      applicationDecisionEmail({
        decision: 'more_info',
        application: a,
        note: req.body.note,
        statusLink: statusLinkFor(a),
      }),
    );
  }),
);

router.post(
  '/applications/:id/reject',
  validate({ body: decision }),
  asyncHandler(async (req, res) => {
    const a = await decide(req, APPLICATION_STATUS.REJECTED, 'rejected');

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.reject',
      resource: 'PracticeApplication',
      resourceId: a._id,
      reason: req.body.note,
      req,
    });

    res.json({ application: full(a.toObject()) });
    tellApplicant(
      a,
      applicationDecisionEmail({
        decision: 'rejected',
        application: a,
        note: req.body.note,
        statusLink: statusLinkFor(a),
      }),
    );
  }),
);

/**
 * Approve, and the practice exists.
 *
 * ---- Why approval provisions in the same request ------------------------
 *
 * The alternative is an "approved" application an operator then has to go and
 * turn into a practice, which is the same shape as "I will add the doctor
 * next" — a second step that does not reliably happen, leaving an applicant
 * told they were approved and a platform with nothing to show for it.
 *
 * The owner's phone is the one the applicant proved when they submitted. It has
 * been theirs since before the application existed, and taking a fresh number
 * here would be accepting an unverified one at the moment it matters most.
 *
 * ---- Who that owner is ---------------------------------------------------
 *
 * The applicant said whether they are the practice's doctor. If they are, they
 * become its head doctor, as every approval used to make them. If they are not,
 * they become its practice manager — owning the practice without prescribing —
 * and the doctor they named is kept on the practice for them to add. A doctor
 * who already has an account stays a doctor either way: an account has one role
 * everywhere, and approval joins the account rather than changing it.
 */
router.post(
  '/applications/:id/approve',
  validate({
    body: z.object({
      note: z.string().trim().min(3).max(1000),
      /**
       * The name to put on the letterhead, if the applicant's differs.
       *
       * An operator reading papers often has the doctor's name in a fuller
       * form than a web form collected. Optional; the application's own is
       * used otherwise.
       */
      headDoctorName: z.string().trim().min(2).max(120).optional(),
    }),
  }),
  asyncHandler(async (req, res) => {
    // Take the application first, so a second approval finds it taken.
    const lease = new Date(Date.now() + APPROVAL_LEASE_MS);
    const a = await PracticeApplication.findOneAndUpdate(
      undecided(req.params.id),
      { $set: { approvingUntil: lease, approvingBy: req.admin.email } },
      { new: true },
    );
    if (!a) throw await refusal(req.params.id);

    const contactIsDoctor = a.contactIsPrimaryDoctor !== false;

    let provisioned;
    try {
      const existing = await User.findByLoginPhone(a.contactPhone).select('role').lean();
      const ownerRole =
        contactIsDoctor || existing?.role === ROLES.DOCTOR ? ROLES.DOCTOR : ROLES.PRACTICE_MANAGER;

      provisioned = await provisionPractice({
        brand: {
          name: a.practiceName,
          practiceType: a.practiceType ?? undefined,
          specialty: a.specialty ?? undefined,
          registrationNo: a.registrationNo ?? undefined,
        },
        /*
         * The contact's own name, unless the contact is the doctor. It used to
         * be the doctor's name on the contact's number whoever the contact was,
         * so a manager's phone signed in as "Dr Priya Nair".
         */
        headDoctorName: contactIsDoctor
          ? req.body.headDoctorName ?? a.doctorName ?? a.contactName
          : a.contactName,
        headDoctorPhone: a.contactPhone,
        headDoctorRegistrationNo: contactIsDoctor ? a.doctorRegistrationNo ?? null : null,
        // What they said they run. Already filtered to the shared catalogue and
        // to types that can have them, on the way in.
        departments: a.departments ?? [],
        ownerRole,
        ownerEmail: a.contactEmail,
        phoneVerifiedAt: a.phoneVerifiedAt,
        // The form only asks which department the doctor runs when there is a
        // choice. With one, the answer is that one.
        ownerDepartment: contactIsDoctor
          ? a.doctorDepartment ?? (a.departments?.length === 1 ? a.departments[0] : null)
          : null,
        location: { name: a.practiceName, addressLine: addressOf(a), city: a.city },
        namedDoctor: contactIsDoctor
          ? null
          : {
              name: a.doctorName ?? null,
              registrationNo: a.doctorRegistrationNo ?? null,
              department: a.doctorDepartment ?? null,
            },
      });
    } catch (err) {
      // Let go, so the next attempt is not refused for five minutes over a
      // failure that has already been undone.
      await PracticeApplication.updateOne(
        { _id: a._id, approvingUntil: lease },
        { $set: { approvingUntil: null, approvingBy: null } },
      ).catch((releaseErr) =>
        logger.error({ err: releaseErr, application: String(a._id) }, 'could not release an approval'),
      );
      throw err;
    }

    const { practice, head, location, department } = provisioned;

    const decided = await PracticeApplication.findOneAndUpdate(
      {
        _id: a._id,
        status: { $in: OPEN_STATUSES },
        // Ours, or lapsed with nobody else holding it.
        $or: [{ approvingUntil: lease }, { approvingUntil: null }, { approvingUntil: { $lte: new Date() } }],
      },
      {
        $set: {
          status: APPLICATION_STATUS.APPROVED,
          practice: practice._id,
          approvingUntil: null,
          approvingBy: null,
        },
        $push: {
          history: {
            action: 'approved',
            admin: req.admin._id,
            adminEmail: req.admin.email,
            note: req.body.note,
            at: new Date(),
          },
        },
      },
      { new: true },
    );
    if (!decided) {
      logger.error(
        { application: String(a._id), practice: String(practice._id) },
        'an approval outlived its lease and another operator acted on the application',
      );
      throw conflict(
        'That approval took too long and another operator acted on the application meanwhile. ' +
          'The practice was created — check the register before doing anything else.',
      );
    }

    const managesOnly = head.membership.role !== ROLES.DOCTOR;
    const outcome = {
      ownerRole: head.membership.role,
      ownerName: head.user.name,
      signInPhone: decided.contactPhone,
      managesOnly,
      accountReused: !head.createdUser,
      locationCreated: Boolean(location),
      department: department?.key ?? null,
      doctorToAdd: contactIsDoctor ? null : practice.namedDoctor?.name ?? null,
      emailTo: decided.contactEmail,
      mailConfigured: mailConfigured(),
    };

    await AdminAuditLog.record({
      admin: req.admin,
      action: 'admin.application.approve',
      resource: 'PracticeApplication',
      resourceId: a._id,
      // Both rows, so the trail reads from either end: the application that
      // was approved, and the practice that resulted.
      practice: practice._id,
      reason: req.body.note,
      before: null,
      after: {
        practice: String(practice._id),
        name: practice.name,
        ownerRole: outcome.ownerRole,
        // Whether approval made an account or joined one that already existed
        // is the difference between onboarding somebody new and adding a
        // practice to somebody already on the platform.
        ownerAccount: head.createdUser ? 'created' : 'existing',
        location: location ? String(location._id) : null,
        department: outcome.department,
        namedDoctor: practice.namedDoctor?.name ?? null,
      },
      req,
    });

    res.json({
      application: full(decided.toObject()),
      practice: practice.toPublic(),
      outcome,
    });
    tellApplicant(
      decided,
      applicationDecisionEmail({
        decision: 'approved',
        application: decided,
        outcome,
        statusLink: statusLinkFor(decided),
      }),
    );
  }),
);

/** The filter that matches an application nobody has decided or is deciding. */
function undecided(id) {
  return {
    _id: id,
    status: { $in: OPEN_STATUSES },
    $or: [{ approvingUntil: null }, { approvingUntil: { $lte: new Date() } }],
  };
}

/** Move an undecided application to `status`, with the operator's note, or refuse. */
async function decide(req, status, action) {
  const a = await PracticeApplication.findOneAndUpdate(
    undecided(req.params.id),
    {
      $set: { status },
      $push: {
        history: {
          action,
          admin: req.admin._id,
          adminEmail: req.admin.email,
          note: req.body.note,
          at: new Date(),
        },
      },
    },
    { new: true },
  );
  if (!a) throw await refusal(req.params.id);
  return a;
}

/**
 * Why a decision found nothing to act on, in the words the operator needs.
 *
 * A conditional update that matched nothing can mean three things — no such
 * application, one already decided, or one another operator is approving this
 * second — and only the first is a 404. The other two are conflicts with what
 * is there, and the second operator should be told which.
 */
async function refusal(id) {
  const a = await PracticeApplication.findById(id).select('status approvingUntil approvingBy').lean();
  if (!a) return notFound('Application not found');
  if (!OPEN_STATUSES.includes(a.status)) {
    return conflict('That application has already been decided.');
  }
  if (a.approvingUntil && a.approvingUntil > new Date()) {
    return conflict(`${a.approvingBy ?? 'Another operator'} is approving that application right now.`);
  }
  return conflict('That application changed while you were deciding. Reload it and try again.');
}

/** The street, then the state and PIN — the location has one address line and a city. */
function addressOf(a) {
  const region = [a.state, a.postalCode].filter(Boolean).join(' ');
  return [a.addressLine, region].filter(Boolean).join(', ') || null;
}

/**
 * The applicant's own status page, when the console has a public address.
 *
 * Configured, never derived from the request — the same rule as every other
 * link this system emails.
 */
function statusLinkFor(a) {
  const base = env.ADMIN_CONSOLE_URL?.replace(/\/+$/, '');
  return base ? `${base}/?application=${a.reference}` : null;
}

/**
 * Write to the applicant, after the operator has their answer.
 *
 * Not awaited. A mail server that is slow or down is no reason to hold an
 * operator over a decision that is already recorded, and the status page says
 * what the email says — so a message that fails is a delay rather than a loss.
 * Logged, never raised.
 */
function tellApplicant(application, message) {
  sendMail({ to: application.contactEmail, ...message }).catch((err) =>
    logger.error({ err, reference: application.reference }, 'could not write to the applicant'),
  );
}

/**
 * Everything an operator may see, which is everything the applicant sent.
 *
 * No clinical data exists on an application by construction — it is a form
 * about an organisation, filled in before any patient could be attached to it.
 */
function full(a) {
  const approving = a.approvingUntil && new Date(a.approvingUntil) > new Date();
  return {
    id: String(a._id),
    reference: a.reference,
    status: a.status,

    practiceName: a.practiceName,
    practiceType: a.practiceType,
    specialty: a.specialty,
    addressLine: a.addressLine,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode,

    contactName: a.contactName,
    contactEmail: a.contactEmail,
    contactEmailVerified: Boolean(a.contactEmailVerifiedAt),
    // Whether approving makes them the head doctor or the practice manager.
    // Null on older rows, which were only ever asked as doctors.
    contactIsPrimaryDoctor: a.contactIsPrimaryDoctor !== false,
    // What they say they run, and which of it the named doctor does. Empty on
    // a clinic, which cannot have departments on any plan.
    departments: a.departments ?? [],
    doctorDepartment: a.doctorDepartment ?? null,
    contactPhone: a.contactPhone,
    phoneVerifiedAt: a.phoneVerifiedAt,

    registrationNo: a.registrationNo,
    doctorName: a.doctorName,
    doctorRegistrationNo: a.doctorRegistrationNo,
    notes: a.notes,

    reviewer: a.reviewerEmail,
    approving: approving ? { by: a.approvingBy ?? null, until: a.approvingUntil } : null,
    practice: a.practice ? String(a.practice) : null,
    submittedOn: a.createdAt,
    history: (a.history ?? []).map((h) => ({
      action: h.action,
      by: h.adminEmail,
      note: h.note,
      at: h.at,
    })),
  };
}

export default router;
