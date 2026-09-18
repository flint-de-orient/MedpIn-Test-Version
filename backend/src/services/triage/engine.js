import { GLUCOSE, BLOOD_PRESSURE, VITALS, maxUrgency } from './thresholds.js';
import { matchRedFlags } from './redFlagRules.js';

/**
 * The triage engine.
 *
 * Design rule: every emergency verdict this system can reach is reachable
 * without the language model. Gemini is called only after triage has already
 * decided, and its job is to phrase the answer — not to decide whether the
 * patient is in danger. `ruleDriven: true` on a result means no model judgement
 * was involved at all.
 */

// ---------------------------------------------------------------------------
// Numeric classification
// ---------------------------------------------------------------------------

/**
 * @param {number} valueMgDl
 * @param {string} context one of GLUCOSE_CONTEXTS
 * @param {object} [targets] patient-specific targets; falls back to clinic defaults
 */
export function classifyGlucose(valueMgDl, context = 'random', targets = {}) {
  const fastingMax = targets.fastingMax ?? GLUCOSE.FASTING_TARGET_MAX;
  const fastingMin = targets.fastingMin ?? GLUCOSE.FASTING_TARGET_MIN;
  const ppMax = targets.postPrandialMax ?? GLUCOSE.POST_PRANDIAL_TARGET_MAX;

  if (valueMgDl < GLUCOSE.SEVERE_LOW) {
    return {
      flag: 'severe_low',
      urgency: 'emergency',
      rule: 'GL_SEVERE_HYPO',
      alertType: 'severe_hypoglycaemia',
      summary: `Blood sugar ${valueMgDl} mg/dL is severely low (below ${GLUCOSE.SEVERE_LOW}).`,
    };
  }
  if (valueMgDl < GLUCOSE.LOW) {
    return {
      flag: 'low',
      urgency: 'urgent',
      rule: 'GL_HYPO',
      alertType: 'severe_hypoglycaemia',
      summary: `Blood sugar ${valueMgDl} mg/dL is low (below ${GLUCOSE.LOW}).`,
    };
  }
  if (valueMgDl > GLUCOSE.CRITICAL_HIGH) {
    return {
      flag: 'critical_high',
      urgency: 'emergency',
      rule: 'GL_CRITICAL_HYPER',
      alertType: 'critical_hyperglycaemia',
      summary: `Blood sugar ${valueMgDl} mg/dL is critically high (above ${GLUCOSE.CRITICAL_HIGH}).`,
    };
  }
  if (valueMgDl > GLUCOSE.HIGH) {
    return {
      flag: 'very_high',
      urgency: 'urgent',
      rule: 'GL_VERY_HIGH',
      alertType: 'critical_hyperglycaemia',
      summary: `Blood sugar ${valueMgDl} mg/dL is very high (above ${GLUCOSE.HIGH}).`,
    };
  }

  const ceiling = context === 'fasting' || context === 'pre_meal' ? fastingMax : ppMax;
  if (valueMgDl > ceiling) {
    return {
      flag: 'high',
      urgency: 'advice',
      rule: 'GL_ABOVE_TARGET',
      alertType: null,
      summary: `Blood sugar ${valueMgDl} mg/dL is above the ${context.replace('_', ' ')} target of ${ceiling} mg/dL.`,
    };
  }
  if ((context === 'fasting' || context === 'pre_meal') && valueMgDl < fastingMin) {
    return {
      flag: 'in_range',
      urgency: 'advice',
      rule: 'GL_BELOW_TARGET',
      alertType: null,
      summary: `Blood sugar ${valueMgDl} mg/dL is slightly below the fasting target of ${fastingMin} mg/dL.`,
    };
  }
  return {
    flag: 'in_range',
    urgency: 'routine',
    rule: 'GL_IN_RANGE',
    alertType: null,
    summary: `Blood sugar ${valueMgDl} mg/dL is within target range.`,
  };
}

export function classifyBloodPressure(systolic, diastolic) {
  if (systolic == null || diastolic == null) return null;

  if (systolic >= BLOOD_PRESSURE.CRISIS_SYSTOLIC || diastolic >= BLOOD_PRESSURE.CRISIS_DIASTOLIC) {
    return {
      flag: 'hypertensive_crisis',
      urgency: 'emergency',
      rule: 'BP_CRISIS',
      alertType: 'hypertensive_crisis',
      summary: `Blood pressure ${systolic}/${diastolic} mmHg is in the hypertensive crisis range.`,
    };
  }
  if (systolic < BLOOD_PRESSURE.HYPOTENSION_SYSTOLIC || diastolic < BLOOD_PRESSURE.HYPOTENSION_DIASTOLIC) {
    return {
      flag: 'hypotension',
      urgency: 'urgent',
      rule: 'BP_LOW',
      alertType: 'other',
      summary: `Blood pressure ${systolic}/${diastolic} mmHg is low.`,
    };
  }
  if (systolic >= BLOOD_PRESSURE.STAGE2_SYSTOLIC || diastolic >= BLOOD_PRESSURE.STAGE2_DIASTOLIC) {
    return {
      flag: 'stage2',
      urgency: 'advice',
      rule: 'BP_STAGE2',
      alertType: null,
      summary: `Blood pressure ${systolic}/${diastolic} mmHg is high (stage 2 hypertension range).`,
    };
  }
  if (systolic >= BLOOD_PRESSURE.STAGE1_SYSTOLIC || diastolic >= BLOOD_PRESSURE.STAGE1_DIASTOLIC) {
    return {
      flag: 'stage1',
      urgency: 'advice',
      rule: 'BP_STAGE1',
      alertType: null,
      summary: `Blood pressure ${systolic}/${diastolic} mmHg is mildly raised (stage 1 range).`,
    };
  }
  if (systolic >= BLOOD_PRESSURE.ELEVATED_SYSTOLIC) {
    return { flag: 'elevated', urgency: 'routine', rule: 'BP_ELEVATED', alertType: null,
      summary: `Blood pressure ${systolic}/${diastolic} mmHg is slightly elevated.` };
  }
  return { flag: 'normal', urgency: 'routine', rule: 'BP_NORMAL', alertType: null,
    summary: `Blood pressure ${systolic}/${diastolic} mmHg is normal.` };
}

export function classifyVitals({ spo2, temperatureC, pulse } = {}) {
  const findings = [];
  if (spo2 != null && spo2 < VITALS.SPO2_CRITICAL) {
    findings.push({ urgency: 'emergency', rule: 'VT_LOW_SPO2', alertType: 'breathing_difficulty',
      summary: `Oxygen saturation ${spo2}% is below ${VITALS.SPO2_CRITICAL}%.` });
  }
  if (temperatureC != null && temperatureC >= VITALS.HIGH_FEVER_C) {
    findings.push({ urgency: 'urgent', rule: 'VT_HIGH_FEVER', alertType: 'other',
      summary: `Temperature ${temperatureC}°C indicates a high fever.` });
  }
  if (pulse != null && (pulse < VITALS.PULSE_LOW || pulse > VITALS.PULSE_HIGH)) {
    findings.push({ urgency: 'urgent', rule: 'VT_ABNORMAL_PULSE', alertType: 'other',
      summary: `Pulse ${pulse} bpm is outside the expected range.` });
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Free-text value extraction
// ---------------------------------------------------------------------------

const MMOL_TO_MGDL = 18.0182;

/**
 * Maps Bengali (০-৯) and Devanagari (०-९) digits onto ASCII. A patient typing
 * their sugar in their own script — "সুগার ৩৫০", "शुगर ३५०" — is entirely
 * normal here, and without this the number is invisible to every regex below,
 * so the reading silently fails to trigger triage. That is a safety bug, not a
 * cosmetic one.
 */
const NATIVE_DIGITS = {
  '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9',
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4', '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

export function normalizeDigits(text) {
  return text.replace(/[०-९০-৯]/g, (d) => NATIVE_DIGITS[d] ?? d);
}

/**
 * Pulls vital signs out of a patient's sentence so that "my sugar is 350"
 * triggers the same rules as a tapped-in reading. Conservative by design:
 * an unrecognised number is ignored rather than guessed at.
 */
export function extractVitalsFromText(text) {
  if (!text) return {};
  // Normalise native-script numerals to ASCII before any digit matching.
  const t = normalizeDigits(text.normalize('NFC'));
  const out = {};

  // Blood pressure — "140/90", "bp 150 by 100"
  const bp = t.match(/\b(\d{2,3})\s*(?:\/|over|by|বাই|बटा)\s*(\d{2,3})\b/i);
  if (bp) {
    const sys = Number(bp[1]);
    const dia = Number(bp[2]);
    if (sys >= 50 && sys <= 300 && dia >= 30 && dia <= 200 && sys > dia) {
      out.systolic = sys;
      out.diastolic = dia;
    }
  }

  // Glucose in mmol/L — must be checked before the mg/dL branch, since a bare
  // "19.4" would otherwise look like a nonsensical mg/dL value.
  const mmol = t.match(/\b(\d{1,2}(?:\.\d)?)\s*(?:mmol\/?l|mmol)\b/i);
  if (mmol) {
    const v = Math.round(Number(mmol[1]) * MMOL_TO_MGDL);
    if (v >= 10 && v <= 900) out.glucoseMgDl = v;
  }

  if (out.glucoseMgDl == null) {
    // Explicit unit, or a number near a sugar/glucose keyword in any of the
    // three supported languages.
    const patterns = [
      /\b(\d{2,3})\s*(?:mg\s*\/?\s*dl|mgdl|mg)\b/i,
      /\b(?:sugar|glucose|bs|rbs|fbs|ppbs|cbg)\b[^0-9\n]{0,20}(\d{2,3})\b/i,
      /\b(\d{2,3})\b[^0-9\n]{0,15}\b(?:sugar|glucose)\b/i,
      /(?:সুগার|সুগার|গ্লুকোজ|রক্তে\s*চিনি)[^0-9\n]{0,20}(\d{2,3})/,
      /(?:शुगर|शर्करा|ग्लूकोज|शक्कर)[^0-9\n]{0,20}(\d{2,3})/,
    ];
    for (const re of patterns) {
      const m = t.match(re);
      if (m) {
        const v = Number(m[1]);
        // Reject values that collide with the BP reading we already parsed.
        if (v >= 20 && v <= 900 && v !== out.systolic && v !== out.diastolic) {
          out.glucoseMgDl = v;
          break;
        }
      }
    }
  }

  const hba1c = t.match(/\b(?:hba1c|a1c|एचबीए1सी|এইচবিএ১সি)\b[^0-9\n]{0,15}(\d{1,2}(?:\.\d)?)/i);
  if (hba1c) {
    const v = Number(hba1c[1]);
    if (v >= 3 && v <= 20) out.hba1c = v;
  }

  const spo2 = t.match(/\b(?:spo2|oxygen|saturation|oxygen\s*level)\b[^0-9\n]{0,15}(\d{2,3})\b/i);
  if (spo2) {
    const v = Number(spo2[1]);
    if (v >= 50 && v <= 100) out.spo2 = v;
  }

  // Pulse — "pulse 150", "heart rate 40", "140 bpm" — graded by the same limits
  // as a logged reading (classifyVitals). It was graded when tapped in and
  // ignored when typed, so "my pulse is 150" in the chat was routine. "hr" is
  // left out: it is also "hour", and "sugar 180, 2 hr after food" is not a
  // heart rate.
  const pulse =
    t.match(/\b(?:pulse|heart\s*rate|heart\s*beat)\b[^0-9\n]{0,15}(\d{2,3})\b/i) ??
    t.match(/\b(\d{2,3})\s*(?:bpm|beats\s*(?:per|a|\/)\s*min\w*)\b/i) ??
    t.match(/(?:পালস|নাড়ি|হৃদস্পন্দন|হার্ট\s*রেট)[^0-9\n]{0,15}(\d{2,3})/) ??
    t.match(/(?:पल्स|नब्ज़|नब्ज|धड़कन|हार्ट\s*रेट)[^0-9\n]{0,15}(\d{2,3})/);
  if (pulse) {
    const v = Number(pulse[1]);
    if (v >= 20 && v <= 250 && v !== out.systolic && v !== out.diastolic) out.pulse = v;
  }

  // Temperature — "fever 103", "temperature 39.5". Home thermometers here are
  // mostly Fahrenheit, so a reading in its range is converted; one in neither
  // range ("fever for 10 days") is not a temperature at all.
  const temp =
    t.match(/\b(?:temp|temperature|fever)\b[^0-9\n]{0,15}(\d{2,3}(?:\.\d)?)/i) ??
    t.match(/(?:জ্বর|তাপমাত্রা|টেম্পারেচার)[^0-9\n]{0,15}(\d{2,3}(?:\.\d)?)/) ??
    t.match(/(?:बुखार|तापमान|टेम्परेचर)[^0-9\n]{0,15}(\d{2,3}(?:\.\d)?)/);
  if (temp) {
    const v = Number(temp[1]);
    if (v >= 93 && v <= 110) out.temperatureC = Math.round((((v - 32) * 5) / 9) * 10) / 10;
    else if (v >= 34 && v <= 43) out.temperatureC = v;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Foot assessment rules
// ---------------------------------------------------------------------------

export function classifyFootSymptoms(symptoms = {}) {
  const matched = [];
  let risk = 'low';

  const bump = (level, rule) => {
    matched.push(rule);
    const order = ['low', 'moderate', 'high', 'urgent'];
    if (order.indexOf(level) > order.indexOf(risk)) risk = level;
  };

  if (symptoms.blackTissue) bump('urgent', 'FT_BLACK_TISSUE');
  if (symptoms.discharge && symptoms.foulSmell) bump('urgent', 'FT_PURULENT_MALODOROUS');
  if (symptoms.fever && (symptoms.discharge || symptoms.swelling)) bump('urgent', 'FT_SYSTEMIC_INFECTION');
  if (symptoms.pain === 'severe') bump('high', 'FT_SEVERE_PAIN');
  if (symptoms.discharge) bump('high', 'FT_DISCHARGE');
  if (symptoms.foulSmell) bump('high', 'FT_MALODOUR');
  if (symptoms.swelling) bump('moderate', 'FT_SWELLING');
  if (symptoms.numbness) bump('moderate', 'FT_NEUROPATHY');
  if (symptoms.pain === 'moderate') bump('moderate', 'FT_MODERATE_PAIN');
  // A wound that has not healed in two weeks is, by definition, a
  // non-healing ulcer and needs review regardless of how it looks.
  if (Number(symptoms.durationDays) >= 14) bump('high', 'FT_NON_HEALING_14D');

  const urgency = risk === 'urgent' ? 'emergency' : risk === 'high' ? 'urgent' : risk === 'moderate' ? 'advice' : 'routine';
  return { riskLevel: risk, urgency, matchedRules: matched };
}

// ---------------------------------------------------------------------------
// Top-level message triage
// ---------------------------------------------------------------------------

/**
 * Triage a free-text patient message, optionally enriched with structured
 * context the app already knows (latest readings, recent alerts).
 *
 * @returns {{
 *   urgency: 'routine'|'advice'|'urgent'|'emergency',
 *   ruleDriven: boolean,
 *   matchedRules: string[],
 *   redFlags: {id:string,label:string}[],
 *   findings: {rule:string,summary:string,urgency:string,alertType:?string}[],
 *   extracted: object,
 *   alertType: ?string,
 * }}
 */
export function triageMessage({ text = '', targets = {}, latestGlucose = null } = {}) {
  const matchedRules = [];
  const findings = [];
  let urgency = 'routine';
  let alertType = null;

  // 1. Symptom red flags — highest-signal, language-aware.
  const redFlags = matchRedFlags(text);
  for (const rf of redFlags) {
    matchedRules.push(rf.id);
    urgency = maxUrgency(urgency, rf.urgency);
    findings.push({ rule: rf.id, summary: rf.label, urgency: rf.urgency, alertType: rf.alertType });
    if (rf.urgency === 'emergency' && !alertType) alertType = rf.alertType;
  }

  // 2. Numbers mentioned in the message.
  const extracted = extractVitalsFromText(text);

  if (extracted.glucoseMgDl != null) {
    const g = classifyGlucose(extracted.glucoseMgDl, 'random', targets);
    matchedRules.push(g.rule);
    urgency = maxUrgency(urgency, g.urgency);
    findings.push({ rule: g.rule, summary: g.summary, urgency: g.urgency, alertType: g.alertType });
    if (g.urgency === 'emergency' && !alertType) alertType = g.alertType;
  }

  if (extracted.systolic != null) {
    const bp = classifyBloodPressure(extracted.systolic, extracted.diastolic);
    if (bp) {
      matchedRules.push(bp.rule);
      urgency = maxUrgency(urgency, bp.urgency);
      findings.push({ rule: bp.rule, summary: bp.summary, urgency: bp.urgency, alertType: bp.alertType });
      if (bp.urgency === 'emergency' && !alertType) alertType = bp.alertType;
    }
  }

  for (const v of classifyVitals(extracted)) {
    matchedRules.push(v.rule);
    urgency = maxUrgency(urgency, v.urgency);
    findings.push(v);
    if (v.urgency === 'emergency' && !alertType) alertType = v.alertType;
  }

  // 3. Context the patient did not restate: a hypo reported minutes ago still
  // matters when the next message says "I feel worse".
  if (latestGlucose && Date.now() - new Date(latestGlucose.measuredAt).getTime() < 60 * 60 * 1000) {
    if (latestGlucose.valueMgDl < GLUCOSE.SEVERE_LOW || latestGlucose.valueMgDl > GLUCOSE.CRITICAL_HIGH) {
      matchedRules.push('CTX_RECENT_CRITICAL_READING');
      urgency = maxUrgency(urgency, 'urgent');
      findings.push({
        rule: 'CTX_RECENT_CRITICAL_READING',
        summary: `A reading of ${latestGlucose.valueMgDl} mg/dL was recorded within the last hour.`,
        urgency: 'urgent',
        alertType: null,
      });
    }
  }

  if (!alertType && urgency === 'emergency') alertType = 'chat_escalation';

  return {
    urgency,
    ruleDriven: matchedRules.length > 0,
    matchedRules,
    redFlags: redFlags.map(({ id, label }) => ({ id, label })),
    findings,
    extracted,
    alertType,
  };
}
