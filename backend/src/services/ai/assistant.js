import { ChatMessage } from '../../models/ChatMessage.js';
import { nextMessageSeq } from '../chatSequence.js';
import { triageMessage } from '../triage/engine.js';
import { buildPatientContext } from '../patientContext.js';
import { retrieve, formatContext } from './rag.js';
import { generate, generateStream, AiUnavailableError } from './gemini.js';
import { replyIsWrongLanguage } from './languageGuard.js';
import { buildSystemPrompt, fallbackReply, languagePrimer, forceLanguageInstruction } from './prompts.js';
// Who this assistant works for, read from the practice. Cached for a minute
// inside the service, so this is not a database round trip per message.
import { clinicIdentity } from '../clinicIdentity.js';
import { assistantContextFor } from './departmentAssistant.js';
import { conversationAssistant } from './assistantAvailability.js';
import { mayAssistantReply, countReply } from './allowance.js';
import { sessionForPatientSend, relationshipOfSession } from '../conversationPractice.js';
import { careTeamNotesFor } from '../careTeamNotes.js';
import { raiseAlert } from '../alerts.js';
import { detectAppointmentIntent } from '../triage/appointmentIntent.js';
import { notifyClinicOfPatientMessage } from '../notifications.js';
import { loadAssetsForAi } from '../../routes/uploads.js';
import { resolveVoiceText } from '../voiceText.js';
import { quotePreview, QUOTE_FIELDS } from '../quotedMessage.js';
import { logger } from '../../config/logger.js';
import { maxUrgency } from '../triage/thresholds.js';
import { env } from '../../config/env.js';

const HISTORY_TURNS = 8;

/**
 * A session's title, from the message that opened it: trimmed to fit a list row.
 */
function titleFrom(text) {
  const t = String(text ?? '');
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
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
 * Whether the assistant should answer in this thread right now.
 *
 * Mirrors the check in routes/chat.js and must stay in step with it: a
 * clinician has switched the assistant off for this conversation, or one of
 * them is reading it this minute. Gates the reply only — triage and alerting
 * happen before this is ever consulted.
 */
async function assistantShouldReply(session, relationship = null, availability = null) {
  if (!session) return true;

  /*
   * What the practice has, and what it has left.
   *
   * Checked here rather than at the route because this is where the assistant
   * already knows how to be silent: a department with no scope written for it
   * gets no reply and the thread says so. A practice without the capability,
   * or one that has spent the month's allowance, lands in exactly the same
   * place — which is the right place, because a patient does not need telling
   * which of their clinic's commercial arrangements applies to their question.
   *
   * The clinic is told, in the audit trail. See [ai/allowance.js].
   */
  const may = await mayAssistantReply(session.patient, { practiceId: relationship?.practiceId ?? null });
  if (!may.allowed) return false;
  // A department nobody has written a scope for has no assistant. Not a
  // general one, not a fallback to the diabetes prompt — silence, and the
  // thread says so. Checked here rather than by returning an empty prompt,
  // because an assistant with no remit still answers.
  //
  // Nor does one whose scope or knowledge nobody at this practice has approved
  // yet — a drafted scope is not a live one. See assistantAvailability.js.
  const answer =
    availability ??
    (await conversationAssistant({
      session,
      practiceId: relationship?.practiceId ?? null,
      language: session.language ?? 'en',
    }));
  if (!answer.enabled) return false;
  // Off is off, however it was reached.
  if (session.assistantEnabled === false) return false;
  // On, chosen deliberately, outranks presence. A clinician who switches the
  // assistant back on while reading the thread is saying "answer this, I am
  // only watching" — and the heartbeat they are still sending would otherwise
  // keep it silent for as long as they stayed on the screen, which is exactly
  // when they were looking to see whether the switch had worked.
  if (session.assistantExplicit) return true;
  // Never configured: hold off while somebody from the clinic is reading, so
  // the assistant does not answer over a reply being typed.
  const until = session.clinicianPresentUntil;
  if (until && new Date(until).getTime() > Date.now()) return false;
  return true;
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
export async function handlePatientMessage({
  patientId,
  sessionId,
  practiceId = null,
  text,
  language = 'en',
  attachments = [],
  replyTo,
}) {
  // A voice-only message carries no typed text; use the words transcribed at
  // upload so triage and the assistant answer what was actually said.
  text = await resolveVoiceText(text, attachments);
  // The conversation this message belongs to, and the practice it is with.
  // That practice decides what the assistant reads, whose clinicians it
  // quotes, who it speaks for and whose allowance it spends — see
  // services/conversationPractice.js.
  const session = await sessionForPatientSend({ patientId, sessionId, practiceId, language, title: titleFrom(text) });
  const relationship = await relationshipOfSession(session);

  const context = await buildPatientContext(patientId, relationship);

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
  if (replyTo) await userMessage.populate('replyTo', QUOTE_FIELDS);
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

  // Did they ask to be seen?
  //
  // Detected from the patient's own words, before the model runs, so it works
  // when Gemini does not — and so a sentence in Bengali is matched by rules a
  // test can pin down rather than by a model's mood.
  const appointment = detectAppointmentIntent(text);

  // And tell the clinic somebody wrote in.
  //
  // After the escalation above, and told about it: an urgent message has
  // already pushed as an alert, and a second notification for the same
  // sentence is noise on a phone the desk is trying to work from.
  //
  // Fire-and-forget. The message is saved; a push that fails must not fail the
  // patient's send.
  notifyClinicOfPatientMessage(patientId, text, {
    escalated: alert != null,
  }).catch(() => {});

  // A clinician is holding this conversation, or has switched the assistant
  // off for it. Everything above still ran — the message is saved and the
  // clinic has been alerted if it needed to be — but no reply is generated:
  // the person is answering, and a second answer arriving under theirs is how
  // a patient ends up with two different accounts of what to do.
  //
  // Which department this conversation is, and whether its assistant is on for
  // this practice in this language — asked once, and used for the gate, for
  // retrieval and for the prompt below.
  const availability = await conversationAssistant({
    session,
    practiceId: relationship.practiceId ?? null,
    language,
  });

  if (!(await assistantShouldReply(session, relationship, availability))) {
    session.messageCount = seq;
    session.lastMessageAt = new Date();
    session.highestUrgency = maxUrgency(session.highestUrgency, triage.urgency);
    if (triage.urgency === 'emergency' || triage.urgency === 'urgent') session.flaggedForReview = true;
    await session.save();

    return {
      sessionId: session._id,
      userMessage: serialiseMessage(userMessage),
      // Null, not an empty reply: the app renders nothing rather than an
      // empty assistant bubble the patient would read as a failure.
      reply: null,
      // Whether an assistant exists here at all, and if not why — so a screen
      // can say "no assistant for this department yet" rather than leave a
      // patient waiting on a reply that is not coming. A clinician holding the
      // thread still reads as enabled: that silence is theirs, not a gap.
      assistant: { enabled: availability.enabled, reason: availability.reason },
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
      citations: [],
    };
  }

  // Retrieve grounding + prior turns + the care team's own words, in parallel.
  //
  // Grounding is narrowed to this practice and this department before it is
  // ranked: the platform's shared passages and the practice's own, filed under
  // this department or under none. Without the practice, passages a clinic
  // approved for its own patients were never retrieved at all; without the
  // department, a cardiology thread would be grounded on insulin advice.
  const [chunks, history, careTeamNotes] = await Promise.all([
    retrieve(text, {
      language,
      categories: categoriesFor(triage),
      limit: 6,
      practice: relationship.practiceId ?? null,
      department: availability.retrievalDepartment ?? null,
    }).catch((err) => {
      logger.warn({ err: err?.message }, 'retrieval failed; answering without grounding');
      return [];
    }),
    ChatMessage.find({ session: session._id, seq: { $lt: seq } })
      .sort({ seq: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
    careTeamNotesFor({ patientId, enrollment: relationship.enrollment }).catch(() => ''),
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
      // without being able to speak as the doctor. See services/careTeamNotes.js.
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isFallback)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    // The language primer sits between the history and the real message, so
    // its instruction is the most recent thing read. See languagePrimer.
    ...languagePrimer(language),
    { role: 'user', parts: userParts },
  ];

  // This patient's practice. Asked without it, this was the first clinic on
  // the platform, for every patient on it.
  const identity = await clinicIdentity(null, { practiceId: relationship.practiceId });

  // The department this thread belongs to decides what the assistant is. Null
  // department is the practice's general thread, which answers as the
  // practice's specialty, or — with no specialty on the practice — keeps the
  // remit the assistant has always had. See assistantAvailability.js. A
  // department whose scope nobody here approved never reaches this line: the
  // gate above has already gone silent, which is the point — an assistant
  // improvising outside its specialty is fluent, and neither the patient nor
  // the reviewing doctor can tell it is guessing.
  const departmentContext = availability.useDepartmentBlock
    ? await assistantContextFor({
        department: availability.department,
        patientId,
        language,
        practiceId: relationship.practiceId ?? null,
        status: availability.status,
      })
    : null;

  const system = buildSystemPrompt({
    language,
    triage,
    patientContext: context.text,
    careTeamNotes,
    groundingContext: formatContext(chunks),
    identity,
    departmentBlock: departmentContext?.promptBlock ?? null,
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

    // One retry when the reply came back in the wrong language.
    //
    // The prompt and the primer both ask; this checks. The model has ignored
    // both in every arrangement tried so far, and a patient reading an English
    // app should not be the one who discovers it. Once only: a second failure
    // means the model has made a considered choice, and an answer in the wrong
    // language still beats a spinner.
    if (replyIsWrongLanguage({ reply: replyText, language, patientText: text })) {
      logger.warn({ language }, 'reply came back in the wrong language; regenerating once');
      const retry = await generate({
        system: `${system}

${forceLanguageInstruction(language)}`,
        contents,
        temperature: 0.1,
        maxOutputTokens: 600,
        model: images.length ? env.GEMINI_VISION_MODEL : undefined,
      });
      const retried = stripTrailingDisclaimer(retry.text.trim());
      // Kept only if it is actually better. A retry that comes back wrong as
      // well should not overwrite a first answer that at least addressed the
      // question.
      if (!replyIsWrongLanguage({ reply: retried, language, patientText: text })) {
        replyText = retried;
        modelVersion = retry.modelVersion;
        latencyMs = (latencyMs ?? 0) + (retry.latencyMs ?? 0);
      }
    }
  } catch (err) {
    if (!(err instanceof AiUnavailableError)) throw err;
    logger.error({ err: err.cause?.message }, 'assistant generation failed; using scripted fallback');
    // In an emergency the scripted emergency text is what matters, not an
    // apology about the service being down.
    replyText = fallbackReply(triage.urgency === 'emergency' ? 'emergency' : 'unavailable', language, identity);
    isFallback = true;
  }

  // No disclaimer is appended to the content: the app already renders one
  // footer line under every assistant reply, and appending here produced a
  // duplicate (sometimes triple, when the model added its own too).
  // Counted against the month's allowance now the model has actually answered.
  // Before this point a failed request has cost the practice nothing, and
  // charging them for it would spend a limit on an outage.
  // The token figures ride along. The allowance still compares replies; what
  // the practice actually costs is tokens, and that number was stored per
  // message and aggregated nowhere anybody could read it.
  countReply(relationship.practiceId, usage);

  // Drawn after the model has answered, not claimed as the patient's message
  // plus one: a doctor replying while the assistant was thinking took that
  // number first, and this reply was the one refused. See chatSequence.js.
  const replySeq = await nextMessageSeq(session._id);
  const assistantMessage = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq: replySeq,
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
    // Offered under the answer, not instead of it. The assistant still replies
    // to what was asked; the card is the shortcut.
    action: appointment
      ? {
          kind: 'appointment_request',
          preferredFor: appointment.preferredFor ?? undefined,
          timePhrase: appointment.timePhrase ?? undefined,
        }
      : undefined,
    // Offered under the answer, not instead of it. The assistant still replies
    // to what was asked; the card is the shortcut.
    action: appointment
      ? {
          kind: 'appointment_request',
          preferredFor: appointment.preferredFor ?? undefined,
          timePhrase: appointment.timePhrase ?? undefined,
        }
      : undefined,
    modelVersion,
    latencyMs,
    tokenUsage: usage,
    isFallback,
    alert: alert?._id,
  });

  session.messageCount = replySeq + 1;
  session.lastMessageAt = new Date();
  session.highestUrgency = maxUrgency(session.highestUrgency, triage.urgency);
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') session.flaggedForReview = true;
  await session.save();

  return {
    sessionId: session._id,
    userMessage: serialiseMessage(userMessage),
    reply: serialiseMessage(assistantMessage),
    assistant: { enabled: availability.enabled, reason: availability.reason },
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
export async function* streamPatientMessage({
  patientId,
  sessionId,
  practiceId = null,
  text,
  language = 'en',
  attachments = [],
  replyTo,
}) {
  // A voice-only message is answered from its transcript here too. The stream
  // skipped this, so a voice note sent the way the app sends every message was
  // triaged and answered as an empty string.
  text = await resolveVoiceText(text, attachments);
  // The same conversation, and the same practice deciding everything below, as
  // the plain send. See services/conversationPractice.js.
  const session = await sessionForPatientSend({ patientId, sessionId, practiceId, language, title: titleFrom(text) });
  const relationship = await relationshipOfSession(session);
  const context = await buildPatientContext(patientId, relationship);
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
  if (replyTo) await userMessage.populate('replyTo', QUOTE_FIELDS);
  // Populate so serialiseMessage can tell a voice note from a photo — otherwise
  // the just-sent recording renders as a broken image thumbnail.
  if (attachments.length) await userMessage.populate('attachments', 'kind mimeType transcript originalName sizeBytes');

// Same detection as the non-streaming path, so a card appears whichever
  // transport the app happened to use.
  const appointment = detectAppointmentIntent(text);

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

  // Same gate as the non-streaming path, and it has to be here too: the
  // toggle would otherwise do nothing at all for any client that streams.
  // Everything above still ran — the message is saved and the clinic alerted
  // if it needed to be — but no reply is generated.
  const availability = await conversationAssistant({
    session,
    practiceId: relationship.practiceId ?? null,
    language,
  });

  if (!(await assistantShouldReply(session, relationship, availability))) {
    session.messageCount = seq;
    session.lastMessageAt = new Date();
    session.highestUrgency = maxUrgency(session.highestUrgency, triage.urgency);
    if (triage.urgency === 'emergency' || triage.urgency === 'urgent') session.flaggedForReview = true;
    await session.save();

    yield {
      type: 'meta',
      data: {
        sessionId: session._id,
        userMessage: serialiseMessage(userMessage),
        assistant: { enabled: availability.enabled, reason: availability.reason },
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
        citations: [],
      },
    };
    // No reply to hand back. A person is writing one.
    yield { type: 'done', data: { reply: null } };
    return;
  }

  // Narrowed to this practice and department, as on the plain send.
  const [chunks, history, careTeamNotes] = await Promise.all([
    retrieve(text, {
      language,
      categories: categoriesFor(triage),
      limit: 6,
      practice: relationship.practiceId ?? null,
      department: availability.retrievalDepartment ?? null,
    }).catch(() => []),
    ChatMessage.find({ session: session._id, seq: { $lt: seq } })
      .sort({ seq: -1 })
      .limit(HISTORY_TURNS)
      .lean(),
    careTeamNotesFor({ patientId, enrollment: relationship.enrollment }).catch(() => ''),
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
      // system prompt instead. See services/careTeamNotes.js.
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.isFallback)
      .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
    // The language primer sits between the history and the real message, so
    // its instruction is the most recent thing read. See languagePrimer.
    ...languagePrimer(language),
    { role: 'user', parts: userParts },
  ];
  // This patient's practice. Asked without it, this was the first clinic on
  // the platform, for every patient on it.
  const identity = await clinicIdentity(null, { practiceId: relationship.practiceId });

  // The department this thread belongs to decides what the assistant is. Null
  // department is the practice's general thread, which answers as the
  // practice's specialty, or — with no specialty on the practice — keeps the
  // remit the assistant has always had. See assistantAvailability.js. A
  // department whose scope nobody here approved never reaches this line: the
  // gate above has already gone silent, which is the point — an assistant
  // improvising outside its specialty is fluent, and neither the patient nor
  // the reviewing doctor can tell it is guessing.
  const departmentContext = availability.useDepartmentBlock
    ? await assistantContextFor({
        department: availability.department,
        patientId,
        language,
        practiceId: relationship.practiceId ?? null,
        status: availability.status,
      })
    : null;

  const system = buildSystemPrompt({
    language,
    triage,
    patientContext: context.text,
    careTeamNotes,
    groundingContext: formatContext(chunks),
    identity,
    departmentBlock: departmentContext?.promptBlock ?? null,
  });

  yield {
    type: 'meta',
    data: {
      sessionId: session._id,
      userMessage: serialiseMessage(userMessage),
      assistant: { enabled: availability.enabled, reason: availability.reason },
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
  // What the streamed call cost, reported once the stream drains. Empty if the
  // provider did not say — see the note on `onUsage` in gemini.js.
  let usage = {};
  try {
    for await (const piece of generateStream({
      system,
      contents,
      model: images.length ? env.GEMINI_VISION_MODEL : undefined,
      temperature: triage.urgency === 'emergency' ? 0.1 : 0.3,
      maxOutputTokens: 600,
      onUsage: (u) => {
        usage = u;
      },
    })) {
      replyText += piece;
      yield { type: 'token', data: piece };
    }
    replyText = stripTrailingDisclaimer(replyText.trim());
    if (!replyText) throw new AiUnavailableError(new Error('empty stream'));

    // The stream has already been shown by now, so a wrong-language reply is
    // corrected by replacing it — the same mechanism the scripted fallback
    // uses. Better a visible correction than leaving a patient with a screen
    // they cannot read.
    if (replyIsWrongLanguage({ reply: replyText, language, patientText: text })) {
      logger.warn({ language }, 'streamed reply was in the wrong language; regenerating once');
      const retry = await generate({
        system: `${system}

${forceLanguageInstruction(language)}`,
        contents,
        temperature: 0.1,
        maxOutputTokens: 600,
        model: images.length ? env.GEMINI_VISION_MODEL : undefined,
      });
      const retried = stripTrailingDisclaimer(retry.text.trim());
      if (retried && !replyIsWrongLanguage({ reply: retried, language, patientText: text })) {
        replyText = retried;
        yield { type: 'replace', data: replyText };
      }
    }
  } catch (err) {
    logger.error({ err: err?.cause?.message ?? err?.message }, 'stream generation failed; scripted fallback');
    replyText = fallbackReply(triage.urgency === 'emergency' ? 'emergency' : 'unavailable', language, identity);
    isFallback = true;
    // Tell the client to discard the partial and show the scripted text.
    yield { type: 'replace', data: replyText };
  }

  // Counted against the month's allowance now the model has actually answered.
  // Before this point a failed request has cost the practice nothing, and
  // charging them for it would spend a limit on an outage.
  // The token figures ride along. The allowance still compares replies; what
  // the practice actually costs is tokens, and that number was stored per
  // message and aggregated nowhere anybody could read it.
  countReply(relationship.practiceId, usage);

  // Drawn after the model has answered, not claimed as the patient's message
  // plus one: a doctor replying while the assistant was thinking took that
  // number first, and this reply was the one refused. See chatSequence.js.
  const replySeq = await nextMessageSeq(session._id);
  const assistantMessage = await ChatMessage.create({
    session: session._id,
    patient: patientId,
    seq: replySeq,
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

  session.messageCount = replySeq + 1;
  session.lastMessageAt = new Date();
  session.highestUrgency = maxUrgency(session.highestUrgency, triage.urgency);
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') session.flaggedForReview = true;
  await session.save();

  yield { type: 'done', data: { reply: serialiseMessage(assistantMessage) } };
}

function serialiseMessage(m) {
  const rt = m.replyTo;
  const rtDoc = rt && typeof rt === 'object' && rt.content != null ? rt : null;
  return {
    id: m._id,
    seq: m.seq,
    role: m.role,
    content: m.content,
    // An offer the app may draw under this turn. Null on every message that
    // carries none, which is nearly all of them.
    action: m.action?.kind
      ? {
          kind: m.action.kind,
          preferredFor: m.action.preferredFor ?? null,
          timePhrase: m.action.timePhrase ?? null,
        }
      : null,
    language: m.language,
    urgency: m.triage?.urgency ?? 'routine',
    isFallback: m.isFallback ?? false,
    // The quoted turn: its id (so the app can scroll to it) and a text preview
    // (so the quote renders even when the original is not loaded on this side).
    replyToId: rt ? (rtDoc ? String(rtDoc._id) : (rt.toString?.() ?? String(rt))) : null,
    // None for a quote from another conversation or one taken back.
    replyPreview: quotePreview(m),
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
