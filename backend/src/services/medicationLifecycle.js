import { Medication, PRESCRIPTION_STATE, TAKING_STATE } from '../models/Medication.js';
import { inClinicTz } from '../utils/clinicTime.js';

/**
 * A medicine's two lives, kept apart: the prescription, which is the doctor's,
 * and the taking, which is the patient's.
 *
 * ---- Every transition is a conditional write ---------------------------------
 *
 * Each function below names the state it moves *from* in its filter, so two
 * people pressing a button at once cannot both succeed, and a stale screen
 * cannot resurrect a medicine somebody else already ended. A null result means
 * "not in a state that allows this", and the route says so.
 *
 * ---- Rows written before the states existed ----------------------------------
 *
 * They have no `prescriptionState` on disk, and Mongoose fills in the default
 * when it loads one — so a medicine a doctor stopped last year would read as
 * "active". `isActive` was exact then and is exact now (prescription active AND
 * patient taking), so it decides: a row that claims to be active and taken but
 * is not active was ended before anybody recorded who ended it.
 */

const { ACTIVE, COMPLETED, STOPPED_BY_DOCTOR, CANCELLED, ENDED_LEGACY } = PRESCRIPTION_STATE;
const { TAKING, STOPPED_BY_PATIENT, NOT_STARTED } = TAKING_STATE;

/** Prescriptions that stand, whether or not the patient is taking them — old rows included. */
export const PRESCRIPTION_STANDS = Object.freeze({
  $or: [
    { prescriptionState: ACTIVE, takingState: STOPPED_BY_PATIENT },
    { prescriptionState: { $in: [ACTIVE, null] }, isActive: true },
  ],
});

export function prescriptionStateOf(med) {
  const stored = med?.prescriptionState ?? null;
  const taking = (med?.takingState ?? TAKING) === TAKING;
  if ((stored === null || stored === ACTIVE) && taking && med?.isActive === false) return ENDED_LEGACY;
  return stored ?? ACTIVE;
}

export function takingStateOf(med, now = new Date()) {
  const stored = med?.takingState ?? TAKING;
  if (stored === TAKING && med?.startDate && new Date(med.startDate) > now) return NOT_STARTED;
  return stored;
}

/** A medicine the patient added or photographed themselves: theirs, and no practice's. */
export function isPatientOwned(med) {
  return !med?.prescribedBy;
}

/** The latest time the patient stopped taking it and has not started again, or null. */
export function openPatientStop(med) {
  const stops = med?.patientStops ?? [];
  const open = stops.filter((s) => !s.resumedAt);
  return open.length ? open[open.length - 1] : null;
}

// ---------------------------------------------------------------------------
// The dose calendar
// ---------------------------------------------------------------------------

/** Days between two clinic-local calendar dates, by the calendar and not by the clock. */
function calendarDaysBetween(from, to) {
  const ymd = (d) => Date.UTC(d.year(), d.month(), d.date());
  return Math.round((ymd(to) - ymd(from)) / 86400000);
}

/**
 * Whether a dose of this medicine falls on this clinic-local day.
 *
 * The one place every schedule reads — today's list, history, adherence and the
 * server's reminder push all asked their own version of this, and none of them
 * asked about the interval: an every-other-day medicine was due every day, and
 * missed on every day it was not due.
 */
export function occursOn(med, day) {
  if (med.asNeeded || med.stat) return false;
  if (med.daysOfWeek?.length && !med.daysOfWeek.includes(day.day())) return false;
  const interval = med.dayInterval ?? 1;
  if (interval > 1) {
    if (!med.startDate) return false;
    const diff = calendarDaysBetween(inClinicTz(med.startDate).startOf('day'), day.startOf('day'));
    if (diff < 0 || diff % interval !== 0) return false;
  }
  return true;
}

/**
 * When this medicine stopped being prescribed, whichever came first: the end of
 * the course, a doctor's stop, or the voiding of its prescription. Null while
 * it stands with no end date.
 */
export function effectiveEnd(med) {
  const ends = [med.endDate, med.stoppedByDoctor?.at, med.cancelled?.at]
    .filter(Boolean)
    .map((d) => new Date(d).getTime());
  return ends.length ? new Date(Math.min(...ends)) : null;
}

/** Whether the patient had stopped taking it at this instant. */
export function pausedAt(med, instant) {
  const t = new Date(instant).getTime();
  return (med.patientStops ?? []).some(
    (s) => t >= new Date(s.at).getTime() && (!s.resumedAt || t < new Date(s.resumedAt).getTime()),
  );
}

/**
 * Whether a dose at `scheduledFor` was expected: inside the prescription's life,
 * on a day it falls, and not while the patient had stopped taking it.
 */
export function doseExpected(med, scheduledFor) {
  const at = new Date(scheduledFor);
  if (med.startDate && at < new Date(med.startDate)) return false;
  const end = effectiveEnd(med);
  if (end && at > end) return false;
  if (!occursOn(med, inClinicTz(at))) return false;
  return !pausedAt(med, at);
}

/** How late a dose may be taken and still be on time. The same grace as "missed". */
export const LATE_AFTER_MINUTES = 120;

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * Courses whose end date has passed are complete: off the active list, no more
 * reminders, and still in the history. Idempotent, and cheap on the index.
 */
export async function completeEndedCourses(filter = {}, now = new Date()) {
  const due = await Medication.find({
    ...filter,
    $and: [PRESCRIPTION_STANDS, { endDate: { $ne: null, $lte: now } }],
  })
    .select('_id endDate')
    .lean();
  if (!due.length) return 0;

  const result = await Medication.bulkWrite(
    due.map((m) => ({
      updateOne: {
        filter: { _id: m._id, $and: [PRESCRIPTION_STANDS] },
        update: { $set: { prescriptionState: COMPLETED, completedAt: m.endDate, isActive: false } },
      },
    })),
  );
  return result.modifiedCount;
}

/**
 * The patient stops taking a medicine.
 *
 * The prescription is untouched — its state, dates, dose and prescriber — and
 * the stop is recorded as the patient's, with their reason. Reminders stop
 * because `isActive` does.
 */
export async function stopTaking({ medicationId, patientId, reason = null, now = new Date() }) {
  await completeEndedCourses({ _id: medicationId, patient: patientId }, now);
  return Medication.findOneAndUpdate(
    {
      _id: medicationId,
      patient: patientId,
      takingState: { $ne: STOPPED_BY_PATIENT },
      $and: [PRESCRIPTION_STANDS],
    },
    {
      // `prescriptionState` is written as what it already was, so a row from
      // before the states existed says so explicitly from here on.
      $set: { takingState: STOPPED_BY_PATIENT, isActive: false, prescriptionState: ACTIVE },
      $push: { patientStops: { at: now, reason: reason || null, resumedAt: null } },
    },
    { new: true },
  );
}

/** The patient starts taking it again — only while the prescription still stands. */
export async function resumeTaking({ medicationId, patientId, now = new Date() }) {
  await completeEndedCourses({ _id: medicationId, patient: patientId }, now);
  return Medication.findOneAndUpdate(
    {
      _id: medicationId,
      patient: patientId,
      prescriptionState: ACTIVE,
      takingState: STOPPED_BY_PATIENT,
      $or: [{ endDate: null }, { endDate: { $gt: now } }],
    },
    {
      $set: { takingState: TAKING, isActive: true, 'patientStops.$[open].resumedAt': now },
    },
    { new: true, arrayFilters: [{ 'open.resumedAt': null }] },
  );
}

/**
 * A clinician stops the prescription. The course's own end date is kept — the
 * record says what was prescribed and, separately, when and why it was stopped.
 */
export async function stopByDoctor({ medicationId, patientId, by, reason, now = new Date() }) {
  await completeEndedCourses({ _id: medicationId, patient: patientId }, now);
  return Medication.findOneAndUpdate(
    { _id: medicationId, patient: patientId, $and: [PRESCRIPTION_STANDS] },
    {
      $set: {
        prescriptionState: STOPPED_BY_DOCTOR,
        isActive: false,
        stoppedByDoctor: { at: now, by, reason },
      },
    },
    { new: true },
  );
}

/**
 * The medicines a prescription put on the list, when that prescription ends.
 *
 * Voided → cancelled: it should never have been issued. Superseded or corrected
 * → stopped, naming the replacement. Only rows still pointing at this
 * prescription: a medicine the replacement carried over was re-pointed at the
 * replacement when it was synced, and stays exactly as it is.
 */
export async function endMedicinesOfPrescription({ prescriptionId, voided, by, reason, now = new Date() }) {
  const filter = { prescription: prescriptionId, source: 'clinic', $and: [PRESCRIPTION_STANDS] };
  const update = voided
    ? { prescriptionState: CANCELLED, isActive: false, cancelled: { at: now, by, reason } }
    : { prescriptionState: STOPPED_BY_DOCTOR, isActive: false, stoppedByDoctor: { at: now, by, reason } };
  const result = await Medication.updateMany(filter, { $set: update });
  return result.modifiedCount;
}
