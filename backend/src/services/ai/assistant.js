import { ChatSession } from '../../models/ChatSession.js';
import { ChatMessage } from '../../models/ChatMessage.js';
import { triageMessage } from '../triage/engine.js';
import { buildPatientContext } from '../patientContext.js';
import { retrieve, formatContext } from './rag.js';
import { generate, generateStream, AiUnavailableError } from './gemini.js';
import { buildSystemPrompt, fallbackReply } from './prompts.js';
import { raiseAlert } from '../alerts.js';
import { loadAssetsForAi } from '../../routes/uploads.js';
import { resolveVoiceText } from '../voiceText.js';
import { logger } from '../../config/logger.js';
import { maxUrgency } from '../triage/thresholds.js';
import { env } from '../../config/env.js';

const HISTORY_TURNS = 8;

/** How many recent doctor/dietician messages are carried into the prompt. */
const CARE_TEAM_NOTES = 6;

/** Each is trimmed to this, so one long note cannot crowd out the rest. */
const CARE_TEAM_NOTE_CHARS = 400;

/**
 * The doctor's and dietician's own messages to this patient.
 *
 * These are deliberately NOT put into `contents` alongside the chat turns.
 * Gemini only accepts `user` and `model` roles, so a clinician's message would
 * have to be labelled as one or the other — and labelling it `model` lets the
 * assistant treat a doctor's instruction as its own earlier output, free to
 * extend or paraphrase. Carrying them as authoritative context in the system
 * prompt instead means the model can quote them but cannot speak as them.
 *
 * Scoped by patient rather than by session: care is one continuous story, and
 * an instruction given last week still stands this week.
 */
async function loadCareTeamNotes(patientId) {
  const notes = await ChatMessage.find({
    patient: patientId,
    role: { $in: ['clinician', 'dietician'] },
    content: { $nin: [null, ''] },
  })
    .sort({ createdAt: -1 })
    .limit(CARE_TEAM_NOTES)
    .populate('sender', 'name')
    .lean();

  if (notes.length === 0) return '';

  return notes
    .reverse()
    .map((m) => {
      const who = m.role === 'dietician' ? 'Dietician' : 'Doctor';
      const name = m.sender?.name ? ` (${m.sender.name})` : '';
      const when = m.createdAt ? m.createdAt.toISOString().slice(0, 10) : '';
      const body = m.content.length > CARE_TEAM_NOTE_CHARS
        ? `${m.content.slice(0, CARE_TEAM_NOTE_CHARS)}…`
        : m.content;
      return `- ${when} ${who}${name}: ${body}`;
    })
    .join('\n');
}

/**
 * Defensively strip a disclaimer the model may still append despite the prompt
 * telling it not to. The app owns the single footer disclaimer; anything the
 * model adds is a duplicate. Matches a trailing line that opens with an em- or
 * en-dash and mentions "AI" guidance, in any of the three languages.
 */
function stripTrailingDisclaimer(text) {
  return text
    .replace(/\n+\s*[â€”â€“-]\s*(This is |à¦à¦Ÿà¦¿|à¤¯à¤¹)[\s\S]*$/u, '')
    .trim();
}

/** Maps triage findings to the knowledge categories worth retrieving. */
function categoriesFor(triage) {
  const cats = new Set();
  for (const rule of triage.matchedRules) {
    if (rule.startsWith('GL_SEVERE_HYPO') || rule === 'GL_HYPO') cats.add('hypoglycaemia');
    if (rule.startsWith('GL_CRITICAL') || rule === 'GL_VERY_HIGH') cats.add('hyperglycaemia');
    if (rule.startsWith('RF_FOOT')) cats.add('foot_care');
    if (rule.startsWith('RF_VISION')) cats.add('eye_care');
    if (rule.startsWith('BP_')) cats.add('hypertension');
    if (rule === 'RF_MISSED_INSULIN') cats.add('insulin');
    if (rule === 'RF_DKA') cats.add('sick_day_rules');
    if (rule === 'RF_CHEST_PAIN' || rule === 'RF_BREATHING' || rule === 'RF_STROKE') cats.add('emergency');
  }
  return [...cats];
}

/**
 * Handles one patient turn end to end.
 *
 * Order is deliberate and load-bearing:
 *   1. persist the patient's message (never lose it, even if everything else fails)
 *   2. triage deterministically
 *   3. escalate immediately if it is an emergency â€” before any model call, so a
 *      Gemini outage cannot delay the clinic being paged
 *   4. retrieve grounding, then generate
 *   5. fall back to a written emergency script if generation fails
 */
export async function handlePatientMessage({ patientId, sessionId, text, language = 'en', attachments = [], replyTo }) {
  // A voice-only message carries no typed text; use the words transcribed at
  // upload so triage and the assistant answer what was actually said.
  text = await resolveVoiceText(text, attachments);
  const session = await resolveSession({ patientId, sessionId, language, text });

  const context = await buildPatientContext(patientId);

  const triage = triageMessage({
    text,
    targets: context.targets,
    latestGlucose: context.latestGlucose,
  });

  const seq = session.messageCount + 1;
  const userMessage = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq,
    role: 'user',
    content: text,
    language,
    attachments,
    replyTo: replyTo ?? undefined,
    triage: {
      urgency: triage.urgency,
      matchedRules: triage.matchedRules,
      redFlags: triage.redFlags.map((r) => r.label),
      ruleDriven: triage.ruleDriven,
    },
  });

  // Populate the quoted turn so the send response carries its text preview.
  if (replyTo) await userMessage.populate('replyTo', 'content role');
  // Populate so serialiseMessage can tell a voice note from a photo — otherwise
  // the just-sent recording renders as a broken image thumbnail.
  if (attachments.length) await userMessage.populate('attachments', 'kind mimeType transcript originalName sizeBytes');

  // Escalate before generating. The clinic learns about a chest-pain message
  // whether or not the model ever responds.
  let alert = null;
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') {
    alert = await raiseAlert({
      patientId,
      severity: triage.urgency === 'emergency' ? 'emergency' : 'urgent',
      type: triage.alertType ?? 'chat_escalation',
      title: triage.redFlags[0]?.label ?? triage.findings[0]?.summary ?? 'Patient reported a concerning symptom',
      detail: `Patient message: "${text.slice(0, 500)}"\n\nTriage findings:\n${triage.findings.map((f) => `- ${f.summary}`).join('\n')}`,
      source: { kind: 'chat', ref: userMessage._id },
      matchedRules: triage.matchedRules,
    });
    await ChatMessage.findByIdAndUpdate(userMessage._id, { alert: alert._id });
  }

  // Retrieve grounding + prior turns + the care team's own words, in parallel.
  const [chunks, history, careTeamNotes] = await Promise.all([
    retrieve(text, { language, categories: categoriesFor(triage), limit: 6 }).catch((err) => {
      logger.warn({ err: err?.message }, 'retrieval failed; answering without grounding');
      return [];
    }),
    ChatMessage.find({ session: session._id, seq: { $lt: seq } })
      .sort({ seq: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
    loadCareTeamNotes(patientId).catch(() => ''),
  ]);

  // If the patient attached photos, load them so the assistant can actually
  // look at them. Without this the image is stored but never seen, and the
  // reply is "I can't tell without knowing what you ate" â€” which reads as the
  // photo being ignored.
  const images = attachments.length ? await loadAssetsForAi(attachments).catch(() => []) : [];
  // Exactly what the patient typed, and nothing else. An instruction appended
  // here was read as part of the message: a Bengali sentence followed by an
  // English directive looked like garbled input, and the assistant told a
  // patient who had asked a perfectly clear clinical question that it could
  // not understand them. The language rule lives in the system prompt instead.
  const userParts = [{ text }, ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } }))];

  const contents = [
    ...history
      .reverse()
      // Never feed the model its own scripted fallback replies: once an
      // "assistant unavailable" message is in the thread, the model parrots it
      // for the same prompt (e.g. every "hi") instead of answering.
      // Clinician and dietician turns are deliberately absent here — they are
      // carried in the system prompt instead, so the model can quote them
      // without being able to speak as the doctor. See loadCareTeamNotes.
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isFallback)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: userParts },
  ];

  const system = buildSystemPrompt({
    language,
    triage,
    patientContext: context.text,
    careTeamNotes,
    groundingContext: formatContext(chunks),
  });

  let replyText;
  let isFallback = false;
  let modelVersion = null;
  let latencyMs = null;
  let usage = {};

  try {
    const result = await generate({
      system,
      contents,
      temperature: triage.urgency === 'emergency' ? 0.1 : 0.3,
      // Shorter cap: patient replies should be tight, and a smaller ceiling
      // discourages the model from padding.
      maxOutputTokens: 600,
      // Use the vision model when there are images so it can read them.
      model: images.length ? env.GEMINI_VISION_MODEL : undefined,
    });
    replyText = stripTrailingDisclaimer(result.text.trim());
    modelVersion = result.modelVersion;
    latencyMs = result.latencyMs;
    usage = result.usage;
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    logger.error({ err: err.cause?.message }, 'assistant generation failed; using scripted fallback');
    // In an emergency the scripted emergency text is what matters, not an
    // apology about the service being down.
    replyText = fallbackReply(triage.urgency === 'emergency' ? 'emergency' : 'unavailable', language);
    isFallback = true;
  }

  // No disclaimer is appended to the content: the app already renders one
  // footer line under every assistant reply, and appending here produced a
  // duplicate (sometimes triple, when the model added its own too).
  const assistantMessage = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq: seq + 1,
    role: 'assistant',
    content: replyText,
    language,
    triage: {
      urgency: triage.urgency,
      matchedRules: triage.matchedRules,
      redFlags: triage.redFlags.map((r) => r.label),
      ruleDriven: triage.ruleDriven,
    },
    // Cap at 3: six full-width source chips buried the answer off-screen.
    // Retrieval still uses the full set for grounding; this only trims what
    // the patient sees.
    citations: chunks.slice(0, 3).map((c) => ({ chunk: c._id, title: c.title, score: c.score })),
    modelVersion,
    latencyMs,
    tokenUsage: usage,
    isFallback,
    alert: alert?._id,
  });

  session.messageCount = seq + 1;
  session.lastMessageAt = new Date();
  session.highestUrgency = maxUrgency(session.highestUrgency, triage.urgency);
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') session.flaggedForReview = true;
  await session.save();

  return {
    sessionId: session._id,
    userMessage: serialiseMessage(userMessage),
    reply: serialiseMessage(assistantMessage),
    triage: {
      urgency: triage.urgency,
      ruleDriven: triage.ruleDriven,
      redFlags: triage.redFlags,
      findings: triage.findings.map((f) => f.summary),
      extracted: triage.extracted,
    },
    alert: alert
      ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title }
      : null,
    citations: chunks.slice(0, 3).map((c) => ({ id: c._id, title: c.title, source: c.sourceCitation ?? null })),
  };
}

/**
 * Streaming variant of {@link handlePatientMessage}: yields events for an SSE
 * response so the app renders the reply as it is generated.
 *
 * The safety order is identical â€” triage runs and any alert is raised BEFORE
 * the first token â€” so streaming never delays escalation. The `meta` event
 * carries the triage verdict and alert, so the emergency card can appear before
 * a single word of the reply.
 *
 * Events: `meta` (verdict, user message, citations) â†’ many `token` (text
 * pieces) â†’ optional `replace` (swap the partial for scripted fallback text on
 * failure) â†’ `done` (the saved assistant message).
 */
export async function* streamPatientMessage({ patientId, sessionId, text, language = 'en', attachments = [], replyTo }) {
  const session = await resolveSession({ patientId, sessionId, language, text });
  const context = await buildPatientContext(patientId);
  const triage = triageMessage({ text, targets: context.targets, latestGlucose: context.latestGlucose });

  const seq = session.messageCount + 1;
  const userMessage = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq,
    role: 'user',
    content: text,
    language,
    attachments,
    replyTo: replyTo ?? undefined,
    triage: {
      urgency: triage.urgency,
      matchedRules: triage.matchedRules,
      redFlags: triage.redFlags.map((r) => r.label),
      ruleDriven: triage.ruleDriven,
    },
  });

  // Populate the quoted turn so the send response carries its text preview.
  if (replyTo) await userMessage.populate('replyTo', 'content role');
  // Populate so serialiseMessage can tell a voice note from a photo — otherwise
  // the just-sent recording renders as a broken image thumbnail.
  if (attachments.length) await userMessage.populate('attachments', 'kind mimeType transcript originalName sizeBytes');

  // Escalate BEFORE the first token â€” the clinic learns about a chest-pain
  // message whether or not any reply is ever generated.
  let alert = null;
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') {
    alert = await raiseAlert({
      patientId,
      severity: triage.urgency === 'emergency' ? 'emergency' : 'urgent',
      type: triage.alertType ?? 'chat_escalation',
      title: triage.redFlags[0]?.label ?? triage.findings[0]?.summary ?? 'Patient reported a concerning symptom',
      detail: `Patient message: "${text.slice(0, 500)}"\n\nTriage findings:\n${triage.findings.map((f) => `- ${f.summary}`).join('\n')}`,
      source: { kind: 'chat', ref: userMessage._id },
      matchedRules: triage.matchedRules,
    });
    await ChatMessage.findByIdAndUpdate(userMessage._id, { alert: alert._id });
  }

  const [chunks, history, careTeamNotes] = await Promise.all([
    retrieve(text, { language, categories: categoriesFor(triage), limit: 6 }).catch(() => []),
    ChatMessage.find({ session: session._id, seq: { $lt: seq } })
      .sort({ seq: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
    loadCareTeamNotes(patientId).catch(() => ''),
  ]);

  const images = attachments.length ? await loadAssetsForAi(attachments).catch(() => []) : [];
  // Exactly what the patient typed, and nothing else. An instruction appended
  // here was read as part of the message: a Bengali sentence followed by an
  // English directive looked like garbled input, and the assistant told a
  // patient who had asked a perfectly clear clinical question that it could
  // not understand them. The language rule lives in the system prompt instead.
  const userParts = [{ text }, ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } }))];
  const contents = [
    ...history
      .reverse()
      // Never feed the model its own scripted fallback replies: once an
      // "assistant unavailable" message is in the thread, the model parrots it
      // for the same prompt (e.g. every "hi") instead of answering.
      //
      // Clinician and dietician turns are absent here too — carried in the
      // system prompt instead. See loadCareTeamNotes.
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isFallback)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    { role: 'user', parts: userParts },
  ];
  const system = buildSystemPrompt({
    language,
    triage,
    patientContext: context.text,
    careTeamNotes,
    groundingContext: formatContext(chunks),
  });

  yield {
    type: 'meta',
    data: {
      sessionId: session._id,
      userMessage: serialiseMessage(userMessage),
      triage: {
        urgency: triage.urgency,
        ruleDriven: triage.ruleDriven,
        redFlags: triage.redFlags,
        findings: triage.findings.map((f) => f.summary),
        extracted: triage.extracted,
      },
      alert: alert ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title } : null,
      citations: chunks.slice(0, 3).map((c) => ({ id: c._id, title: c.title, source: c.sourceCitation ?? null })),
    },
  };

  let replyText = '';
  let isFallback = false;
  try {
    for await (const piece of generateStream({
      system,
      contents,
      model: images.length ? env.GEMINI_VISION_MODEL : undefined,
      temperature: triage.urgency === 'emergency' ? 0.1 : 0.3,
      maxOutputTokens: 600,
    })) {
      replyText += piece;
      yield { type: 'token', data: piece };
    }
    replyText = stripTrailingDisclaimer(replyText.trim());
    if (!replyText) throw new AiUnavailableError(new Error('empty stream'));
  } catch (err) {
    logger.error({ err: err?.cause?.message ?? err?.message }, 'stream generation failed; scripted fallback');
    replyText = fallbackReply(triage.urgency === 'emergency' ? 'emergency' : 'unavailable', language);
    isFallback = true;
    // Tell the client to discard the partial and show the scripted text.
    yield { type: 'replace', data: replyText };
  }

  const assistantMessage = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq: seq + 1,
    role: 'assistant',
    content: replyText,
    language,
    triage: {
      urgency: triage.urgency,
      matchedRules: triage.matchedRules,
      redFlags: triage.redFlags.map((r) => r.label),
      ruleDriven: triage.ruleDriven,
    },
    citations: chunks.slice(0, 3).map((c) => ({ chunk: c._id, title: c.title, score: c.score })),
    isFallback,
    alert: alert?._id,
  });

  session.messageCount = seq + 1;
  session.lastMessageAt = new Date();
  session.highestUrgency = maxUrgency(session.highestUrgency, triage.urgency);
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') session.flaggedForReview = true;
  await session.save();

  yield { type: 'done', data: { reply: serialiseMessage(assistantMessage) } };
}

async function resolveSession({ patientId, sessionId, language, text }) {
  if (sessionId) {
    const existing = await ChatSession.findOne({ _id: sessionId, patient: patientId });
    if (existing) return existing;
  }

  // No session id means "continue where this patient left off", not "start
  // again". Creating one unconditionally scattered a single patient's history
  // across a new session per message whenever a client had not yet learned the
  // id â€” which left the clinic reading only the newest fragment while the
  // patient read another, and the doctor's reply landing in a thread the
  // patient was not looking at.
  const ongoing = await ChatSession.findOne({ patient: patientId, kind: { $ne: 'nutrition' }, isArchived: false }).sort({
    lastMessageAt: -1,
  });
  if (ongoing) return ongoing;

  return ChatSession.create({
    patient: patientId,
    language,
    // First message doubles as the thread title; trimmed to fit a list row.
    title: text.length > 60 ? `${text.slice(0, 57)}...` : text,
  });
}

function serialiseMessage(m) {
  const rt = m.replyTo;
  const rtDoc = rt && typeof rt === 'object' && rt.content != null ? rt : null;
  return {
    id: m._id,
    seq: m.seq,
    role: m.role,
    content: m.content,
    language: m.language,
    urgency: m.triage?.urgency ?? 'routine',
    isFallback: m.isFallback ?? false,
    // The quoted turn: its id (so the app can scroll to it) and a text preview
    // (so the quote renders even when the original is not loaded on this side).
    replyToId: rt ? (rtDoc ? String(rtDoc._id) : (rt.toString?.() ?? String(rt))) : null,
    replyPreview: rtDoc ? { content: String(rtDoc.content).slice(0, 160), role: rtDoc.role ?? null } : null,
    createdAt: m.createdAt,
    // Attachments carry kind/mimeType/transcript so the app can tell a voice
    // note from a photo — without them a recording is drawn as a (broken) image
    // thumbnail instead of a player. Needs the message's attachments populated;
    // falls back to id+url when they are not.
    attachments: (m.attachments ?? []).map((a) => {
      const id = (a?._id ?? a).toString?.() ?? a;
      const populated = a && typeof a === 'object' && ('kind' in a || 'mimeType' in a);
      return {
        id,
        url: `/api/v1/uploads/${id}/raw`,
        kind: populated ? (a.kind ?? null) : null,
        mimeType: populated ? (a.mimeType ?? null) : null,
        name: populated ? (a.originalName ?? null) : null,
        sizeBytes: populated ? (a.sizeBytes ?? null) : null,
        transcript: populated ? (a.transcript ?? null) : null,
      };
    }),
  };
}
