import { User, ROLES } from '../models/User.js';
import { getMessaging } from '../config/firebase.js';
import { ClinicalAlert } from '../models/ClinicalAlert.js';
import { logger } from '../config/logger.js';
import { PatientProfile } from '../models/PatientProfile.js';

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
async function deliver({ tokens, title, body, data }) {
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
export async function sendMedicationReminderPush({ patientId, med, time, relationToMeal, notifId }) {
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  const tokens = patient?.deviceTokens ?? [];
  if (!tokens.length) return { delivered: 0 };
  return deliverData({
    tokens,
    data: {
      kind: 'medication_reminder',
      notifId,
      medicationId: med._id?.toString?.() ?? String(med._id),
      name: med.name ?? 'your medicine',
      dose: med.dose ?? '',
      relationToMeal: relationToMeal ?? '',
      time: time ?? '',
    },
  });
}

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

export async function notifyClinicStaff(alert) {
  const staff = await User.find({ role: { $in: [ROLES.DOCTOR, ROLES.STAFF] }, isActive: true })
    .select('deviceTokens name')
    .lean();

  const tokens = staff.flatMap((s) => s.deviceTokens ?? []);
  await deliver({
    tokens,
    title: `${alert.severity === 'emergency' ? '🚨 EMERGENCY' : '⚠️ Urgent'}: ${alert.title}`,
    body: alert.detail?.slice(0, 180) ?? '',
    data: { alertId: alert._id.toString(), patientId: alert.patient.toString(), type: alert.type },
  });

  await ClinicalAlert.findByIdAndUpdate(alert._id, { notifiedStaffAt: new Date() });
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
export async function notifyPatientOfClinicianReply(patientId, clinician, content) {
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  await deliver({
    tokens: patient?.deviceTokens ?? [],
    title: `${clinician.name} replied`,
    body: content.slice(0, 180),
    // `kind` lets the app route the tap straight to the conversation.
    data: { kind: 'clinician_reply', patientId: patientId.toString() },
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
async function dieticiansFor(patientId) {
  const profile = await PatientProfile.findOne({ user: patientId })
    .select('assignedDietician')
    .lean();

  if (profile?.assignedDietician) {
    const one = await User.findOne({ _id: profile.assignedDietician, isActive: true })
      .select('deviceTokens')
      .lean();
    return one ? [one] : [];
  }

  const dieticians = await User.find({ role: ROLES.DIETICIAN, isActive: true })
    .select('_id deviceTokens')
    .lean();
  if (dieticians.length === 0) return [];

  // Only the ones whose scope is the clinic. A dietician with their own named
  // list has said what they cover, and an unassigned patient is not on it.
  const assignedCounts = await PatientProfile.aggregate([
    { $match: { assignedDietician: { $in: dieticians.map((d) => d._id) } } },
    { $group: { _id: '$assignedDietician', n: { $sum: 1 } } },
  ]);
  const hasOwnList = new Set(assignedCounts.map((a) => String(a._id)));
  return dieticians.filter((d) => !hasOwnList.has(String(d._id)));
}

export async function notifyDieticianOfPatientMessage(patientId, patientName, content) {
  const recipients = await dieticiansFor(patientId);
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
export async function notifyClinicOfAppointmentChange(appointment, patientName, change) {
  const staff = await User.find({ role: { $in: [ROLES.DOCTOR, ROLES.STAFF] }, isActive: true })
    .select('deviceTokens')
    .lean();

  const when = new Date(appointment.scheduledFor).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Kolkata',
  });

  const verb = { booked: 'booked', rescheduled: 'moved', cancelled: 'cancelled' }[change] ?? change;

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
export async function notifyClinicOfTomorrowSchedule(appointments) {
  const doctors = await User.find({ role: ROLES.DOCTOR, isActive: true }).select('deviceTokens').lean();
  const tokens = doctors.flatMap((d) => d.deviceTokens ?? []);

  if (!appointments.length) {
    await deliver({
      tokens,
      title: 'Tomorrow: no appointments',
      body: 'Your schedule is clear.',
      data: { kind: 'schedule_digest', count: '0' },
    });
    return;
  }

  const first = new Date(appointments[0].scheduledFor).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });

  await deliver({
    tokens,
    title: `Tomorrow: ${appointments.length} appointment${appointments.length === 1 ? '' : 's'}`,
    body: `First at ${first}.`,
    data: { kind: 'schedule_digest', count: String(appointments.length) },
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

export async function notifyMedicationReminder(patientId, medication) {
  const patient = await User.findById(patientId).select('deviceTokens').lean();
  await deliver({
    tokens: patient?.deviceTokens ?? [],
    title: 'Medication reminder',
    body: `Time to take ${medication.name}`,
    data: { medicationId: medication._id.toString(), kind: 'medication_reminder' },
  });
}
