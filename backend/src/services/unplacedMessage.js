import { AppError } from '../middleware/errors.js';
import { sessionForPatientSend, CHOOSE_PRACTICE } from './conversationPractice.js';
import { buildPatientContext } from './patientContext.js';
import { triageMessage } from './triage/engine.js';
import { raiseAlert } from './alerts.js';
import { fallbackReply } from './ai/prompts.js';
import { resolveVoiceText } from './voiceText.js';
import { logger } from '../config/logger.js';

/**
 * The conversation a patient's own message goes into — and, when the server has
 * to ask which practice it is for, the triage that cannot wait for the answer.
 *
 * ---- What was wrong ------------------------------------------------------
 *
 * A patient with two practices who wrote without naming one was refused with a
 * 409 before triage ran. The refusal is right: the message is not guessed into
 * one practice's conversation. But everything that makes the assistant safe to
 * run came after it — the rule engine, the alert, the written emergency
 * instructions — so "I have chest pain" from that patient paged nobody and
 * told them nothing until they had picked a doctor from a list and sent it
 * again. The whole design rests on escalation never waiting on anything, and
 * this made it wait on the patient.
 *
 * ---- Now ------------------------------------------------------------------
 *
 * Before the 409 leaves, the message is triaged exactly as a placed one would
 * be. Urgent or emergency, the alert is raised then — and an alert names the
 * patient, not a conversation, so it reaches every practice caring for them,
 * which is right when nobody yet knows which one is meant. The 409 carries the
 * verdict and, for an emergency, the same written instructions a placed
 * message gets, so the app can show them while it asks.
 *
 * When the patient then chooses and sends it again, the send raises the same
 * alert and is handed the open one rather than paging twice — see raiseAlert.
 */
export async function sessionForPatientMessage({
  patientId,
  sessionId = null,
  practiceId = null,
  kind = 'care',
  language = 'en',
  replyLanguage = language,
  title,
  text = '',
  attachments = [],
}) {
  try {
    return await sessionForPatientSend({ patientId, sessionId, practiceId, kind, language, title });
  } catch (err) {
    if (!(err instanceof AppError) || err.details?.reason !== CHOOSE_PRACTICE) throw err;
    try {
      err.details = {
        ...err.details,
        ...(await escalateUnplaced({ patientId, text, attachments, language: replyLanguage, kind })),
      };
    } catch (escalationError) {
      // Still the question, not a 500. The app holds the message and sends it
      // again once the patient chooses, and that send triages it afresh; a
      // failure here would have lost the message along with the alert.
      logger.error(
        { err: escalationError, patientId: String(patientId) },
        'could not triage an unplaced patient message; it will be triaged when resent',
      );
    }
    throw err;
  }
}

/**
 * No practice speaks yet. Written out as an identity so the emergency script
 * names no doctor and no number rather than falling back to the deployment's
 * own — which is one clinic's, and not necessarily this patient's.
 */
const NO_PRACTICE = Object.freeze({ emergencyPhone: null });

async function escalateUnplaced({ patientId, text, attachments, language, kind }) {
  // What a voice note said, as the placed send reads it.
  const said = await resolveVoiceText(text, attachments);

  // The patient's own targets and latest reading. Only these reach triage; the
  // rest of the picture is never shown to anyone from here.
  const context = await buildPatientContext(patientId);
  const triage = triageMessage({ text: said, targets: context.targets, latestGlucose: context.latestGlucose });

  let alert = null;
  if (triage.urgency === 'emergency' || triage.urgency === 'urgent') {
    alert = await raiseAlert({
      patientId,
      severity: triage.urgency === 'emergency' ? 'emergency' : 'urgent',
      type: triage.alertType ?? 'chat_escalation',
      title: triage.redFlags[0]?.label ?? triage.findings[0]?.summary ?? 'Patient reported a concerning symptom',
      detail:
        `Written ${kind === 'nutrition' ? 'to the dietician' : 'in the app'} by a patient with more than one ` +
        `practice, before they chose which it was for: "${said.slice(0, 500)}"\n\n` +
        `Triage findings:\n${triage.findings.map((f) => `- ${f.summary}`).join('\n')}`,
      source: { kind: 'chat' },
      matchedRules: triage.matchedRules,
    });
    logger.warn(
      { patientId: String(patientId), urgency: triage.urgency, alertId: String(alert._id) },
      'unplaced patient message escalated before the practice was chosen',
    );
  }

  return {
    triage: {
      urgency: triage.urgency,
      ruleDriven: triage.ruleDriven,
      redFlags: triage.redFlags,
      findings: triage.findings.map((f) => f.summary),
    },
    alert: alert ? { id: alert._id, severity: alert.severity, type: alert.type, title: alert.title } : null,
    instructions: triage.urgency === 'emergency' ? fallbackReply('emergency', language, NO_PRACTICE) : null,
  };
}
