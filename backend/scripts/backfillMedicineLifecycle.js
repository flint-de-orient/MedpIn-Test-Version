#!/usr/bin/env node
/**
 * Give the medicines and prescriptions already on record what C3 now records
 * for every new one.
 *
 *   node scripts/backfillMedicineLifecycle.js           # report
 *   node scripts/backfillMedicineLifecycle.js --apply   # write
 *
 * ---- What it writes ------------------------------------------------------------
 *
 * 1. `practice` on prescriptions. The practice the prescribing doctor and the
 *    patient share — or, for a doctor who has only ever worked at one practice,
 *    that one: nothing else could have issued it. A doctor at two practices with
 *    the patient enrolled at both is ambiguous, and is listed, not guessed.
 *
 * 2. `practice` on medicines a clinician prescribed: their prescription's, or
 *    the same shared-practice answer. Without it, a medicine is changeable only
 *    by the practices its prescriber works at (routes/medications.js), and a
 *    renewal by the same doctor adopts it — so nothing breaks before this runs,
 *    but every renewal by another doctor at the same practice would add a
 *    second row beside it.
 *
 * 3. `source: manual` on medicines the patient added themselves, which were
 *    recorded as the clinic's (`source` defaulted to `clinic`, and no prescriber
 *    was set because there was none).
 *
 * 4. States on rows that have none: active and taking if active; `ended_legacy`
 *    if not — ended before anybody recorded whether a doctor stopped it or the
 *    patient did, and not claimed as either.
 *
 * 5. Courses already past their end date: completed, as the live sweep would.
 *
 * Every write repeats its "still missing" condition, so a row the live code
 * wrote between the report and the apply is kept. A second run changes nothing.
 * Dry run by default; reads `.env` from the directory it runs in — run it from
 * the deployment's own `backend/`, after a mongodump of `medications` and
 * `prescriptions`.
 */
import { pathToFileURL } from 'node:url';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { Prescription } from '../src/models/Prescription.js';
import { Medication, PRESCRIPTION_STATE, TAKING_STATE } from '../src/models/Medication.js';
import { Membership } from '../src/models/Membership.js';
import { Enrollment } from '../src/models/Enrollment.js';
import { completeEndedCourses, PRESCRIPTION_STANDS } from '../src/services/medicationLifecycle.js';

const NO_PRACTICE = { $or: [{ practice: null }, { practice: { $exists: false } }] };
const NO_STATE = { prescriptionState: { $exists: false } };
const NO_PRESCRIBER = { $or: [{ prescribedBy: null }, { prescribedBy: { $exists: false } }] };

/** Answers "which practice issued this", cached across the run. */
function practiceResolver() {
  const memberships = new Map();
  const enrolments = new Map();

  const practicesOfMember = async (userId) => {
    const key = String(userId);
    if (!memberships.has(key)) {
      // Every membership, ended ones included: a prescription written by a
      // doctor who has since left was still their practice's.
      const rows = await Membership.find({ user: userId }).select('practice').lean();
      memberships.set(key, new Set(rows.map((r) => String(r.practice))));
    }
    return memberships.get(key);
  };

  const practicesOfPatient = async (patientId) => {
    const key = String(patientId);
    if (!enrolments.has(key)) {
      const rows = await Enrollment.find({ patient: patientId }).select('practice').lean();
      enrolments.set(key, new Set(rows.map((r) => String(r.practice))));
    }
    return enrolments.get(key);
  };

  return async (prescriberId, patientId) => {
    if (!prescriberId) return null;
    const theirs = await practicesOfMember(prescriberId);
    const patients = await practicesOfPatient(patientId);
    const shared = [...theirs].filter((p) => patients.has(p));
    if (shared.length === 1) return shared[0];
    if (shared.length === 0 && theirs.size === 1) return [...theirs][0];
    return null;
  };
}

/** What applying would write, without writing it. */
export async function planMedicineLifecycle() {
  const resolve = practiceResolver();

  const prescriptions = { resolved: [], unresolved: [] };
  const rxPractice = new Map();
  for (const rx of await Prescription.find(NO_PRACTICE).select('_id doctor patient').lean()) {
    const practice = await resolve(rx.doctor, rx.patient);
    if (practice) {
      prescriptions.resolved.push({ id: rx._id, practice });
      rxPractice.set(String(rx._id), practice);
    } else {
      prescriptions.unresolved.push(rx._id);
    }
  }

  const medicines = { resolved: [], unresolved: [], relabel: [] };
  const rows = await Medication.find(NO_PRACTICE).select('_id patient prescribedBy prescription source').lean();
  const known = new Map(
    (await Prescription.find({ _id: { $in: rows.map((r) => r.prescription).filter(Boolean) }, practice: { $ne: null } })
      .select('_id practice')
      .lean()).map((p) => [String(p._id), String(p.practice)]),
  );
  for (const med of rows) {
    if (!med.prescribedBy) {
      // The patient's own. No practice, and a source that says so.
      if ((med.source ?? 'clinic') === 'clinic') medicines.relabel.push(med._id);
      continue;
    }
    const fromRx = med.prescription ? (rxPractice.get(String(med.prescription)) ?? known.get(String(med.prescription))) : null;
    const practice = fromRx ?? (await resolve(med.prescribedBy, med.patient));
    if (practice) medicines.resolved.push({ id: med._id, practice });
    else medicines.unresolved.push(med._id);
  }

  const states = {
    active: await Medication.countDocuments({ ...NO_STATE, isActive: true }),
    endedLegacy: await Medication.countDocuments({ ...NO_STATE, isActive: false }),
  };
  const coursesEnded = await Medication.countDocuments({
    $and: [PRESCRIPTION_STANDS, { endDate: { $ne: null, $lte: new Date() } }],
  });

  return { prescriptions, medicines, states, coursesEnded };
}

/** Writes the plan. Each write keeps its "still missing" condition. */
export async function applyMedicineLifecycle(plan) {
  const written = { prescriptions: 0, medicines: 0, relabelled: 0, states: 0, completed: 0 };

  for (const { id, practice } of plan.prescriptions.resolved) {
    const r = await Prescription.updateOne({ _id: id, ...NO_PRACTICE }, { $set: { practice } });
    written.prescriptions += r.modifiedCount ?? 0;
  }
  for (const { id, practice } of plan.medicines.resolved) {
    const r = await Medication.updateOne({ _id: id, ...NO_PRACTICE }, { $set: { practice } });
    written.medicines += r.modifiedCount ?? 0;
  }
  for (const id of plan.medicines.relabel) {
    const r = await Medication.updateOne(
      { _id: id, $and: [NO_PRESCRIBER, { $or: [{ source: 'clinic' }, { source: { $exists: false } }] }] },
      { $set: { source: 'manual' } },
    );
    written.relabelled += r.modifiedCount ?? 0;
  }

  const active = await Medication.updateMany(
    { ...NO_STATE, isActive: true },
    { $set: { prescriptionState: PRESCRIPTION_STATE.ACTIVE, takingState: TAKING_STATE.TAKING } },
  );
  const ended = await Medication.updateMany(
    { ...NO_STATE, isActive: false },
    { $set: { prescriptionState: PRESCRIPTION_STATE.ENDED_LEGACY, takingState: TAKING_STATE.TAKING } },
  );
  written.states = (active.modifiedCount ?? 0) + (ended.modifiedCount ?? 0);
  written.completed = await completeEndedCourses();

  return written;
}

async function main(argv) {
  const apply = argv.includes('--apply');
  await connectDb();
  try {
    const plan = await planMedicineLifecycle();
    const sample = (ids) => ids.slice(0, 20).map(String).join(', ');

    console.log(`Prescriptions without a practice: ${plan.prescriptions.resolved.length} resolvable, ${plan.prescriptions.unresolved.length} ambiguous.`);
    if (plan.prescriptions.unresolved.length) {
      console.log(`  Ambiguous (doctor and patient share more than one practice, or none): ${sample(plan.prescriptions.unresolved)}`);
    }
    console.log(`Prescribed medicines without a practice: ${plan.medicines.resolved.length} resolvable, ${plan.medicines.unresolved.length} ambiguous.`);
    if (plan.medicines.unresolved.length) console.log(`  Ambiguous: ${sample(plan.medicines.unresolved)}`);
    console.log(`Medicines the patient added, recorded as the clinic's: ${plan.medicines.relabel.length}.`);
    console.log(`Medicines with no state: ${plan.states.active} active, ${plan.states.endedLegacy} ended before states were recorded.`);
    console.log(`Courses past their end date and still standing: ${plan.coursesEnded}.`);
    console.log('Ambiguous rows are left without a practice: only their prescriber\'s practices may change them.');

    if (!apply) {
      console.log('\nDry run — nothing written. Run again with --apply to write it.');
      return;
    }
    console.log('\nWritten:', await applyMedicineLifecycle(plan));
  } finally {
    await disconnectDb();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
