import mongoose from 'mongoose';

import { Feedback, FEEDBACK_ABOUT, FEEDBACK_ROUTE, FEEDBACK_STATE } from '../models/Feedback.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { Membership, MEMBERSHIP_STATUS, PERMISSIONS } from '../models/Membership.js';
import { Patient } from '../models/Patient.js';
import { Practice } from '../models/Practice.js';
import { User } from '../models/User.js';
import { DIRECT_PATIENT_ACCESS } from '../middleware/auth.js';
import { AppError, badRequest, forbidden, notFound } from '../middleware/errors.js';
import { loginMayAccess } from './patientsForLogin.js';
import { deliver } from './notifications.js';

/**
 * Where a piece of feedback goes, who may read it, and who is told.
 *
 * ---- The readers are the people who may open the patient ------------------
 *
 * Feedback is attributable — the inbox shows the patient's name, number and
 * photograph beside what they said — so reading it is reading about a patient.
 * The same two questions as any clinical read decide who may: a role that opens
 * patient records directly, and VIEW_PATIENT at that practice. A practice
 * manager, whose preset reads no clinical record, and a dietician, whose
 * patients are the ones assigned to them, are not readers of the whole
 * practice's feedback.
 *
 * The push goes to exactly those people and says nothing on the lock screen
 * about who wrote or what: the notification is a summons, and the words belong
 * behind the tap, on a screen that checks who is holding the phone.
 */

/** The login and household of a patient account, as strings, the login first. */
export async function householdOf(loginId) {
  const rows = await Patient.find({ login: loginId, isActive: true }).select('_id').lean();
  const ids = rows.map((r) => String(r._id));
  return [String(loginId), ...ids.filter((id) => id !== String(loginId))];
}

/** The practices a patient account may send clinic feedback to: every current enrolment in the household. */
export async function feedbackPractices(loginId) {
  const household = await householdOf(loginId);
  const enrollments = await Enrollment.find({
    patient: { $in: household },
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
  })
    .sort({ enrolledOn: 1, _id: 1 })
    .lean();
  const [practices, patients] = await Promise.all([
    Practice.find({ _id: { $in: enrollments.map((e) => e.practice) } }).select('name').lean(),
    Patient.find({ _id: { $in: enrollments.map((e) => e.patient) } }).select('name').lean(),
  ]);
  const practiceName = new Map(practices.map((p) => [String(p._id), p.name]));
  const patientName = new Map(patients.map((p) => [String(p._id), p.name]));
  return enrollments.map((e) => ({
    practiceId: String(e.practice),
    practiceName: practiceName.get(String(e.practice)) ?? null,
    patientId: String(e.patient),
    patientName: patientName.get(String(e.patient)) ?? null,
    isSelf: String(e.patient) === String(loginId),
  }));
}

/**
 * Decide where a new piece of feedback goes.
 *
 *   about the app                          → the platform
 *   about a clinic, naming a practice      → that practice, if somebody in the
 *                                            household is enrolled there; refused
 *                                            otherwise
 *   about a clinic, naming none            → the one practice the household is
 *                                            enrolled at; refused when there are
 *                                            several, because guessing which clinic
 *                                            a complaint meant is how it reaches
 *                                            the wrong one
 *   about a clinic, enrolled nowhere       → the platform, since no practice has
 *                                            taken this patient on
 *
 * Naming none is what every app build before this sends, and for a patient
 * with one practice it has only one meaning.
 */
export async function routeFeedback({ login, about, practiceId = null, patientId = null }) {
  const self = String(login._id);
  const platform = { route: FEEDBACK_ROUTE.PLATFORM, practice: null, enrollment: null, patient: self };
  if (about !== FEEDBACK_ABOUT.CLINIC) return platform;

  const named = patientId && patientId !== 'me' ? String(patientId) : null;
  if (named && !(await loginMayAccess(login._id, named))) {
    throw forbidden('That is not someone you look after.');
  }
  if (practiceId && !mongoose.isValidObjectId(practiceId)) {
    throw badRequest('You are not registered with that practice.');
  }

  const candidates = named ? [named] : await householdOf(login._id);
  const current = await Enrollment.find({
    patient: { $in: candidates },
    status: ENROLLMENT_STATUS.ACTIVE,
    revokedAt: null,
  })
    .sort({ enrolledOn: 1, _id: 1 })
    .lean();

  // The person it is about: the one named, else the account holder, else
  // whoever in the household is enrolled there.
  const preferred = (rows) => rows.find((e) => String(e.patient) === (named ?? self)) ?? rows[0];

  let chosen = null;
  if (practiceId) {
    chosen = preferred(current.filter((e) => String(e.practice) === String(practiceId)));
    if (!chosen) throw badRequest('You are not registered with that practice.');
  } else {
    const practices = [...new Set(current.map((e) => String(e.practice)))];
    if (practices.length > 1) throw badRequest('Choose which practice this feedback is about.');
    if (practices.length === 1) chosen = preferred(current);
  }

  if (!chosen) return platform;
  return {
    route: FEEDBACK_ROUTE.PRACTICE,
    practice: chosen.practice,
    enrollment: chosen._id,
    patient: String(chosen.patient),
  };
}

/**
 * Everybody who may read this practice's patient feedback: a role that opens
 * patient records directly, holding VIEW_PATIENT, currently a member.
 */
export async function feedbackReaders(practiceId) {
  if (!practiceId) return [];
  const rows = await Membership.find({
    practice: practiceId,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
    role: { $in: DIRECT_PATIENT_ACCESS },
  });
  const ids = rows.filter((m) => m.can(PERMISSIONS.VIEW_PATIENT)).map((m) => m.user);
  return User.find({ _id: { $in: ids }, isActive: true }).select('_id name deviceTokens').lean();
}

/** Tell the practice's readers something arrived. Nothing identifying on the lock screen. */
export async function notifyPracticeOfFeedback(feedback) {
  const readers = await feedbackReaders(feedback.practice);
  return deliver({
    tokens: readers.flatMap((r) => r.deviceTokens ?? []),
    title: 'New patient feedback',
    body: 'A patient has sent feedback about the clinic.',
    data: { kind: 'patient_feedback', feedbackId: String(feedback._id) },
  });
}

/** Tell the patient somebody answered. */
export async function notifyPatientOfFeedbackReply(feedback, fromName) {
  const login = await User.findById(feedback.createdBy ?? feedback.patient).select('deviceTokens').lean();
  return deliver({
    tokens: login?.deviceTokens ?? [],
    title: 'A reply to your feedback',
    body: `${fromName} replied to your feedback.`,
    data: { kind: 'feedback_reply', feedbackId: String(feedback._id) },
  });
}

/**
 * A reply, the idempotent way: the same key twice is one reply, the same key
 * for different words is refused, and no key always adds one.
 *
 * @returns {Promise<'added'|'replayed'>}
 */
export async function addReply(feedbackId, reply, idempotency = null) {
  const entry = {
    ...reply,
    at: new Date(),
    idempotencyKey: idempotency?.key ?? null,
    idempotencyHash: idempotency?.hash ?? null,
  };
  const filter = idempotency
    ? { _id: feedbackId, 'replies.idempotencyKey': { $ne: idempotency.key } }
    : { _id: feedbackId };
  // One update, so the check and the push cannot be split by a second retry
  // arriving between them.
  const result = await Feedback.updateOne(filter, {
    $push: { replies: entry },
    $set: { state: FEEDBACK_STATE.ANSWERED },
  });
  if (result.modifiedCount === 1) return 'added';
  if (!idempotency) throw notFound('Feedback not found');

  const existing = await Feedback.findById(feedbackId).select('replies').lean();
  const same = existing?.replies?.find((r) => r.idempotencyKey === idempotency.key);
  if (!same) throw notFound('Feedback not found');
  if (same.idempotencyHash === idempotency.hash) return 'replayed';
  throw new AppError(
    409,
    'IDEMPOTENCY_KEY_REUSED',
    'This request key was already used with different details. Nothing was changed.',
  );
}

/** Names for the people and practices a list of feedback rows mentions. */
export async function feedbackNames(rows) {
  const practiceIds = [...new Set(rows.map((f) => f.practice).filter(Boolean).map(String))];
  const userIds = [
    ...new Set(
      rows
        .flatMap((f) => [
          ...(f.readBy ?? []).map((r) => r.user),
          ...(f.replies ?? []).filter((r) => r.from === FEEDBACK_ROUTE.PRACTICE).map((r) => r.by),
        ])
        .filter(Boolean)
        .map(String),
    ),
  ];
  const [practices, users] = await Promise.all([
    Practice.find({ _id: { $in: practiceIds } }).select('name').lean(),
    User.find({ _id: { $in: userIds } }).select('name').lean(),
  ]);
  return {
    practice: new Map(practices.map((p) => [String(p._id), p.name])),
    user: new Map(users.map((u) => [String(u._id), u.name])),
  };
}
