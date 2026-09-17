import { User, ROLES } from '../models/User.js';
import { getMessaging } from '../config/firebase.js';
import { ClinicalAlert } from '../models/ClinicalAlert.js';
import { logger } from '../config/logger.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { ChatSession } from '../models/ChatSession.js';
import { ChatMessage } from '../models/ChatMessage.js';
import { practicesOfPatient, practiceOfAppointment, memberIdsOf } from '../middleware/practiceScope.js';

/**
 * Notification transport.
 *
 * Sends through FCM when credentials are configured, and logs instead when they
 * are not — so a development machine without a service-account key still runs
 * every caller unchanged.
 *
 * Failures never propagate. This channel carries medication reminders and the
 * alert that a patient reported chest pain; a push provider having a bad minute
 * must not roll back the clinical write that triggered it. The alert is already
 * persisted and visible in the clinician panel regardless.
 */
/**
 * Exported so the billing surfaces can use it too.
 *
 * Kept private for a long time on purpose — a shared push helper invites a push
 * from anywhere. It is exported rather than reimplemented because the retry,
 * the token pruning and the size limits in here are the parts nobody would get
 * right a second time.
 */
export async function deliver({ tokens, title, body, data }) {
  if (!tokens?.length) {
    logger.debug({ title }, 'no device tokens registered; notification skipped');
    return { delivered: 0 };
  }

  const messaging = getMessaging();
  if (!messaging) {
    logger.info({ title, body, tokenCount: tokens.length, data }, '[push] no credentials; logged only');
    return { delivered: 0 };
  }

  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      // FCM requires every data value to be a string.
      data: Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v ?? '')])),
      android: {
        // Clinical notifications are the reason this app has push at all, so
        // they are exempted from Doze batching rather than arriving whenever
        // the device next wakes.
        priority: 'high',
        // Must match the channel NotificationService creates on the device; an
        // unknown id silently demotes the notification to a default channel.
        notification: { channelId: 'clinq_updates', sound: 'default' },
      },
    });

    // A token rejected as unregistered belongs to an uninstalled or restored
    // app and will never deliver again. Removing it keeps the next send from
    // wasting a slot and quietly reporting success.
    const dead = [];
    response.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await User.updateMany({ deviceTokens: { $in: dead } }, { $pull: { deviceTokens: { $in: dead } } });
      logger.info({ removed: dead.length }, 'pruned dead device tokens');
    }

    logger.info({ title, delivered: response.successCount, failed: response.failureCount }, 'push sent');
    return { delivered: response.successCount };
  } catch (err) {
    logger.error({ err, title }, 'push delivery failed');
    return { delivered: 0 };
  }
}

/**
 * Data-only delivery. No `notification` block, so the CLIENT builds the local
 * notification itself — which lets a medication-reminder push carry the same
 * notification id as the on-device alarm and collapse onto it instead of
 * double-reminding. (A notification-block message is drawn by the system with
 * its own id and cannot be deduped against the local alarm.)
 */
async function deliverData({ tokens, data }) {
  if (!tokens?.length) return { delivered: 0 };
  const messaging = getMessaging();
  if (!messaging) {
    logger.info({ data, tokenCount: tokens.length }, '[push] no credentials; data push logged only');
    return { delivered: 0 };
  }
  try {
    const response = await messaging.sendEachForMulticast({
      tokens,
      data: Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v ?? '')])),
      android: { priority: 'high' },
    });
    const dead = [];
    response.responses.forEach((r, i) => {
      const code = r.error?.code;
      if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-argument') {
        dead.push(tokens[i]);
      }
    });
    if (dead.length) {
      await User.updateMany({ deviceTokens: { $in: dead } }, { $pull: { deviceTokens: { $in: dead } } });
    }
    return { delivered: response.successCount };
  } catch (err) {
    logger.error({ err }, 'data push delivery failed');
    return { delivered: 0 };
  }
}

/**
 * Fires one medication-reminder push (data-only) to a patient's devices — the
 * cron's backstop for the on-device alarm. [notifId] MUST equal the client's
 * deterministic id for this (med, slot, day) so the two collapse into a single
 * notification rather than reminding twice.
 */
/**
 * How stale a phone's "my alarms are armed" report may be and still be trusted.
 *
 * Two days, because the report is posted every time the app arms — on launch,
 * on resume, after a dose is logged — so a patient who has opened the app at
 * all this week has a fresh one. Longer would keep trusting a phone that has
 * been silently broken for days; much shorter would send the loud envelope to
 * somebody who simply had a quiet weekend, and give them two of every reminder
 * for their trouble.
 */
const ARMED_REPORT_TTL_MS = 48 * 60 * 60 * 1000;

export async function sendMedicationReminderPush({ patientId, med, time, relationToMeal, notifId }) {
  const patient = await User.findById(patientId)
    .select('deviceTokens language remindersArmedAt')
    .lean();
  const tokens = patient?.deviceTokens ?? [];
  if (!tokens.length) return { delivered: 0 };

  const data = {
    kind: 'medication_reminder',
    notifId,
    medicationId: med._id?.toString?.() ?? String(med._id),
    name: med.name ?? 'your medicine',
    dose: med.dose ?? '',
    relationToMeal: relationToMeal ?? '',
    time: time ?? '',
  };

  // Can this phone draw its own reminder?
  //
  // A data-only message is silent until the app renders it, and the app cannot
  // render anything when it has been force-stopped — by the patient, or by the
  // battery manager these handsets ship with. That is precisely the case this
  // backstop exists for, so for those phones the message carries a notification
  // block and Android draws it without the app's help.
  //
  // The alternative was to always carry one, which would have meant every
  // healthy phone showing the reminder twice: the local alarm draws it, and a
  // system-drawn notification will not collapse onto that, because the id the
  // two sides share is only honoured when the app is the one drawing.
  //
  // So the phone says which it is. It reads the platform's pending-alarm table
  // after every arming pass and reports; a report inside
  // [ARMED_REPORT_TTL_MS] means the local alarm is live and this can stay
  // silent. No report, or a stale one, gets the drawn notification — the safe
  // direction, since being wrong that way costs one duplicate and being wrong
  // the other way costs the dose.
  const armedAt = patient?.remindersArmedAt;
  const canDrawItself =
    armedAt instanceof Date && Date.now() - armedAt.getTime() < ARMED_REPORT_TTL_MS;

  if (canDrawItself) return deliverData({ tokens, data });

  const copy = MEDICATION_BACKSTOP_COPY[patient?.language] ?? MEDICATION_BACKSTOP_COPY.en;
  return deliver({
    tokens,
    title: copy.title(med.name ?? 'your medicine'),
    body: copy.body(med.dose ?? '', relationToMeal ?? ''),
    data,
  });
}

/**
 * What the server writes when it has to draw the reminder itself.
 *
 * Only used on a phone whose app cannot run, so it is read on a lock screen
 * with no chance of the app adding anything to it. It names the medicine and
 * the dose and nothing else — a lock screen is visible to whoever picks the
 * phone up, and on a shared handset the rest of somebody's prescription is not
 * theirs to read.
 */
const MEDICATION_BACKSTOP_COPY = {
  en: {
    title: (name) => `Time for ${name}`,
    body: (dose, rel) =>
      [dose, rel === 'before_meal' ? 'before food' : rel === 'after_meal' ? 'after food' : '']
        .filter(Boolean)
        .join(' · ') || 'Tap to open MedPin.',
  },
  bn: {
    title: (name) => `${name} নেওয়ার সময়`,
    body: (dose, rel) =>
      [dose, rel === 'before_meal' ? 'খাবারের আগে' : rel === 'after_meal' ? 'খাবারের পরে' : '']
        .filter(Boolean)
        .join(' · ') || 'MedPin খুলতে ট্যাপ করুন।',
  },
  hi: {
    title: (name) => `${name} लेने का समय`,
    body: (dose, rel) =>
      [dose, rel === 'before_meal' ? 'खाने से पहले' : rel === 'after_meal' ? 'खाने के बाद' : '']
        .filter(Boolean)
        .join(' · ') || 'MedPin खोलने के लिए टैप करें।',
  },
};

/**
 * Localized copy for the two patient-engagement nudges. The frame is
 * translated; a test name inside it stays as the doctor typed it (medical
 * terms like "HbA1c" are not translated on a lab form anywhere).
 */
const GLUCOSE_CHECKIN_COPY = {
  en: {
    title: 'Time for a blood-sugar check',
    recent: "Log today's reading so your doctor sees the latest.",
    lapsed: (n) => `It's been ${n} days since your last reading — a quick check keeps your trend accurate.`,
  },
  bn: {
    title: 'রক্তে শর্করা মাপার সময়',
    recent: 'আজকের রিডিং রেকর্ড করুন যাতে আপনার ডাক্তার সর্বশেষ তথ্য দেখতে পান।',
    lapsed: (n) => `আপনার শেষ রিডিং-এর ${n} দিন হয়ে গেছে — একটি রিডিং আপনার ট্রেন্ড সঠিক রাখে।`,
  },
  hi: {
    title: 'ब्लड शुगर जांचने का समय',
    recent: 'आज की रीडिंग दर्ज करें ताकि आपके डॉक्टर को ताज़ा जानकारी दिखे।',
    lapsed: (n) => `आपकी पिछली रीडिंग को ${n} दिन हो गए — एक रीडिंग आपका ट्रेंड सही रखती है।`,
  },
};

const LAB_NUDGE_COPY = {
  en: {
    title: 'Lab report pending',
    fallbackTest: 'the test your doctor advised',
    body: (test) => `Your doctor advised ${test}. Upload the report when it's ready — tap to add it.`,
  },
  bn: {
    title: 'ল্যাব রিপোর্ট বাকি আছে',
    fallbackTest: 'ডাক্তারের পরামর্শ দেওয়া পরীক্ষা',
    body: (test) => `আপনার ডাক্তার ${test} করাতে বলেছেন। রিপোর্ট তৈরি হলে আপলোড করুন — যোগ করতে ট্যাপ করুন।`,
  },
  hi: {
    title: 'लैब रिपोर्ट बाकी है',
    fallbackTest: 'डॉक्टर की सलाह दी गई जांच',
    body: (test) => `आपके डॉक्टर ने ${test} की सलाह दी है। रिपोर्ट तैयार होने पर अपलोड करें — जोड़ने के लिए टैप करें।`,
  },
};

/**
 * A morning "log a blood sugar" nudge. Sent only by patientReminderCron, which
 * decides who is due and backs off so this never becomes a daily drumbeat. The
 * `kind` routes the tap to the Home check-in.
 */
export async function sendGlucoseCheckinPush({ patient, gapDays }) {
  const tokens = patient.deviceTokens ?? [];
  if (!tokens.length) return { delivered: 0 };
  const copy = GLUCOSE_CHECKIN_COPY[patient.language] ?? GLUCOSE_CHECKIN_COPY.en;
  return deliver({
    tokens,
    title: copy.title,
    body: gapDays <= 1 ? copy.recent : copy.lapsed(gapDays),
    data: { kind: 'glucose_checkin' },
  });
}

/**
 * A "your lab report is still pending" nudge, naming one advised test. Sent at
 * most three times per report by patientReminderCron. The `kind` routes the tap
 * to the lab-tests upload screen.
 */
export async function sendLabUploadNudgePush({ patient, tests }) {
  const tokens = patient.deviceTokens ?? [];
  if (!tokens.length) return { delivered: 0 };
  const copy = LAB_NUDGE_COPY[patient.language] ?? LAB_NUDGE_COPY.en;
  const first = (tests ?? []).filter(Boolean)[0] ?? copy.fallbackTest;
  return deliver({
    tokens,
    title: copy.title,
    body: copy.body(first),
    data: { kind: 'lab_upload' },
  });
}

/**
 * The people at a patient's own practice who should be woken up.
 *
 * ---- Every fan-out in this file was the whole platform ------------------
 *
 * `User.find({ role: DOCTOR, isActive: true })` is the right query for a clinic
 * and the wrong one for a product with two of them. Once a second practice
 * existed, its doctor's phone buzzed with the first one's emergencies — and the
 * body of that push carries a patient's name and the first 180 characters of
 * what is wrong with them.
 *
 * That is a worse leak than the screens, because it needs nobody to go looking.
 * It arrives on a lock screen belonging to somebody with no relationship to the
 * patient at all.
 *
 * ---- Whose patient ------------------------------------------------------
 *
 * Every practice actively caring for them, from their enrolments — see
 * `practicesOfPatient`. This asked the assigned doctor alone, and the desk
 * enrolling a patient by phone assigns none: for exactly the patients a second
 * practice brings, the answer was "unknown", and unknown woke everybody.
 *
 * ---- Nobody, never everybody ----------------------------------------------
 *
 * A patient no practice is caring for — someone who signed up in the app and
 * has not been enrolled anywhere — reaches nobody. This used to fall back to
 * every doctor and front-desk account on the platform, and the push carries the
 * patient's name and the first 180 characters of what is wrong: the exact
 * people with no relationship to the patient were the ones woken. Nothing is
 * sent, and the gap is logged so an operator can see it.
 *
 * The same holds when a practice's memberships cannot be read at all (a
 * database that was never migrated): nobody, loudly — not the whole platform.
 *
 * Exported so that whose phones ring can be asked directly.
 */
export async function staffFor(patientId, roles) {
  const wanted = [].concat(roles);
  const practices = patientId ? await practicesOfPatient(patientId) : [];

  if (!practices.length) {
    logger.warn(
      { patientId: patientId ? String(patientId) : null, roles: wanted },
      'notification has no practice to go to; nobody was notified',
    );
    return [];
  }

  const lists = await Promise.all(practices.map((practiceId) => memberIdsOf(practiceId, wanted)));
  if (lists.some((list) => list === null)) {
    logger.error(
      { patientId: String(patientId), practices: practices.map(String) },
      'practice memberships could not be read; nobody was notified',
    );
    return [];
  }

  const ids = [...new Set(lists.flat().map(String))];
  if (!ids.length) return [];

  return User.find({
    _id: { $in: ids },
    role: { $in: wanted },
    isActive: true,
  })
    .select('_id deviceTokens name')
    .lean();
}

export async function notifyClinicStaff(alert) {
  // An alert names its patient, and that patient names the practice whose
  // phones should ring.
  const staff = await staffFor(alert.patient, [ROLES.DOCTOR, ROLES.STAFF]);

  const tokens = staff.flatMap((s) => s.deviceTokens ?? []);
  const { delivered } = await deliver({
    tokens,
    title: `${alert.severity === 'emergency' ? '🚨 EMERGENCY' : '⚠️ Urgent'}: ${alert.title}`,
    body: alert.detail?.slice(0, 180) ?? '',
    data: { alertId: alert._id.toString(), patientId: alert.patient.toString(), type: alert.type },
  });

  // "Notified" only when somebody's phone was actually reached. The attempt is
  // kept either way, so zero delivered is on the record rather than invisible.
  const now = new Date();
  await ClinicalAlert.findByIdAndUpdate(alert._id, {
    $set: {
      staffNotification: { attemptedAt: now, recipients: staff.length, delivered },
      ...(delivered > 0 ? { notifiedStaffAt: now } : {}),
    },
  });
}

/**
 * A patient has written into the care thread.
 *
 * This did not exist, and its absence was the whole of "no notifications come
 * to the clinic panel". A patient message raised a push only when triage
 * escalated it — so a chest-pain message reached the desk in seconds and
 * "doctor, my sugar was 340 this morning" reached nobody at all. The in-app
 * bell counted it, which only helps somebody already holding the phone.
 *
 * To the doctor and the desk both. The desk answers the routine ones and knows
 * when to walk the phone over; the doctor is the one who can actually answer a
 * clinical question, and neither can pick it up without being told.
 *
 * Skipped when an alert already fired for the same message: two buzzes for one
 * sentence, seconds apart, is how a clinic learns to swipe this app away.
 */
export async function notifyClinicOfPatientMessage(patientId, text, { escalated = false } = {}) {
  if (escalated) return { delivered: 0, skipped: 'alerted' };

  // Looked up here rather than taken as an argument. The one caller has a
  // patient context that does not carry a name, and threading one through for
  // this would be a change to the assistant's context object to suit a push.
  const patient = await User.findById(patientId).select('name').lean();

  const staff = await staffFor(patientId, [ROLES.DOCTOR, ROLES.STAFF]);

  const tokens = staff.flatMap((s) => s.deviceTokens ?? []);
  if (!tokens.length) return { delivered: 0 };

  const body = (text ?? '').trim();
  return deliver({
    tokens,
    title: `Message from ${patient?.name || 'a patient'}`,
    // Truncated rather than sent whole: a notification is a summons, and the
    // full text belongs behind the tap, on a screen that marks it read.
    body: body.length > 160 ? `${body.slice(0, 157)}…` : body || 'Sent an attachment',
    data: {
      kind: 'patient_message',
      patientId: patientId.toString(),
    },
  });
}

export async function notifyPatient(patientId, alert) {
  const patient = await User.findById(patientId).select('deviceTokens language').lean();
  if (!patient) return;

  await deliver({
    tokens: patient.deviceTokens ?? [],
    title: 'Please seek medical attention',
    body: alert.title,
    data: { alertId: alert._id.toString(), type: alert.type },
  });

  await ClinicalAlert.findByIdAndUpdate(alert._id, { notifiedPatientAt: new Date() });
}

/** The clinic has replied inside the patient's assistant thread. */
export async function notifyPatientOfClinicianReply(
  patientId,
  clinician,
  content,
  { threadKind = 'care' } = {},
) {
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  await deliver({
    tokens: patient?.deviceTokens ?? [],
    title: `${clinician.name} replied`,
    body: content.slice(0, 180),
    // `kind` lets the app route the tap straight to the conversation.
    // Which thread this landed in, not who wrote it.
    //
    // Every clinician reply said `clinician_reply`, and the app maps that to
    // the care thread — so a dietician answering "can I eat this?" refreshed
    // the doctor's conversation and left the nutrition one, the one that had
    // actually changed, showing nothing. Tapping the notification opened the
    // wrong thread too. The app already had a `dietician_reply` branch waiting
    // for a message that was never sent.
    //
    // Keyed on the thread rather than the sender's role because a doctor can
    // step into the nutrition thread to guide a dietician, and when he does the
    // patient's nutrition thread is still the one to open.
    data: {
      kind: threadKind === 'nutrition' ? 'dietician_reply' : 'clinician_reply',
      patientId: patientId.toString(),
    },
  });
}

/**
 * A patient has written in their nutrition thread.
 *
 * The reverse of [notifyPatientOfClinicianReply], which was the only half of
 * this conversation that existed: the patient was told when the clinic
 * answered, but nobody told the clinic a question had been asked. A patient
 * asking "can I eat this?" in the evening waited until the dietician next
 * happened to open the app.
 *
 * Goes to the dietician the patient is assigned to, and to nobody else. A
 * message about somebody else's patient is a message the reader cannot act on.
 */
/**
 * The dieticians who should hear about this patient.
 *
 * Mirrors `scopeFilter` in routes/dietician.js, and it has to: that rule says a
 * dietician with no explicit assignments covers the whole clinic, so in the
 * common setup — one dietician, nobody individually assigned — every patient is
 * theirs. This function used to require an explicit assignment, so their
 * dashboard listed all seven patients, the bell counted the unread messages,
 * and no push ever fired for any of them.
 *
 * Two shapes, matching that rule exactly: a patient with an assigned dietician
 * belongs to them alone, and everyone else belongs to whichever dieticians are
 * covering the clinic at large.
 */
/**
 * Which of the covering dieticians a patient's message should reach.
 *
 * Split out from the queries so the rule itself can be read and tested. Every
 * argument is already resolved: `pool` is the dieticians currently covering the
 * clinic at large, `lastReplierId` is whichever of them answered this patient
 * most recently, `urgency` is the triage on the message that just arrived.
 *
 * @param {{pool: Array<{_id: any}>, lastReplierId: string|null, urgency: string|null}} input
 */
export function routeToDieticians({ pool, lastReplierId, urgency }) {
  // One dietician covering the clinic is the whole clinic's dietician. This is
  // the setup the app launched with and it was never wrong — the fan-out only
  // becomes a problem when there is someone else it could have gone to.
  if (pool.length <= 1) return pool;

  // An urgent or emergency message goes to everyone covering.
  //
  // The ownership rule below is a courtesy — it stops two dieticians being
  // pinged about a question one of them is already handling. It must never
  // decide that nobody hears about chest pain because the person who usually
  // answers this patient is off today.
  if (urgency === 'urgent' || urgency === 'emergency') return pool;

  // Whoever answered this patient last owns the conversation. They have the
  // history, the plan and the context; a second dietician arriving cold adds
  // nothing and two people drafting the same reply is worse than one.
  if (lastReplierId) {
    const owner = pool.find((d) => String(d._id) === String(lastReplierId));
    if (owner) return [owner];
  }

  // Nobody has answered this patient yet, so nobody owns them. Everyone
  // covering hears about it, and the first to reply becomes the owner by the
  // rule above.
  return pool;
}

/**
 * The dieticians who should hear about this patient.
 *
 * Visibility and notification are deliberately different things here.
 * `scopeFilter` in routes/dietician.js decides who may *see* a patient, and it
 * stays wide on purpose: any covering dietician can open any unrestricted
 * patient and help. This decides who gets *woken up*, which is a narrower
 * question — a push about a conversation somebody else is already having is
 * noise, and two dieticians answering the same question is worse than noise.
 *
 * Three shapes:
 *  - a patient the doctor has assigned belongs to that dietician alone;
 *  - everyone else belongs to the dieticians covering the clinic at large;
 *  - and among those, to whichever one is already in the conversation.
 */
async function dieticiansFor(patientId, { urgency } = {}) {
  const profile = await PatientProfile.findOne({ user: patientId })
    .select('assignedDietician')
    .lean();

  // The doctor's explicit assignment wins over everything below it. It is the
  // one place a human has said who is responsible for this patient.
  if (profile?.assignedDietician) {
    const one = await User.findOne({ _id: profile.assignedDietician, isActive: true })
      .select('deviceTokens')
      .lean();
    return one ? [one] : [];
  }

  const dieticians = await staffFor(patientId, ROLES.DIETICIAN);
  if (dieticians.length === 0) return [];

  // Only the ones whose scope is the clinic. A dietician with their own named
  // list has said what they cover, and an unassigned patient is not on it.
  const assignedCounts = await PatientProfile.aggregate([
    { $match: { assignedDietician: { $in: dieticians.map((d) => d._id) } } },
    { $group: { _id: '$assignedDietician', n: { $sum: 1 } } },
  ]);
  const hasOwnList = new Set(assignedCounts.map((a) => String(a._id)));
  const pool = dieticians.filter((d) => !hasOwnList.has(String(d._id)));

  // Skip the lookup entirely when the answer cannot depend on it.
  if (pool.length <= 1 || urgency === 'urgent' || urgency === 'emergency') {
    return routeToDieticians({ pool, lastReplierId: null, urgency });
  }

  return routeToDieticians({
    pool,
    lastReplierId: await lastDieticianToReply(patientId, pool),
    urgency,
  });
}

/**
 * The dietician who most recently answered this patient, if any.
 *
 * Constrained to senders in [pool], so a doctor answering in the nutrition
 * thread does not erase the dietician who was handling it — the query walks
 * back past them to the last reply that was actually a covering dietician's.
 */
async function lastDieticianToReply(patientId, pool) {
  const session = await ChatSession.findOne({ patient: patientId, kind: 'nutrition' })
    .select('_id')
    .lean();
  if (!session) return null;

  const last = await ChatMessage.findOne({
    session: session._id,
    role: 'clinician',
    sender: { $in: pool.map((d) => d._id) },
  })
    .sort({ seq: -1 })
    .select('sender')
    .lean();

  return last?.sender ? String(last.sender) : null;
}

export async function notifyDieticianOfPatientMessage(patientId, patientName, content, { urgency } = {}) {
  const recipients = await dieticiansFor(patientId, { urgency });
  const tokens = recipients.flatMap((d) => d.deviceTokens ?? []);
  if (tokens.length === 0) return;

  await deliver({
    tokens,
    title: `${patientName} sent a message`,
    body: (content ?? '').slice(0, 180),
    data: { kind: 'nutrition_message', patientId: patientId.toString() },
  });
}

/**
 * A doctor has put a patient on this dietician's list.
 *
 * Work arriving. Without this it showed up only if the dietician happened to
 * open their dashboard and notice a count had gone up.
 */
export async function notifyDieticianOfAssignment(dieticianId, patientName) {
  const dietician = await User.findOne({ _id: dieticianId, isActive: true })
    .select('deviceTokens')
    .lean();
  if (!dietician?.deviceTokens?.length) return;

  await deliver({
    tokens: dietician.deviceTokens,
    title: 'New patient assigned',
    body: `${patientName} has been added to your list and needs a diet plan.`,
    data: { kind: 'dietician_assignment' },
  });
}

/**
 * A practice has been made, and this person owns it.
 *
 * Sent when an operator creates a practice or approves an application, to the
 * phones the owner's account is already signed in on — which, for somebody new
 * to MedPin, is none, and this sends nothing. Their first way in is the number
 * they proved: they sign in with a texted code, and nobody set a password for
 * them. An operator who gave an email is told separately (see the admin route);
 * a text message would need a template approved for it, and there is none yet.
 *
 * Returns how many devices it was addressed to, so the console can say whether
 * anybody heard.
 */
export async function notifyOwnerOfNewPractice({ userId, practiceName, managesOnly = false }) {
  const owner = await User.findOne({ _id: userId, isActive: true }).select('deviceTokens').lean();
  const tokens = owner?.deviceTokens ?? [];
  if (!tokens.length) return { devices: 0 };

  await deliver({
    tokens,
    title: `${practiceName} is set up on MedPin`,
    body: managesOnly
      ? 'Open MedPin to add the practice’s doctors and staff.'
      : 'Open MedPin to check your locations and add your staff.',
    data: { kind: 'practice_ready' },
  });
  return { devices: tokens.length };
}

/** The doctor issued or updated a prescription — medicines and reminders changed. */
export async function notifyPatientOfPrescription(patientId, doctor) {
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  await deliver({
    tokens: patient?.deviceTokens ?? [],
    title: `${doctor?.name ?? 'Your doctor'} updated your prescription`,
    body: 'Open Medicines to see your updated medicines and reminders.',
    data: { kind: 'prescription' },
  });
}

/**
 * A clinician changed a patient's medicines outside a prescription.
 *
 * The gap this fills: `notifyPatientOfPrescription` only fires from the
 * prescriptions route, so a medicine added straight onto the patient profile
 * was silent. The Medicines tab changed under the patient, reminders were
 * scheduled for a drug nobody had told them about, and the first they knew of
 * it was an alarm at eight in the morning.
 *
 * Coalesced rather than sent per medicine. A doctor writing up a visit adds
 * four drugs in fifteen seconds, and four buzzes in fifteen seconds is how
 * people learn to switch notifications off — which then costs them the dose
 * reminders, which are the ones that matter.
 *
 * The window is in memory, so a clustered deployment could send one push per
 * worker. That is a real limit and the right fix is a job table; it is not
 * worth one here, because the failure mode is a duplicate notification rather
 * than a missing one.
 */
const pendingMedChanges = new Map();
const MED_CHANGE_WINDOW_MS = 45_000;

export function notifyPatientOfMedicineChange(patientId, clinician, kind) {
  const key = String(patientId);
  const existing = pendingMedChanges.get(key);

  if (existing) {
    existing.counts[kind] = (existing.counts[kind] ?? 0) + 1;
    existing.clinician = clinician ?? existing.clinician;
    return;
  }

  const entry = {
    clinician,
    counts: { [kind]: 1 },
    timer: setTimeout(() => {
      pendingMedChanges.delete(key);
      flushMedChange(key, entry).catch(() => {});
    }, MED_CHANGE_WINDOW_MS),
  };
  // Never hold the process open for a notification.
  entry.timer.unref?.();
  pendingMedChanges.set(key, entry);
}

async function flushMedChange(patientId, entry) {
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  const tokens = patient?.deviceTokens ?? [];
  if (tokens.length === 0) return;

  const { added = 0, changed = 0, stopped = 0 } = entry.counts;
  const parts = [];
  if (added) parts.push(`${added} added`);
  if (changed) parts.push(`${changed} changed`);
  if (stopped) parts.push(`${stopped} stopped`);
  const total = added + changed + stopped;

  await deliver({
    tokens,
    title: `${entry.clinician?.name ?? 'Your doctor'} updated your medicines`,
    // The counts, not the drug names. A push notification shows on a locked
    // screen, and what a patient is taking is not something to put in front of
    // whoever is holding the phone.
    body: `${total} ${total === 1 ? 'medicine' : 'medicines'} — ${parts.join(', ')}. Open Medicines to see the details.`,
    data: { kind: 'medication_change' },
  });
}

/**
 * A patient has booked, moved or cancelled an appointment.
 *
 * Sent the moment it happens rather than batched: a cancellation an hour from
 * now is only useful if the doctor hears about it in time to refill the slot.
 */
export async function notifyClinicOfAppointmentChange(appointment, patientName, change, opts = {}) {
  // A request is the desk's work, not the doctor's: he has already approved the
  // hours, and staff book inside them. Telling him about every request would
  // recreate the bottleneck the request path exists to remove. A confirmed or
  // cancelled appointment does reach him — that is his day changing.
  const deskOnly = opts.deskOnly === true;

  // Populated on some call paths and a bare id on others.
  const patientId = appointment.patient?._id ?? appointment.patient ?? null;

  let staff = await staffFor(patientId, deskOnly ? ROLES.STAFF : [ROLES.DOCTOR, ROLES.STAFF]);

  // A clinic with no staff account yet is every clinic on its first day. A
  // request nobody is told about is worse than one that interrupts the doctor
  // — but it is still only this practice's doctor.
  if (deskOnly && staff.length === 0) {
    staff = await staffFor(patientId, ROLES.DOCTOR);
  }

  // A request carries a preferred day and no time. Printing a time for it —
  // whatever the field happened to hold — would tell the desk the patient chose
  // an hour they never chose.
  const at = appointment.scheduledFor ?? appointment.preferredFor;
  const when = at
    ? new Date(at).toLocaleString('en-IN', {
        dateStyle: 'medium',
        ...(appointment.scheduledFor ? { timeStyle: 'short' } : {}),
        timeZone: 'Asia/Kolkata',
      })
    : 'a date to be arranged';

  const verb =
    { booked: 'booked', rescheduled: 'moved', cancelled: 'cancelled', requested: 'asked for' }[change] ?? change;

  await deliver({
    tokens: staff.flatMap((s) => s.deviceTokens ?? []),
    title: `Appointment ${verb}`,
    body: `${patientName} — ${when}`,
    data: {
      kind: 'appointment_change',
      change,
      appointmentId: appointment._id.toString(),
      patientId: appointment.patient.toString(),
    },
  });
}

/**
 * Tell the patient their appointment was cancelled, rejected or moved.
 *
 * The one notification a patient cannot afford to miss after an emergency
 * alert: without it they travel to the clinic for an appointment that is no
 * longer there. Reaches them whether the clinic or they themselves made the
 * change, because a reschedule confirmed on someone else's screen is not a
 * reschedule they know about.
 */
export async function notifyPatientOfAppointmentChange(appointment, change, reason) {
  const patientId = appointment.patient?._id ?? appointment.patient;
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  if (!patient) return;

  const when = new Date(appointment.scheduledFor).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  const title = {
    cancelled: 'Your appointment was cancelled',
    rejected: 'Your appointment could not be confirmed',
    rescheduled: 'Your appointment was moved',
  }[change] ?? 'Your appointment changed';

  await deliver({
    tokens: patient.deviceTokens ?? [],
    title,
    // The reason matters: "the doctor is unavailable" and "please come at a
    // different time" call for different things from the patient.
    body: reason ? `${when} — ${reason}` : `${when}. Please book another time.`,
    data: {
      kind: 'appointment_change_patient',
      change,
      appointmentId: appointment._id.toString(),
    },
  });
}

/**
 * Evening summary of the next day's list, for the doctor.
 *
 * Deliberately the evening before rather than the morning of: the point of
 * knowing the day's shape is to be able to act on it — move a clash, prepare
 * for a complex case, start late if the morning is empty — and by the time the
 * clinic opens, none of that is possible any more. Same-day changes are covered
 * by [notifyClinicOfAppointmentChange], which fires immediately.
 *
 * Caller supplies the appointments so this stays a pure transport function and
 * the scheduling query lives with the rest of the scheduling logic.
 */
/**
 * One appointment, tomorrow — told to the patient and to the doctor.
 *
 * Separate from the doctor's evening digest, and not a duplicate of it. The
 * digest is the shape of a day, for planning: "six tomorrow, first at 10:30".
 * This is a single appointment with a name and an hour on it, and the patient
 * gets it — which the digest never could, because a list of everyone coming
 * tomorrow is not something one patient may read.
 *
 * In the patient's language. A reminder nobody can read is one they miss.
 */
const VISIT_TOMORROW = {
  en: {
    title: 'Appointment tomorrow',
    body: (when) => `You are booked with the doctor tomorrow at ${when}.`,
  },
  bn: {
    title: 'আগামীকাল অ্যাপয়েন্টমেন্ট',
    body: (when) => `আগামীকাল ${when}-এ ডাক্তারের সঙ্গে আপনার সময় নির্ধারিত আছে।`,
  },
  hi: {
    title: 'कल अपॉइंटमेंट है',
    body: (when) => `कल ${when} बजे डॉक्टर के साथ आपका समय तय है।`,
  },
};

export async function notifyVisitTomorrow(appointment, { patient, doctorTokens = [] } = {}) {
  const at = appointment.scheduledFor;
  if (!at) return { delivered: 0 };

  const when = new Date(at).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  const sent = [];

  const patientTokens = patient?.deviceTokens ?? [];
  if (patientTokens.length) {
    const copy = VISIT_TOMORROW[patient?.language] ?? VISIT_TOMORROW.en;
    sent.push(
      deliver({
        tokens: patientTokens,
        title: copy.title,
        body: copy.body(when),
        data: { kind: 'appointment_tomorrow', appointmentId: appointment._id.toString() },
      }),
    );
  }

  if (doctorTokens.length) {
    sent.push(
      deliver({
        tokens: doctorTokens,
        title: `Tomorrow ${when}: ${patient?.name ?? 'a patient'}`,
        body: 'Appointment confirmed for tomorrow.',
        data: {
          kind: 'appointment_tomorrow',
          appointmentId: appointment._id.toString(),
          patientId: String(appointment.patient?._id ?? appointment.patient ?? ''),
        },
      }),
    );
  }

  const results = await Promise.all(sent);
  return { delivered: results.reduce((n, r) => n + (r?.delivered ?? 0), 0) };
}

/**
 * Tomorrow's list, to the doctors whose day it is.
 *
 * ---- One digest per practice, not one digest ---------------------------
 *
 * This is a cron over every appointment in the system, so before scoping it
 * counted them all and told every doctor on the platform the total. A practice
 * with three patients tomorrow was told it had forty, and the "first at" time
 * belonged to a clinic on the other side of the city.
 *
 * Wrong in both directions at once: it leaks the other practice's volume and it
 * misinforms about your own.
 */
export async function notifyClinicOfTomorrowSchedule(appointments) {
  // Nothing tomorrow: say nothing.
  //
  // A push every night of a clinic's every closed day, saying that nothing is
  // happening, is the notification that teaches someone to turn the rest of
  // them off. A doctor learns a clear day by opening the app; he cannot learn
  // a full one that way in time to do anything about it, which is the whole
  // reason this exists.
  if (!appointments.length) return { delivered: 0, skipped: 'empty' };

  // Grouped by whose day it is: the appointment's doctor's practice, or its
  // patient's when the doctor belongs to none. This grouped by the patient's
  // assigned doctor alone, which a patient the desk enrolled does not have, so
  // their appointments went into the digest sent to everybody. `null` is still
  // the unknown bucket — one digest to everybody — for a database where nothing
  // is enrolled yet.
  const byPractice = new Map();
  for (const appt of appointments) {
    const key = (await practiceOfAppointment(appt)) ?? null;
    if (!byPractice.has(key)) byPractice.set(key, []);
    byPractice.get(key).push(appt);
  }

  let delivered = 0;

  for (const [practiceId, theirs] of byPractice) {
    const ids = await memberIdsOf(practiceId, ROLES.DOCTOR);
    const doctors = await User.find({
      role: ROLES.DOCTOR,
      isActive: true,
      ...(ids ? { _id: { $in: ids } } : {}),
    })
      .select('deviceTokens')
      .lean();

    const tokens = doctors.flatMap((d) => d.deviceTokens ?? []);
    if (!tokens.length) continue;

    // Sorted per group: the caller sorted the whole list, and the earliest of
    // all of them is not the earliest of this practice's.
    const first = new Date(
      theirs.reduce((a, b) => (new Date(a.scheduledFor) <= new Date(b.scheduledFor) ? a : b))
        .scheduledFor,
    ).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });

    const out = await deliver({
      tokens,
      title: `Tomorrow: ${theirs.length} appointment${theirs.length === 1 ? '' : 's'}`,
      body: `First at ${first}.`,
      data: { kind: 'schedule_digest', count: String(theirs.length) },
    });
    delivered += out?.delivered ?? 0;
  }

  return { delivered };
}

/**
 * Tell a clinician that the day's patient conversations are summarised.
 *
 * Counts only. The body lands on a lock screen, which is no place for a
 * patient's name or words; the summaries are one tap away behind the app's own
 * sign-in.
 *
 * Sent only to somebody with at least one patient who wrote. A push every
 * evening saying nothing happened is the push that teaches somebody to turn
 * the rest off.
 */
export async function notifyClinicianOfChatDigest({ user, patients, needYou, day }) {
  const tokens = user?.deviceTokens ?? [];
  if (!tokens.length || !patients) return { delivered: 0 };

  const wrote = `${patients} patient${patients === 1 ? '' : 's'} wrote today.`;
  return deliver({
    tokens,
    title: 'Today’s patient conversations',
    body: needYou ? `${wrote} ${needYou} need${needYou === 1 ? 's' : ''} you.` : `${wrote} None needs you.`,
    data: { kind: 'chat_digest', day },
  });
}

/**
 * Tell waitlisted patients that a slot has opened on a day they wanted.
 *
 * Only patients who explicitly joined the waitlist are contacted — see
 * [AppointmentWaitlist] for why this is never a broadcast.
 *
 * Entries are notified highest clinical risk first. The slot still goes to
 * whoever books it, but the patient whose control is worst gets the head start,
 * which is the only ordering a clinic could defend.
 */
export async function notifyWaitlistOfFreedSlot(entries, appointment) {
  if (!entries.length) return { notified: 0 };

  const when = new Date(appointment.scheduledFor).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  const patients = await User.find({ _id: { $in: entries.map((e) => e.patient) } })
    .select('deviceTokens')
    .lean();

  const byId = new Map(patients.map((p) => [p._id.toString(), p]));

  for (const entry of entries) {
    const patient = byId.get(entry.patient.toString());
    await deliver({
      tokens: patient?.deviceTokens ?? [],
      title: 'An appointment has opened up',
      body: `${when} is now free. Book it before someone else does.`,
      data: {
        kind: 'slot_freed',
        appointmentAt: new Date(appointment.scheduledFor).toISOString(),
        clinicId: appointment.clinic?.toString() ?? '',
      },
    });
  }

  return { notified: entries.length };
}

