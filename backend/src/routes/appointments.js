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
import { ACTIVE_STATUSES, isSlotBookable } from '../services/scheduling.js';
import { paged, pageParams, dateRange } from '../utils/pagination.js';
import { postCareThreadNote } from '../services/careThreadNote.js';

const router = Router();
router.use(requireAuth);

/** Fallback slot length for teleconsults and queue estimates (no clinic). */
const DEFAULT_SLOT_MINUTES = 15;

const isPatient = (req) => req.user.role === ROLES.PATIENT;

/** Patients see only their own appointments; clinicians see the whole diary. */
function scopeFilter(req) {
  return isPatient(req) ? { patient: req.user._id } : {};
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

    const filter = {
      ...scopeFilter(req),
      ...dateRange('scheduledFor', { from, to }),
      ...(status ? { status } : {}),
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

    const doctor = req.body.doctorId
      ? await User.findOne({ _id: req.body.doctorId, role: ROLES.DOCTOR })
      : await User.findOne({ role: ROLES.DOCTOR });
    if (!doctor) throw badRequest('No doctor is available for booking');

    // An in-clinic visit must land on a real, free slot of the chosen clinic's
    // schedule. This is the authoritative check — the client cannot book a time
    // the schedule does not offer, or one already taken.
    let clinic = null;
    if (mode === 'in_clinic') {
      if (!clinicId) throw badRequest('Please choose a clinic');
      clinic = await Clinic.findOne({ _id: clinicId, isActive: true });
      if (!clinic) throw badRequest('That clinic is not available');
      if (!(await isSlotBookable(clinic, scheduledFor))) {
        throw badRequest('That time slot is no longer available. Please choose another.');
      }
    }

    // Second guard against a race — two patients validating the same free slot
    // in the same instant. The unique-ish window catches the loser.
    const slotStart = dayjs(scheduledFor);
    const clash = await Appointment.findOne({
      ...(clinic ? { clinic: clinic._id } : { doctor: doctor._id, clinic: null }),
      status: { $in: ACTIVE_STATUSES },
      scheduledFor: {
        $gte: slotStart.toDate(),
        $lt: slotStart.add(clinic?.slotMinutes ?? DEFAULT_SLOT_MINUTES, 'minute').toDate(),
      },
    });
    if (clash) throw badRequest('That time slot has just been taken. Please choose another.');

    const appointment = await Appointment.create({
      patient: patientId,
      doctor: doctor._id,
      clinic: clinic?._id,
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

    const doctor = await User.findOne({ role: ROLES.DOCTOR });
    if (!doctor) throw badRequest('No doctor is available for booking');

    // One open request at a time. A patient who taps twice, or asks again next
    // day because nobody has answered, should not appear on the desk's list as
    // two people wanting two appointments.
    const existing = await Appointment.findOne({
      patient: patientId,
      status: 'requested',
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

    const appointment = await Appointment.create({
      patient: patientId,
      doctor: doctor._id,
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

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) throw notFound('Appointment not found');
    if (appointment.status !== 'requested') {
      throw badRequest('Only a request can be confirmed. Use reschedule to move a booking.');
    }
    if (dayjs(scheduledFor).isBefore(dayjs())) {
      throw badRequest('Appointment time must be in the future');
    }

    const clinic = await Clinic.findOne({ _id: clinicId, isActive: true });
    if (!clinic) throw badRequest('That clinic is not available');

    // The same authority a patient booking goes through. A request confirmed
    // onto a time the schedule does not offer is worse than one left pending:
    // the patient is told to come at an hour the doctor is not there.
    if (!(await isSlotBookable(clinic, scheduledFor))) {
      throw badRequest('That time is not free. Please choose another.');
    }

    const slotStart = dayjs(scheduledFor);
    const clash = await Appointment.findOne({
      _id: { $ne: appointment._id },
      clinic: clinic._id,
      status: { $in: ACTIVE_STATUSES },
      scheduledFor: {
        $gte: slotStart.toDate(),
        $lt: slotStart.add(clinic.slotMinutes ?? DEFAULT_SLOT_MINUTES, 'minute').toDate(),
      },
    });
    if (clash) throw badRequest('That time has just been taken. Please choose another.');

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
      const sameDay = await Appointment.findOne({
        _id: { $ne: appointment._id },
        patient: appointment.patient,
        status: { $in: ACTIVE_STATUSES },
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

    appointment.clinic = clinic._id;
    appointment.scheduledFor = scheduledFor;
    appointment.durationMinutes = clinic.slotMinutes ?? DEFAULT_SLOT_MINUTES;
    appointment.status = 'confirmed';
    // The wish is spent. Keeping it would leave two dates on one row and no
    // way to tell which one anybody should turn up for.
    appointment.preferredFor = undefined;
    appointment.preferredTime = undefined;
    await appointment.save();
    await appointment.populate(POPULATE);

    const when = inClinicTz(scheduledFor).format('ddd D MMM, h:mm A');

    // The patient asked and is owed the answer; the doctor's day has changed.
    await Promise.all([
      notifyPatientOfAppointmentChange(appointment, 'confirmed').catch(() => {}),
      // And in the thread they asked in. The push is dismissed or arrives with
      // the phone face-down; the Home card shows a date with no account of
      // where it came from. Without this the conversation reads as a question
      // nobody answered.
      postCareThreadNote({
        patientId: appointment.patient?._id ?? appointment.patient,
        author: req.user,
        text: `Your appointment is confirmed for ${when} at ${clinic.name}.`,
      }),
      notifyClinicOfAppointmentChange(
        appointment,
        appointment.patient?.name ?? 'A patient',
        'booked',
      ).catch(() => {}),
    ]);

    res.json({ appointment: serialise(appointment) });
  }),
);

router.patch(
  '/:id/reschedule',
  validate({ body: z.object({ scheduledFor: z.coerce.date() }) }),
  audit('update', 'Appointment'),
  asyncHandler(async (req, res) => {
    const existing = await Appointment.findOne({ _id: req.params.id, ...scopeFilter(req) });
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
      if (!(await isSlotBookable(clinic, req.body.scheduledFor))) {
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
    const appt = await Appointment.findOne({ _id: req.params.id, ...scopeFilter(req) });
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

    const profiles = await PatientProfile.find({ patient: { $in: entries.map((e) => e.patient._id) } })
      .select('patient riskScore')
      .lean();
    const risk = new Map(profiles.map((p) => [p.patient.toString(), p.riskScore ?? 0]));
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

    const entries = await Appointment.find({
      queueDate: today,
      status: { $in: ['checked_in', 'in_consultation'] },
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
    const appt = await Appointment.findOne({ _id: req.params.id, ...scopeFilter(req) });
    if (!appt) throw notFound('Appointment not found');
    if (appt.status === 'checked_in') {
      return res.json({ queueNumber: appt.queueNumber, position: null, estimatedWaitMinutes: null });
    }
    if (!['requested', 'confirmed'].includes(appt.status)) {
      throw badRequest('This appointment cannot be checked in');
    }

    const today = dayjs().format('YYYY-MM-DD');
    const last = await Appointment.findOne({ queueDate: today }).sort({ queueNumber: -1 }).select('queueNumber').lean();

    appt.queueDate = today;
    appt.queueNumber = (last?.queueNumber ?? 0) + 1;
    appt.status = 'checked_in';
    await appt.save();

    const ahead = await Appointment.countDocuments({
      queueDate: today,
      status: { $in: ['checked_in', 'in_consultation'] },
      queueNumber: { $lt: appt.queueNumber },
    });

    res.json({
      queueNumber: appt.queueNumber,
      position: ahead + 1,
      estimatedWaitMinutes: ahead * (appt.durationMinutes ?? DEFAULT_SLOT_MINUTES),
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
