import { generateFromImage, generate, AiUnavailableError } from './gemini.js';
import { retrieve, formatContext } from './rag.js';
import { doctorOr } from '../clinicIdentity.js';
import { currentDoctorOf } from '../careDoctor.js';
import { logger } from '../../config/logger.js';
import { countAiCall } from './allowance.js';

const LANGUAGE_NAME = { en: 'English', bn: 'Bengali (বাংলা)', hi: 'Hindi (हिन्दी)' };

/**
 * Diabetic foot image assessment.
 *
 * Scoped deliberately narrowly: the model describes what is visible and
 * suggests an urgency, it does not diagnose. Its output is combined with the
 * deterministic symptom rules by the caller, and the *higher* of the two risk
 * levels always wins — an optimistic model can never talk the system down from
 * a rule-based "urgent".
 */
const FOOT_SCHEMA = {
  type: 'object',
  properties: {
    riskLevel: { type: 'string', enum: ['low', 'moderate', 'high', 'urgent'] },
    wagnerGradeEstimate: { type: 'integer' },
    observations: { type: 'string' },
    recommendations: { type: 'string' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
    imageQualityIssue: { type: 'string' },
  },
  required: ['riskLevel', 'observations', 'recommendations', 'confidence'],
};

export async function assessFootImages({ images, symptoms, language = 'en', patientContext, practiceId = null, patientId = null }) {
  if (!images?.length) return null;

  const grounding = await retrieve('diabetic foot ulcer assessment wound infection signs care', {
    categories: ['foot_care'],
    language: 'en',
    limit: 4,
  }).catch(() => []);

  // The patient's own doctor at this practice, or "your doctor". Not a
  // credential either: "a Consultant Diabetologist" was printed after every
  // practice's doctor. Not the practice's head doctor: see careDoctor.js.
  const doctorName = doctorOr((await currentDoctorOf({ patientId, practiceId }))?.displayName, 'en');
  const system = `You are a clinical triage assistant supporting ${doctorName} in reviewing diabetic foot photographs submitted by patients.

Your role is strictly limited:
- Describe only what is actually visible in the photograph. Do not speculate about what might be underneath.
- You are NOT making a diagnosis. A clinician reviews every case.
- When the image is blurred, too dark, or does not clearly show a foot, say so in "imageQualityIssue" and set confidence to "low". Never guess to be helpful.
- Err toward a HIGHER risk level when uncertain. Under-calling a diabetic foot infection can cost a patient their limb.

Set riskLevel using these anchors:
- "urgent": visible black/necrotic tissue, gangrene, exposed bone or tendon, spreading redness with streaking, large amounts of pus.
- "high": open ulcer, purulent discharge, significant surrounding redness or swelling, deep wound.
- "moderate": superficial break in skin, callus with surrounding redness, blister, early pressure damage.
- "low": intact skin, dry skin, well-healed scar, mild callus with no redness.

wagnerGradeEstimate: 0-5 on the Wagner ulcer classification, or omit if it cannot be judged from the image.
observations: 2-4 plain sentences describing what is visible.
recommendations: what the patient should do next, in ${LANGUAGE_NAME[language] ?? 'English'}. Never recommend specific medicines or antibiotics.

Approved clinical reference material:
${formatContext(grounding) ?? 'None available.'}`;

  const symptomText = Object.entries(symptoms ?? {})
    .filter(([, v]) => v !== false && v != null && v !== 'none')
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');

  const prompt = `Assess these diabetic foot photograph(s).

Patient-reported symptoms: ${symptomText || 'none reported'}

Patient background:
${patientContext ?? 'Not available.'}

Return your assessment as JSON.`;

  try {
    const result = await generateFromImage({ system, prompt, images, responseSchema: FOOT_SCHEMA });
    // Metered after the call: a failed request cost the practice nothing.
    // Tokens and a per-kind count, never the reply allowance — see allowance.js.
    countAiCall(practiceId, 'vision', result?.usage);
    const json = result.json;
    if (!json) throw new AiUnavailableError(new Error('unparseable foot assessment'));

    return {
      riskLevel: json.riskLevel,
      wagnerGradeEstimate: Number.isInteger(json.wagnerGradeEstimate) ? json.wagnerGradeEstimate : undefined,
      observations: json.observations,
      recommendations: json.recommendations,
      confidence: json.imageQualityIssue ? 'low' : json.confidence,
      imageQualityIssue: json.imageQualityIssue ?? null,
      modelVersion: result.modelVersion,
      generatedAt: new Date(),
    };
  } catch (err) {
    logger.error({ err: err?.message }, 'foot image assessment failed');
    return null; // the caller falls back to rule-based risk alone
  }
}

/**
 * Explains an existing ophthalmology report in plain language.
 *
 * Note what this does NOT do: it does not grade retinopathy from a fundus
 * image. That requires a validated diagnostic device and regulatory clearance.
 * It only translates a report a qualified clinician has already produced.
 */
const EYE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    whatItMeans: { type: 'string' },
    recommendedActions: { type: 'string' },
    referralUrgency: { type: 'string', enum: ['routine', 'soon', 'urgent'] },
    extractedGrade: {
      type: 'string',
      enum: ['no_dr', 'mild_npdr', 'moderate_npdr', 'severe_npdr', 'pdr', 'unknown'],
    },
  },
  required: ['summary', 'whatItMeans', 'recommendedActions', 'referralUrgency'],
};

export async function explainEyeReport({ reportText, images, reportedGrade, language = 'en', patientContext, practiceId = null, patientId = null }) {
  const grounding = await retrieve('diabetic retinopathy grading what it means follow up screening', {
    categories: ['eye_care'],
    language: 'en',
    limit: 4,
  }).catch(() => []);

  // The patient's own doctor, as the foot reader above.
  const doctorName = doctorOr((await currentDoctorOf({ patientId, practiceId }))?.displayName, 'en');
  const system = `You explain eye examination reports to patients of ${doctorName}. Many of these patients have diabetic retinopathy.

Rules:
- You are explaining a report that an eye specialist has ALREADY produced. You are not examining the eye or making a diagnosis yourself.
- Never grade retinopathy from an image. If you are given a photograph rather than a written report, read only the printed text in it. If there is no readable text, say the report could not be read and set extractedGrade to "unknown".
- Write in ${LANGUAGE_NAME[language] ?? 'English'}, for someone with no medical training. Explain every medical term the first time you use it.
- Be honest but not alarming. Diabetic retinopathy is treatable when caught early, and that reassurance belongs in the explanation.
- Set referralUrgency to "urgent" for proliferative retinopathy (PDR), macular oedema, or any mention of sudden vision change or vitreous haemorrhage. "soon" for severe NPDR. "routine" otherwise.
- Never suggest medicines or procedures. Direct the patient to their eye specialist and to ${doctorName}.

Approved reference material:
${formatContext(grounding) ?? 'None available.'}`;

  const prompt = `Explain this eye report to the patient.

Grade recorded in the app: ${reportedGrade ?? 'not specified'}

Report text:
${reportText?.trim() || '(no text provided — read the attached image if present)'}

Patient background:
${patientContext ?? 'Not available.'}

Return JSON.`;

  try {
    const result = images?.length
      ? await generateFromImage({ system, prompt, images, responseSchema: EYE_SCHEMA })
      : await generate({
          system,
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          responseSchema: EYE_SCHEMA,
          temperature: 0.2,
        });

    // Metered after the call: a failed request cost the practice nothing.
    // Tokens and a per-kind count, never the reply allowance — see allowance.js.
    countAiCall(practiceId, 'vision', result?.usage);

    const json = result.json;
    if (!json) return null;

    return {
      summary: json.summary,
      whatItMeans: json.whatItMeans,
      recommendedActions: json.recommendedActions,
      referralUrgency: json.referralUrgency,
      extractedGrade: json.extractedGrade ?? 'unknown',
      language,
      modelVersion: result.modelVersion,
      generatedAt: new Date(),
    };
  } catch (err) {
    logger.error({ err: err?.message }, 'eye report explanation failed');
    return null;
  }
}

/**
 * Reads a photograph of a prescription and extracts its medicines as structured
 * data, so the patient's reminders can be built from a picture instead of by
 * hand.
 *
 * Deliberately conservative: it transcribes only what is legibly written and
 * never invents a medicine, dose, or timing. Dose accuracy is the patient's and
 * doctor's to confirm — the reminders this feeds are about *when* to take a
 * medicine, and the patient always has the paper prescription to check against.
 */
const PRESCRIPTION_SCHEMA = {
  type: 'object',
  properties: {
    readable: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          strength: { type: 'string' },
          dose: { type: 'string' },
          // "1-0-1", "1-1-1", "OD", "BD", "TDS" — kept as written.
          frequency: { type: 'string' },
          // The timing exactly as the doctor wrote it, transcribed rather than
          // interpreted: "AF Lunch", "A Dinner", "before meal", "10 AM".
          //
          // Its own field because `frequency` is defined as how OFTEN, so a
          // model filling that in returns "OD" and discards the word "Lunch" —
          // and the meal is the half that decides what hour the alarm rings.
          // Every timing on the prescription this was built from lived in that
          // discarded half, and all four medicines were scheduled for 08:00.
          whenText: { type: 'string' },
          durationDays: { type: 'integer' },
          relationToMeal: { type: 'string', enum: ['before_meal', 'after_meal', 'with_meal', 'any'] },
          instructions: { type: 'string' },
        },
        required: ['name'],
      },
    },
    // Who the prescription was written FOR, as printed on it.
    //
    // Read so it can be checked, never so it can be used. The clinic files
    // paper prescriptions onto records by hand, and the one mistake that
    // matters is filing this patient's slip onto that patient's chart — a
    // wrong medicine list on a diabetic's record, invisible until it does
    // harm. The name comes back so the desk can be shown a mismatch; nothing
    // downstream ever resolves a patient from it.
    patient: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'string' },
        sex: { type: 'string' },
      },
    },
    // The rest of the page, beside the medicine lines.
    //
    // Kept out of `items` deliberately: a diagnosis is not a drug, and a lab
    // test advised is not one either. They were simply discarded before, which
    // is why a filed prescription showed the desk a photograph and nothing it
    // could read without opening it.
    diagnosis: { type: 'array', items: { type: 'string' } },
    labTests: { type: 'array', items: { type: 'string' } },
    advice: { type: 'string' },
    // The letterhead, read as a label rather than as a decision. Everything
    // here is optional: a handwritten slip with no letterhead is still a
    // perfectly good prescription, and a guessed doctor is worse than none.
    prescriber: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        speciality: { type: 'string' },
        clinic: { type: 'string' },
        writtenOn: { type: 'string' },
      },
    },
    note: { type: 'string' },
  },
  required: ['readable', 'items'],
};

export async function extractPrescription({ images, practiceId = null }) {
  if (!images?.length) return null;

  // Deliberately does NOT say whose prescription this is.
  //
  // It used to open "prescriptions written by Dr. ..., a Consultant
  // Diabetologist", which is an assertion about the photograph rather than an
  // instruction about reading it — and a patient photographs prescriptions from
  // any doctor they have seen. Telling the model the author in advance biases
  // what it expects to find, and is simply untrue for the cardiologist's slip.
  const system = `You transcribe photographs of medical prescriptions into structured medicine data. The prescription may have been written by any doctor the patient has seen — do not assume a specialty.

Strict rules:
- Extract ONLY what is clearly legible. Never invent a medicine, dose, strength, or timing. If a field is not written, omit it.
- "frequency" is how often per day. Keep the notation the prescription uses: Indian "1-0-1" (morning-noon-night), "1-1-1", "0-0-1", "1-0-1-0", or shorthand (OD, BD, TDS, QID) or words (once/twice/thrice daily).
- "whenText": the timing EXACTLY as written, copied not interpreted — "1 tab each AF Lunch", "1 tab A Dinner", "1 tab before meal", "1 tab each 10 AM". Include the meal or the hour if either is written. This is the most important field on the line after the medicine name: it is what decides when the patient's alarm rings, and "frequency" above deliberately does not carry it.
- "relationToMeal": before_meal (BF / before food / खाली পেটে), after_meal (AF / after food / খাবারের পরে), with_meal, or any.
- "durationDays": the number of days if written, e.g. "x 5 days" -> 5, "1 week" -> 7.
- Read the medicine lines (usually after the ℞ / Rx symbol) for "items", and ONLY those lines. A diagnosis is not a medicine and neither is an advised test.
- Read the patient's own details into "patient": the name exactly as printed, their age and sex if written. This is used to check the prescription is being filed onto the right person's record, so copy it and never guess — an omitted name is safe, an invented one is not.
- Read any diagnosis into "diagnosis" (one entry per condition), any investigations or blood tests advised into "labTests" (one entry each), and the general instructions — diet, exercise, follow-up, "review after 2 weeks" — into "advice".
- Also read the letterhead, if there is one, into "prescriber": the doctor's name, their speciality as printed, the clinic name, and the date written. Omit any of these you cannot read — a guessed doctor is worse than a blank one. This is recorded as a label so the patient and their doctors can see where a medicine came from; it never decides which medicines are kept.
- Extract EVERY medicine on the prescription, whatever it is for. Never leave one out because it looks unrelated to diabetes: a complete list is what makes interactions visible, and the medicine another specialist added is the one most worth knowing about.
- ONE ITEM PER DRUG. A line joining two drugs with "+" is two medicines, and both must be returned. "Teneligliptin (20) + MF500(SR) — 1 tab each AF Lunch" is two items, each with its own name and strength, and BOTH carry the line's timing. Returning only the first is how a patient ends up with no reminder for the second, which on a diabetes prescription is usually the metformin.
- An "=" is not a join. "Teneligliptin + MF500 = GIP2 + MF500" is the doctor naming the generics and then the brands to dispense — the same two medicines twice. Take the names before the "=" and ignore the rest of that line; returning both halves doubles the prescription.
- A single branded combination written as one name — "Glycomet GP2", "Janumet" — is ONE medicine however many drugs it contains. Only an explicit "+" between two names means two tablets.
- "strength" is the amount ONLY: "20mg", "500mg SR", "40". Never put the dose, the timing, another drug's name or a whole prescription line in it. If a drug's strength is welded into its name as the doctor's shorthand ("MF500"), leave the name exactly as written and omit strength rather than prising it apart.
- If the photo is blurry, is not a prescription, or the medicines cannot be read, set readable=false and items=[]. Do not guess to be helpful — a wrong medicine name is worse than none.`;

  const prompt = 'Extract every medicine from this prescription photograph as JSON. If it cannot be read, set readable=false and return no items.';

  const result = await generateFromImage({ system, prompt, images, responseSchema: PRESCRIPTION_SCHEMA });
  // Metered after the call: a failed request cost the practice nothing.
  // Tokens and a per-kind count, never the reply allowance — see allowance.js.
  countAiCall(practiceId, 'prescription', result?.usage);
  const json = result?.json;
  if (!json) return { readable: false, items: [] };
  return {
    readable: json.readable !== false,
    items: Array.isArray(json.items) ? json.items : [],
    patient: json.patient ?? null,
    diagnosis: Array.isArray(json.diagnosis) ? json.diagnosis : [],
    labTests: Array.isArray(json.labTests) ? json.labTests : [],
    advice: json.advice ?? null,
    prescriber: json.prescriber ?? null,
    note: json.note ?? null,
    modelVersion: result.modelVersion,
  };
}
