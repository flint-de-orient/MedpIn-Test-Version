import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

/**
 * Medical safety settings.
 *
 * Gemini's default DANGEROUS_CONTENT filter blocks legitimate clinical
 * discussion — insulin dosing, overdose symptoms, self-harm risk assessment.
 * Blocking those would leave a patient in crisis with no answer, which is the
 * more dangerous failure. Harassment and hate remain at default thresholds.
 */
const SAFETY_SETTINGS = [
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_ONLY_HIGH },
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];

export class AiUnavailableError extends Error {
  constructor(cause) {
    super('AI service unavailable');
    this.cause = cause;
    this.expected = true;
  }
}

function isRetryable(err) {
  const status = err?.status ?? err?.response?.status;
  if (status === 429 || status === 503 || status === 500) return true;
  return /fetch failed|ECONNRESET|ETIMEDOUT|network/i.test(err?.message ?? '');
}

async function withRetry(fn, { attempts = 3, baseDelayMs = 400, label = 'gemini' } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || i === attempts - 1) break;
      const delay = baseDelayMs * 2 ** i;
      logger.warn({ label, attempt: i + 1, delay }, 'retrying gemini call');
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/**
 * Single-shot generation with an optional structured-output schema.
 *
 * @param {object} opts
 * @param {string} opts.system system instruction
 * @param {Array} opts.contents chat contents ([{role, parts}])
 * @param {object} [opts.responseSchema] when set, forces JSON output
 * @param {string} [opts.model]
 */
/**
 * Models observed to reject `thinkingConfig` with a 400.
 *
 * Learned once per process rather than hard-coded, because the set changes as
 * Google ships model aliases — `gemini-2.5-flash` accepts it, the moving
 * `gemini-flash-latest` alias currently does not.
 */
const MODELS_REJECTING_THINKING = new Set();

export async function generate({
  system,
  contents,
  responseSchema,
  model = env.GEMINI_CHAT_MODEL,
  temperature = 0.3,
  maxOutputTokens = 1600,
  thinkingBudget = 0,
}) {
  const started = Date.now();

  const baseConfig = {
    temperature,
    ...(responseSchema ? { responseMimeType: 'application/json', responseSchema } : {}),
  };

  // Gemini 2.5 models are "thinking" models: their internal reasoning tokens
  // are charged against maxOutputTokens. Left on the default dynamic budget, a
  // long system prompt plus RAG context lets thinking consume the whole
  // allowance and the patient receives an answer truncated mid-sentence
  // (finishReason MAX_TOKENS). Patient guidance needs to be short, fast and
  // complete, not deeply reasoned, so thinking is capped by default.
  //
  // But model variants disagree: gemini-2.5-flash accepts thinkingBudget: 0,
  // while gemini-flash-latest rejects it with a 400. So this is an *attempt* —
  // if the model refuses the thinking config, `runOnce` retries without it and
  // relies on a generous token budget to absorb the thinking instead.
  const withThinking = {
    ...baseConfig,
    maxOutputTokens,
    thinkingConfig: { thinkingBudget },
  };
  const withoutThinking = {
    ...baseConfig,
    // No thinking cap means thinking tokens are unbounded and eat into the
    // budget, so give the answer generous headroom on top.
    maxOutputTokens: Math.max(maxOutputTokens, 2400),
  };

  const runOnce = async (generationConfig) => {
    const client = genAI.getGenerativeModel({
      model,
      systemInstruction: system,
      safetySettings: SAFETY_SETTINGS,
      generationConfig,
    });
    return withRetry(() => client.generateContent({ contents }), { label: model });
  };

  const isInvalidThinkingArg = (err) => {
    const status = err?.status ?? err?.response?.status;
    return status === 400 && /invalid argument|thinking/i.test(err?.message ?? '');
  };

  try {
    let result;
    if (MODELS_REJECTING_THINKING.has(model)) {
      // Already learned that this model refuses it — go straight to the config
      // that works rather than spending a doomed round trip first.
      result = await runOnce(withoutThinking);
    } else {
      try {
        result = await runOnce(withThinking);
      } catch (err) {
        if (!isInvalidThinkingArg(err)) throw err;
        // Whether a model accepts thinkingConfig is a fixed property of the
        // model, so remember it. Without this every single reply paid for a
        // 400 before the real request — the largest avoidable latency in the
        // whole chat path.
        MODELS_REJECTING_THINKING.add(model);
        logger.warn({ model }, 'model rejects thinkingConfig; skipping it from now on');
        result = await runOnce(withoutThinking);
      }
    }

    const response = result.response;

    const blockReason = response.promptFeedback?.blockReason;
    if (blockReason) {
      logger.warn({ blockReason }, 'gemini blocked the prompt');
      throw new AiUnavailableError(new Error(`blocked: ${blockReason}`));
    }

    const text = response.text();
    if (!text?.trim()) throw new AiUnavailableError(new Error('empty response'));

    // A reply cut off mid-sentence is worse than no reply in a clinical
    // setting — the patient may act on half an instruction. Treat it as a
    // failure so the caller falls back to the scripted safe answer.
    const finishReason = response.candidates?.[0]?.finishReason;
    if (finishReason === 'MAX_TOKENS') {
      logger.error(
        {
          model,
          maxOutputTokens,
          thinkingBudget,
          thoughtsTokens: response.usageMetadata?.thoughtsTokenCount,
        },
        'gemini response truncated at the token limit',
      );
      throw new AiUnavailableError(new Error('response truncated (MAX_TOKENS)'));
    }

    return {
      text,
      finishReason,
      json: responseSchema ? safeParseJson(text) : null,
      modelVersion: model,
      latencyMs: Date.now() - started,
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount,
        responseTokens: response.usageMetadata?.candidatesTokenCount,
      },
    };
  } catch (err) {
    if (err instanceof AiUnavailableError) throw err;
    logger.error({ err: err?.message, model }, 'gemini generation failed');
    throw new AiUnavailableError(err);
  }
}

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    // Occasionally the model wraps JSON in a fence despite responseMimeType.
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {
        /* fall through */
      }
    }
    logger.warn('failed to parse structured gemini output');
    return null;
  }
}

/** Embeds text for RAG. Returns a plain number[]. */
export async function embed(text, { taskType = 'RETRIEVAL_DOCUMENT', title } = {}) {
  const client = genAI.getGenerativeModel({ model: env.GEMINI_EMBED_MODEL });
  const result = await withRetry(
    () =>
      client.embedContent({
        content: { parts: [{ text }], role: 'user' },
        taskType,
        ...(title ? { title } : {}),
      }),
    { label: 'embed' },
  );
  return result.embedding.values;
}

/**
 * Streams the reply text chunk by chunk, so the app can show words as they are
 * generated instead of waiting for the whole answer. Yields plain text pieces.
 *
 * Safety is unchanged: the caller runs triage and raises any alert BEFORE
 * calling this, so escalation never waits on the stream.
 */
/**
 * The streaming sibling of `generate`, and what it costs.
 *
 * ---- `onUsage`, and why it is a callback -------------------------------
 *
 * A generator that yields strings cannot also return a number, and this is the
 * highest-volume path in the product — every patient message the app sends.
 * It reported nothing at all, so the recorded token spend was missing its
 * largest single contributor and nobody could see the shape of the gap.
 *
 * The SDK exposes the aggregate response only once the stream is finished,
 * which is why this is a callback rather than a return value.
 *
 * Written here rather than beside the parameter: a doc comment inside a
 * destructured parameter list merges with the binding after it as far as
 * `noMissingHelpers.test.js` is concerned, and `onUsage` then reads as a
 * function nothing defines.
 */
export async function* generateStream({
  system,
  contents,
  model = env.GEMINI_CHAT_MODEL,
  temperature = 0.3,
  maxOutputTokens = 600,
  onUsage,
}) {
  const generationConfig = MODELS_REJECTING_THINKING.has(model)
    ? { temperature, maxOutputTokens: Math.max(maxOutputTokens, 2400) }
    : { temperature, maxOutputTokens, thinkingConfig: { thinkingBudget: 0 } };

  const run = () => {
    const client = genAI.getGenerativeModel({
      model,
      systemInstruction: system,
      safetySettings: SAFETY_SETTINGS,
      generationConfig,
    });
    return client.generateContentStream({ contents });
  };

  let result;
  try {
    result = await withRetry(run, { label: `${model}:stream` });
  } catch (err) {
    if (isInvalidThinkingArg(err) && !MODELS_REJECTING_THINKING.has(model)) {
      MODELS_REJECTING_THINKING.add(model);
      logger.warn({ model }, 'model rejects thinkingConfig on stream; retrying without it');
      const client = genAI.getGenerativeModel({
        model,
        systemInstruction: system,
        safetySettings: SAFETY_SETTINGS,
        generationConfig: { temperature, maxOutputTokens: Math.max(maxOutputTokens, 2400) },
      });
      result = await client.generateContentStream({ contents });
    } else {
      throw new AiUnavailableError(err);
    }
  }

  try {
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  } catch (err) {
    throw new AiUnavailableError(err);
  }

  /*
   * Reported after the text, and never allowed to fail the call.
   *
   * The reply has already reached the patient by this point. A provider that
   * omits `usageMetadata`, or an aggregate response that rejects, is a figure
   * nobody gets — not a message nobody gets.
   */
  if (onUsage) {
    try {
      const final = await result.response;
      onUsage({
        promptTokens: final?.usageMetadata?.promptTokenCount,
        responseTokens: final?.usageMetadata?.candidatesTokenCount,
      });
    } catch (err) {
      logger.warn({ err: err?.message, model }, 'stream finished without reporting usage');
    }
  }
}

export async function generateFromImage({ system, prompt, images, responseSchema, model = env.GEMINI_VISION_MODEL }) {
  const parts = [
    { text: prompt },
    ...images.map((img) => ({
      inlineData: { mimeType: img.mimeType, data: img.base64 },
    })),
  ];
  return generate({
    system,
    contents: [{ role: 'user', parts }],
    responseSchema,
    model,
    temperature: 0.2,
  });
}
