import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireClinician, requireRole, resolvePatientScope } from '../middleware/auth.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, notFound, badRequest } from '../middleware/errors.js';
import { ROLES } from '../models/User.js';
import { audit } from '../middleware/audit.js';
import { handlePatientMessage, streamPatientMessage } from '../services/ai/assistant.js';
import { ChatSession } from '../models/ChatSession.js';
import { ChatMessage } from '../models/ChatMessage.js';
import {
  notifyPatientOfClinicianReply,
  notifyDieticianOfPatientMessage,
} from '../services/notifications.js';
import { triageMessage } from '../services/triage/engine.js';
import { buildPatientContext } from '../services/patientContext.js';
import { raiseAlert } from '../services/alerts.js';
import { nutritionReply } from '../services/ai/nutritionAssistant.js';
import { resolveVoiceText } from '../services/voiceText.js';
import { FoodLog } from '../models/FoodLog.js';
import { MediaAsset } from '../models/MediaAsset.js';
import { paged, pageParams } from '../utils/pagination.js';

// The dietician assistant's one canned line — asked when a food PHOTO arrives
// with no meal named — in the patient's language, so it is not the single
// English sentence in an otherwise Bengali or Hindi conversation.
const WHICH_MEAL_PROMPT = {
  en: 'Thanks — which meal was this, and roughly when did you eat it? Breakfast, lunch, dinner or a snack. I will file it against the right one.',
  bn: 'ধন্যবাদ — এটি কোন খাবার ছিল, এবং আপনি আনুমানিক কখন খেয়েছিলেন? সকালের নাস্তা, দুপুরের খাবার, রাতের খাবার নাকি হালকা খাবার? আমি সঠিক জায়গায় নথিভুক্ত করব।',
  hi: 'धन्यवाद — यह कौन सा भोजन था, और आपने इसे लगभग कब खाया? नाश्ता, दोपहर का खाना, रात का खाना या स्नैक? मैं इसे सही जगह दर्ज कर दूँगा।',
};

/// How long an author has to correct themselves. Long enough for a typo
/// spotted on re-reading, short enough that the other side has probably not
/// replied to it yet.
const EDIT_WINDOW_MS = 15 * 60 * 1000;

/// How long a clinician's heartbeat holds the assistant back.
///
/// Comfortably longer than the client's beat so one dropped request does not
/// hand the conversation back mid-sentence, and short enough that a phone
/// locked in a pocket releases it quickly.
const PRESENCE_TTL_MS = 90 * 1000;

/**
 * Whether the assistant should answer in this thread right now.
 *
 * Two ways it stays quiet. A clinician has switched it off for this
 * conversation, or one of them is reading the thread this minute — in which
 * case the human is already answering, and a second reply arriving underneath
 * theirs is how a patient ends up with two different answers to one question.
 *
 * This gates the REPLY only. Triage runs on every message regardless: if
 * somebody reports chest pain the clinic has to be alerted whether or not the
 * assistant happens to be speaking.
 */
function assistantShouldReply(session) {
  if (!session) return true;
  if (session.assistantEnabled === false) return false;
  const until = session.clinicianPresentUntil;
  if (until && new Date(until).getTime() > Date.now()) return false;
  return true;
}

const router = Router();

/**
 * Generation is the expensive path. The limit is generous enough that an
 * anxious patient in a genuine crisis is never locked out, but low enough to
 * stop a runaway client from burning the API quota.
 */
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  keyGenerator: (req) => req.user?._id?.toString() ?? req.ip,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
    error: {
      code: 'RATE_LIMITED',
      message: 'You are sending messages very quickly. Please wait a moment. If this is an emergency, go to the nearest hospital.',
    },
  },
});

router.post(
  '/message',
  requireAuth,
  chatLimiter,
  validate({
    body: z
      .object({
        sessionId: z.string().optional(),
        // Optional so a photo (or several) can be sent with no caption.
        text: z.string().trim().max(4000).optional().default(''),
        language: z.enum(['en', 'bn', 'hi']).optional(),
        attachments: z.array(z.string()).max(5).default([]),
        // The earlier turn this message answers, so a reply that lands hours
        // later still says what it is about.
        replyTo: z.string().optional(),
      })
      .refine((b) => b.text.trim().length > 0 || b.attachments.length > 0, {
        message: 'Add a message or attach a photo',
        path: ['text'],
      }),
  }),
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const result = await handlePatientMessage({
      patientId: req.user._id,
      sessionId: req.body.sessionId,
      text: req.body.text,
      language: req.body.language ?? req.user.language ?? 'en',
      attachments: req.body.attachments,
      replyTo: req.body.replyTo,
    });
    res.json(result);
  }),
);

/**
 * Streaming sibling of POST /message. Same triage-first safety order, but the
 * reply is delivered as Server-Sent Events so the app can show words as they
 * are generated. The client falls back to the non-streaming endpoint if the
 * stream cannot be opened.
 */
router.post(
  '/message/stream',
  requireAuth,
  chatLimiter,
  validate({
    body: z
      .object({
        sessionId: z.string().optional(),
        // Optional so a photo (or several) can be sent with no caption.
        text: z.string().trim().max(4000).optional().default(''),
        language: z.enum(['en', 'bn', 'hi']).optional(),
        attachments: z.array(z.string()).max(5).default([]),
        // The earlier turn this message answers, so a reply that lands hours
        // later still says what it is about.
        replyTo: z.string().optional(),
      })
      .refine((b) => b.text.trim().length > 0 || b.attachments.length > 0, {
        message: 'Add a message or attach a photo',
        path: ['text'],
      }),
  }),
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stop nginx from buffering the stream so tokens arrive as they are sent.
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();

    const send = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);

    try {
      for await (const ev of streamPatientMessage({
        patientId: req.user._id,
        sessionId: req.body.sessionId,
        text: req.body.text,
        language: req.body.language ?? req.user.language ?? 'en',
        attachments: req.body.attachments,
        replyTo: req.body.replyTo,
      })) {
        send(ev.type, ev.data);
      }
    } catch (err) {
      // The generator already scripts a fallback for AI failures; this catches
      // anything earlier (DB, retrieval) so the client is not left hanging.
      send('error', { message: 'Something went wrong. Please try again.' });
    } finally {
      res.end();
    }
  }),
);

router.get(
  '/sessions',
  requireAuth,
  validate({ query: pageParams }),
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = q(req);
    const filter = { patient: req.user._id, kind: { $ne: 'nutrition' }, isArchived: false };
    const [items, total] = await Promise.all([
      ChatSession.find(filter).sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean(),
      ChatSession.countDocuments(filter),
    ]);
    res.json(paged(items.map(serialiseSession), { page, limit, total }));
  }),
);

router.get(
  '/sessions/:id/messages',
  requireAuth,
  validate({ query: pageParams }),
  audit('read', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const session = await ChatSession.findOne({ _id: req.params.id, patient: req.user._id });
    if (!session) throw notFound('Conversation not found');

    const { page, limit, skip } = q(req);
    // Messages this patient chose to hide stay in the record but leave their view.
    const filter = { session: session._id, hiddenFor: { $ne: req.user._id } };
    const [items, total] = await Promise.all([
      ChatMessage.find(filter)
        .sort({ seq: 1 })
        .skip(skip)
        .limit(limit)
        .populate('sender', 'name avatarAssetId')
        .populate('replyTo', 'content role')
        .populate('attachments', 'kind mimeType transcript originalName sizeBytes')
        .lean(),
      ChatMessage.countDocuments(filter),
    ]);

    res.json({
      ...paged(items.map(serialiseMessage), { page, limit, total }),
      session: serialiseSession(session.toObject()),
    });
  }),
);

router.post(
  '/sessions/:id/archive',
  requireAuth,
  asyncHandler(async (req, res) => {
    const updated = await ChatSession.findOneAndUpdate(
      { _id: req.params.id, patient: req.user._id },
      { isArchived: true },
    );
    if (!updated) throw notFound('Conversation not found');
    res.status(204).end();
  }),
);

router.post(
  '/messages/:id/flag',
  requireAuth,
  asyncHandler(async (req, res) => {
    const message = await ChatMessage.findOneAndUpdate(
      { _id: req.params.id, patient: req.user._id },
      { flaggedByPatient: true },
    );
    if (!message) throw notFound('Message not found');
    // A patient reporting a bad answer is a review signal for the doctor.
    await ChatSession.updateOne({ _id: message.session }, { flaggedForReview: true });
    res.status(204).end();
  }),
);

/**
 * The patient's conversation, read by a clinician.
 *
 * The patient-facing history route is scoped to `req.user`, so a doctor cannot
 * use it. This returns the same thread â€” assistant turns, the patient's own
 * words and any clinician replies â€” so the clinic reads exactly what the
 * patient reads, rather than a separate inbox showing half the story.
 */
router.get(
  '/patients/:patientId/thread',
  requireAuth,
  requireClinician,
  resolvePatientScope,
  validate({ query: pageParams }),
  audit('read', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const session = await ChatSession.findOne({ patient: req.patientId, kind: { $ne: 'nutrition' }, isArchived: false })
      .sort({ lastMessageAt: -1 })
      .lean();

    // Messages are fetched by patient, not by session. The clinic needs the
    // whole history â€” a patient's care is one continuous story, and an earlier
    // exchange is often exactly the context that explains today's question.
    // It also heals threads already split by sessions created per message
    // before that was fixed.
    const careIdsForCount = await ChatSession.find({
      patient: req.patientId,
      kind: { $ne: 'nutrition' },
    })
      .select('_id')
      .lean();
    const total = await ChatMessage.countDocuments({
      patient: req.patientId,
      session: { $in: careIdsForCount.map((s) => s._id) },
    });

    if (!session && total === 0) {
      // No conversation yet is a normal state, not an error: the clinic may be
      // reaching out first. An empty thread lets the composer open regardless.
      return res.json({
        session: null,
        items: [],
        page: 1,
        limit: 0,
        total: 0,
        hasMore: false,
        patient: req.patientUser
          ? {
              id: req.patientUser._id,
              name: req.patientUser.name,
              phone: req.patientUser.phone,
              // The clinician's conversation header shows the photo the patient
              // set, so the clinic sees the same face the patient chose.
              avatarUrl: req.patientUser.avatarAssetId
                ? `/api/v1/uploads/${req.patientUser.avatarAssetId}/raw` 
                : null,
            }
          : null,
      });
    }

    const { page, limit, skip } = q(req);
    // Newest first so a long history returns its most RECENT page, not its
    // oldest — the clinic was missing the latest messages on any thread past the
    // limit. Ordered by time, not seq: seq restarts per session, so it cannot
    // order a history that spans several. The app re-sorts ascending to display.
    // Scoped to the patient's CARE sessions, not simply to the patient. The
    // nutrition thread is a separate conversation with the dietician, and
    // pulling it in here put the dietician's messages into the doctor's chat
    // as though they were part of it.
    const careSessionIds = await ChatSession.find({
      patient: req.patientId,
      kind: { $ne: 'nutrition' },
    })
      .select('_id')
      .lean();

    const items = await ChatMessage.find({
      patient: req.patientId,
      session: { $in: careSessionIds.map((s) => s._id) },
      hiddenFor: { $ne: req.user._id },
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('sender', 'name avatarAssetId')
      .populate('replyTo', 'content role')
        .populate('attachments', 'kind mimeType transcript originalName sizeBytes')
      .lean();

    // Opening the thread is what "seen by the clinic" means. Stamped only on
    // the patient's own unseen turns, so the mark says a person from the clinic
    // has read them â€” deliberately in place of a typing indicator, which would
    // promise a reply in seconds that a full clinic list cannot honour.
    await ChatMessage.updateMany(
      { patient: req.patientId, role: 'user', seenByClinicAt: null },
      { seenByClinicAt: new Date() },
    );

    res.json({
      ...paged(items.map(serialiseMessage), { page, limit, total }),
      session: session ? serialiseSession(session) : null,
      // So the clinician's toggle shows the thread's real state instead of
      // assuming it. Defaults to on, which is what a session created before
      // this field existed means.
      assistantEnabled: session ? session.assistantEnabled !== false : true,
      patient: req.patientUser
        ? {
              id: req.patientUser._id,
              name: req.patientUser.name,
              phone: req.patientUser.phone,
              // The clinician's conversation header shows the photo the patient
              // set, so the clinic sees the same face the patient chose.
              avatarUrl: req.patientUser.avatarAssetId
                ? `/api/v1/uploads/${req.patientUser.avatarAssetId}/raw` 
                : null,
            }
        : null,
    });
  }),
);

/**
 * The doctor (or staff) speaking directly into the patient's assistant thread.
 *
 * There is deliberately no separate doctor-patient inbox. The assistant handles
 * what it safely can and refers the rest to the clinic; a reply that arrived in
 * a different screen would split one clinical conversation in two, and neither
 * half would carry the context of the other. So a clinician's words land in the
 * same thread the patient is already reading, as `role: 'clinician'` â€” a role
 * the message schema has always allowed.
 *
 * It attaches to the patient's most recent session, or opens one if the patient
 * has never written, so the clinic can always reach out first.
 */
router.post(
  '/patients/:patientId/clinician-message',
  requireAuth,
  requireClinician,
  resolvePatientScope,
  validate({
    body: z
      .object({
        // Optional so the clinician can send photos (or a voice note) alone.
        content: z.string().trim().max(4000).optional().default(''),
        // A clinician can reply with a voice note too — faster between patients,
        // and the patient hears reassurance that text cannot carry.
        attachments: z.array(z.string()).max(5).default([]),
        // Threaded reply: the message this one answers, so a clinician can quote
        // the exact symptom they are responding to days later.
        replyTo: z.string().optional(),
      })
      .refine((b) => b.content.trim().length > 0 || b.attachments.length > 0, {
        message: 'Add a message or attach a photo',
        path: ['content'],
      }),
  }),
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    let session = await ChatSession.findOne({ patient: req.patientId, kind: { $ne: 'nutrition' }, isArchived: false }).sort({
      lastMessageAt: -1,
    });

    if (!session) {
      session = await ChatSession.create({
        patient: req.patientId,
        language: req.patientUser?.language ?? 'en',
        title: 'Message from the clinic',
      });
    }

    // seq is unique per session, so derive it from the current tail rather than
    // a count â€” an archived or partially deleted history would collide.
    const last = await ChatMessage.findOne({ session: session._id }).sort({ seq: -1 }).select('seq').lean();

    const message = await ChatMessage.create({
      session: session._id,
      patient: req.patientId,
      seq: (last?.seq ?? -1) + 1,
      role: 'clinician',
      sender: req.user._id,
      content: req.body.content,
      language: session.language,
      attachments: req.body.attachments,
      replyTo: req.body.replyTo || undefined,
    });

    await ChatSession.findByIdAndUpdate(session._id, {
      lastMessageAt: message.createdAt,
      $inc: { messageCount: 1 },
      // The clinician has now answered, so it no longer needs review.
      flaggedForReview: false,
    });

    await notifyPatientOfClinicianReply(req.patientId, req.user, req.body.content);

    // Populate so the doctor's own copy comes back knowing a voice note from a
    // photo (kind/mimeType) — otherwise their just-sent recording renders as a
    // broken thumbnail instead of a player until the thread reloads.
    if (message.attachments?.length) {
      await message.populate('attachments', 'kind mimeType transcript originalName sizeBytes');
    }
    // Populate the quoted turn so the reply comes back with its preview.
    if (message.replyTo) {
      await message.populate('replyTo', 'content role');
    }

    res.status(201).json({
      sessionId: session._id,
      message: { ...serialiseMessage(message), senderName: req.user.name },
    });
  }),
);

/** Pin or unpin a message so it stays at the top of the thread. */
// ---------------------------------------------------------------------------
// The patient's nutrition thread — their side of the dietician conversation.
// ---------------------------------------------------------------------------

/** Read the nutrition thread. Empty until the dietician writes the first time. */
router.get(
  '/nutrition',
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await ChatSession.findOne({
      patient: req.user._id,
      kind: 'nutrition',
      isArchived: false,
    }).sort({ lastMessageAt: -1 });

    if (!session) return res.json({ items: [] });

    const items = await ChatMessage.find({
      session: session._id,
      hiddenFor: { $ne: req.user._id },
    })
      .sort({ seq: 1 })
      .limit(300)
      .populate('sender', 'name avatarAssetId')
      .populate('attachments', 'kind mimeType transcript originalName sizeBytes')
      .lean();

    res.json({ items: items.map(serialiseMessage) });
  }),
);

/**
 * The patient writes to their dietician.
 *
 * Runs the identical triage the care thread runs. The dietician's thread is a
 * separate conversation, not a lesser one: a patient who types "my chest hurts"
 * here has said it to the clinic, and which inbox they happened to choose must
 * not decide whether anyone is paged. Without this the same words escalate in
 * one thread and vanish in the other.
 */
router.post(
  '/nutrition',
  requireAuth,
  chatLimiter,
  validate({
    body: z
      .object({
        content: z.string().trim().max(4000).optional().default(''),
        attachments: z.array(z.string()).max(5).default([]),
        // The nutrition thread quotes, pins and replies exactly as the care
        // thread does. It accepted none of it, so the patient's dietician chat
        // offered only Copy on a long press.
        replyTo: z.string().optional(),
        // The patient's live app language, so the assistant replies in it — the
        // care thread sends this too. Without it the nutrition assistant fell
        // back to the session language (the account default fixed at creation),
        // so a Bengali message on an English account got an English answer.
        language: z.enum(['en', 'bn', 'hi']).optional(),
      })
      .refine((b) => b.content.trim().length > 0 || b.attachments.length > 0, {
        message: 'Add a message or attach a photo',
        path: ['content'],
      }),
  }),
  audit('create', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const patientId = req.user._id;
    // Voice-only message → use the transcript as the text, so the nutrition
    // assistant answers what was said instead of an empty prompt.
    const text = await resolveVoiceText(req.body.content, req.body.attachments);
    let askedForMeal = false;

    let session = await ChatSession.findOne({
      patient: patientId,
      kind: 'nutrition',
      isArchived: false,
    }).sort({ lastMessageAt: -1 });

    if (!session) {
      session = await ChatSession.create({
        patient: patientId,
        kind: 'nutrition',
        language: req.user.language ?? 'en',
        title: 'Nutrition',
      });
    }

    // Resolve the reply language exactly as the care thread does: the app's live
    // language first, then the account, then the session's stored one. Using
    // only session.language (fixed at session creation) is why the dietician
    // assistant did not follow the patient's language like the doctor assistant.
    const replyLanguage = req.body.language ?? req.user.language ?? session.language ?? 'en';

    const context = await buildPatientContext(patientId);
    const triage = triageMessage({
      text,
      targets: context.targets,
      latestGlucose: context.latestGlucose,
    });

    const last = await ChatMessage.findOne({ session: session._id }).sort({ seq: -1 }).select('seq').lean();
    const message = await ChatMessage.create({
      session: session._id,
      patient: patientId,
      seq: (last?.seq ?? -1) + 1,
      role: 'user',
      content: text,
      language: session.language,
      attachments: req.body.attachments,
      replyTo: req.body.replyTo,
      triage: {
        urgency: triage.urgency,
        matchedRules: triage.matchedRules,
        redFlags: triage.redFlags.map((r) => r.label),
        ruleDriven: triage.ruleDriven,
      },
    });

    // Tell the dietician a question has arrived. Fire-and-forget: a push
    // that fails must not fail the patient's message, which is already saved.
    notifyDieticianOfPatientMessage(patientId, req.user.name, text).catch(() => {});

    if (triage.urgency === 'emergency' || triage.urgency === 'urgent') {
      const alert = await raiseAlert({
        patientId,
        severity: triage.urgency === 'emergency' ? 'emergency' : 'urgent',
        type: triage.alertType ?? 'chat_escalation',
        title: triage.redFlags[0]?.label ?? triage.findings[0]?.summary ?? 'Patient reported a concerning symptom',
        detail:
          `Sent to the dietician: "${text.slice(0, 500)}"\n\n` +
          `Triage findings:\n${triage.findings.map((f) => `- ${f.summary}`).join('\n')}`,
        source: { kind: 'chat', ref: message._id },
        matchedRules: triage.matchedRules,
      });
      await ChatMessage.findByIdAndUpdate(message._id, { alert: alert._id });
    }

    await ChatSession.findByIdAndUpdate(session._id, {
      lastMessageAt: message.createdAt,
      $inc: { messageCount: 1 },
      highestUrgency: triage.urgency,
    });

    // A photo sent to the dietician IS a food log entry. Recording it here
    // rather than asking the patient to also add it somewhere else removes the
    // question the two-screen version created — "do I log this or send it?" —
    // and means the dietician sees one item, not the same meal twice.
    if (req.body.attachments.length) {
      // Only IMAGE attachments are food photos. A voice note or a document must
      // never be filed as a meal or trigger the "which meal?" question — which
      // is exactly what happened when a nutrition voice note, stored with kind
      // 'other', slipped past a kind-only filter and was treated as a photo.
      const photos = await MediaAsset.find({
        _id: { $in: req.body.attachments },
        mimeType: { $regex: '^image/' },
      })
        .select('_id')
        .lean();

      // Only label it if the patient said which meal it was. Otherwise leave it
      // unlabelled and ask — a wrong label is worse than a missing one, because
      // the dietician reads it as fact.
      const stated = mealTypeFromText(text);

      for (const photo of photos) {
        await FoodLog.create({
          patient: patientId,
          mealType: stated ?? 'other',
          note: text,
          photo: photo._id,
          // Ties the log back to the message it arrived in, so opening either
          // one can find the other.
          sourceMessage: message._id,
        });
      }

      // Only a real food PHOTO with no meal named triggers the "which meal?"
      // question — a voice note (no photo) must fall through to the assistant.
      askedForMeal = photos.length > 0 && stated == null;
    }

    if (message.attachments?.length) {
      await message.populate('attachments', 'kind mimeType transcript originalName sizeBytes');
    }

    // The plan-bound assistant answers only what the dietician has already
    // decided. It stays silent when there is no plan to quote, when the
    // question is not covered, or when anything failed — the dietician
    // answering late beats the app answering differently from them.
    //
    // Skipped entirely on an escalation: a patient who has just reported a
    // symptom needs the clinic, not a sentence about their meal plan.
    // A plain text reply that names a meal labels the photo still waiting for
    // one. This is the other half of asking: the question is only worth putting
    // to the patient if their answer actually files the meal.
    if (!req.body.attachments.length) {
      const answered = mealTypeFromText(text);
      if (answered) {
        const pending = await FoodLog.findOne({
          patient: patientId,
          mealType: 'other',
          sourceMessage: { $ne: null },
        }).sort({ createdAt: -1 });

        // Only the most recent, and only if it is fresh — answering "lunch"
        // today must not relabel a photo from last week.
        if (pending && Date.now() - pending.createdAt.getTime() < 24 * 60 * 60 * 1000) {
          await FoodLog.updateOne({ _id: pending._id }, { mealType: answered });
        }
      }
    }

    // A photo with no meal named: ask, rather than guess from the clock.
    let assistantMessage = null;
    if (askedForMeal) {
      assistantMessage = await ChatMessage.create({
        session: session._id,
        patient: patientId,
        seq: message.seq + 1,
        role: 'assistant',
        content: WHICH_MEAL_PROMPT[replyLanguage] ?? WHICH_MEAL_PROMPT.en,
        language: replyLanguage,
      });
      await ChatSession.findByIdAndUpdate(session._id, {
        lastMessageAt: assistantMessage.createdAt,
        $inc: { messageCount: 1 },
      });
    } else if (
      triage.urgency !== 'emergency' &&
      triage.urgency !== 'urgent' &&
      // The dietician is holding this conversation, or has asked to. Their
      // message is coming; a second answer under it would contradict them.
      assistantShouldReply(session)
    ) {
      const reply = await nutritionReply({
        patientId,
        sessionId: session._id,
        text,
        language: replyLanguage,
      }).catch(() => null);

      if (reply) {
        assistantMessage = await ChatMessage.create({
          session: session._id,
          patient: patientId,
          seq: message.seq + 1,
          role: 'assistant',
          content: reply,
          language: replyLanguage,
        });
        await ChatSession.findByIdAndUpdate(session._id, {
          lastMessageAt: assistantMessage.createdAt,
          $inc: { messageCount: 1 },
        });
      }
    }

    res.status(201).json({
      message: serialiseMessage(message),
      reply: assistantMessage ? serialiseMessage(assistantMessage) : null,
      // So the app can show the same emergency card it shows in the care
      // thread, rather than the patient getting a silent send.
      triage: { urgency: triage.urgency },
    });
  }),
);

router.post(
  '/messages/:id/pin',
  requireAuth,
  validate({ body: z.object({ pinned: z.boolean() }) }),
  audit('update', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const message = await findVisibleMessage(req);
    message.pinnedAt = req.body.pinned ? new Date() : null;
    message.pinnedBy = req.body.pinned ? req.user._id : null;
    await message.save();
    res.json({ id: message._id, pinned: Boolean(message.pinnedAt) });
  }),
);

/**
 * Hide a message from the caller's own view.
 *
 * Never deletes. The conversation is part of a medical record, and an answer
 * the clinic acted on has to remain readable afterwards.
 *
 * A message carrying an emergency verdict cannot be hidden at all: it is the
 * evidence the clinic was paged, and losing it would break the audit trail at
 * the one point where it matters most.
 */
router.post(
  '/messages/:id/hide',
  requireAuth,
  audit('update', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const message = await findVisibleMessage(req);

    if (message.triage?.urgency === 'emergency' || message.alert) {
      throw badRequest(
        'This message is part of an emergency record and cannot be hidden. It shows the clinic was alerted.',
      );
    }

    await ChatMessage.updateOne({ _id: message._id }, { $addToSet: { hiddenFor: req.user._id } });
    res.status(204).end();
  }),
);

router.post(
  '/messages/:id/unhide',
  requireAuth,
  audit('update', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const message = await findVisibleMessage(req);
    await ChatMessage.updateOne({ _id: message._id }, { $pull: { hiddenFor: req.user._id } });
    res.status(204).end();
  }),
);

/**
 * Delete a message. Two scopes, matching every chat app the patient already
 * uses:
 *   - `me`       hides it from the caller's own view only (reversible; the same
 *                as /hide). Works on any message in a thread they can see.
 *   - `everyone` tombstones it for all participants. Only the message's OWN
 *                author may do this — a patient their own turns, a clinician or
 *                dietician the turns they personally sent; the assistant's turns
 *                are nobody's to delete, which also protects the audit trail of
 *                what the AI told the patient. Never allowed on an
 *                emergency/alerted message. The row and its text stay in the DB
 *                for the record; the serialiser just stops returning them.
 */
router.post(
  '/messages/:id/delete',
  requireAuth,
  validate({ body: z.object({ scope: z.enum(['me', 'everyone']) }) }),
  audit('update', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const message = await findVisibleMessage(req);

    if (message.triage?.urgency === 'emergency' || message.alert) {
      throw badRequest(
        'This message is part of an emergency record and cannot be deleted. It shows the clinic was alerted.',
      );
    }

    if (req.body.scope === 'me') {
      await ChatMessage.updateOne({ _id: message._id }, { $addToSet: { hiddenFor: req.user._id } });
      return res.status(204).end();
    }

    if (!isOwnMessage(message, req.user)) {
      throw badRequest('You can only delete your own messages for everyone.');
    }
    // A deleted message can't stay pinned to the top as an empty tombstone.
    message.deletedForEveryoneAt = new Date();
    message.deletedForEveryoneBy = req.user._id;
    message.pinnedAt = null;
    message.pinnedBy = null;
    await message.save();
    res.json({ id: message._id, deletedForEveryone: true });
  }),
);

/**
 * Rewrite your own message.
 *
 * Held to a fifteen-minute window, and the original is kept.
 *
 * This is a clinical record, which makes a silent rewrite genuinely unsafe: a
 * dietician may already have read "two rotis" and answered it before it became
 * "four". So an edit is always visible as an edit, the words the clinic
 * originally saw are preserved on the row, and after a quarter of an hour the
 * message stands as sent — by then it has almost certainly been read, and the
 * reply beneath it would stop making sense.
 *
 * Anything that raised an alert is frozen outright, for the same reason
 * deletion is: the alert quoted this text, and editing it would leave the
 * clinic's record of why it acted disagreeing with what it acted on.
 */
/**
 * Turn the assistant on or off for one patient's thread.
 *
 * Keyed on the patient and the kind of conversation rather than a session id,
 * because neither clinician screen has one: the doctor's thread and the
 * dietician's are both opened by patient, and the session behind them is the
 * server's business.
 *
 * A clinician's switch, not a patient's. The patient cannot know whether
 * anyone is free to take over, and a thread with the assistant off and nobody
 * watching is a question into silence.
 */
async function threadFor(patientId, kind) {
  return ChatSession.findOne({
    patient: patientId,
    kind: kind === 'nutrition' ? 'nutrition' : { $ne: 'nutrition' },
    isArchived: false,
  }).sort({ lastMessageAt: -1 });
}

const threadKind = z.object({ kind: z.enum(['care', 'nutrition']).default('care') });

/**
 * Read the switch for one thread.
 *
 * Its own endpoint so the control is self-contained. The doctor's thread and
 * the dietician's are fetched through two different repositories with two
 * different return types, and threading one boolean through both — so a widget
 * dropped into either could read it — is more plumbing than the flag is worth.
 */
router.get(
  '/patients/:patientId/assistant',
  requireAuth,
  requireRole(ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN),
  validate({ query: threadKind }),
  asyncHandler(async (req, res) => {
    const session = await threadFor(req.params.patientId, req.query.kind);
    // No thread yet means nothing has been turned off. On is the default.
    res.json({ assistantEnabled: session ? session.assistantEnabled !== false : true });
  }),
);

router.patch(
  '/patients/:patientId/assistant',
  requireAuth,
  requireRole(ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN),
  validate({ body: threadKind.extend({ enabled: z.boolean() }) }),
  audit('update', 'ChatSession'),
  asyncHandler(async (req, res) => {
    const session = await threadFor(req.params.patientId, req.body.kind);
    if (!session) throw notFound('No conversation with this patient yet');
    session.assistantEnabled = req.body.enabled;
    await session.save();
    res.json({ assistantEnabled: session.assistantEnabled });
  }),
);

/**
 * "I am reading this thread." Refreshed while the screen is open.
 *
 * A heartbeat rather than an open/close pair on purpose: a close that never
 * arrives — app killed, battery flat, tunnel — would mute a conversation
 * nobody is actually watching, indefinitely. This lapses on its own.
 */
router.post(
  '/patients/:patientId/presence',
  requireAuth,
  requireRole(ROLES.DOCTOR, ROLES.STAFF, ROLES.DIETICIAN),
  validate({ body: threadKind }),
  asyncHandler(async (req, res) => {
    const session = await threadFor(req.params.patientId, req.body.kind);
    // No thread yet is not an error: the clinician opened a patient who has
    // never written. There is simply nothing to hold back.
    if (!session) return res.status(204).end();
    session.clinicianPresentUntil = new Date(Date.now() + PRESENCE_TTL_MS);
    await session.save();
    res.json({ until: session.clinicianPresentUntil });
  }),
);

router.post(
  '/messages/:id/edit',
  requireAuth,
  validate({ body: z.object({ content: z.string().trim().min(1).max(20000) }) }),
  audit('update', 'ChatMessage'),
  asyncHandler(async (req, res) => {
    const message = await findVisibleMessage(req);

    if (message.deletedForEveryoneAt) {
      throw badRequest('This message was deleted.');
    }
    if (!isOwnMessage(message, req.user)) {
      throw badRequest('You can only edit your own messages.');
    }
    if (message.triage?.urgency === 'emergency' || message.alert) {
      throw badRequest(
        'This message is part of an emergency record and cannot be edited. It shows what the clinic was told.',
      );
    }
    // A voice note is not text and cannot be rewritten; there is nothing to
    // edit and the audio would then contradict the words beside it.
    if ((message.voiceNotes ?? []).length > 0) {
      throw badRequest('A voice note cannot be edited. Delete it and send another.');
    }

    const ageMs = Date.now() - new Date(message.createdAt).getTime();
    if (ageMs > EDIT_WINDOW_MS) {
      throw badRequest('Messages can only be edited within 15 minutes of sending.');
    }

    const next = req.body.content.trim();
    if (next === message.content) return res.json(serialiseMessage(message));

    // Only on the first edit: the point of reference is what the clinic saw
    // originally, not the previous revision.
    if (!message.originalContent) message.originalContent = message.content;
    message.content = next;
    message.editedAt = new Date();
    await message.save();

    res.json(serialiseMessage(message));
  }),
);

/**
 * Whether `user` is the author of `message`. A patient owns their own `user`
 * turns; a clinician/dietician owns the turns they personally sent. Everything
 * else — the assistant, the system — is nobody's to delete for everyone.
 */
function isOwnMessage(message, user) {
  if (message.role === 'user') return String(message.patient) === String(user._id);
  if (message.role === 'clinician' || message.role === 'dietician') {
    return message.sender != null && String(message.sender) === String(user._id);
  }
  return false;
}

/**
 * Loads a message the caller is entitled to act on: their own thread if they
 * are the patient, any patient's if they are clinical staff.
 */
async function findVisibleMessage(req) {
  const filter = { _id: req.params.id };
  if (req.user.role === ROLES.PATIENT) filter.patient = req.user._id;

  const message = await ChatMessage.findOne(filter);
  if (!message) throw notFound('Message not found');
  return message;
}

function serialiseSession(s) {
  return {
    id: s._id,
    title: s.title,
    language: s.language,
    messageCount: s.messageCount,
    highestUrgency: s.highestUrgency,
    lastMessageAt: s.lastMessageAt,
    flaggedForReview: s.flaggedForReview,
    createdAt: s.createdAt,
  };
}

/**
 * Reads the meal from what the patient actually wrote.
 *
 * The clock is not the answer. People photograph a plate after they have eaten,
 * often hours later and often at night — a lunch sent at 2am was being filed as
 * a snack purely because of when the phone was in their hand. Asking costs one
 * short question and is the only way to be right.
 *
 * Deliberately keyword matching rather than a model call: it is instant, it is
 * the same every time, and "lunch" is not a sentence that needs interpreting.
 */
function mealTypeFromText(text) {
  const t = (text ?? '').toLowerCase();
  if (/breakfast|subah|nashta/.test(t)) return 'breakfast';
  if (/lunch|dupur|dopahar/.test(t)) return 'lunch';
  if (/dinner|supper|raat|rati/.test(t)) return 'dinner';
  if (/snack|tiffin|nasta/.test(t)) return 'snack';
  return null;
}

function serialiseMessage(m) {
  // Deleted for everyone: return only enough to render a "message deleted"
  // tombstone in place. The words, files and quote are withheld even though the
  // row still exists for the medical record.
  if (m.deletedForEveryoneAt) {
    return {
      id: m._id,
      seq: m.seq,
      role: m.role,
      senderName: m.sender && typeof m.sender === 'object' ? (m.sender.name ?? null) : null,
      deletedForEveryone: true,
      content: '',
      attachments: [],
      citations: [],
      redFlags: [],
      urgency: 'routine',
      pinned: false,
      replyToId: null,
      replyPreview: null,
      createdAt: m.createdAt,
    };
  }
  return {
    id: m._id,
    seq: m.seq,
    role: m.role,
    deletedForEveryone: false,
    // Present on clinician turns once populated; null everywhere else.
    senderName: m.sender && typeof m.sender === 'object' ? (m.sender.name ?? null) : null,
    // The clinician's or dietician's own photo, so the patient sees the person
    // who wrote to them rather than a role icon standing in for them.
    senderAvatarUrl:
      m.sender && typeof m.sender === 'object' && m.sender.avatarAssetId
        ? `/api/v1/uploads/${m.sender.avatarAssetId}/raw`
        : null,
    pinned: Boolean(m.pinnedAt),
    // The thread shows "edited" from this; `originalContent` is deliberately
    // not sent — it is for the record, not for the other party to read back.
    editedAt: m.editedAt ?? null,
    replyToId: m.replyTo
      ? (m.replyTo._id ? String(m.replyTo._id) : (m.replyTo.toString?.() ?? String(m.replyTo)))
      : null,
    // Text of the quoted turn, so the reply renders its quote on every device
    // without needing the original message loaded on that side.
    replyPreview:
      m.replyTo && typeof m.replyTo === 'object' && m.replyTo.content != null
        ? { content: String(m.replyTo.content).slice(0, 160), role: m.replyTo.role ?? null }
        : null,
    seenByClinicAt: m.seenByClinicAt ?? null,
    content: m.content,
    language: m.language,
    urgency: m.triage?.urgency ?? 'routine',
    redFlags: m.triage?.redFlags ?? [],
    citations: (m.citations ?? []).map((c) => ({ id: c.chunk, title: c.title })),
    isFallback: m.isFallback ?? false,
    // Populated attachments carry kind and mimeType so the client knows whether
    // to draw a thumbnail or an audio player; an unpopulated id still yields a
    // usable url, which is what the streaming path sends before it reloads.
    attachments: (m.attachments ?? []).map((a) => {
      const id = (a?._id ?? a).toString?.() ?? a;
      return {
        id,
        url: `/api/v1/uploads/${id}/raw`,
        kind: a?.kind ?? null,
        mimeType: a?.mimeType ?? null,
        // Filename + size, so a shared document renders as a named file card.
        name: a?.originalName ?? null,
        sizeBytes: a?.sizeBytes ?? null,
        // Shown under a voice note so the thread stays skimmable without
        // playing every clip — and readable at all for a deaf patient.
        transcript: a?.transcript ?? null,
      };
    }),
    createdAt: m.createdAt,
  };
}

export default router;
