import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireRole } from '../middleware/auth.js';
import { requireRecordAccess } from '../middleware/authorise.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { practiceOf } from '../middleware/practiceScope.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { VitalRecord } from '../models/VitalRecord.js';
import { Prescription } from '../models/Prescription.js';
import { PatientCondition, CONDITION_STATUS } from '../models/PatientCondition.js';
import { User, ROLES, CLINICIAN_ROLES } from '../models/User.js';
import { bloodPressureBand } from '../services/clinicalReadings.js';
import { GLUCOSE, HBA1C, VITALS } from '../services/triage/thresholds.js';
import { RECORD_STATE } from '../models/plugins/clinicalRecord.js';
import { LabResult } from '../models/LabResult.js';
import { EcgReport } from '../models/EcgReport.js';
import { GlucoseReading } from '../models/GlucoseReading.js';
import { Hba1cRecord } from '../models/Hba1cRecord.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { ANALYTES } from '../services/analyteCatalog.js';

/**
 * The caseload panels a doctor's home is made of: a general physician's, a
 * cardiologist's and a diabetologist's.
 *
 * ---- Every panel reads data the platform already holds -------------------
 *
 * The rule uiConfig.js was rewritten to obey: a panel names something the API
 * answers, never something a specialty ought to have. So there is no cardiac
 * risk score here — Framingham, QRISK and the WHO charts are instruments, not
 * arithmetic, and a number labelled that way would be read as validated. What
 * is here is what the record already says: the band of each patient's latest
 * blood pressure, the follow-up date the doctor wrote on the prescription, the
 * conditions a clinician diagnosed, the pulse that was measured, the sugars
 * patients logged and the HbA1c results on file.
 *
 * Nor are there foot or eye screening panels, though `/patients/:id/foot` and
 * `/eye` exist: no screen in the app or the console files either record, so a
 * "screening due" panel would name every patient on every practice, forever,
 * and read as a clinic that screens nobody.
 *
 * ---- Bounded twice ----------------------------------------------------------
 *
 * By the practice — only its active enrolments — and by each patient's own
 * enrolment date. A practice that enrolled a patient in September may not read
 * the blood pressure another practice recorded in May, and a caseload panel is
 * no exception: "latest reading" means the latest one this practice is allowed
 * to see, not the latest one there is.
 *
 * ---- Who may open them -----------------------------------------------------
 *
 * The doctor's panel's rule: the clinical roles other than the dietician, whose
 * caseload is their assigned patients and whose panel is /dietician, holding
 * VIEW_PATIENT — these return patients by name.
 */
const router = Router();

const PANEL_ROLES = CLINICIAN_ROLES.filter((role) => role !== ROLES.DIETICIAN);
router.use(requireAuth, requireRole(...PANEL_ROLES), requireRecordAccess());

/** How many named patients a panel returns before it only counts. */
const NAMED = 10;

const DAY = 24 * 60 * 60 * 1000;

/**
 * This practice's active caseload: patient id → the date this practice's
 * access to their record begins.
 */
async function caseload(req) {
  const practice = await practiceOf(req);
  if (!practice) return new Map();

  const rows = await Enrollment.find({
    practice,
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
  })
    .select('patient enrolledOn')
    .lean();

  return new Map(rows.map((r) => [String(r.patient), r.enrolledOn ? new Date(r.enrolledOn) : null]));
}

/** Names for the patients a panel is about to show. */
async function namesFor(ids) {
  if (!ids.length) return new Map();
  const users = await User.find({ _id: { $in: ids } }).select('name').lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

/** Whether a record dated `at` is inside this practice's window for the patient. */
function visible(patients, patientId, at) {
  const enrolledOn = patients.get(String(patientId));
  return !enrolledOn || new Date(at) >= enrolledOn;
}

/**
 * The latest record per patient from rows sorted newest first, keeping only
 * the ones this practice may read.
 */
function latestPerPatient(rows, patients, dateField) {
  const latest = new Map();
  for (const row of rows) {
    const key = String(row.patient);
    if (latest.has(key)) continue;
    if (!visible(patients, key, row[dateField])) continue;
    latest.set(key, row);
  }
  return latest;
}

// ---------------------------------------------------------------------------
// Blood pressure control
// ---------------------------------------------------------------------------

/**
 * Most urgent first when the list is cut short: a crisis before a low reading
 * before a stage 2, and the newest first within each.
 */
const ATTENTION_ORDER = ['hypertensive_crisis', 'hypotension', 'stage2'];

router.get(
  '/blood-pressure',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(365).default(90) }) }),
  audit('read', 'VitalRecord'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const patients = await caseload(req);

    const rows = patients.size
      ? await VitalRecord.find({
          patient: { $in: [...patients.keys()] },
          systolic: { $ne: null },
          diastolic: { $ne: null },
          // The window here; each patient's enrolment date is applied below.
          recordedAt: { $gte: since },
        })
          .select('patient systolic diastolic flag recordedAt')
          .sort({ recordedAt: -1 })
          .lean()
      : [];

    const latest = latestPerPatient(rows, patients, 'recordedAt');

    const bands = {
      normal: 0,
      elevated: 0,
      stage1: 0,
      stage2: 0,
      hypertensive_crisis: 0,
      hypotension: 0,
    };
    const attention = [];

    for (const [patientId, r] of latest) {
      // The stored band, or the same thresholds applied now to a reading
      // written before clinic readings were banded — see backfillReadingBands.js.
      const band = r.flag ?? bloodPressureBand(r.systolic, r.diastolic);
      if (!band || !(band in bands)) continue;
      bands[band] += 1;
      if (ATTENTION_ORDER.includes(band)) {
        attention.push({ patientId, systolic: r.systolic, diastolic: r.diastolic, band, recordedAt: r.recordedAt });
      }
    }

    attention.sort(
      (a, b) =>
        ATTENTION_ORDER.indexOf(a.band) - ATTENTION_ORDER.indexOf(b.band) ||
        new Date(b.recordedAt) - new Date(a.recordedAt),
    );
    const named = attention.slice(0, NAMED);
    const names = await namesFor(named.map((a) => a.patientId));

    res.json({
      days,
      caseload: patients.size,
      withReading: latest.size,
      // Not folded into "normal": a patient nobody has measured is a gap in
      // care, and a panel that hid them would read as a controlled caseload.
      withoutReading: patients.size - latest.size,
      bands,
      attention: named.map((a) => ({ ...a, name: names.get(a.patientId) ?? null })),
      attentionTotal: attention.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// Follow-ups due
// ---------------------------------------------------------------------------

router.get(
  '/follow-ups',
  validate({ query: z.object({ days: z.coerce.number().int().min(1).max(60).default(7) }) }),
  audit('read', 'Prescription'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const patients = await caseload(req);
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const horizon = new Date(startOfToday.getTime() + (days + 1) * 24 * 60 * 60 * 1000);
    // Overdue is bounded too, or a follow-up missed two years ago would sit at
    // the top of this panel forever.
    const overdueFrom = new Date(startOfToday.getTime() - 30 * 24 * 60 * 60 * 1000);

    // The follow-up that counts is the one on the patient's latest prescription
    // still in force: a newer visit answers an older follow-up date.
    const rows = patients.size
      ? await Prescription.find({
          patient: { $in: [...patients.keys()] },
          recordState: { $in: [RECORD_STATE.CURRENT, null] },
          // Switched off the old way, before backfillPrescriptionRecordState.js
          // has given it a state: ended all the same.
          isActive: { $ne: false },
        })
          .select('patient followUpOn issuedOn referenceNo doctor')
          .populate('doctor', 'name')
          .sort({ issuedOn: -1 })
          .lean()
      : [];

    const latest = latestPerPatient(rows, patients, 'issuedOn');

    const overdue = [];
    const due = [];
    for (const [patientId, rx] of latest) {
      if (!rx.followUpOn) continue;
      const on = new Date(rx.followUpOn);
      const entry = {
        patientId,
        followUpOn: rx.followUpOn,
        referenceNo: rx.referenceNo,
        doctorName: rx.doctor?.name ?? null,
      };
      if (on >= overdueFrom && on < startOfToday) overdue.push(entry);
      else if (on >= startOfToday && on < horizon) due.push(entry);
    }

    overdue.sort((a, b) => new Date(a.followUpOn) - new Date(b.followUpOn));
    due.sort((a, b) => new Date(a.followUpOn) - new Date(b.followUpOn));

    const names = await namesFor([...overdue, ...due].map((e) => e.patientId));
    const withName = (e) => ({ ...e, name: names.get(e.patientId) ?? null });

    res.json({
      days,
      overdue: overdue.slice(0, NAMED).map(withName),
      overdueTotal: overdue.length,
      due: due.slice(0, NAMED).map(withName),
      dueTotal: due.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// Condition register
// ---------------------------------------------------------------------------

router.get(
  '/conditions',
  validate({ query: z.object({ language: z.enum(['en', 'bn', 'hi']).default('en') }) }),
  audit('read', 'PatientCondition'),
  asyncHandler(async (req, res) => {
    const { language } = q(req);
    const patients = await caseload(req);

    // Diagnosed and being treated. Suspected is noted, not confirmed, and a
    // register that counted suspicions would read as a caseload of diagnoses.
    const rows = patients.size
      ? await PatientCondition.find({
          patient: { $in: [...patients.keys()] },
          status: CONDITION_STATUS.ACTIVE,
        })
          .select('patient condition')
          .populate('condition', 'key names')
          .lean()
      : [];

    const byCondition = new Map();
    for (const row of rows) {
      if (!row.condition) continue;
      const key = row.condition.key ?? String(row.condition._id);
      const entry = byCondition.get(key) ?? {
        key,
        name: row.condition.names?.[language] || row.condition.names?.en || key,
        patients: new Set(),
      };
      entry.patients.add(String(row.patient));
      byCondition.set(key, entry);
    }

    const conditions = [...byCondition.values()]
      .map((c) => ({ key: c.key, name: c.name, count: c.patients.size }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

    const withAny = new Set(rows.map((r) => String(r.patient)));

    res.json({
      caseload: patients.size,
      conditions,
      // Stated, so an empty register reads as "nothing recorded" rather than
      // as a caseload with no chronic illness.
      withoutCondition: patients.size - withAny.size,
    });
  }),
);

// ---------------------------------------------------------------------------
// Heart rate
// ---------------------------------------------------------------------------

router.get(
  '/heart-rate',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(365).default(30) }) }),
  audit('read', 'VitalRecord'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const patients = await caseload(req);

    const rows = patients.size
      ? await VitalRecord.find({
          patient: { $in: [...patients.keys()] },
          pulse: { $ne: null },
          recordedAt: { $gte: since },
        })
          .select('patient pulse recordedAt')
          .sort({ recordedAt: -1 })
          .lean()
      : [];

    const latest = latestPerPatient(rows, patients, 'recordedAt');

    // The triage engine's own limits, so this panel and an alert can never
    // disagree about what is outside the expected range.
    const low = [];
    const high = [];
    for (const [patientId, r] of latest) {
      const entry = { patientId, pulse: r.pulse, recordedAt: r.recordedAt };
      if (r.pulse < VITALS.PULSE_LOW) low.push(entry);
      else if (r.pulse > VITALS.PULSE_HIGH) high.push(entry);
    }
    const byRecency = (a, b) => new Date(b.recordedAt) - new Date(a.recordedAt);
    low.sort(byRecency);
    high.sort(byRecency);

    const names = await namesFor([...low, ...high].map((e) => e.patientId));
    const withName = (e) => ({ ...e, name: names.get(e.patientId) ?? null });

    res.json({
      days,
      limits: { low: VITALS.PULSE_LOW, high: VITALS.PULSE_HIGH },
      withReading: latest.size,
      withoutReading: patients.size - latest.size,
      low: low.slice(0, NAMED).map(withName),
      lowTotal: low.length,
      high: high.slice(0, NAMED).map(withName),
      highTotal: high.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// Lipid control
// ---------------------------------------------------------------------------

/**
 * Each patient's latest LDL against the catalog's own upper limit.
 *
 * The one threshold, from services/analyteCatalog.js, so the panel and the
 * patient's lab record can never disagree about "above target". The values are
 * the ones the platform read from uploaded lab reports — the same ones the
 * patient's record already shows — which the response says, so nobody reads
 * them as a laboratory's own feed.
 */
router.get(
  '/lipids',
  validate({ query: z.object({ days: z.coerce.number().int().min(30).max(730).default(365) }) }),
  audit('read', 'LabResult'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const patients = await caseload(req);
    const ldl = ANALYTES.find((a) => a.code === 'ldl');

    const rows = patients.size
      ? await LabResult.find({
          patient: { $in: [...patients.keys()] },
          'analysis.status': 'done',
          'analysis.ldl': { $ne: null },
          createdAt: { $gte: since },
        })
          .select('patient analysis.ldl analysis.testedOn createdAt')
          .lean()
      : [];

    // Dated by when the test was done where the report says, and by when it was
    // filed where it does not — newest first. Whether this practice may read it
    // is decided by when it was filed, the date the patient's lab record is
    // windowed by (routes/labtests.js), so the panel and the record agree.
    const dated = rows
      .map((r) => ({ ...r, at: r.analysis?.testedOn ?? r.createdAt }))
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const visibleLatest = latestPerPatient(dated, patients, 'createdAt');
    // Filed in the window is not tested in it: a two-year-old report uploaded
    // last week is not a result from inside the window.
    const latest = new Map([...visibleLatest].filter(([, r]) => new Date(r.at) >= since));

    const above = [];
    let atOrBelow = 0;
    for (const [patientId, r] of latest) {
      if (r.analysis.ldl > ldl.high) above.push({ patientId, ldl: r.analysis.ldl, testedOn: r.at });
      else atOrBelow += 1;
    }
    above.sort((a, b) => b.ldl - a.ldl);

    const named = above.slice(0, NAMED);
    const names = await namesFor(named.map((a) => a.patientId));

    res.json({
      days,
      source: 'uploaded lab reports',
      target: { analyte: 'LDL', unit: ldl.unit, high: ldl.high },
      withResult: latest.size,
      withoutResult: patients.size - latest.size,
      atOrBelow,
      above: named.map((a) => ({ ...a, name: names.get(a.patientId) ?? null })),
      aboveTotal: above.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// ECGs
// ---------------------------------------------------------------------------

/** Abnormal before borderline when the list is cut short. */
const ECG_ORDER = ['abnormal', 'borderline'];

/**
 * Each patient's latest ECG, by the impression the clinician who read it gave.
 * Nothing here is interpreted by the platform — see models/EcgReport.js.
 */
router.get(
  '/ecg',
  validate({ query: z.object({ days: z.coerce.number().int().min(30).max(730).default(180) }) }),
  audit('read', 'EcgReport'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const patients = await caseload(req);

    const rows = patients.size
      ? await EcgReport.find({
          patient: { $in: [...patients.keys()] },
          recordedOn: { $gte: since },
        })
          .select('patient recordedOn impression rhythm heartRate')
          .sort({ recordedOn: -1 })
          .lean()
      : [];

    const latest = latestPerPatient(rows, patients, 'recordedOn');

    const impressions = { normal: 0, borderline: 0, abnormal: 0, unknown: 0 };
    const flagged = [];
    for (const [patientId, r] of latest) {
      impressions[r.impression] = (impressions[r.impression] ?? 0) + 1;
      if (ECG_ORDER.includes(r.impression)) {
        flagged.push({
          patientId,
          impression: r.impression,
          rhythm: r.rhythm,
          heartRate: r.heartRate ?? null,
          recordedOn: r.recordedOn,
        });
      }
    }
    flagged.sort(
      (a, b) =>
        ECG_ORDER.indexOf(a.impression) - ECG_ORDER.indexOf(b.impression) ||
        new Date(b.recordedOn) - new Date(a.recordedOn),
    );

    const named = flagged.slice(0, NAMED);
    const names = await namesFor(named.map((f) => f.patientId));

    res.json({
      days,
      withEcg: latest.size,
      withoutEcg: patients.size - latest.size,
      impressions,
      flagged: named.map((f) => ({ ...f, name: names.get(f.patientId) ?? null })),
      flaggedTotal: flagged.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// Glucose: lows and very highs
// ---------------------------------------------------------------------------

/**
 * Who had a low or a very high sugar in the window, and how the caseload's
 * readings sat against the range.
 *
 * ---- By the value, against the triage engine's own thresholds ------------
 *
 * Not by the flag stored on the reading. That flag depends on the context the
 * patient chose — "high" after a meal is not "high" fasting — and it is missing
 * on readings written before it existed. Below 70 and above 250 mean the same
 * thing whatever the context, and they are the numbers that page a doctor, so a
 * panel counting them cannot disagree with the alert that already did.
 *
 * "In range" is 70–180, the band the practice's glucose chart
 * (services/analytics.js) already draws, so the two never say different
 * percentages about the same readings.
 *
 * ---- Every low, not only the latest ---------------------------------------
 *
 * The other panels read each patient's latest record. A hypo on Tuesday is not
 * answered by a normal reading on Wednesday — it is the thing a diabetologist
 * changes the prescription for — so this counts them all within the window.
 */
router.get(
  '/glucose',
  validate({ query: z.object({ days: z.coerce.number().int().min(7).max(90).default(14) }) }),
  audit('read', 'GlucoseReading'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const since = new Date(Date.now() - days * DAY);
    const patients = await caseload(req);

    const rows = patients.size
      ? await GlucoseReading.find({
          patient: { $in: [...patients.keys()] },
          measuredAt: { $gte: since },
        })
          .select('patient valueMgDl measuredAt')
          .sort({ measuredAt: -1 })
          .lean()
      : [];

    let readings = 0;
    let inRange = 0;
    const measured = new Set();
    const lows = new Map();
    const highs = new Map();

    for (const r of rows) {
      const patientId = String(r.patient);
      // Each patient's enrolment date, here: a hypo recorded before this
      // practice took them on is another practice's reading.
      if (!visible(patients, patientId, r.measuredAt)) continue;

      const value = r.valueMgDl;
      readings += 1;
      measured.add(patientId);
      if (value >= GLUCOSE.LOW && value <= GLUCOSE.POST_PRANDIAL_TARGET_MAX) inRange += 1;

      // Rows arrive newest first, so the first one seen is the latest.
      if (value < GLUCOSE.LOW) {
        const low = lows.get(patientId) ?? { patientId, count: 0, severe: 0, lowest: value, lastAt: r.measuredAt };
        low.count += 1;
        if (value < GLUCOSE.SEVERE_LOW) low.severe += 1;
        low.lowest = Math.min(low.lowest, value);
        lows.set(patientId, low);
      } else if (value > GLUCOSE.HIGH) {
        const high = highs.get(patientId) ?? { patientId, count: 0, critical: 0, highest: value, lastAt: r.measuredAt };
        high.count += 1;
        if (value > GLUCOSE.CRITICAL_HIGH) high.critical += 1;
        high.highest = Math.max(high.highest, value);
        highs.set(patientId, high);
      }
    }

    // A severe low before a mild one, then the lowest value, then the newest.
    const lowList = [...lows.values()].sort(
      (a, b) =>
        Number(b.severe > 0) - Number(a.severe > 0) ||
        a.lowest - b.lowest ||
        new Date(b.lastAt) - new Date(a.lastAt),
    );
    // Above 400 before above 250, then the highest value, then the newest.
    const highList = [...highs.values()].sort(
      (a, b) =>
        Number(b.critical > 0) - Number(a.critical > 0) ||
        b.highest - a.highest ||
        new Date(b.lastAt) - new Date(a.lastAt),
    );

    const namedLows = lowList.slice(0, NAMED);
    const namedHighs = highList.slice(0, NAMED);
    const names = await namesFor([...namedLows, ...namedHighs].map((e) => e.patientId));
    const withName = (e) => ({ ...e, name: names.get(e.patientId) ?? null });

    res.json({
      days,
      unit: 'mg/dL',
      thresholds: {
        low: GLUCOSE.LOW,
        severeLow: GLUCOSE.SEVERE_LOW,
        veryHigh: GLUCOSE.HIGH,
        criticalHigh: GLUCOSE.CRITICAL_HIGH,
        rangeLow: GLUCOSE.LOW,
        rangeHigh: GLUCOSE.POST_PRANDIAL_TARGET_MAX,
      },
      caseload: patients.size,
      // Stated, never folded into "no lows": a patient who logged nothing had
      // no chance to record one.
      withReadings: measured.size,
      withoutReadings: patients.size - measured.size,
      readings,
      inRange,
      lows: namedLows.map(withName),
      lowsTotal: lowList.length,
      highs: namedHighs.map(withName),
      highsTotal: highList.length,
    });
  }),
);

// ---------------------------------------------------------------------------
// HbA1c control
// ---------------------------------------------------------------------------

/**
 * Each patient's latest HbA1c against their own target, and who has had none.
 *
 * ---- Their target, not one number for everybody ---------------------------
 *
 * `PatientProfile.targets.hba1cMax` is set per patient — 8% is a reasonable
 * target for a frail eighty-year-old and a dangerous one to push below — and
 * the triage engine and the risk score already read it. A panel that called
 * that patient "above target" at 7.4% would be the one screen disagreeing with
 * the doctor who set it. 9% and over is poor control whatever the target: the
 * same line services/analytics.js draws.
 *
 * ---- "Not tested", said as a window rather than as overdue ---------------
 *
 * How often somebody should be tested depends on how they are doing, and
 * nothing records a schedule. What is true and checkable is that there is no
 * result in the last N days, so that is what this says — with the date of the
 * last one this practice may read, or none.
 */
router.get(
  '/hba1c',
  validate({ query: z.object({ days: z.coerce.number().int().min(90).max(730).default(180) }) }),
  audit('read', 'Hba1cRecord'),
  asyncHandler(async (req, res) => {
    const { days } = q(req);
    const since = new Date(Date.now() - days * DAY);
    const patients = await caseload(req);
    const ids = [...patients.keys()];

    const [rows, profiles] = patients.size
      ? await Promise.all([
          // Every result, not only the window's: a patient with none in the
          // window is still told apart from one who has never been tested.
          Hba1cRecord.find({ patient: { $in: ids } })
            .select('patient percentage testedOn')
            .sort({ testedOn: -1 })
            .lean(),
          PatientProfile.find({ user: { $in: ids } }).select('user targets.hba1cMax').lean(),
        ])
      : [[], []];

    const targetOf = new Map(
      profiles.map((p) => [String(p.user), p.targets?.hba1cMax ?? HBA1C.TARGET_MAX]),
    );
    // The latest result this practice may read, by test date against enrolment
    // — the rule the patient's own HbA1c record is read by (routes/tracking.js).
    const latest = latestPerPatient(rows, patients, 'testedOn');

    let atTarget = 0;
    const above = [];
    const untested = [];

    for (const patientId of ids) {
      const r = latest.get(patientId);
      if (!r || new Date(r.testedOn) < since) {
        untested.push({ patientId, lastTestedOn: r?.testedOn ?? null, lastPercentage: r?.percentage ?? null });
        continue;
      }
      const target = targetOf.get(patientId) ?? HBA1C.TARGET_MAX;
      if (r.percentage > target) {
        above.push({
          patientId,
          percentage: r.percentage,
          target,
          testedOn: r.testedOn,
          poorControl: r.percentage >= HBA1C.POOR_CONTROL,
        });
      } else {
        atTarget += 1;
      }
    }

    // The highest first: that is who a diabetologist rings.
    above.sort((a, b) => b.percentage - a.percentage || new Date(b.testedOn) - new Date(a.testedOn));
    // Never tested before tested long ago, then the longest since a result.
    untested.sort((a, b) => {
      if (!a.lastTestedOn || !b.lastTestedOn) return Number(Boolean(a.lastTestedOn)) - Number(Boolean(b.lastTestedOn));
      return new Date(a.lastTestedOn) - new Date(b.lastTestedOn);
    });

    const namedAbove = above.slice(0, NAMED);
    const namedUntested = untested.slice(0, NAMED);
    const names = await namesFor([...namedAbove, ...namedUntested].map((e) => e.patientId));
    const withName = (e) => ({ ...e, name: names.get(e.patientId) ?? null });

    res.json({
      days,
      unit: '%',
      target: { default: HBA1C.TARGET_MAX, poorControl: HBA1C.POOR_CONTROL, individual: true },
      caseload: patients.size,
      withResult: atTarget + above.length,
      atTarget,
      aboveTarget: above.filter((a) => !a.poorControl).length,
      poorControl: above.filter((a) => a.poorControl).length,
      above: namedAbove.map(withName),
      aboveTotal: above.length,
      untested: namedUntested.map(withName),
      untestedTotal: untested.length,
    });
  }),
);

export default router;
