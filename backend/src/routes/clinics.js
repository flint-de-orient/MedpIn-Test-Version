import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireClinician, requireRole, PRACTICE_SETUP } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, badRequest, conflict, forbidden } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Clinic } from '../models/Clinic.js';
import { Appointment } from '../models/Appointment.js';
import { Availability } from '../models/Availability.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS } from '../models/Membership.js';
import { practiceOf, practiceClinics, clinicsFor, memberIdsOf } from '../middleware/practiceScope.js';
import {
  assertManagesLocation,
  managedLocationIds,
  managesLocation,
  requireEveryLocation,
} from '../middleware/locationScope.js';
import { requestCan } from '../middleware/requireCapability.js';
import { CAPABILITIES } from '../services/capabilities.js';
import { Practice } from '../models/Practice.js';
import { billingBlocks } from '../services/billing/lapse.js';
import { noticeUsage } from '../services/billing/usageNotice.js';
import { User, ROLES } from '../models/User.js';
import { ACTIVE_STATUSES, generateSlots, scheduleFor } from '../services/scheduling.js';
import { forgetClinicIdentity } from '../services/clinicIdentity.js';
import { dayjs, DATE_RE, TIME_RE } from '../utils/clinicTime.js';
import { resolveDoctor } from '../services/doctorContext.js';
import { assertLogoAssets } from '../services/mediaAccess.js';

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

/**
 * List clinics. Patients see only active ones; clinicians see inactive too.
 *
 * ---- Both halves of that sentence were wrong ---------------------------
 *
 * `isClinician(req) ? {} : { isActive: true }` is every location on the
 * platform. A doctor in a practice created that morning opened the Clinics
 * screen and read another practice's two addresses, one of them marked
 * inactive — a building they have no relationship to, its opening days, and
 * its slot length.
 *
 * The patient side leaked the same rows for the same reason. A patient belongs
 * to a practice through their enrolment, and the clinics they may book at are
 * that practice's; every other practice's addresses were in the list they pick
 * from.
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // `clinicsFor`, not `practiceClinics`: that one answers from a membership,
    // and a patient has none — so every patient was shown every practice's
    // locations. See httpBookingScope.test.js.
    const scope = await clinicsFor(req);
    const filter = {
      ...scope,
      ...(isClinician(req) ? {} : { isActive: true }),
    };
    const clinics = await Clinic.find(filter).sort({ sortIndex: 1, name: 1 });

    /*
     * Which of these the reader runs.
     *
     * A member of staff narrowed to one branch still reads the whole list — a
     * receptionist at Salt Lake is asked for Behala's address — but may book,
     * confirm, edit and close only where they run. Said on each row, so the app
     * offers a location in a picker only where the server will accept it, and
     * counts one location as one rather than asking a question with a single
     * answer. Absent for a patient, who runs nothing and books by enrolment.
     */
    const mine = isClinician(req) ? await managedLocationIds(req) : undefined;
    res.json({
      items: clinics.map((c) => ({
        ...c.toPublic(),
        ...(mine === undefined
          ? {}
          : { managedByYou: mine === null || mine.includes(String(c._id)) }),
      })),
    });
  }),
);

/**
 * Who runs which of this practice's locations.
 *
 * ---- Here rather than on the team routes ----------------------------------
 *
 * A membership's `locations` is the wall around a person's work, where the
 * `location` the team screen sets is only the diary they open on. Both are about
 * a place in this practice, and this file is where places are managed.
 *
 * Read by any member of staff, like the team list it sits beside: who works at
 * which branch is what the desk tells a caller. Changed only by somebody who
 * could change who works here at all — see PUT below.
 *
 * Before `/:id`, so "access" is never read as a location's id.
 */
router.get(
  '/access',
  requireClinician,
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    if (!practiceId) return res.json({ items: [] });

    const rows = await Membership.find({
      practice: practiceId,
      status: MEMBERSHIP_STATUS.ACTIVE,
      endedOn: null,
    })
      .populate('user', 'name')
      .lean();

    res.json({
      items: rows
        .filter((r) => r.user)
        .map((r) => {
          const scope = Membership.locationScopeOf(r);
          return {
            membershipId: String(r._id),
            userId: String(r.user._id),
            name: r.user.name,
            role: r.role,
            isOwner: Boolean(r.isOwner),
            // The rule the guards read, stated rather than left for the app to
            // re-derive from an empty array.
            everyLocation: scope === null,
            locations: scope ?? [],
          };
        }),
    });
  }),
);

/**
 * Narrow somebody to particular locations, or give them all of them back.
 *
 * `locationIds: []` is every location — the same rule the stored field follows,
 * so there is no second way to say it.
 *
 * ---- Who may ------------------------------------------------------------------
 *
 * The people who may change who works here at all: a doctor or the practice's
 * owner, holding MANAGE_STAFF, the rule routes/team.js applies to a role or a
 * department. And they must run every location themselves. A manager narrowed
 * to Salt Lake handing a colleague Behala — or handing themselves "all" — would
 * be reaching past what they were given.
 *
 * The owner is not narrowed from here. Somebody has to be able to reach every
 * location, and the recovery for a practice whose head cannot is a support call.
 */
router.put(
  '/access/:membershipId',
  requireClinician,
  requirePermission(PERMISSIONS.MANAGE_STAFF),
  requireEveryLocation,
  validate({ body: z.object({ locationIds: z.array(z.string()).max(100) }) }),
  audit('update', 'Membership'),
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    const own = practiceId
      ? await Membership.findOne(Membership.currentFilter(req.user._id, practiceId))
          .select('isOwner')
          .lean()
      : null;
    if (req.user.role !== ROLES.DOCTOR && !own?.isOwner) {
      throw forbidden('This action requires a different role');
    }

    // This practice's membership, and "not found" for anybody else's: saying an
    // id exists at another practice is itself an answer.
    const membership = practiceId
      ? await Membership.findOne({ _id: req.params.membershipId, practice: practiceId })
      : null;
    if (!membership) throw notFound('Not found');
    if (membership.isOwner) {
      throw badRequest('The practice owner runs every location.');
    }

    const wanted = [...new Set(req.body.locationIds.map(String))];
    const found = wanted.length
      ? await Clinic.find({ _id: { $in: wanted }, practice: practiceId }).select('_id').lean()
      : [];
    if (found.length !== wanted.length) throw notFound('Location not found');

    membership.locations = found.map((c) => c._id);
    await membership.save();
    req.auditResourceId = membership._id;

    res.json({ membership: membership.toPublic() });
  }),
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    // Scoped like the list. By id it answered for any practice's location — to
    // a patient choosing where to book, and to another practice's desk. `$and`,
    // so the scope can never stand in for the id asked for.
    const clinic = await Clinic.findOne({ $and: [{ _id: req.params.id }, await clinicsFor(req)] });
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
    const clinic = await Clinic.findOne({ $and: [{ _id: req.params.id }, await clinicsFor(req)] });
    if (!clinic || (!isClinician(req) && !clinic.isActive)) throw notFound('Clinic not found');

    const { date, doctorId } = q(req);
    if (!dayjs(date, 'YYYY-MM-DD', true).isValid()) throw badRequest('Invalid date');

    /*
     * Whose diary, when nobody named one: the doctor a booking here would go to.
     *
     * Absent a doctor this answered for the building, marking a time taken when
     * anybody's appointment started at it. That was harmless while a location
     * held one doctor and wrong the day it held two — Dr Roy's ten o'clock hid
     * Dr Sen's, though the two are booked side by side — and it matched slots by
     * start time, so a 45-minute consultation left the next two slots on offer.
     * Booking resolves the doctor from the location and then checks that
     * doctor's diary; the list now asks the same question it will be held to.
     * Only where no doctor can be resolved does it fall back to the building.
     */
    const forDoctor =
      doctorId ?? (await resolveDoctor({ clinicId: clinic._id }).catch(() => null))?._id ?? null;

    const [slots, schedule] = await Promise.all([
      generateSlots(clinic, date, { doctorId: forDoctor }),
      scheduleFor(clinic, forDoctor),
    ]);
    res.json({
      clinicId: clinic._id,
      date,
      // The length of the diary the slots came from — a doctor's own where they
      // keep one here, which need not be the building's.
      slotMinutes: schedule?.slotMinutes ?? clinic.slotMinutes,
      // Said outright, so a closed location's empty list reads as closed rather
      // than as a fully booked day. The engine publishes nothing either way.
      isActive: clinic.isActive,
      slots,
    });
  }),
);

/* ------------------------------------------------- a doctor's hours at a location */

/**
 * When each of the practice's doctors sits at this location.
 *
 * ---- Why these exist ------------------------------------------------------------
 *
 * `Availability` — a diary per doctor per location — is what the slot engine
 * reads first, and nothing could write one. So a location's hours were every
 * doctor's hours there: a polyclinic's cardiologist was offered in the
 * dermatologist's sittings, and "Clinic A on Mondays and Wednesdays, Clinic B on
 * Tuesday and Thursday evenings" could not be said at all.
 *
 * A doctor with no diary here keeps the location's hours, exactly as before, so
 * nothing changes for a practice until somebody sets one. A diary with no
 * sittings says the doctor is not at this location.
 *
 * Read by any member of staff at the practice; changed by the people who set the
 * practice up (PRACTICE_SETUP), and only at a location they run.
 */
const diaryBody = z.object({
  slotMinutes: z.number().int().min(5).max(120),
  weeklyHours: z.array(weeklyHourShape).max(50),
  // Left out, a diary keeps the one-off closures it already has.
  overrides: z.array(overrideShape).max(120).optional(),
});

/** This practice's location, for a member of staff, or "not found". */
async function practiceLocation(req) {
  const clinic = await Clinic.findOne({ $and: [{ _id: req.params.id }, await practiceClinics(req)] });
  if (!clinic) throw notFound('Clinic not found');
  return clinic;
}

/** One of this practice's current doctors, in the words used for a doctor who does not exist. */
async function practiceDoctor(req, clinic) {
  const doctors = (await memberIdsOf(clinic.practice, ROLES.DOCTOR)) ?? [];
  const id = doctors.find((d) => String(d) === String(req.params.doctorId));
  if (!id) throw notFound('Doctor not found');
  return User.findOne({ _id: id, role: ROLES.DOCTOR }).select('_id name specialty').lean();
}

const diaryOut = (row) =>
  row
    ? {
        slotMinutes: row.slotMinutes,
        weeklyHours: (row.weeklyHours ?? [])
          .map((w) => ({ dayOfWeek: w.dayOfWeek, start: w.start, end: w.end }))
          .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.start.localeCompare(b.start)),
        overrides: (row.overrides ?? []).map((o) => ({
          date: o.date,
          isClosed: o.isClosed,
          windows: (o.windows ?? []).map((w) => ({ start: w.start, end: w.end })),
          note: o.note ?? null,
        })),
      }
    : null;

router.get(
  '/:id/availability',
  requireClinician,
  asyncHandler(async (req, res) => {
    const clinic = await practiceLocation(req);
    const doctorIds = (await memberIdsOf(clinic.practice, ROLES.DOCTOR)) ?? [];

    const [doctors, diaries] = await Promise.all([
      User.find({ _id: { $in: doctorIds }, role: ROLES.DOCTOR }).select('_id name specialty').sort({ name: 1 }).lean(),
      Availability.find({ location: clinic._id, doctor: { $in: doctorIds }, isActive: true }).lean(),
    ]);
    const byDoctor = new Map(diaries.map((d) => [String(d.doctor), d]));

    res.json({
      location: { ...clinic.toPublic(), managedByYou: await managesLocation(req, clinic._id) },
      items: doctors.map((d) => {
        const diary = byDoctor.get(String(d._id)) ?? null;
        return {
          doctor: { id: String(d._id), name: d.name, specialty: d.specialty ?? null },
          // Said, not left to be inferred from a null: this is the rule the
          // slot engine follows.
          usesLocationHours: !diary,
          diary: diaryOut(diary),
        };
      }),
    });
  }),
);

router.put(
  '/:id/availability/:doctorId',
  requireRole(...PRACTICE_SETUP),
  validate({ body: diaryBody }),
  audit('update', 'Availability'),
  asyncHandler(async (req, res) => {
    const clinic = await practiceLocation(req);
    await assertManagesLocation(req, clinic._id);
    const doctor = await practiceDoctor(req, clinic);

    const { slotMinutes, weeklyHours, overrides } = req.body;
    const set = { slotMinutes, weeklyHours, isActive: true, ...(overrides ? { overrides } : {}) };

    /*
     * One diary per doctor per location, and the unique index says so. Two saves
     * in the same instant can both try to create it; the loser's duplicate key
     * is the winner's row, which it then updates.
     */
    const write = () =>
      Availability.findOneAndUpdate(
        { doctor: doctor._id, location: clinic._id },
        { $set: set },
        { upsert: true, new: true, runValidators: true },
      );
    let row;
    try {
      row = await write();
    } catch (err) {
      if (err?.code !== 11000) throw err;
      row = await write();
    }
    req.auditResourceId = row._id;

    /*
     * The same doctor's sittings at the practice's other open locations that
     * these overlap. Not refused: a doctor may be at either on a given Monday,
     * and bookings are what cannot overlap — see withDoctorDiary. Said, so the
     * person entering "Clinic A, Mondays 9 to 1" sees that Clinic B also has
     * those Mondays.
     */
    const elsewhere = await Availability.find({
      doctor: doctor._id,
      location: { $ne: clinic._id },
      isActive: true,
    }).lean();
    const openHere = await Clinic.find({
      _id: { $in: elsewhere.map((e) => e.location) },
      practice: clinic.practice,
      isActive: true,
    })
      .select('_id name')
      .lean();
    const names = new Map(openHere.map((c) => [String(c._id), c.name]));

    const overlapsElsewhere = [];
    for (const other of elsewhere) {
      const name = names.get(String(other.location));
      if (!name) continue;
      for (const theirs of other.weeklyHours ?? []) {
        const clash = weeklyHours.some(
          (mine) => mine.dayOfWeek === theirs.dayOfWeek && mine.start < theirs.end && theirs.start < mine.end,
        );
        if (clash) {
          overlapsElsewhere.push({
            location: { id: String(other.location), name },
            dayOfWeek: theirs.dayOfWeek,
            start: theirs.start,
            end: theirs.end,
          });
        }
      }
    }

    res.json({
      doctor: { id: String(doctor._id), name: doctor.name, specialty: doctor.specialty ?? null },
      usesLocationHours: false,
      diary: diaryOut(row),
      overlapsElsewhere,
    });
  }),
);

/**
 * Give a doctor the location's hours back.
 *
 * The diary is switched off rather than deleted, so its sittings are still there
 * to look at, and a later save turns it back on with whatever it is given.
 */
router.delete(
  '/:id/availability/:doctorId',
  requireRole(...PRACTICE_SETUP),
  audit('update', 'Availability'),
  asyncHandler(async (req, res) => {
    const clinic = await practiceLocation(req);
    await assertManagesLocation(req, clinic._id);
    const doctor = await practiceDoctor(req, clinic);

    await Availability.updateOne({ doctor: doctor._id, location: clinic._id }, { $set: { isActive: false } });

    res.json({
      doctor: { id: String(doctor._id), name: doctor.name, specialty: doctor.specialty ?? null },
      usesLocationHours: true,
      diary: null,
    });
  }),
);

router.post(
  '/',
  requireRole(...PRACTICE_SETUP),
  // Opening a location is an act about every location, and somebody narrowed
  // to particular ones does not decide it. See middleware/locationScope.js.
  requireEveryLocation,
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

    /**
     * The second location is the one that costs something.
     *
     * Two separate limits, checked in this order because they fail for
     * different reasons and want different answers:
     *
     *   MULTI_LOCATION  this practice runs from one building. A solo clinic
     *                   has no second site by definition; a hospital always
     *                   does. That is a fact about what it is, and the answer
     *                   is not "buy more".
     *   limits.locations  a number somebody agreed. The answer *is* a larger
     *                   plan, and the message says so.
     *
     * The first location is always allowed. A practice with none cannot take a
     * booking at all — Patients cannot book until there is one — so refusing
     * the first would be selling a plan that cannot be used.
     */
    if (practiceId) {
      const existing = await Clinic.countDocuments({ practice: practiceId });

      if (existing >= 1 && !(await requestCan(req, CAPABILITIES.MULTI_LOCATION))) {
        throw conflict(
          'This practice is set up for a single location. Adding another needs a practice type that has them.',
        );
      }

      // The cap has existed since plans did and was never called — the same
      // way the staff one was decoration until /team started asking.
      const lapsed = await billingBlocks(practiceId, 'ADD_LOCATION');
      if (lapsed) {
        throw conflict(
          'Adding a location is paused while the subscription payment is outstanding. ' +
            'Your existing locations are unaffected.',
        );
      }

      const practice = await Practice.findById(practiceId);
      const over = practice?.overLimit('locations', existing);
      if (over) {
        throw conflict(
          `This practice is at its limit of ${over.cap} location${over.cap === 1 ? '' : 's'}. Ask about a larger plan.`,
        );
      }
    }

    // A logo is published to every patient once a location carries it, so it
    // has to be this practice's own artwork. See services/mediaAccess.js.
    await assertLogoAssets(req, req.body, practiceId);

    const clinic = await Clinic.create({
      ...req.body,
      doctor: doctor?._id,
      ...(practiceId ? { practice: practiceId } : {}),
    });
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
    if (practiceId) {
      noticeUsage(
        practiceId,
        'locations',
        await Clinic.countDocuments({ practice: practiceId }),
      ).catch(() => {});
    }

    res.status(201).json({ clinic: clinic.toPublic() });
  }),
);

router.patch(
  '/:id',
  requireRole(...PRACTICE_SETUP),
  validate({ body: clinicBody.partial() }),
  audit('update', 'Clinic'),
  asyncHandler(async (req, res) => {
    // This practice's locations only. `findById` edited anybody's — and a
    // location's name, phone and letterhead are what its patients are shown.
    // `$and`, so the scope can never stand in for the id asked for.
    const clinic = await Clinic.findOne({ $and: [{ _id: req.params.id }, await practiceClinics(req)] });
    if (!clinic) throw notFound('Clinic not found');
    // After the practice check, so another practice's location is still "not
    // found" to everybody; this one is ours, and the question is whose to run.
    await assertManagesLocation(req, clinic._id);
    await assertLogoAssets(req, req.body, clinic.practice);
    Object.assign(clinic, req.body);
    await clinic.save();
    // The identity resolver caches for a minute. Without this the person who
    // just renamed the clinic is shown the old name back, which reads as the
    // save having failed.
    forgetClinicIdentity();
    // Switching "Accepting bookings" off here closes the location as surely as
    // the delete route does, and leaves the same patients to be moved.
    res.json({
      clinic: clinic.toPublic(),
      ...(clinic.isActive ? {} : await stillBookedAt(clinic._id)),
    });
  }),
);

/**
 * The appointments still standing at a location from now on — what closing it
 * leaves for the desk to deal with.
 *
 * ---- Returned, not counted and not acted on ----------------------------------
 *
 * Closing a location stops new work there and touches nothing already booked.
 * It used to say nothing at all, so the patients booked at a branch that had
 * just closed kept confirmed appointments at a door nobody would open, and
 * nobody was told who they were. A count says there is a problem and not whose.
 *
 * Nothing is cancelled on their behalf either: whether a closed branch's Tuesday
 * list goes to the other branch, to another day or to a phone call is the
 * practice's decision, and a patient told by push that their visit was called
 * off by a settings change stops trusting the pushes. So the desk is given the
 * appointments themselves — who, when, with whom — to move or call off.
 *
 * Capped, with the total: a location with years of bookings ahead is a list to
 * work through on the appointments screen, not a response to scroll.
 */
const STILL_BOOKED_CAP = 200;

async function stillBookedAt(clinicId) {
  const filter = {
    clinic: clinicId,
    status: { $in: ACTIVE_STATUSES },
    scheduledFor: { $gte: new Date() },
  };
  const [rows, total] = await Promise.all([
    Appointment.find(filter)
      .sort({ scheduledFor: 1 })
      .limit(STILL_BOOKED_CAP)
      .populate('patient', 'name phone')
      .populate('doctor', 'name')
      .lean(),
    Appointment.countDocuments(filter),
  ]);

  return {
    affectedTotal: total,
    affectedAppointments: rows.map((a) => ({
      id: String(a._id),
      patientId: String(a.patient?._id ?? a.patient),
      patientName: a.patient?.name ?? null,
      patientPhone: a.patient?.phone ?? null,
      doctorId: String(a.doctor?._id ?? a.doctor),
      doctorName: a.doctor?.name ?? null,
      clinicId: String(clinicId),
      scheduledFor: a.scheduledFor,
      durationMinutes: a.durationMinutes,
      mode: a.mode,
      status: a.status,
    })),
  };
}

/**
 * Soft-delete: mark inactive rather than remove, so appointments already booked
 * here keep a valid clinic reference and history stays intact.
 *
 * What stops is new work: the slot engine publishes nothing for an inactive
 * location, and booking, confirming, moving into it and checking in there are
 * refused. What stays is everything already written — the appointments, the
 * queue numbers, the row itself.
 */
router.delete(
  '/:id',
  requireRole(...PRACTICE_SETUP),
  audit('update', 'Clinic'),
  asyncHandler(async (req, res) => {
    // Found, then checked, then closed: one update scoped by the practice could
    // not ask whether this caller runs the location before closing it.
    const found = await Clinic.findOne({ $and: [{ _id: req.params.id }, await practiceClinics(req)] });
    if (!found) throw notFound('Clinic not found');
    await assertManagesLocation(req, found._id);

    const clinic = await Clinic.findOneAndUpdate({ _id: found._id }, { isActive: false }, { new: true });
    forgetClinicIdentity();

    // The patients still booked here, for the desk to move or call off. See
    // stillBookedAt.
    res.json({ clinic: clinic.toPublic(), ...(await stillBookedAt(clinic._id)) });
  }),
);

export default router;
