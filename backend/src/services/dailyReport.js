import { Appointment } from '../models/Appointment.js';
import { Prescription } from '../models/Prescription.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { Patient } from '../models/Patient.js';
import { User } from '../models/User.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { RECORD_STATE } from '../models/plugins/clinicalRecord.js';
import { clinicDateTime, inClinicTz } from '../utils/clinicTime.js';
import { clinicIdentity } from './clinicIdentity.js';

/**
 * One doctor's day, as a summary they can keep or pass on.
 *
 * ---- What "seen" means ------------------------------------------------------
 *
 * Nothing in the record says "the doctor saw this patient today", so the report
 * reads it from the two things that do happen when they do:
 *
 *   - an appointment with this doctor, at this practice, scheduled on that day,
 *     that got as far as the room: checked in, in consultation or completed.
 *     A booking that was cancelled, never turned up or is still only confirmed
 *     is a plan, not a visit.
 *   - a prescription this doctor issued at this practice on that day, typed in
 *     the consult or filed from paper. A prescription is the visit's outcome
 *     even when nobody booked the visit — a walk-in, or the paper pilot.
 *
 * Either one is enough. Vitals alone are not: `VitalRecord` does not say who
 * took them, so a blood pressure the patient logged at home that morning cannot
 * be told from one taken in the consulting room, and letting it put a patient on
 * a doctor's list would be inventing a visit.
 *
 * ---- Whose ------------------------------------------------------------------
 *
 * The doctor's own day at the practice this request is for. A colleague's day is
 * not reachable from here: no permission in the model says "may read another
 * clinician's work as a report", and VIEW_PATIENT is about patients, not about
 * colleagues. A head doctor who wants to know what somebody else did asks them.
 *
 * And only patients this practice may still read: actively enrolled, with the
 * visit on or after the day the enrolment began. A patient who withdrew the
 * practice's access is not printed onto a document that leaves the app, even
 * though the practice wrote the prescription — the same rule every other read
 * already applies (see middleware/authorise.js).
 *
 * ---- What it carries --------------------------------------------------------
 *
 * Name, age and sex, complaint, diagnosis, vitals, what was prescribed, advice
 * and follow-up. No phone number, no address, no record ids and no reference
 * numbers: this is written to be shared through a phone's share sheet, and
 * everything on it is something the reader needs rather than something that was
 * lying around.
 */

/** The appointment states that mean the patient actually came in. */
export const SEEN_STATUSES = Object.freeze(['checked_in', 'in_consultation', 'completed']);

/** "YYYY-MM-DD" for today, in the clinic's timezone. */
export function clinicToday(now = new Date()) {
  return inClinicTz(now).format('YYYY-MM-DD');
}

/** The clinic-local day as an instant range: [start, end). */
export function dayBounds(date) {
  const start = clinicDateTime(date, '00:00');
  return { start: start.toDate(), end: start.add(1, 'day').toDate() };
}

const SEX = { male: 'Male', female: 'Female', other: 'Other' };

/** Whole years on the report's day. Null when nobody recorded a birth date. */
function ageOn(dateOfBirth, day) {
  if (!dateOfBirth) return null;
  const years = inClinicTz(day).diff(inClinicTz(dateOfBirth), 'year');
  return Number.isFinite(years) && years >= 0 ? years : null;
}

function uniq(list) {
  return [...new Set(list.filter(Boolean).map((s) => String(s).trim()).filter(Boolean))];
}

/**
 * The prescriptions that belong on the page, and what became of the rest.
 *
 * A voided prescription was issued in error and is left off — printing its
 * medicines on a summary somebody forwards is how an error gets dispensed. One
 * replaced later the same day by another on the page is left off too: the later
 * one is what the visit ended with. One replaced on a later day stays, marked,
 * because on this day it was the prescription.
 */
function prescriptionsToShow(rows) {
  const voided = rows.filter((p) => p.recordState === RECORD_STATE.VOIDED).length;
  const standing = rows.filter((p) => p.recordState !== RECORD_STATE.VOIDED);
  const ids = new Set(standing.map((p) => String(p._id)));
  const shown = standing.filter((p) => !(p.replacedBy && ids.has(String(p.replacedBy))));
  return { shown, voided };
}

function vitalsLine(v) {
  return {
    at: v.recordedAt,
    bloodPressure: v.systolic && v.diastolic ? `${v.systolic}/${v.diastolic}` : null,
    pulse: v.pulse ?? null,
    spo2: v.spo2 ?? null,
    weightKg: v.weightKg ?? null,
    waistCm: v.waistCm ?? null,
    temperatureC: v.temperatureC ?? null,
  };
}

/**
 * Build the day for one doctor at one practice.
 *
 * `report` is plain data with nothing in it that is an id — the PDF and the
 * app's preview render the same object, so what the doctor previews is what
 * they share. `subjects` are the patients it names, kept apart for the audit
 * trail and never serialised.
 */
export async function buildDailyReport({ doctor, practiceId, date, now = new Date() }) {
  const { start, end } = dayBounds(date);

  const [appointments, prescriptions] = await Promise.all([
    Appointment.find({
      doctor: doctor._id,
      practice: practiceId,
      status: { $in: SEEN_STATUSES },
      scheduledFor: { $gte: start, $lt: end },
    })
      .select('patient scheduledFor status reason')
      .sort({ scheduledFor: 1 })
      .lean(),
    Prescription.find({
      doctor: doctor._id,
      practice: practiceId,
      issuedOn: { $gte: start, $lt: end },
    })
      .select(
        'patient issuedOn complaint diagnosis items labTestsAdvised generalAdvice followUpOn source recordState replacedBy',
      )
      .sort({ issuedOn: 1 })
      .lean(),
  ]);

  const candidateIds = uniq([
    ...appointments.map((a) => String(a.patient)),
    ...prescriptions.map((p) => String(p.patient)),
  ]);

  /*
   * Who this practice may still read, and from when. Asked once for the whole
   * day rather than per patient: a clinic day is dozens of patients, and this is
   * the same question each time.
   */
  const enrolments = candidateIds.length
    ? await Enrollment.find({
        patient: { $in: candidateIds },
        practice: practiceId,
        status: ENROLLMENT_STATUS.ACTIVE,
        revokedAt: null,
      })
        .select('patient enrolledOn')
        .lean()
    : [];
  const windowFrom = new Map(
    enrolments.map((e) => [String(e.patient), e.enrolledOn ? new Date(e.enrolledOn) : null]),
  );
  const inWindow = (patientId, when) => {
    if (!windowFrom.has(String(patientId))) return false;
    const from = windowFrom.get(String(patientId));
    return !from || new Date(when) >= from;
  };

  const visits = appointments.filter((a) => inWindow(a.patient, a.scheduledFor));
  const issued = prescriptions.filter((p) => inWindow(p.patient, p.issuedOn));
  const patientIds = uniq([...visits.map((a) => String(a.patient)), ...issued.map((p) => String(p.patient))]);

  const [patients, logins, vitals, glucose, identity] = await Promise.all([
    patientIds.length
      ? Patient.find({ _id: { $in: patientIds } }).select('name dateOfBirth gender').lean()
      : [],
    // A patient backfilled from an account has the same id on both rows, and
    // older accounts carry the birth date and sex only on the login.
    patientIds.length
      ? User.find({ _id: { $in: patientIds } }).select('name dateOfBirth gender').lean()
      : [],
    patientIds.length
      ? VitalRecord.find({ patient: { $in: patientIds }, recordedAt: { $gte: start, $lt: end } })
          .select('patient recordedAt systolic diastolic pulse spo2 weightKg waistCm temperatureC')
          .sort({ recordedAt: 1 })
          .lean()
      : [],
    // Clinic-measured only. A glucose reading does say where it came from, and
    // a home fingerprick is not something the doctor measured at the visit.
    patientIds.length
      ? GlucoseReading.find({
          patient: { $in: patientIds },
          source: 'clinic',
          measuredAt: { $gte: start, $lt: end },
        })
          .select('patient measuredAt valueMgDl context')
          .sort({ measuredAt: 1 })
          .lean()
      : [],
    clinicIdentity(null, { practiceId }),
  ]);

  const personOf = new Map();
  for (const u of logins) personOf.set(String(u._id), u);
  // The Patient row wins where it has something: it is the body, the login is
  // only whose phone reaches them.
  for (const p of patients) {
    const login = personOf.get(String(p._id)) ?? {};
    personOf.set(String(p._id), {
      name: p.name || login.name,
      dateOfBirth: p.dateOfBirth ?? login.dateOfBirth ?? null,
      gender: p.gender && p.gender !== 'undisclosed' ? p.gender : login.gender,
    });
  }

  const rows = patientIds.map((id) => {
    const person = personOf.get(id) ?? {};
    const theirVisits = visits.filter((a) => String(a.patient) === id);
    const { shown, voided } = prescriptionsToShow(issued.filter((p) => String(p.patient) === id));

    const seenAt = [
      ...theirVisits.map((a) => new Date(a.scheduledFor)),
      ...shown.map((p) => new Date(p.issuedOn)),
    ].sort((a, b) => a - b)[0] ?? null;

    // The complaint the doctor recorded on the prescription, which is a
    // snapshot of that visit; otherwise what the patient booked for, said as
    // such, because it is their words rather than the doctor's.
    const recorded = [...shown].reverse().find((p) => p.complaint?.trim());
    const booked = theirVisits.find((a) => a.reason?.trim());
    const complaint = recorded
      ? { text: recorded.complaint.trim(), source: 'prescription' }
      : booked
        ? { text: booked.reason.trim(), source: 'appointment' }
        : null;

    const followUp = [...shown].reverse().find((p) => p.followUpOn)?.followUpOn ?? null;

    return {
      name: person.name ?? 'Unnamed patient',
      age: ageOn(person.dateOfBirth, start),
      sex: SEX[person.gender] ?? null,
      seenAt,
      visit: theirVisits.length ? theirVisits[theirVisits.length - 1].status : null,
      complaint,
      diagnosis: uniq(shown.flatMap((p) => p.diagnosis ?? [])),
      vitals: vitals
        .filter((v) => String(v.patient) === id && inWindow(id, v.recordedAt))
        .map(vitalsLine),
      glucose: glucose
        .filter((g) => String(g.patient) === id && inWindow(id, g.measuredAt))
        .map((g) => ({ at: g.measuredAt, valueMgDl: g.valueMgDl, context: g.context ?? null })),
      prescriptions: shown.map((p) => ({
        issuedAt: p.issuedOn,
        source: p.source ?? 'composed',
        // Replaced later: on this day it stood, and the page says it no longer does.
        standing: (p.recordState ?? RECORD_STATE.CURRENT) === RECORD_STATE.CURRENT,
        items: (p.items ?? []).map((it) => ({
          name: it.name,
          strength: it.strength ?? null,
          dose: it.dose ?? null,
          frequency: it.frequency ?? null,
          durationDays: it.durationDays ?? null,
          relationToMeal: it.relationToMeal && it.relationToMeal !== 'any' ? it.relationToMeal : null,
          instructions: it.instructions ?? null,
        })),
        investigations: uniq(p.labTestsAdvised ?? []),
      })),
      voidedPrescriptions: voided,
      advice: uniq(shown.map((p) => p.generalAdvice)).join('\n\n') || null,
      followUpOn: followUp,
    };
  });

  rows.sort((a, b) => (a.seenAt ?? 0) - (b.seenAt ?? 0) || a.name.localeCompare(b.name));

  const report = {
    date,
    generatedAt: now,
    practice: {
      name: identity.clinicName ?? null,
      tagline: identity.tagline ?? null,
      addressLine: identity.addressLine ?? null,
      city: identity.city ?? null,
    },
    doctor: {
      name: doctor.name ?? null,
      qualifications: doctor.qualifications ?? null,
      registrationNo: doctor.registrationNo ?? null,
    },
    patients: rows,
    totals: {
      patients: rows.length,
      prescriptions: rows.reduce((n, r) => n + r.prescriptions.length, 0),
    },
  };

  return { report, subjects: patientIds };
}
