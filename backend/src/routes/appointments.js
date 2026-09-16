import { Router } from 'express';
import dayjs from 'dayjs';
// The clinic's own clock, not the server's. A confirmation that names an hour
// has to name it in the hour the patient will turn up.
import { inClinicTz } from '../utils/clinicTime.js';
import crypto from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireClinician, requireRole } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, badRequest, conflict } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Appointment, APPOINTMENT_STATUS } from '../models/Appointment.js';
import { Clinic } from '../models/Clinic.js';
import { User, ROLES } from '../models/User.js';
import { AppointmentWaitlist } from '../models/AppointmentWaitlist.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { logger } from '../config/logger.js';
import {
  notifyClinicOfAppointmentChange,
  notifyPatientOfAppointmentChange,
  notifyWaitlistOfFreedSlot,
} from '../services/notifications.js';
import { ACTIVE_STATUSES, isSlotBookable, doctorCommitments } from '../services/scheduling.js';
import { paged, pageParams, dateRange } from '../utils/pagination.js';
import { postCareThreadNote } from '../services/careThreadNote.js';
import { resolveDoctor } from '../services/doctorContext.js';
import { nextInSequence } from '../services/sequence.js';
import {
  practiceMembers,
  memberLocation,
  practiceOf,
  practicePatients,
  practiceClinics,
  patientClinics,
  patientPracticeIds,
  memberIdsOf,
  practiceOfMember,
} from '../middleware/practiceScope.js';

const router = Router();
router.use(requireAuth);

/** Fallback slot length for teleconsults and queue estimates (no clinic). */
const DEFAULT_SLOT_MINUTES = 15;

const isPatient = (req) => req.user.role === ROLES.PATIENT;

/**
 * Whose appointments this caller may see, and it returned `{}` for a clinician.
 *
 * ---- Every appointment on the platform ---------------------------------
 *
 * A patient was correctly limited to their own. Anybody else got an empty
 * filter, which with one clinic was the right answer and with two is every
 * booking anywhere: the diary, the waiting-room queue with patients' names on
 * it, and — through `findOne({ _id, ...scopeFilter })` — the ability to
 * reschedule, cancel or check in another practice's appointment by id.
 *
 * ---- Scoped by the doctor, not the location ----------------------------
 *
 * `clinic` is optional: a teleconsult has none, and an appointment scoped by
 * clinic alone would leave every remote consultation unfiltered. `doctor` is
 * required on every appointment, so the practice's doctors are the reliable
 * boundary.
 *
 * Permissive on unknown, like every other guard here — `practiceMembers`
 * returns `{}` when the caller has no practice or the backfill has not run.
 */
async function scopeFilter(req) {
  if (isPatient(req)) return { patient: req.user._id };
  return practiceMembers(req, ROLES.DOCTOR, 'doctor');
}

/**
 * Which waiting room an appointment queues in, and how to find the others in it.
 *
 * A location where there is one: two branches of one practice run two rooms and
 * two numbering sequences. A teleconsult has no building and queues with its
 * practice's other remote consultations.
 *
 * ---- From the appointment, never from the caller -------------------------
 *
 * The teleconsult queue was the *caller's* practice's doctors. A receptionist
 * has a practice; a patient checking themselves in does not, so their queue
 * came back empty — and every patient who checked in on their own phone was
 * told they were number one, whoever was already waiting. The appointment
 * knows whose it is.
 *
 * `key` names the counter; `scope` finds the room's other patients.
 */
async function queueOf(appt) {
  if (appt.clinic) {
    return { key: `clinic:${appt.clinic}`, scope: { clinic: appt.clinic } };
  }

  const practice = appt.practice ?? (await practiceOfMember(appt.doctor));
  if (!practice) {
    return { key: `doctor:${appt.doctor}`, scope: { doctor: appt.doctor, clinic: null } };
  }

  const doctors = await memberIdsOf(practice, ROLES.DOCTOR);
  return {
    key: `practice:${practice}`,
    scope: { doctor: { $in: doctors?.length ? doctors : [appt.doctor] }, clinic: null },
  };
}

/**
 * The queue a patient is standing in today, as a filter — or null when they are
 * not in one.
 *
 * The same queue their number was drawn from at check-in: the location's, or
 * for a teleconsult, which has no location, the doctors of the practice it is
 * with. Anything wider shows them other practices' waiting rooms.
 */
async function queueOfPatient(patientId, today) {
  const mine = await Appointment.findOne({
    patient: patientId,
    queueDate: today,
    status: { $in: ['checked_in', 'in_consultation'] },
  })
    .select('clinic doctor practice')
    .lean();
  if (!mine) return null;
  // The same definition check-in numbers by, so "three ahead of you" counts the
  // room the token came from — see queueOf.
  return (await queueOf(mine)).scope;
}

/**
 * Refuse a patient named in the body who is not this practice's.
 *
 * The desk books on somebody's behalf by id, and nothing asked whose patient
 * the id was: a receptionist could book another practice's patient into their
 * own diary and read the name and number back from the response. The same
 * check the upload route makes for a file filed against a patient.
 */
async function assertOwnPatient(req, patientId) {
  const scope = await practicePatients(req, '_id');
  // `{}` is the permissive answer — a deployment the enrolment backfill has
  // not reached. Same rule as everywhere else.
  const theirs = !scope._id || scope._id.$in.some((id) => String(id) === String(patientId));
  if (!theirs) throw notFound('Patient not found');
}

/**
 * The locations a booking may use: the desk's practice's, or the patient's
 * practices'. `practiceClinics` answers from a membership, which a patient
 * does not have.
 */
function bookableClinics(req, patientId) {
  return isPatient(req) ? patientClinics(patientId) : practiceClinics(req);
}

/**
 * Which practice an appointment request is being made to.
 *
 * A member of staff asks for their own. A patient asks the practice they are
 * under — derived from the work, never picked off a list: the doctor they are
 * assigned to where that doctor works at one of their practices, and otherwise
 * their enrolment when they have only one.
 *
 * `assignedDoctor` is a single global field on the profile, so it can name a
 * doctor at a practice the caller has nothing to do with. Read as a preference
 * *within* the practice being asked and ignored when it points outside, which
 * is what stops a desk at one clinic writing a request into another's diary.
 *
 * `ambiguous` rather than a guess: two enrolments and nothing to choose
 * between them is a question for the patient, and answering it by writing into
 * whichever practice came back first is how one clinic ends up holding
 * another's appointment. `unknown` is the pre-backfill deployment, where the
 * old permissive behaviour stands.
 *
 * @returns {Promise<{practice: import('mongoose').Types.ObjectId|null, reason: string|null}>}
 */
async function practiceAsked(req, patientId, assignedDoctor) {
  if (!isPatient(req)) return { practice: await practiceOf(req), reason: null };

  const mine = await patientPracticeIds(patientId);
  if (mine === null) return { practice: null, reason: 'unknown' };
  if (mine.length === 0) return { practice: null, reason: 'none' };
  if (mine.length === 1) return { practice: mine[0], reason: null };

  if (assignedDoctor) {
    const where = await practiceOfMember(assignedDoctor);
    if (where && mine.some((p) => String(p) === String(where))) {
      return { practice: where, reason: null };
    }
  }
  return { practice: null, reason: 'ambiguous' };
}

/**
 * Refuse a doctor who does not work where this booking is.
 *
 * `resolveDoctor` finds a named doctor anywhere on the platform, which is
 * right for what it answers — and a booking naming one landed in that doctor's
 * practice's diary. Refused in the words `resolveDoctor` uses for a doctor who
 * does not exist, so the answer says nothing about who else is on the platform.
 */
async function assertDoctorHere(req, patientId, doctorId, location) {
  let practices;
  if (location?.practice) {
    practices = [location.practice];
  } else if (!isPatient(req)) {
    const mine = await practiceOf(req);
    practices = mine ? [mine] : null;
  } else {
    practices = await patientPracticeIds(patientId);
  }
  // Unknown is permissive, like every scope here.
  if (!practices) return;

  const members = await Promise.all(practices.map((p) => memberIdsOf(p, ROLES.DOCTOR)));
  // `null` is "memberships not migrated", which permits too.
  if (members.some((ids) => ids === null)) return;
  if (!members.flat().some((id) => String(id) === String(doctorId))) {
    throw conflict('That doctor was not found.');
  }
}

const POPULATE = [
  // avatarAssetId so a request card can show the patient's face. The desk is
  // looking for a person standing in front of them, and initials in a coloured
  // circle are not what anybody scans a waiting room for.
  { path: 'patient', select: 'name phone avatarAssetId' },
  // specialty too, so a patient's own list can say who they are seeing and
  // what for. It is on the doctor's record already and was simply never asked
  // for here, which left the patient reading a date with no name against it.
  { path: 'doctor', select: 'name specialty' },
  { path: 'clinic', select: 'name addressLine city phone' },
];

router.get(
  '/',
  validate({
    query: pageParams.and(
      z.object({
        status: z.enum(APPOINTMENT_STATUS).optional(),
        patientId: z.string().optional(),
        clinicId: z.string().optional(),
      }),
    ),
  }),
  audit('read', 'Appointment'),
  asyncHandler(async (req, res) => {
    const { page, limit, skip, from, to, status, patientId, clinicId } = q(req);

    /**
     * Which branch's diary this is.
     *
     * A doctor whose membership names a location opens on that location's day.
     * Null — every membership the backfill created, and every solo practice —
     * means the whole practice, unchanged.
     *
     * A default, not a wall: `?clinicId=` still overrides it, because a doctor
     * covering a colleague's afternoon at the other branch has to be able to
     * look at it. The doctor filter above still bounds that to this practice,
     * so an id from somewhere else returns nothing rather than somebody's
     * afternoon.
     */
    const mine = await memberLocation(req);

    const filter = {
      ...(await scopeFilter(req)),
      ...dateRange('scheduledFor', { from, to }),
      ...(status ? { status } : {}),
      ...(!isPatient(req) && mine && !clinicId ? { clinic: mine } : {}),
      ...(clinicId ? { clinic: clinicId } : {}),
      ...(!isPatient(req) && patientId ? { patient: patientId } : {}),
    };

    const [items, total] = await Promise.all([
      Appointment.find(filter)
        .sort({ scheduledFor: -1 })
        .skip(skip)
        .limit(limit)
        .populate(POPULATE)
        .lean(),
      Appointment.countDocuments(filter),
    ]);

    res.json(paged(items.map(serialise), { page, limit, total }));
  }),
);

router.post(
  '/',
  validate({
    body: z.object({
      scheduledFor: z.coerce.date(),
      clinicId: z.string().optional(),
      mode: z.enum(['in_clinic', 'teleconsult']).default('in_clinic'),
      reason: z.string().max(600).optional(),
      patientId: z.string().optional(),
      doctorId: z.string().optional(),
    }),
  }),
  audit('create', 'Appointment'),
  asyncHandler(async (req, res) => {
    const { scheduledFor, mode, reason, clinicId } = req.body;

    if (dayjs(scheduledFor).isBefore(dayjs())) {
      throw badRequest('Appointment time must be in the future');
    }

    const patientId = isPatient(req) ? req.user._id : req.body.patientId;
    if (!patientId) throw badRequest('patientId is required');
    if (!isPatient(req)) await assertOwnPatient(req, patientId);

    // A named location has to be one this booking may use, and it is checked
    // before anything reads it: resolving the doctor reads the clinic by id, and
    // another practice's location must be refused in the same words as one that
    // does not exist. An inactive one reads the same way, for the same reason.
    const location = clinicId
      ? await Clinic.findOne({ $and: [{ _id: clinicId }, await bookableClinics(req, patientId)] })
      : null;
    if (clinicId && !location) throw badRequest('That clinic is not available');

    // The chosen clinic already records its doctor, so a booking at the Salt
    // Lake branch lands on the doctor who sits there rather than on whichever
    // row the database returned first.
    const doctor = await resolveDoctor({
      explicitId: req.body.doctorId,
      clinicId: location?._id ?? null,
      required: true,
    });
    if (!doctor) throw badRequest('No doctor is available for booking');
    await assertDoctorHere(req, patientId, doctor._id, location);

    // An in-clinic visit must land on a real, free slot of the chosen clinic's
    // schedule. This is the authoritative check — the client cannot book a time
    // the schedule does not offer, or one already taken.
    let clinic = null;
    if (mode === 'in_clinic') {
      if (!location) throw badRequest('Please choose a clinic');
      if (!location.isActive) throw badRequest('That clinic is not available');
      clinic = location;
      if (!(await isSlotBookable(clinic, scheduledFor, { doctorId: doctor._id }))) {
        throw badRequest('That time slot is no longer available. Please choose another.');
      }
    }

    // Second guard, for the doctor rather than the building: a teleconsult has
    // no slot list to have checked, and a doctor booked at another location in
    // the moments since is not in either. See doctorCommitments.
    const slotStart = dayjs(scheduledFor);
    const length = clinic?.slotMinutes ?? DEFAULT_SLOT_MINUTES;
    const clash = await doctorCommitments(
      doctor._id,
      slotStart.toDate(),
      slotStart.add(length, 'minute').toDate(),
    );
    if (clash.length) throw badRequest('That time slot has just been taken. Please choose another.');

    const appointment = await Appointment.create({
      patient: patientId,
      doctor: doctor._id,
      clinic: clinic?._id,
      // Whose diary. From the building where there is one; a teleconsult has
      // none, so it comes from the doctor's own membership.
      practice: clinic?.practice ?? (await practiceOfMember(doctor._id)),
      scheduledFor,
      mode,
      reason,
      durationMinutes: clinic?.slotMinutes ?? DEFAULT_SLOT_MINUTES,
      // Auto-confirm: booking a free slot grants it immediately — no manual
      // approval step. The clinic can still cancel or reschedule afterwards.
      status: 'confirmed',
      ...(mode === 'teleconsult'
        ? { teleconsult: { roomId: crypto.randomUUID(), joinUrl: null } }
        : {}),
    });

    await appointment.populate(POPULATE);

    // Booking auto-confirms, so the clinic learns of it only if told. Awaited
    // rather than fired-and-forgotten so a transport failure surfaces in the
    // log next to the booking that caused it.
    await notifyClinicOfAppointmentChange(
      appointment,
      req.patientUser?.name ?? appointment.patient?.name ?? 'A patient',
      'booked',
    );

    res.status(201).json({ appointment: serialise(appointment) });
  }),
);

/**
 * Ask for an appointment without choosing a slot.
 *
 * The booking route above is the fast path: a patient picks a free slot from
 * the published schedule and it confirms immediately. This is the other half —
 * a patient saying "can I see the doctor this week?" from the care thread, with
 * a day in mind rather than a time.
 *
 * It is a real Appointment at status `requested`, not a chat message. A request
 * that lives only in the conversation cannot be listed, counted, reminded on or
 * reported, and it is lost the moment the thread scrolls. The desk turns it
 * into a time; the row is the same row throughout.
 *
 * `preferredFor` is what the patient asked for, not a promise. Staff confirm it
 * or move it, and the patient is told which.
 */

/**
 * "We have your request" — in the thread, the moment it is made.
 *
 * The clinic already answers there: confirming writes a line, and so does
 * turning somebody down. The gap was the beginning. A patient asked — from the
 * chat card or the button in the header — and the conversation showed their own
 * message and nothing after it, sometimes for a day. Nothing said the clinic
 * had it. The commonest response to that silence is to ask again, which the
 * server folds into the same request, so they hear nothing a second time.
 *
 * A snackbar is not this. It is gone in four seconds, it is on whatever screen
 * they were on, and it is not there tomorrow when they wonder whether they
 * actually sent it. The thread is where they will look.
 *
 * Best-effort, like the other two: an acknowledgement that fails must never
 * fail the request it is acknowledging.
 */
function acknowledgeInThread(appointment, patientId) {
  const day = appointment.preferredFor
    ? new Date(appointment.preferredFor).toLocaleDateString('en-IN', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        timeZone: 'Asia/Kolkata',
      })
    : null;

  // Their preferred hour is read back to them. It is the part most likely to
  // be lost between a request and a confirmation, and a patient who asked for
  // the evening wants to see that the evening was heard.
  const when = [day, appointment.preferredTime].filter(Boolean).join(', ');

  return postCareThreadNote({
    patientId,
    author: 'clinic',
    text: when
      ? `We have your appointment request for ${when}. The clinic will confirm a time and let you know here.`
      : 'We have your appointment request. The clinic will confirm a time and let you know here.',
  }).catch(() => {});
}

router.post(
  '/request',
  validate({
    body: z.object({
      // A day they have in mind. Required, because "sometime" gives the desk
      // nothing to work with and turns into a phone call anyway.
      preferredFor: z.coerce.date(),
      // 'HH:mm'. Optional, because "any time on Tuesday" is a real answer and
      // forcing an hour makes the patient invent one.
      preferredTime: z
        .string()
        .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
        .optional(),
      mode: z.enum(['in_clinic', 'teleconsult']).default('in_clinic'),
      reason: z.string().max(600).optional(),
      patientId: z.string().optional(),
    }),
  }),
  audit('create', 'Appointment'),
  asyncHandler(async (req, res) => {
    const { preferredFor, preferredTime, mode, reason } = req.body;

    if (dayjs(preferredFor).isBefore(dayjs().startOf('day'))) {
      throw badRequest('Please choose a day that has not passed');
    }

    const patientId = isPatient(req) ? req.user._id : req.body.patientId;
    if (!patientId) throw badRequest('patientId is required');
    // Before anything is written — a request posts a line into the patient's
    // care thread, and another practice's patient is not this desk's to write to.
    if (!isPatient(req)) await assertOwnPatient(req, patientId);

    // No clinic is chosen yet — this is a request, and the desk gives it a time
    // later. So it goes to the doctor this patient is already under, which is
    // the one they mean when they ask for an appointment.
    const enrolled = await PatientProfile.findOne({ user: patientId })
      .select('assignedDoctor')
      .lean();

    const asked = await practiceAsked(req, patientId, enrolled?.assignedDoctor);
    if (asked.reason === 'none') {
      throw badRequest('You are not with a clinic yet, so there is nobody to ask.');
    }
    if (asked.reason === 'ambiguous') {
      throw badRequest('Please choose which of your clinics you are asking.');
    }

    /*
     * The doctors of the practice being asked. `assignedDoctor` is honoured
     * only if it names one of them: it is a single field for a patient who may
     * be under two clinics, and a request carrying the wrong practice's doctor
     * lands in the wrong diary — where the practice that took it cannot even
     * confirm it, because every route here is scoped by its own doctors.
     */
    const doctorsHere = asked.practice ? await memberIdsOf(asked.practice, ROLES.DOCTOR) : null;
    const assignedHere =
      enrolled?.assignedDoctor &&
      (doctorsHere === null ||
        doctorsHere.some((id) => String(id) === String(enrolled.assignedDoctor)));

    const doctor = await resolveDoctor({
      explicitId: assignedHere ? enrolled.assignedDoctor : null,
      practiceId: asked.practice ?? null,
      required: true,
    });
    if (!doctor) throw badRequest('No doctor is available for booking');

    /*
     * One open request at a time — at this practice.
     *
     * A patient who taps twice, or asks again next day because nobody has
     * answered, should not appear on the desk's list as two people wanting two
     * appointments. That is a true rule about a clinic and a false one about a
     * person: somebody may be asking a diabetologist and a cardiologist in the
     * same week, and this query had neither practice nor doctor in it. The
     * second clinic's request therefore rewrote the first clinic's row, which
     * kept its original doctor — so the second never saw it, and the first saw
     * a day the patient had asked somebody else for.
     *
     * Falls back to the resolved doctor where the practice cannot be read,
     * which is narrower than the platform and never touches another practice's
     * row.
     */
    const existing = await Appointment.findOne({
      patient: patientId,
      status: 'requested',
      doctor: doctorsHere?.length ? { $in: doctorsHere } : doctor._id,
      /*
       * A request for a day, not the replacement row a reschedule leaves
       * behind. That one is also 'requested' and carries a time the patient
       * already holds; writing this request's preferred day onto it would put
       * two times on one row, one of them imaginary — which is the thing
       * `preferredFor` exists as a separate field to prevent.
       */
      preferredFor: { $ne: null },
    });
    if (existing) {
      existing.preferredFor = preferredFor;
      // Assigned, not conditionally kept: a patient who asked again *without*
      // a time has changed their mind about the time, and leaving the old one
      // would have the desk working from a wish that was withdrawn.
      existing.preferredTime = preferredTime ?? undefined;
      if (reason) existing.reason = reason;
      existing.mode = mode;
      await existing.save();
      await existing.populate(POPULATE);
      // Acknowledged again on a repeat, deliberately. Somebody asking a second
      // time is somebody who is not sure the first one landed, and answering
      // the question they are actually asking is worth one more line.
      acknowledgeInThread(existing, patientId);
      return res.json({ appointment: serialise(existing), updated: true });
    }

    let appointment;
    try {
      appointment = await Appointment.create({
        patient: patientId,
        doctor: doctor._id,
        // Which practice was asked. Written on the row rather than inferred
        // from the doctor later, so "one open request per practice" is a rule
        // the database can hold rather than one every query has to remember.
        practice: asked.practice ?? (await practiceOfMember(doctor._id)),
        // No clinic and no time yet: the desk assigns both when it confirms.
        //
        // preferredFor, NOT scheduledFor. 'requested' is an active status, so a
        // time written here would hold that slot against everyone — including the
        // desk trying to confirm this very request at a different hour.
        preferredFor,
        preferredTime,
        mode,
        reason,
        status: 'requested',
      });
    } catch (err) {
      /*
       * Two taps in the same instant.
       *
       * The lookup above and this write are a read and then a write, and both
       * requests read "nothing there". The unique index is what actually stops
       * the second row; this turns its refusal into the answer the second tap
       * deserved in the first place — the request that exists, which is what a
       * patient who pressed twice is asking about.
       */
      if (err?.code !== 11000) throw err;

      const raced = await Appointment.findOne({
        patient: patientId,
        status: 'requested',
        practice: asked.practice,
        preferredFor: { $ne: null },
      }).populate(POPULATE);
      if (!raced) throw err;

      acknowledgeInThread(raced, patientId);
      return res.json({ appointment: serialise(raced), updated: true });
    }

    await appointment.populate(POPULATE);

    acknowledgeInThread(appointment, patientId);

    // The desk hears first, which is the whole point of the request path: the
    // doctor has already approved the hours, and staff book inside them.
    // The desk hears, and only the desk.
    //
    // Pushing every request to the doctor as well would put him back in the
    // middle of routine scheduling — the exact bottleneck the request path
    // exists to avoid. He has already approved the hours; he learns of the
    // appointment when it is confirmed and lands in his day. If the clinic has
    // no staff account yet, it falls back to him, because a request nobody is
    // told about is worse than one that interrupts.
    await notifyClinicOfAppointmentChange(
      appointment,
      req.patientUser?.name ?? appointment.patient?.name ?? 'A patient',
      'requested',
      { deskOnly: true },
    );

    res.status(201).json({ appointment: serialise(appointment) });
  }),
);

/**
 * Turn a request into a booking: give it a clinic and a time.
 *
 * The desk's own action, and the reason the request path exists. The doctor
 * published his hours once; staff confirm inside them without asking him each
 * time, and he learns of it when it lands in his day.
 *
 * Not reschedule-then-set-status. Reschedule validates the new time against
 * `existing.clinic`, and a request has no clinic — so it would skip slot
 * validation altogether and leave the appointment `requested` WITH a
 * scheduledFor, which is precisely the state that holds a slot without being a
 * booking. Both halves have to move together, and the slot has to be checked
 * the same way a patient's own booking is.
 */
router.patch(
  '/:id/confirm',
  requireRole(ROLES.DOCTOR, ROLES.STAFF),
  validate({
    body: z.object({
      clinicId: z.string(),
      scheduledFor: z.coerce.date(),
      // Set only on a second attempt, after the desk has been shown that this
      // patient already has a slot that day and has said to go ahead anyway.
      allowSameDay: z.boolean().optional(),
    }),
  }),
  audit('update', 'Appointment'),
  asyncHandler(async (req, res) => {
    const { clinicId, scheduledFor } = req.body;

    // Scoped like every other id-based fetch here. `findById` on a route that
    // only checks the caller is a clinician lets one practice confirm
    // another's booking by knowing the id.
    const appointment = await Appointment.findOne({
      _id: req.params.id,
      ...(await scopeFilter(req)),
    });
    if (!appointment) throw notFound('Appointment not found');
    if (appointment.status !== 'requested') {
      throw badRequest('Only a request can be confirmed. Use reschedule to move a booking.');
    }
    if (dayjs(scheduledFor).isBefore(dayjs())) {
      throw badRequest('Appointment time must be in the future');
    }

    // One of this practice's locations. The appointment is scoped above and the
    // location was not, so a request could be confirmed into another practice's
    // building — holding a slot in its diary.
    const clinic = await Clinic.findOne({
      $and: [{ _id: clinicId, isActive: true }, await practiceClinics(req)],
    });
    if (!clinic) throw badRequest('That clinic is not available');

    // The same authority a patient booking goes through. A request confirmed
    // onto a time the schedule does not offer is worse than one left pending:
    // the patient is told to come at an hour the doctor is not there.
    if (!(await isSlotBookable(clinic, scheduledFor, { doctorId: appointment.doctor }))) {
      throw badRequest('That time is not free. Please choose another.');
    }

    // The doctor's diary, not the building's — the same rule as booking.
    const slotStart = dayjs(scheduledFor);
    const clash = await doctorCommitments(
      appointment.doctor,
      slotStart.toDate(),
      slotStart.add(clinic.slotMinutes ?? DEFAULT_SLOT_MINUTES, 'minute').toDate(),
      { exclude: appointment._id },
    );
    if (clash.length) throw badRequest('That time has just been taken. Please choose another.');

    // The same patient, twice on one day.
    //
    // The clash check above asks whether the *slot* is free, which it is — a
    // patient given 10:00 and then 10:30 breaks no rule the schedule knows
    // about. It is still almost always a mistake: two requests from one person
    // that both got answered, or a desk confirming twice because the first tap
    // did not visibly land. The clinic then holds a slot nobody comes to and
    // the patient gets two reminders for one visit.
    //
    // A warning, not a rule. Two appointments in a day are legitimate — a
    // morning review and an evening procedure — so the desk is told and may go
    // ahead, rather than being refused something the clinic is allowed to do.
    if (!req.body.allowSameDay) {
      const dayStart = slotStart.startOf('day');
      /*
       * This practice's day, not the patient's.
       *
       * Unscoped, this refused a legitimate confirmation because another
       * practice had seen the same patient that morning — and said so, by
       * returning that appointment's exact time in the error. Two clinics
       * seeing one person on one day is ordinary; only a clash inside a
       * practice is a mistake worth warning the desk about.
       */
      const sameDay = await Appointment.findOne({
        _id: { $ne: appointment._id },
        patient: appointment.patient,
        status: { $in: ACTIVE_STATUSES },
        ...(await scopeFilter(req)),
        scheduledFor: {
          $gte: dayStart.toDate(),
          $lt: dayStart.add(1, 'day').toDate(),
        },
      })
        .select('scheduledFor')
        .lean();

      if (sameDay) {
        // A list of {path, message}, because that is the only shape the error
        // envelope carries through to the client — an object here is parsed as
        // nothing and the desk would get a bare "conflict" with no idea which
        // appointment it clashed with.
        throw conflict('This patient already has an appointment that day.', [
          {
            path: 'SAME_DAY_APPOINTMENT',
            message: sameDay.scheduledFor.toISOString(),
          },
        ]);
      }
    }

    /*
     * The confirmation itself — only if nobody has confirmed it first.
     *
     * It read the request, checked it was still a request above, changed it
     * and saved it. Two desks answering the same request together both passed
     * that check and both saved, the second silently replacing the first
     * desk's time and building, and the patient was sent a confirmation for
     * each: two times for one appointment, with the later one quietly the true
     * one. Conditional on the status in one operation, exactly one desk
     * confirms; the other is told somebody already has, and sends nothing.
     */
    const confirmed = await Appointment.findOneAndUpdate(
      { _id: appointment._id, status: 'requested' },
      {
        $set: {
          clinic: clinic._id,
          scheduledFor,
          durationMinutes: clinic.slotMinutes ?? DEFAULT_SLOT_MINUTES,
          status: 'confirmed',
        },
        // The wish is spent. Keeping it would leave two dates on one row and
        // no way to tell which one anybody should turn up for.
        $unset: { preferredFor: 1, preferredTime: 1 },
      },
      { new: true },
    ).populate(POPULATE);
    if (!confirmed) {
      throw conflict('Somebody has already confirmed this request. Nothing was changed.');
    }

    const when = inClinicTz(scheduledFor).format('ddd D MMM, h:mm A');

    // The patient asked and is owed the answer; the doctor's day has changed.
    await Promise.all([
      notifyPatientOfAppointmentChange(confirmed, 'confirmed').catch(() => {}),
      // And in the thread they asked in. The push is dismissed or arrives with
      // the phone face-down; the Home card shows a date with no account of
      // where it came from. Without this the conversation reads as a question
      // nobody answered.
      postCareThreadNote({
        patientId: confirmed.patient?._id ?? confirmed.patient,
        author: req.user,
        text: `Your appointment is confirmed for ${when} at ${clinic.name}.`,
      }),
      notifyClinicOfAppointmentChange(
        confirmed,
        confirmed.patient?.name ?? 'A patient',
        'booked',
      ).catch(() => {}),
    ]);

    res.json({ appointment: serialise(confirmed) });
  }),
);

router.patch(
  '/:id/reschedule',
  validate({ body: z.object({ scheduledFor: z.coerce.date() }) }),
  audit('update', 'Appointment'),
  asyncHandler(async (req, res) => {
    const existing = await Appointment.findOne({ _id: req.params.id, ...(await scopeFilter(req)) });
    if (!existing) throw notFound('Appointment not found');
    if (['completed', 'cancelled'].includes(existing.status)) {
      throw badRequest('This appointment can no longer be changed');
    }
    if (dayjs(req.body.scheduledFor).isBefore(dayjs())) {
      throw badRequest('Appointment time must be in the future');
    }

    // Re-validate the new time against the same clinic's live schedule.
    if (existing.clinic) {
      const clinic = await Clinic.findOne({ _id: existing.clinic, isActive: true });
      if (!clinic) throw badRequest('That clinic is not available');
      // The appointment being moved is still in the diary until it is
      // cancelled below, and must not count as the thing it clashes with.
      if (!(await isSlotBookable(clinic, req.body.scheduledFor, { doctorId: existing.doctor, exclude: existing._id }))) {
        throw badRequest('That time slot is not available. Please choose another.');
      }
    }

    // Preserve the original as an audit trail rather than mutating in place.
    existing.status = 'cancelled';
    existing.cancellationReason = 'Rescheduled by patient';
    existing.cancelledBy = req.user._id;
    await existing.save();

    const replacement = await Appointment.create({
      patient: existing.patient,
      doctor: existing.doctor,
      clinic: existing.clinic,
      // Carried from the row it replaces, and derived for one written before
      // the field existed — a reschedule must not lose whose diary it is in.
      practice: existing.practice ?? (await practiceOfMember(existing.doctor)),
      scheduledFor: req.body.scheduledFor,
      mode: existing.mode,
      reason: existing.reason,
      durationMinutes: existing.durationMinutes,
      status: 'requested',
      rescheduledFrom: existing._id,
    });

    await replacement.populate(POPULATE);
    res.json({ appointment: serialise(replacement) });
  }),
);

router.patch(
  '/:id/cancel',
  validate({ body: z.object({ reason: z.string().max(500).optional() }) }),
  audit('update', 'Appointment'),
  asyncHandler(async (req, res) => {
    const appt = await Appointment.findOne({ _id: req.params.id, ...(await scopeFilter(req)) });
    if (!appt) throw notFound('Appointment not found');
    if (appt.status === 'completed') throw badRequest('Completed appointments cannot be cancelled');

    appt.status = 'cancelled';
    appt.cancelledBy = req.user._id;
    appt.cancellationReason = req.body.reason;
    await appt.save();

    await appt.populate(POPULATE);

    await notifyClinicOfAppointmentChange(appt, appt.patient?.name ?? 'A patient', 'cancelled');
    // Only tell the patient when someone else cancelled on them. Announcing
    // their own action back to them is noise, and noise is what teaches people
    // to ignore the alert that matters.
    if (!appt.patient?._id?.equals?.(req.user._id)) {
      await notifyPatientOfAppointmentChange(appt, 'cancelled', req.body.reason);

      // And in the thread, exactly as a confirmation is.
      //
      // Confirming wrote a line into the conversation the patient asked in;
      // being turned down wrote nothing, so a refusal existed only as a push —
      // and a push is swiped away. The thread then reads as a question nobody
      // answered, which is the precise failure the confirmation note was added
      // to prevent, left in place for the answer that is harder to hear.
      //
      // The two are worded apart because they are different events. A request
      // declined never had a time, so there is nothing to say has been called
      // off — only that the day they wanted could not be given, and that asking
      // for another is the next move. A booking cancelled had an hour, and
      // naming it is how the patient knows which visit is gone.
      const declinedRequest = !appt.scheduledFor;
      const reason = (req.body.reason ?? '').trim();
      await postCareThreadNote({
        patientId: appt.patient?._id ?? appt.patient,
        author: req.user,
        text: declinedRequest
          ? [
              appt.preferredFor
                ? `We could not give you an appointment on ${inClinicTz(appt.preferredFor).format('ddd D MMM')}.`
                : 'We could not give you an appointment for the day you asked about.',
              reason || 'Please ask for another day and we will find you a time.',
            ].join(' ')
          : [
              `Your appointment on ${inClinicTz(appt.scheduledFor).format('ddd D MMM, h:mm A')} has been cancelled.`,
              reason || 'Please ask for another time when you are ready.',
            ].join(' '),
      });
    }
    await offerFreedSlotToWaitlist(appt);

    res.json({ appointment: serialise(appt) });
  }),
);

/**
 * Patient asks to be told if a slot frees up on a day that is currently full.
 *
 * Re-activates a previous request rather than erroring on the unique index, so
 * a patient who joined, booked, and later needs the same day again just works.
 */
router.post(
  '/waitlist',
  validate({
    body: z.object({ clinicId: z.string(), date: z.coerce.date() }),
  }),
  audit('create', 'AppointmentWaitlist'),
  asyncHandler(async (req, res) => {
    if (req.user.role !== ROLES.PATIENT) throw badRequest('Only patients can join the waitlist');

    // A location this patient may book at. The waitlist took any id, and a
    // freed slot there is offered to everybody waiting on it.
    const bookable = await Clinic.exists({
      $and: [{ _id: req.body.clinicId, isActive: true }, await patientClinics(req.user._id)],
    });
    if (!bookable) throw badRequest('That clinic is not available');

    const desiredDate = dayjs(req.body.date).startOf('day').toDate();
    const entry = await AppointmentWaitlist.findOneAndUpdate(
      { patient: req.user._id, clinic: req.body.clinicId, desiredDate },
      { $set: { isActive: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true },
    );

    res.status(201).json({ waitlist: { id: entry._id, date: desiredDate, clinicId: entry.clinic } });
  }),
);

router.delete(
  '/waitlist/:id',
  audit('update', 'AppointmentWaitlist'),
  asyncHandler(async (req, res) => {
    await AppointmentWaitlist.findOneAndUpdate(
      { _id: req.params.id, patient: req.user._id },
      { isActive: false },
    );
    res.status(204).end();
  }),
);

/**
 * Notifies patients waiting on the day this appointment occupied.
 *
 * Ordered worst-controlled first: the slot still goes to whoever books it, but
 * the patient in most clinical need gets the head start.
 *
 * Never throws into the request — a patient cancelling their own appointment
 * must not see an error because a notification could not be sent.
 */
async function offerFreedSlotToWaitlist(appointment) {
  try {
    if (!appointment.clinic) return;

    const day = dayjs(appointment.scheduledFor).startOf('day').toDate();
    const clinicId = appointment.clinic?._id ?? appointment.clinic;

    const entries = await AppointmentWaitlist.find({
      clinic: clinicId,
      desiredDate: day,
      isActive: true,
      // Do not re-notify anyone told within the hour: a cancel/rebook flap
      // would otherwise page the same people repeatedly.
      $or: [{ lastNotifiedAt: null }, { lastNotifiedAt: { $lt: dayjs().subtract(1, 'hour').toDate() } }],
    })
      .populate('patient', 'name')
      .lean();

    if (!entries.length) return;

    // `user`, not `patient` — PatientProfile keys on the User it belongs to and
    // has no `patient` field at all. Queried by the wrong name this matched
    // nothing, every risk score came back 0, and the sort below compared zero
    // to zero: the waitlist was notified in whatever order Mongo returned it,
    // so the sickest patient had no more claim on a freed slot than anyone else.
    const profiles = await PatientProfile.find({ user: { $in: entries.map((e) => e.patient._id) } })
      .select('user riskScore')
      .lean();
    const risk = new Map(profiles.map((p) => [p.user.toString(), p.riskScore ?? 0]));
    entries.sort((a, b) => (risk.get(b.patient._id.toString()) ?? 0) - (risk.get(a.patient._id.toString()) ?? 0));

    await notifyWaitlistOfFreedSlot(entries, appointment);
    await AppointmentWaitlist.updateMany(
      { _id: { $in: entries.map((e) => e._id) } },
      { lastNotifiedAt: new Date() },
    );
  } catch (err) {
    logger.error({ err, appointmentId: appointment._id }, 'could not offer freed slot to waitlist');
  }
}

router.patch(
  '/:id/status',
  requireClinician,
  validate({
    body: z.object({
      status: z.enum(APPOINTMENT_STATUS),
      consultationNotes: z.string().max(8000).optional(),
    }),
  }),
  audit('update', 'Appointment'),
  asyncHandler(async (req, res) => {
    // The scoped equivalent. findByIdAndUpdate takes no filter beyond the id,
    // so this route could move another practice's appointment into
    // "in_consultation" — and the queue screen would show it.
    const scoped = await Appointment.findOne({
      _id: req.params.id,
      ...(await scopeFilter(req)),
    })
      .select('_id')
      .lean();
    if (!scoped) throw notFound('Appointment not found');

    const appt = await Appointment.findByIdAndUpdate(
      req.params.id,
      { $set: req.body, ...(req.body.status === 'in_consultation' ? { calledAt: new Date() } : {}) },
      { new: true },
    ).populate(POPULATE);
    if (!appt) throw notFound('Appointment not found');

    // A clinician turning an appointment down is exactly the case where a
    // patient would otherwise travel to one that no longer exists, so it is
    // told to them directly rather than left to be discovered. There is no
    // separate "rejected" status in the schema — declining is a cancellation
    // made by the clinic.
    if (req.body.status === 'cancelled') {
      await notifyPatientOfAppointmentChange(appt, 'cancelled', appt.cancellationReason);
      await offerFreedSlotToWaitlist(appt);
    }

    res.json({ appointment: serialise(appt) });
  }),
);

/** Live queue for the clinic waiting room. */
router.get(
  '/queue/today',
  asyncHandler(async (req, res) => {
    const today = dayjs().format('YYYY-MM-DD');

    // The names on a waiting-room display. Unscoped, this listed every
    // patient checked in anywhere on the platform, by name.
    //
    // And a waiting room is a room. Two branches of one practice have two of
    // them, so a screen in Behala showing Salt Lake's queue is not a leak but
    // is certainly wrong — the person watching it is looking for who to call
    // next through the door in front of them.
    //
    // A patient has no membership, so the practice scope below was `{}` for
    // every one of them and their "queue" was every practice's. A patient
    // stands in the queue their own number was drawn from, and in none before
    // they have checked in.
    let queue;
    if (isPatient(req)) {
      queue = await queueOfPatient(req.user._id, today);
      if (!queue) return res.json({ date: today, nowServing: null, entries: [] });
    } else {
      const here = await memberLocation(req);
      queue = {
        ...(await practiceMembers(req, ROLES.DOCTOR, 'doctor')),
        ...(here ? { clinic: here } : {}),
      };
    }

    const entries = await Appointment.find({
      queueDate: today,
      status: { $in: ['checked_in', 'in_consultation'] },
      ...queue,
    })
      .sort({ isPriority: -1, queueNumber: 1 })
      .populate('patient', 'name')
      .lean();

    const nowServing = entries.find((e) => e.status === 'in_consultation');

    res.json({
      date: today,
      nowServing: nowServing?.queueNumber ?? null,
      entries: entries.map((e) => ({
        queueNumber: e.queueNumber,
        // Patients see only their own name in the queue; others are masked.
        patientName:
          isPatient(req) && e.patient?._id?.toString() !== req.user._id.toString()
            ? 'Patient'
            : (e.patient?.name ?? 'Patient'),
        status: e.status,
        isPriority: e.isPriority,
        isYou: e.patient?._id?.toString() === req.user._id.toString(),
      })),
    });
  }),
);

router.post(
  '/:id/check-in',
  audit('update', 'Appointment'),
  asyncHandler(async (req, res) => {
    const appt = await Appointment.findOne({ _id: req.params.id, ...(await scopeFilter(req)) });
    if (!appt) throw notFound('Appointment not found');
    if (appt.status === 'checked_in') {
      return res.json({ queueNumber: appt.queueNumber, position: null, estimatedWaitMinutes: null });
    }
    if (!['requested', 'confirmed'].includes(appt.status)) {
      throw badRequest('This appointment cannot be checked in');
    }

    const today = dayjs().format('YYYY-MM-DD');
    const queue = await queueOf(appt);

    /*
     * The next token, drawn from a counter rather than read off the room.
     *
     * It was "today's highest in this queue, plus one, then save". Two people
     * checked in at the same moment both read the same highest, and six checked
     * in together were all handed token one — six patients holding the same
     * number in one waiting room, with no index behind it to refuse any of
     * them. The counter hands each request its own number; a gap where a
     * double tap drew one it did not keep is harmless, and a duplicate is not.
     *
     * Seeded from the tokens already handed out today, so a deploy at eleven
     * does not start a second number one in a room that is on twelve.
     */
    const queueNumber = await nextInSequence(`queue:${queue.key}:${today}`, {
      seed: async () => {
        const last = await Appointment.findOne({ queueDate: today, ...queue.scope })
          .sort({ queueNumber: -1 })
          .select('queueNumber')
          .lean();
        return last?.queueNumber ?? 0;
      },
    });

    /*
     * And the check-in itself, only if it has not already happened.
     *
     * A read, a change and a `save()` let two taps on a slow connection both
     * pass the status check above and both write — the second silently taking
     * a new token over the first. Conditional on the status, in one operation,
     * exactly one of them checks the patient in; the other is told the token
     * that stuck.
     */
    const checkedIn = await Appointment.findOneAndUpdate(
      { _id: appt._id, status: { $in: ['requested', 'confirmed'] } },
      { $set: { queueDate: today, queueNumber, status: 'checked_in' } },
      { new: true },
    ).lean();

    if (!checkedIn) {
      const current = await Appointment.findById(appt._id).select('status queueNumber').lean();
      if (current?.status === 'checked_in') {
        return res.json({ queueNumber: current.queueNumber, position: null, estimatedWaitMinutes: null });
      }
      throw badRequest('This appointment cannot be checked in');
    }

    // The same queue the number came from, or "seven ahead of you" counts
    // people in another building.
    const ahead = await Appointment.countDocuments({
      queueDate: today,
      status: { $in: ['checked_in', 'in_consultation'] },
      queueNumber: { $lt: checkedIn.queueNumber },
      ...queue.scope,
    });

    res.json({
      queueNumber: checkedIn.queueNumber,
      position: ahead + 1,
      estimatedWaitMinutes: ahead * (checkedIn.durationMinutes ?? DEFAULT_SLOT_MINUTES),
    });
  }),
);

function serialise(a) {
  const patient = a.patient && typeof a.patient === 'object' && a.patient.name ? a.patient : null;
  const doctor = a.doctor && typeof a.doctor === 'object' && a.doctor.name ? a.doctor : null;
  const clinic = a.clinic && typeof a.clinic === 'object' && a.clinic.name ? a.clinic : null;
  return {
    id: a._id,
    patientId: patient?._id ?? a.patient,
    patientName: patient?.name ?? null,
    patientPhone: patient?.phone ?? null,
    patientAvatarUrl: patient?.avatarAssetId
      ? `/api/v1/uploads/${patient.avatarAssetId}/raw`
      : null,
    doctorId: doctor?._id ?? a.doctor,
    doctorName: doctor?.name ?? null,
    doctorSpecialty: doctor?.specialty ?? null,
    clinicId: clinic?._id ?? a.clinic ?? null,
    clinic: clinic
      ? {
          id: clinic._id,
          name: clinic.name,
          addressLine: clinic.addressLine ?? null,
          city: clinic.city ?? null,
          phone: clinic.phone ?? null,
        }
      : null,
    scheduledFor: a.scheduledFor ?? null,
    // The day a patient asked for, on a request that has no time yet. Kept
    // separate from scheduledFor so nothing reading the schedule mistakes a
    // wish for a booking.
    preferredFor: a.preferredFor ?? null,
    preferredTime: a.preferredTime ?? null,
    durationMinutes: a.durationMinutes,
    mode: a.mode,
    status: a.status,
    reason: a.reason ?? null,
    queueNumber: a.queueNumber ?? null,
    isPriority: a.isPriority ?? false,
    teleconsult: a.teleconsult?.roomId
      ? { roomId: a.teleconsult.roomId, joinUrl: a.teleconsult.joinUrl ?? null }
      : null,
    consultationNotes: a.consultationNotes ?? null,
    createdAt: a.createdAt,
  };
}

export default router;
