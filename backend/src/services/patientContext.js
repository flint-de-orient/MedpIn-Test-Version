import dayjs from 'dayjs';
import { PatientProfile } from '../models/PatientProfile.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { Medication } from '../models/Medication.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { Appointment } from '../models/Appointment.js';
import { Prescription } from '../models/Prescription.js';
import { LabResult } from '../models/LabResult.js';
import { DietPlan } from '../models/DietPlan.js';
import { FootAssessment } from '../models/FootAssessment.js';
import { Membership } from '../models/Membership.js';

/**
 * Builds the compact clinical picture injected into the assistant prompt.
 *
 * Deliberately terse: this is prepended to every chat turn, so it is a summary
 * rather than a dump. Only what changes an answer belongs here — an assistant
 * that knows the patient is on insulin and ran 320 mg/dL this morning gives a
 * materially different reply than one that does not.
 */
export async function buildPatientContext(patientId, { practiceId = null, enrolledOn = null } = {}) {
  /*
   * One practice's picture of the patient.
   *
   * ---- What was wrong ----------------------------------------------------
   *
   * Every read here was by patient alone. A practice that enrolled a patient
   * today was given another practice's latest prescription — its diagnosis,
   * its advice, the tests it advised — and the assistant presented them as
   * guidance "the doctor has approved", in the voice of the practice that had
   * never seen them. The same text is what a clinician reads as "Assistant
   * context".
   *
   * ---- Now ----------------------------------------------------------------
   *
   * The practice the conversation is with, from the date it was given access —
   * the same windows the record routes apply — and the practice's own
   * clinicians' writing only: a prescription by one of its doctors, a diet
   * plan by one of its dieticians, an appointment with one of its doctors.
   * Both default to null, which is a deployment with nothing to decide by, and
   * reads as it always did.
   */
  const window = (field) => (enrolledOn ? { [field]: { $gte: new Date(enrolledOn) } } : {});
  const authors = practiceId ? await Membership.distinct('user', { practice: practiceId }) : null;
  const writtenHere = (field) => (authors ? { [field]: { $in: authors } } : {});

  const [
    profile,
    recentGlucose,
    meds,
    latestVital,
    latestHba1c,
    nextAppt,
    latestRx,
    labs,
    dietPlan,
    foot,
  ] = await Promise.all([
    PatientProfile.findOne({ user: patientId }).lean(),
    GlucoseReading.find({ patient: patientId, ...window('measuredAt') })
      .sort({ measuredAt: -1 })
      .limit(10)
      .select('valueMgDl context measuredAt flag')
      .lean(),
    Medication.find({ patient: patientId, isActive: true, ...window('createdAt') })
      .select('name strength dose form schedule')
      .lean(),
    VitalRecord.findOne({ patient: patientId, ...window('recordedAt') }).sort({ recordedAt: -1 }).lean(),
    Hba1cRecord.findOne({ patient: patientId, ...window('testedOn') }).sort({ testedOn: -1 }).lean(),
    Appointment.findOne({
      patient: patientId,
      status: { $in: ['requested', 'confirmed'] },
      scheduledFor: { $gte: new Date() },
      ...writtenHere('doctor'),
    })
      .sort({ scheduledFor: 1 })
      .lean(),
    // The doctor's own record of this patient. Without it the assistant could
    // describe the medicines but not what they were prescribed *for*, and gave
    // general answers to a patient whose diagnosis was already written down.
    Prescription.findOne({ patient: patientId, ...window('issuedOn'), ...writtenHere('doctor') })
      .sort({ issuedOn: -1 })
      .lean(),
    LabResult.find({ patient: patientId, ...window('createdAt') }).sort({ createdAt: -1 }).limit(5).lean(),
    DietPlan.findOne({ patient: patientId, ...writtenHere('dietician') }).lean(),
    FootAssessment.findOne({ patient: patientId, ...window('assessedAt') }).sort({ assessedAt: -1 }).lean(),
  ]);

  const lines = [];

  if (profile) {
    const bits = [];
    if (profile.diabetesType && profile.diabetesType !== 'none') {
      bits.push(`Diabetes: ${profile.diabetesType.replace('type', 'Type ')}`);
    }
    if (profile.diagnosedOn) bits.push(`diagnosed ${dayjs(profile.diagnosedOn).format('MMM YYYY')}`);
    if (bits.length) lines.push(`- ${bits.join(', ')}`);

    if (profile.comorbidities?.length) {
      lines.push(`- Other conditions: ${profile.comorbidities.join(', ')}`);
    }
    if (profile.allergies?.length) {
      lines.push(`- Known allergies: ${profile.allergies.join(', ')}`);
    }
    if (profile.targets) {
      lines.push(
        `- Targets: fasting ${profile.targets.fastingMin}-${profile.targets.fastingMax} mg/dL, post-meal under ${profile.targets.postPrandialMax} mg/dL, HbA1c under ${profile.targets.hba1cMax}%`,
      );
    }
    if (profile.footRiskCategory && profile.footRiskCategory !== 'low') {
      lines.push(`- Diabetic foot risk category: ${profile.footRiskCategory}`);
    }
  }

  if (recentGlucose?.length) {
    const list = recentGlucose
      .slice(0, 5)
      .map((r) => `${r.valueMgDl} (${r.context.replace('_', ' ')}, ${dayjs(r.measuredAt).fromNow?.() ?? dayjs(r.measuredAt).format('DD MMM HH:mm')})`)
      .join('; ');
    lines.push(`- Recent blood sugar readings, newest first: ${list}`);

    const avg = Math.round(recentGlucose.reduce((s, r) => s + r.valueMgDl, 0) / recentGlucose.length);
    lines.push(`- Average of last ${recentGlucose.length} readings: ${avg} mg/dL`);
  } else {
    lines.push('- No blood sugar readings recorded yet.');
  }

  if (latestHba1c) {
    lines.push(`- Latest HbA1c: ${latestHba1c.percentage}% (${dayjs(latestHba1c.testedOn).format('DD MMM YYYY')})`);
  }

  if (latestVital?.systolic) {
    lines.push(
      `- Latest blood pressure: ${latestVital.systolic}/${latestVital.diastolic} mmHg (${dayjs(latestVital.recordedAt).format('DD MMM')})`,
    );
  }
  if (latestVital?.weightKg) {
    lines.push(`- Latest weight: ${latestVital.weightKg} kg`);
  }

  if (meds?.length) {
    const list = meds
      .map((m) => {
        const times = m.schedule?.map((s) => s.time).join(', ');
        return `${m.name}${m.strength ? ` ${m.strength}` : ''}${m.dose ? ` — ${m.dose}` : ''}${times ? ` at ${times}` : ''}`;
      })
      .join('; ');
    lines.push(`- Current medicines: ${list}`);
  } else {
    lines.push('- No active medicines recorded.');
  }

  if (nextAppt) {
    lines.push(
      `- Next appointment: ${dayjs(nextAppt.scheduledFor).format('DD MMM YYYY, h:mm A')} (${nextAppt.mode.replace('_', ' ')}, ${nextAppt.status})`,
    );
  } else {
    lines.push('- No upcoming appointment booked.');
  }

  // ---- The clinical record ------------------------------------------------
  // What the clinic has actually written about this patient, as opposed to what
  // the patient has logged. It is the difference between "your sugars look
  // high" and "your sugars are above the target Dr. Dey set for you, and he has
  // already changed your metformin once for it".

  if (latestRx) {
    if (latestRx.diagnosis) {
      lines.push(`- Diagnosis on the latest prescription: ${latestRx.diagnosis}`);
    }
    lines.push(`- Latest prescription issued: ${dayjs(latestRx.issuedOn).format('DD MMM YYYY')}`);
    if (latestRx.generalAdvice) {
      lines.push(`- Doctor's advice on it: ${String(latestRx.generalAdvice).slice(0, 500)}`);
    }
    // Per-item instructions ("take with water", "stop if loose motions") sit on
    // each medicine, not on the prescription, and are exactly the sort of thing
    // a patient asks the assistant to repeat.
    const perItem = (latestRx.items ?? [])
      .filter((it) => it.instructions)
      .map((it) => `${it.name}: ${it.instructions}`);
    if (perItem.length) lines.push(`- Instructions with specific medicines: ${perItem.join('; ')}`);
    if (latestRx.labTestsAdvised?.length) {
      lines.push(`- Tests the doctor advised: ${latestRx.labTestsAdvised.join(', ')}`);
    }
    if (latestRx.followUpOn) {
      lines.push(`- Doctor asked for follow-up on: ${dayjs(latestRx.followUpOn).format('DD MMM YYYY')}`);
    }
  }

  if (labs?.length) {
    const list = labs
      .map((l) => `${l.testName}${l.note ? ` — ${String(l.note).slice(0, 120)}` : ''}`)
      .join('; ');
    lines.push(`- Recent tests and reports on file: ${list}`);
  }

  // The clinician's own verdict outranks the final computed one, which in turn
  // outranks the model's — the same order the patient is shown.
  const footRisk =
    foot?.clinicianReview?.riskLevel ?? foot?.finalRiskLevel ?? foot?.aiAssessment?.riskLevel;
  if (footRisk) {
    lines.push(
      `- Most recent foot assessment: risk ${footRisk}` +
        `${foot.assessedAt ? ` (${dayjs(foot.assessedAt).format('DD MMM YYYY')})` : ''}`,
    );
  }

  // The plan is quoted in full rather than summarised: the nutrition assistant
  // is only allowed to answer from it, so a paraphrase here would become the
  // answer the patient acts on.
  const dietLines = [];
  if (dietPlan) {
    if (dietPlan.goal) dietLines.push(`Goal: ${dietPlan.goal}`);
    for (const meal of dietPlan.meals ?? []) {
      const items = (meal.items ?? []).join(', ');
      dietLines.push(
        `${meal.name}${meal.time ? ` (${meal.time})` : ''}: ${items || '—'}` +
          `${meal.notes ? ` [${meal.notes}]` : ''}`,
      );
    }
    if (dietPlan.avoid?.length) dietLines.push(`Best avoided: ${dietPlan.avoid.join(', ')}`);
    if (dietPlan.notes) dietLines.push(`Other notes: ${dietPlan.notes}`);
    lines.push(`- Diet plan from the dietician:\n  ${dietLines.join('\n  ')}`);
  }

  return {
    text: lines.join('\n'),
    profile,
    latestGlucose: recentGlucose?.[0] ?? null,
    targets: profile?.targets ?? {},
    dietPlan: dietPlan ?? null,
    dietPlanText: dietLines.length ? dietLines.join('\n') : null,
  };
}
