/**
 * What would the enrolment window hide?
 *
 * Reads are now bounded by `enrolledOn`, and a bound can only ever remove rows.
 * If it removes none, the deploy is invisible; if it removes some, a clinician
 * opens a patient tomorrow and finds a shorter history than they had today,
 * with nothing in the logs to say why. That is the failure worth an hour of
 * caution, and it is one query per collection to rule out.
 *
 * The migration dated each enrolment from the patient's `PatientProfile`
 * creation, so anything recorded before that profile existed — a desk entering
 * history for a walk-in, a record imported ahead of its account — falls outside
 * a window that was supposed to include everything.
 *
 * Read-only. Safe on production, and meant for it: run it before the restart
 * and again after.
 *
 *   node scripts/checkRecordWindow.js
 *   node scripts/checkRecordWindow.js --list   # the worst offenders, per row
 */
import mongoose from 'mongoose';

import { env } from '../src/config/env.js';
import { Enrollment, ENROLLMENT_STATUS } from '../src/models/Enrollment.js';
import { GlucoseReading } from '../src/models/GlucoseReading.js';
import { Hba1cRecord } from '../src/models/Hba1cRecord.js';
import { VitalRecord } from '../src/models/VitalRecord.js';
import { LifestyleLog } from '../src/models/LifestyleLog.js';
import { FootAssessment } from '../src/models/FootAssessment.js';
import { EyeReport } from '../src/models/EyeReport.js';
import { LabReport } from '../src/models/LabReport.js';
import { LabResult } from '../src/models/LabResult.js';
import { FoodLog } from '../src/models/FoodLog.js';
import { DirectMessage } from '../src/models/DirectMessage.js';
import { Prescription } from '../src/models/Prescription.js';

/**
 * Every read a clinician makes that carries a window, and the field it is
 * bounded on. Kept in the same order as the routes so the two can be compared
 * by eye — a collection here with no `recordWindow` in its route, or the other
 * way round, is the drift this is meant to catch.
 */
const BOUNDED = [
  ['glucose readings', GlucoseReading, 'measuredAt'],
  ['HbA1c records', Hba1cRecord, 'testedOn'],
  ['vitals', VitalRecord, 'recordedAt'],
  ['lifestyle logs', LifestyleLog, 'loggedAt'],
  ['foot assessments', FootAssessment, 'assessedAt'],
  ['eye reports', EyeReport, 'createdAt'],
  ['lab reports', LabReport, 'testedOn'],
  ['lab results', LabResult, 'testedOn'],
  ['food logs', FoodLog, 'createdAt'],
  ['direct messages', DirectMessage, 'createdAt'],
  ['prescriptions', Prescription, 'issuedOn'],
];

const list = process.argv.includes('--list');

async function main() {
  await mongoose.connect(env.MONGODB_URI);

  // Only active enrolments bound anything. A pending or revoked one does not
  // reach a read at all — the gate refuses before the window is consulted.
  const enrolments = await Enrollment.find({ status: ENROLLMENT_STATUS.ACTIVE })
    .select('patient practice enrolledOn')
    .lean();

  // A patient may be enrolled at more than one practice. The earliest date is
  // the generous one, and a row outside even that is hidden from everybody.
  const earliest = new Map();
  for (const e of enrolments) {
    if (!e.enrolledOn) continue;
    const k = String(e.patient);
    const on = new Date(e.enrolledOn);
    if (!earliest.has(k) || on < earliest.get(k)) earliest.set(k, on);
  }

  console.log(`\n  ${enrolments.length} active enrolment(s), ${earliest.size} patient(s) dated\n`);

  const undated = enrolments.filter((e) => !e.enrolledOn).length;
  if (undated) {
    // Not a problem: no date means no bound, and the read is unrestricted the
    // way it was yesterday. Worth printing so it is not mistaken for one.
    console.log(`  ${undated} active enrolment(s) with no enrolledOn — unbounded, as before\n`);
  }

  let total = 0;

  for (const [label, Model, field] of BOUNDED) {
    let hidden = 0;
    const worst = [];

    for (const [patient, on] of earliest) {
      const n = await Model.countDocuments({ patient, [field]: { $lt: on } });
      if (!n) continue;
      hidden += n;
      if (list) worst.push({ patient, on, n });
    }

    total += hidden;
    const mark = hidden ? '!!' : '  ';
    console.log(`  ${mark} ${String(hidden).padStart(6)}  ${label} before enrolledOn (${field})`);

    if (list && worst.length) {
      for (const w of worst.sort((a, b) => b.n - a.n).slice(0, 5)) {
        console.log(`         patient ${w.patient}  ${w.n} row(s) before ${w.on.toISOString().slice(0, 10)}`);
      }
    }
  }

  console.log('');
  if (total === 0) {
    console.log('  Nothing would be hidden. The bound changes what a second practice\n' +
                '  can read and nothing about what this one already sees.\n');
  } else {
    console.log(`  ${total} row(s) would stop appearing.\n`);
    console.log('  Before restarting, either widen those enrolments:\n');
    console.log('    db.enrollments.updateOne({ patient: ObjectId("...") },');
    console.log('                             { $set: { enrolledOn: ISODate("...") } })\n');
    console.log('  or accept it deliberately. Do not find out from a clinician.\n');
  }

  await mongoose.disconnect();
  process.exitCode = total === 0 ? 0 : 1;
}

main().catch(async (err) => {
  console.error(err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
