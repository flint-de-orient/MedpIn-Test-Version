import { GlucoseReading } from '../models/GlucoseReading.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { LabResult } from '../models/LabResult.js';
import { RECORD_STATE } from '../models/plugins/clinicalRecord.js';

/**
 * Taking a reading or a lab report off the record — without erasing it.
 *
 * ---- Why not delete --------------------------------------------------------------
 *
 * A glucose of 42 that a patient typed as 420 has to stop counting: in the
 * trend, the risk score, the caseload panels, the assistant's context. But it
 * may already have raised an alert, reordered the waiting list, or been read by
 * a doctor who acted on it. Deleted, none of that can be explained afterwards.
 * Voided, the row stays with who took it off the record, in what capacity, when
 * and why — and every ordinary read leaves it out (plugins/clinicalRecord.js).
 *
 * ---- Only what the report put there -----------------------------------------------
 *
 * Withdrawing a lab report used to delete every clinic glucose reading with the
 * same value, context and date — which is also what a reading the desk typed
 * from the same printout looks like. Readings read off a report now carry its
 * id, and those are what go with it. Readings written before that carried an id
 * are matched by the note the reader stamped on them ("From <test> report"),
 * never by value alone.
 */

const CURRENT = { recordState: { $ne: RECORD_STATE.VOIDED } };

function voidedBy({ by, byRole, reason, now }) {
  return {
    recordState: RECORD_STATE.VOIDED,
    endedAt: now,
    endedBy: by,
    endedByRole: byRole,
    endedReason: String(reason).trim().slice(0, 500),
  };
}

/**
 * Voids one glucose reading. `scope` is the caller's filter for which readings
 * they may reach — this patient, and the practice's record window.
 *
 * @returns the voided reading, or null when there is no current one in scope.
 */
export async function voidGlucoseReading({ readingId, scope, by, byRole, reason, now = new Date() }) {
  return GlucoseReading.findOneAndUpdate(
    { _id: readingId, ...scope, ...CURRENT },
    { $set: voidedBy({ by, byRole, reason, now }) },
    { new: true },
  );
}

/**
 * Withdraws a lab report and exactly the readings it created.
 *
 * @param entry the current LabResult, already found within the caller's scope
 * @returns what was voided, or null if the report was withdrawn meanwhile
 */
export async function withdrawLabResult({ entry, by, byRole, reason, now = new Date() }) {
  const report = await LabResult.findOneAndUpdate(
    { _id: entry._id, ...CURRENT },
    { $set: voidedBy({ by, byRole, reason, now }) },
    { new: true },
  );
  if (!report) return null;

  const derived = voidedBy({
    by,
    byRole,
    reason: `Its ${entry.testName} report was withdrawn: ${String(reason).trim()}`,
    now,
  });

  let glucose = (await GlucoseReading.updateMany({ labResult: entry._id, ...CURRENT }, { $set: derived }))
    .modifiedCount;
  let hba1c = (await Hba1cRecord.updateMany({ labResult: entry._id, ...CURRENT }, { $set: derived }))
    .modifiedCount;

  // Written before readings carried their report's id.
  if (entry.photo) {
    hba1c += (
      await Hba1cRecord.updateMany(
        { patient: entry.patient, reportFile: entry.photo, labResult: null, ...CURRENT },
        { $set: derived },
      )
    ).modifiedCount;
  }
  const a = entry.analysis ?? {};
  if (a.testedOn) {
    for (const [context, valueMgDl] of [
      ['fasting', a.fastingGlucoseMgDl],
      ['post_meal', a.postPrandialGlucoseMgDl],
    ]) {
      if (valueMgDl == null) continue;
      glucose += (
        await GlucoseReading.updateMany(
          {
            patient: entry.patient,
            labResult: null,
            source: 'clinic',
            valueMgDl,
            context,
            measuredAt: a.testedOn,
            notes: `From ${entry.testName} report`,
            ...CURRENT,
          },
          { $set: derived },
        )
      ).modifiedCount;
    }
  }

  return { report, glucose, hba1c };
}

/** How a removed entry is described to a clinician reading the full history. */
export function removalOf(record) {
  if (record?.recordState !== RECORD_STATE.VOIDED) return null;
  return {
    at: record.endedAt ?? null,
    byRole: record.endedByRole ?? null,
    reason: record.endedReason ?? null,
  };
}
