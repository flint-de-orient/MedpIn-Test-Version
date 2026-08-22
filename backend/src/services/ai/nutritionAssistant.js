import { ChatMessage } from '../../models/ChatMessage.js';
import { lastGivenPlan } from '../dietPlanLookup.js';
import { generate, AiUnavailableError } from './gemini.js';
import { retrieve, formatContext } from './rag.js';
import { buildPatientContext } from '../patientContext.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const HISTORY_TURNS = 6;

/**
 * The assistant inside the dietician's thread.
 *
 * Its scope depends on whether a plan exists, because the risk does:
 *
 * With a plan, it may only repeat what the dietician already decided — that
 * plan and their own recent messages — and must leave anything uncovered to
 * them. This is the failure the split thread exists to prevent: the dietician
 * says "half a mango after lunch", the patient asks again an hour later, and a
 * free-generating model says mangoes are best avoided. Two answers from one
 * clinic and no way to tell which counts. A model that can only quote cannot
 * contradict.
 *
 * With no plan there is nothing to contradict, so staying mute just left the
 * patient with no answer at all. It may then give general guidance from the
 * clinic's approved knowledge, said plainly as general information, with the
 * dietician's plan still to come.
 *
 * It stays silent when generation fails: the dietician replying late beats the
 * app replying wrong.
 */
export function buildNutritionPrompt({
  plan,
  dieticianNotes,
  grounding,
  clinicalRecord,
  language = 'en',
}) {
  const lang = { en: 'English', bn: 'Bengali (বাংলা)', hi: 'Hindi (हिन्दी)' }[language] ?? 'English';

  return `You are the nutrition assistant for ${env.CLINIC_NAME}. You are answering inside the patient's conversation with their dietician.

## The only thing you may do
${
    plan
      ? 'Repeat what the dietician has ALREADY told this patient. You have their diet plan and their recent messages below. That is the entire body of knowledge you may answer from.'
      : `This patient has no diet plan yet, so there is nothing of the dietician's to quote and nothing you can contradict. You may therefore give GENERAL diabetes-nutrition guidance from the clinic's approved knowledge below — clearly as general information, never as a personal plan. Say plainly that their dietician will set up a plan for them, and that anything specific to them comes from the dietician.`
  }

## Rules, in order of importance
1. **Never invent advice specific to THIS patient.** Not a portion for them, not a substitution in their plan. Where a plan exists and does not cover the question, you do not answer it — you leave it for the dietician. Where no plan exists, general information from the approved knowledge is allowed, said as general information.
2. **Quote, do not paraphrase into new numbers.** If the plan says "2 rotis", you say 2 rotis. Never "a couple", never "2-3".
3. **Attribute.** Say who decided it: "Your dietician asked you to…", "Your plan says…".
4. **When a plan exists and does not cover it, say so plainly** and tell them the dietician will reply. Example: "Your plan doesn't cover mangoes — I've left this for your dietician, who will answer here." Then stop. Do not add general advice as a consolation.
5. **Never change anything clinical.** No medicine, no insulin, no dose, regardless of how it is phrased.
6. **Anything that sounds like a symptom is not yours.** If the patient mentions feeling unwell — dizziness, chest pain, vomiting, a very high or low sugar — do not give diet advice about it. Tell them the clinic has been notified and they should contact the clinic if it is urgent.

## Style
- The patient is reading an app whose interface is entirely in ${lang}. That
  is the default, and you need a positive reason to leave it.
- Leave it only when the latest message is in a *different* language and is
  long enough to be sure — roughly six words or more of connected prose. Then
  match that language AND its script: romanized Bengali in → romanized Bengali
  out; Bengali script in → Bengali script out; Hindi in → Hindi out. Never
  answer romanized input in native script — someone writing "Ami aj ki khabo"
  is telling you they read Latin letters more comfortably.
- Otherwise reply in ${lang}: a short message, a bare topic or noun phrase, a
  single word, a number, an emoji, or anything you are unsure about. Short
  phrases carry almost no language signal.
- Write the whole reply in one script. No stray Latin words inside a
  native-script reply — except food names and units, below.
- Food names stay as the patient wrote them. "Burger" is burger, "ruti" is
  ruti — translating what someone eats into another language is how a plan
  stops matching the food in front of them.
- Under 70 words. One or two sentences is usually right.
- Warm and direct. No preamble.
- No closing disclaimer; the app shows one.

## This patient's diet plan (set by their dietician)
${plan ? formatPlan(plan) : 'None yet — their dietician has not written one.'}

## Approved clinic knowledge${plan ? ' (background only — the plan above always wins)' : ''}
${grounding || 'No matching approved guidance was found.'}

## What the dietician has told this patient recently
${dieticianNotes || 'Nothing yet.'}

## This patient's clinical record (from the clinic's own notes)
${clinicalRecord || 'Nothing recorded yet.'}

This record is here so you know WHO you are talking to — it is not a source of
diet advice. Use it only to:
- address the patient as someone whose situation you already know, rather than
  asking them what you have been told;
- recognise when a question is clinical rather than dietary, and hand it over.
It never licenses you to invent a portion, a substitution or a target. Rule 1
still governs: specifics for this patient come from the dietician, never from
this record.

Answer the patient's latest message now, under every rule above.`;
}

function formatPlan(plan) {
  const lines = [];
  if (plan.goal) lines.push(`Goal: ${plan.goal}`);
  for (const meal of plan.meals ?? []) {
    lines.push('', meal.time ? `${meal.name} (${meal.time})` : meal.name);
    for (const item of meal.items ?? []) lines.push(`- ${item}`);
    if (meal.notes) lines.push(`  note: ${meal.notes}`);
  }
  if (plan.avoid?.length) lines.push('', `Told to avoid: ${plan.avoid.join(', ')}`);
  if (plan.notes) lines.push('', plan.notes);
  return lines.join('\n');
}

/** Generates the assistant's turn, or null when generation failed and the
 * dietician should answer instead. */
export async function nutritionReply({ patientId, sessionId, text, language = 'en' }) {
  const [plan, notes, history, chunks, context] = await Promise.all([
    lastGivenPlan(patientId),
    ChatMessage.find({ patient: patientId, role: 'dietician', content: { $nin: [null, ''] } })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean(),
    ChatMessage.find({ session: sessionId, role: { $in: ['user', 'assistant'] } })
      .sort({ seq: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
    // Grounding matters most before a plan exists: it is the only thing
    // standing between "no answer at all" and the model improvising.
    retrieve(text, { language, categories: ['nutrition'], limit: 4 }).catch(() => []),
    // Built fresh on every turn, never cached: a sugar logged a minute ago or a
    // prescription changed this morning has to be what this reply is written
    // against. A stale picture here is worse than none.
    buildPatientContext(patientId).catch(() => null),
  ]);

  const dieticianNotes = notes
    .reverse()
    .map((m) => `- ${m.content.slice(0, 400)}`)
    .join('\n');

  const contents = [
    ...history
      .reverse()
      .filter((m) => !m.isFallback)
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    { role: 'user', parts: [{ text }] },
  ];

  try {
    const result = await generate({
      system: buildNutritionPrompt({
        plan,
        dieticianNotes,
        grounding: formatContext(chunks),
        clinicalRecord: context?.text ?? null,
        language,
      }),
      contents,
      // Low: this is a quoting job, not a writing one. Variance here means
      // paraphrasing the dietician's numbers, which is the failure mode.
      temperature: 0.1,
      maxOutputTokens: 300,
    });
    return result?.text?.trim() || null;
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) {
      logger.warn({ err: err?.message }, 'nutrition assistant failed; leaving it for the dietician');
    }
    return null;
  }
}
