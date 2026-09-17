import mongoose from 'mongoose';

import {
  ShareGrant,
  SHARE_CATEGORY,
  OWN_LOG_CATEGORIES,
  HISTORY_CATEGORIES,
  GRANT_STATE,
  GRANT_ORIGIN,
  REVOKE_REASON,
  grantCovers,
  grantStatus,
} from '../models/ShareGrant.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { ConsentEvent, CONSENT_ACTION, CONSENT_METHOD } from '../models/ConsentEvent.js';
import { Membership, MEMBERSHIP_STATUS } from '../models/Membership.js';
import { Practice } from '../models/Practice.js';
import { Patient } from '../models/Patient.js';
import { User, ROLES } from '../models/User.js';
import { AuditLog } from '../models/AuditLog.js';
import { badRequest, conflict, notFound } from '../middleware/errors.js';
import { isReplayOf, isKeyCollision } from '../middleware/idempotency.js';
import { logger } from '../config/logger.js';
import { deliver } from './notifications.js';

/**
 * Patient-controlled sharing: grants, requests, the questions asked once at
 * enrolment, and the reads a grant widens.
 *
 * ---- The one question a read asks ------------------------------------------
 *
 * `readUnderGrant(req, category)`: does a grant in force let this caller read
 * this category of this patient's record — and if so, write that down. Every
 * widening goes through it, so there is one definition of "covered" and one
 * audit trail, whatever the read is bounded by: the enrolment window today, or
 * who wrote the record when reads are bounded that way.
 *
 * ---- How a grant meets the enrolment window, today --------------------------
 *
 * The narrowest reading that still does what a patient means by "share":
 *
 *   - A practice's enrolment lets it read the patient's dated records from
 *     `enrolledOn` forward. That is unchanged.
 *   - A current grant lets that practice — or only the doctor it names — read
 *     the categories it names from *before* `enrolledOn` as well.
 *   - Only on a read. `recordWindow` is also used to find the row a write acts
 *     on (a prescription being superseded, a report being deleted), and a
 *     grant widening those would let a practice change history it was only
 *     shown.
 *   - Only on a read this file can name. A route the table below does not
 *     list reads inside the enrolment, grant or no grant. A new route widens
 *     nothing until somebody decides which category it belongs to.
 *   - Only for a patient the practice may already open. The grant is loaded
 *     after the enrolment gate has passed, so it can never introduce a patient
 *     to a practice, and a practice with no current enrolment gets nothing
 *     from any grant.
 *
 * Every read a grant widens is written to the audit log with the grant's id,
 * which is what the patient's sharing history reads back to them.
 */

/// The audit action a read under a grant is recorded with.
export const SHARED_READ_ACTION = 'read.shared';

const READ_METHODS = new Set(['GET', 'HEAD']);
const PATIENT_ROUTE = '/patients/[^/]+';

/**
 * Which category each windowed read belongs to.
 *
 * Keyed on the route as mounted plus the field the window is on, because one
 * handler can read two categories: the lab-tests screen reads the tests a
 * prescription advised (a prescription) beside the reports uploaded against
 * them (a lab result), and a grant for one is not a grant for the other.
 *
 * `sharedReadsAreMapped.test.js` fails when a windowed read in a GET handler
 * is neither listed here nor named as deliberately unshared.
 */
export const SHARED_READS = Object.freeze([
  { route: new RegExp(`${PATIENT_ROUTE}/prescriptions(/:id(/pdf)?)?/?$`), field: 'issuedOn', category: SHARE_CATEGORY.PRESCRIPTIONS },
  { route: new RegExp(`${PATIENT_ROUTE}/lab-tests/?$`), field: 'issuedOn', category: SHARE_CATEGORY.PRESCRIPTIONS },
  { route: new RegExp(`${PATIENT_ROUTE}/lab-tests/?$`), field: 'createdAt', category: SHARE_CATEGORY.LAB_RESULTS },
  { route: new RegExp(`${PATIENT_ROUTE}/glucose$`), field: 'measuredAt', category: SHARE_CATEGORY.READINGS },
  { route: new RegExp(`${PATIENT_ROUTE}/vitals(/weight-trend)?$`), field: 'recordedAt', category: SHARE_CATEGORY.READINGS },
  { route: new RegExp(`${PATIENT_ROUTE}/hba1c$`), field: 'testedOn', category: SHARE_CATEGORY.LAB_RESULTS },
  { route: new RegExp(`${PATIENT_ROUTE}/labs(/:id)?$`), field: 'testedOn', category: SHARE_CATEGORY.LAB_RESULTS },
  { route: new RegExp(`${PATIENT_ROUTE}/ecg/reports(/:id)?$`), field: 'recordedOn', category: SHARE_CATEGORY.ECG },
  { route: new RegExp(`${PATIENT_ROUTE}/eye/reports(/:id)?$`), field: 'createdAt', category: SHARE_CATEGORY.EYE },
  {
    route: new RegExp(`${PATIENT_ROUTE}/foot/(assessments(/:id)?|wounds/:woundKey/progression)$`),
    field: 'assessedAt',
    category: SHARE_CATEGORY.FOOT,
  },
  { route: new RegExp(`${PATIENT_ROUTE}/lifestyle(/summary)?$`), field: 'loggedAt', category: SHARE_CATEGORY.FOOD_LOGS },
  { route: new RegExp(`${PATIENT_ROUTE}/food-log/?$`), field: 'createdAt', category: SHARE_CATEGORY.FOOD_LOGS },
]);

/** The category a windowed read in this request belongs to, or null. */
export function categoryOfRead(req, field) {
  const handler = req.route?.path;
  if (!handler) return null;
  const route = `${req.baseUrl ?? ''}${handler}`;
  return SHARED_READS.find((r) => r.field === field && r.route.test(route))?.category ?? null;
}

/**
 * The grants in force for this patient at this practice.
 *
 * Loaded by the enrolment gate on a read only. Expiry is part of the query and
 * checked again at the moment of use, so a grant that lapses mid-request
 * widens nothing after it has.
 */
export async function grantsForRead(req, patientId, practiceId) {
  if (!READ_METHODS.has(req.method) || !patientId || !practiceId) return [];
  const now = new Date();
  return ShareGrant.find({
    patient: patientId,
    practice: practiceId,
    state: GRANT_STATE.ACTIVE,
    revokedAt: null,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  })
    .select('_id patient practice enrollment doctor categories state revokedAt expiresAt')
    .lean();
}

/**
 * The grant that lets this request read `category` of the patient in front of
 * it, or null — and when there is one, the read is written down.
 *
 * For any read that knows its own category. Synchronous, so it can be asked
 * while a filter is being built: the gate loaded the grants beforehand, and
 * only for a read (see `grantsForRead`). Refuses on every method but GET and
 * HEAD whatever was loaded, because a grant is permission to read and a
 * filter built for a write must not become wider than the enrolment.
 *
 * Returns the grant rather than a boolean so a caller that needs to say which
 * grant it read under can.
 */
export function readUnderGrant(req, category) {
  if (!READ_METHODS.has(req.method)) return null;
  const grants = req.shareGrants;
  if (!category || !grants?.length || !req.enrollment?._id) return null;

  const now = new Date();
  const grant = grants.find(
    (g) =>
      // A grant widens the relationship it was given under, and no other.
      String(g.enrollment) === String(req.enrollment._id) &&
      grantCovers(g, { category, userId: req.user?._id, now }),
  );
  if (!grant) return null;

  noteSharedRead(req, grant, category);
  return grant;
}

/**
 * Whether a grant lifts the enrolment window for this read, recording the
 * read if it does.
 *
 * Asked by `recordWindow`, which knows only the field it bounds — so the
 * category comes from where the read is mounted. See SHARED_READS.
 */
export function sharedHistoryCovers(req, field) {
  if (!READ_METHODS.has(req.method)) return false;
  return Boolean(readUnderGrant(req, categoryOfRead(req, field)));
}

/**
 * Remember a read made under a grant, and write it down once the response is
 * known to have succeeded.
 *
 * Its own audit row rather than a field on the route's: not every windowed read
 * has an `audit()` wrapper, and "all access through grants must be logged" is
 * not a rule that should depend on which route somebody remembered to wrap.
 */
function noteSharedRead(req, grant, category) {
  if (!req._sharedReads) {
    req._sharedReads = new Map();
    const res = req.res;
    res?.once?.('finish', () => recordSharedReads(req, res));
  }
  req._sharedReads.set(`${grant._id}:${category}`, { grant, category });
}

function recordSharedReads(req, res) {
  // A refused or failed read showed nothing.
  if (res.statusCode >= 400) return;
  for (const { grant, category } of req._sharedReads.values()) {
    AuditLog.create({
      actor: req.user?._id,
      actorRole: req.user?.role,
      action: SHARED_READ_ACTION,
      resource: 'ShareGrant',
      resourceId: grant._id,
      subjectPatient: grant.patient,
      ip: req.ip,
      userAgent: req.get?.('user-agent')?.slice(0, 300),
      meta: {
        grant: String(grant._id),
        category,
        practice: String(grant.practice),
        method: req.method,
        path: req.route?.path ?? req.originalUrl,
        status: res.statusCode,
      },
    }).catch((err) => logger.error({ err }, 'shared-read audit write failed'));
  }
}

/* ------------------------------------------------------------ validation */

function normaliseCategories(categories) {
  const allowed = Object.values(SHARE_CATEGORY);
  const list = [...new Set((categories ?? []).map(String))];
  if (!list.length) throw badRequest('Choose at least one kind of record to share.');
  const unknown = list.filter((c) => !allowed.includes(c));
  if (unknown.length) throw badRequest(`Not a kind of record that can be shared: ${unknown.join(', ')}`);
  return list;
}

function normaliseExpiry(expiresAt) {
  if (expiresAt == null || expiresAt === '') return null;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) throw badRequest('That end date is not a date.');
  if (at <= new Date()) throw badRequest('An end date has to be in the future.');
  return at;
}

/** The patient's current enrolment at a practice, or the refusal a patient can act on. */
async function currentEnrollment(patientId, practiceId) {
  const enrollment = await Enrollment.findOne({ patient: patientId, practice: practiceId });
  if (!enrollment || !enrollment.isCurrent()) {
    throw conflict(
      'You can only share with a practice you are registered with. Ask the practice to register you first.',
    );
  }
  return enrollment;
}

/** A doctor currently working at this practice, or a refusal. */
async function doctorAt(practiceId, doctorId) {
  if (!mongoose.isValidObjectId(doctorId)) throw badRequest('That doctor is not at this practice.');
  const row = await Membership.findOne({
    ...Membership.currentFilter(doctorId, practiceId),
    role: ROLES.DOCTOR,
  })
    .select('user')
    .lean();
  if (!row) throw badRequest('That doctor is not at this practice.');
  return row.user;
}

/* ---------------------------------------------------------------- grants */

/**
 * The patient sharing a category of their record with one of their practices.
 *
 * `patientId` has already been checked against the caller's household by the
 * route; this checks everything about the practice.
 */
export async function createGrant({
  actor,
  patientId,
  practiceId,
  doctorId = null,
  categories,
  expiresAt = null,
  idempotency = null,
}) {
  const cats = normaliseCategories(categories);
  const expiry = normaliseExpiry(expiresAt);

  const replay = async () => {
    if (!idempotency) return null;
    const existing = await ShareGrant.findOne({ createdBy: actor._id, idempotencyKey: idempotency.key });
    return isReplayOf({ idempotency }, existing) ? existing : null;
  };

  const already = await replay();
  if (already) return { grant: already, replayed: true };

  if (!mongoose.isValidObjectId(practiceId)) throw badRequest('Choose one of your practices.');
  const enrollment = await currentEnrollment(patientId, practiceId);
  const doctor = doctorId ? await doctorAt(practiceId, doctorId) : null;
  const now = new Date();

  try {
    const grant = await ShareGrant.create({
      patient: enrollment.patient,
      practice: enrollment.practice,
      enrollment: enrollment._id,
      doctor,
      categories: cats,
      state: GRANT_STATE.ACTIVE,
      origin: GRANT_ORIGIN.PATIENT_APP,
      createdBy: actor._id,
      createdByRole: actor.role,
      grantedBy: actor._id,
      grantedAt: now,
      expiresAt: expiry,
      idempotencyKey: idempotency?.key ?? null,
      idempotencyHash: idempotency?.hash ?? null,
    });
    return { grant, replayed: false };
  } catch (err) {
    if (idempotency && isKeyCollision(err)) {
      const raced = await replay();
      if (raced) return { grant: raced, replayed: true };
    }
    throw err;
  }
}

/**
 * The patient taking a grant back. Effective on the very next read.
 *
 * Deletes nothing: the row says what was shared, when, and when it stopped,
 * which is the history the patient is shown.
 */
export async function revokeGrant({ actor, grantId, patientIds }) {
  if (!mongoose.isValidObjectId(grantId)) throw notFound('That sharing was not found.');
  const updated = await ShareGrant.findOneAndUpdate(
    { _id: grantId, patient: { $in: patientIds }, state: GRANT_STATE.ACTIVE },
    {
      $set: {
        state: GRANT_STATE.REVOKED,
        revokedAt: new Date(),
        revokedBy: actor._id,
        revokeReason: REVOKE_REASON.PATIENT,
      },
    },
    { new: true },
  );
  if (updated) return updated;

  const existing = await ShareGrant.findOne({ _id: grantId, patient: { $in: patientIds } });
  if (!existing) throw notFound('That sharing was not found.');
  // Twice is once: the second tap on a slow network is not an error.
  if (existing.state === GRANT_STATE.REVOKED) return existing;
  throw conflict(
    existing.state === GRANT_STATE.REQUESTED
      ? 'That is a request nobody has approved. Decline it instead.'
      : `That sharing has already ${existing.state === GRANT_STATE.DECLINED ? 'been declined' : 'ended'}.`,
  );
}

/**
 * An enrolment ending takes its grants and open requests with it.
 *
 * Otherwise registering at that practice again later would quietly bring back
 * history the patient shared under the relationship that ended, without being
 * asked again.
 */
export async function endSharingWithEnrolment({ enrollmentId, actor = null }) {
  const result = await ShareGrant.updateMany(
    { enrollment: enrollmentId, state: { $in: [GRANT_STATE.ACTIVE, GRANT_STATE.REQUESTED] } },
    {
      $set: {
        state: GRANT_STATE.REVOKED,
        revokedAt: new Date(),
        revokedBy: actor,
        revokeReason: REVOKE_REASON.ENROLMENT_ENDED,
      },
    },
  );
  return result.modifiedCount ?? 0;
}

/* -------------------------------------------------------------- requests */

/**
 * A practice asking to see some of a patient's earlier records.
 *
 * What SHARE_RECORDS is for. The permission never let a practice share
 * anything — no route asked for it — and a practice cannot share a patient's
 * record, because that is the patient's decision. What it can do is ask, and
 * asking writes a row that grants nothing until the patient approves it.
 */
export async function requestShare({ requester, patientId, practiceId, categories, doctorId = null, note = null }) {
  const cats = normaliseCategories(categories);
  const enrollment = await currentEnrollment(patientId, practiceId);
  const doctor = doctorId ? await doctorAt(practiceId, doctorId) : null;

  let row;
  try {
    row = await ShareGrant.create({
      patient: enrollment.patient,
      practice: enrollment.practice,
      enrollment: enrollment._id,
      doctor,
      categories: cats,
      state: GRANT_STATE.REQUESTED,
      origin: GRANT_ORIGIN.PRACTICE_REQUEST,
      createdBy: requester._id,
      createdByRole: requester.role,
      requestNote: note || null,
    });
  } catch (err) {
    if (err?.code === 11000 && 'practice' in (err.keyPattern ?? {})) {
      throw conflict('This practice has already asked, and the patient has not answered yet.');
    }
    throw err;
  }

  const practice = await Practice.findById(enrollment.practice).select('name').lean();
  notifyPatient(enrollment.patient, {
    title: 'A clinic is asking to see earlier records',
    body: `${practice?.name ?? 'Your clinic'} has asked to see some of your earlier records. Nothing is shared unless you say yes.`,
    data: { kind: 'share_request' },
  }).catch((err) => logger.warn({ err }, 'share request push failed'));

  return row;
}

/**
 * The patient answering a practice's request.
 *
 * Approving may narrow what was asked for and never widen it: a patient who
 * wants to share something else creates that grant themselves, where the
 * screen says plainly what it is.
 */
export async function answerRequest({ actor, requestId, patientIds, approve, categories = null, expiresAt = null }) {
  if (!mongoose.isValidObjectId(requestId)) throw notFound('That request was not found.');
  const request = await ShareGrant.findOne({ _id: requestId, patient: { $in: patientIds } });
  if (!request) throw notFound('That request was not found.');

  if (request.state !== GRANT_STATE.REQUESTED) {
    if (approve && request.state === GRANT_STATE.ACTIVE && String(request.grantedBy) === String(actor._id)) {
      return request;
    }
    if (!approve && request.state === GRANT_STATE.DECLINED) return request;
    throw conflict('That request has already been answered, or has ended.');
  }

  const now = new Date();
  let update;
  if (approve) {
    const cats = categories ? normaliseCategories(categories) : [...request.categories];
    if (!cats.every((c) => request.categories.includes(c))) {
      throw badRequest('You can share less than was asked for, not more. To share something else, add it yourself.');
    }
    const expiry = normaliseExpiry(expiresAt);
    // Still connected. A request outlives nothing: if the enrolment ended, the
    // request ended with it, but a patient answering the notification from
    // before is told why rather than handed a grant that can never be used.
    await currentEnrollment(request.patient, request.practice);
    update = {
      state: GRANT_STATE.ACTIVE,
      categories: cats,
      expiresAt: expiry,
      grantedBy: actor._id,
      grantedAt: now,
    };
  } else {
    update = { state: GRANT_STATE.DECLINED, declinedAt: now, declinedBy: actor._id };
  }

  // Conditional on still being a request, so two answers racing produce one.
  const answered = await ShareGrant.findOneAndUpdate(
    { _id: request._id, state: GRANT_STATE.REQUESTED },
    { $set: update },
    { new: true },
  );
  if (answered) return answered;
  throw conflict('That request has already been answered.');
}

/* ----------------------------------------------- the questions at enrolment */

function isCurrentRow(e) {
  return e.status === ENROLLMENT_STATUS.ACTIVE && e.revokedAt == null;
}

/**
 * The consent that still owes its sharing answers, from one enrolment's events
 * in time order — or null.
 *
 * Two questions, asked once per consent a desk recorded:
 *
 *   own health logs   — always. What the patient writes themselves (readings,
 *                       food and lifestyle logs, photos and documents) is
 *                       theirs to share, including with the clinic that has
 *                       just enrolled them.
 *   earlier history   — only when the desk connected an account that already
 *                       existed (a `granted` answering a `requested`). A
 *                       brand-new account the desk made has no earlier
 *                       record to share.
 *
 * A row the migration wrote asked nobody and has no consent to answer.
 */
function unansweredConsent(events) {
  let lastGrant = null;
  let historyApplies = false;
  let sawRequest = false;
  for (const e of events) {
    if (e.action === CONSENT_ACTION.REQUESTED) sawRequest = true;
    if (e.action === CONSENT_ACTION.GRANTED && e.method === CONSENT_METHOD.OTP_DESK) {
      lastGrant = e;
      historyApplies = sawRequest;
    }
  }
  if (!lastGrant) return null;
  const answered = events.some(
    (e) =>
      (e.action === CONSENT_ACTION.SHARING_GIVEN || e.action === CONSENT_ACTION.SHARING_DECLINED) &&
      String(e.answers) === String(lastGrant._id),
  );
  return answered ? null : { consent: lastGrant, historyApplies };
}

/** Every enrolment still waiting on its sharing answers, across these patients. */
export async function pendingSharingQuestions(patientIds) {
  const enrollments = (await Enrollment.find({ patient: { $in: patientIds } }).lean()).filter(isCurrentRow);
  if (!enrollments.length) return [];

  const events = await ConsentEvent.find({ enrollment: { $in: enrollments.map((e) => e._id) } })
    .sort({ at: 1, _id: 1 })
    .lean();
  const byEnrollment = new Map();
  for (const e of events) {
    const key = String(e.enrollment);
    if (!byEnrollment.has(key)) byEnrollment.set(key, []);
    byEnrollment.get(key).push(e);
  }

  const waiting = enrollments
    .map((e) => ({ enrollment: e, open: unansweredConsent(byEnrollment.get(String(e._id)) ?? []) }))
    .filter((p) => p.open);
  if (!waiting.length) return [];

  const [practices, patients] = await Promise.all([
    Practice.find({ _id: { $in: waiting.map((p) => p.enrollment.practice) } }).select('name').lean(),
    Patient.find({ _id: { $in: waiting.map((p) => p.enrollment.patient) } }).select('name').lean(),
  ]);
  const practiceName = new Map(practices.map((p) => [String(p._id), p.name]));
  const patientName = new Map(patients.map((p) => [String(p._id), p.name]));

  return waiting.map(({ enrollment, open }) => ({
    enrollmentId: String(enrollment._id),
    practice: { id: String(enrollment.practice), name: practiceName.get(String(enrollment.practice)) ?? null },
    patient: { id: String(enrollment.patient), name: patientName.get(String(enrollment.patient)) ?? null },
    // The date "earlier" means: the practice's enrolment.
    since: enrollment.enrolledOn,
    connectedAt: open.consent.at,
    asks: { ownLogs: true, history: open.historyApplies },
    ownLogCategories: [...OWN_LOG_CATEGORIES],
    historyCategories: open.historyApplies ? [...HISTORY_CATEGORIES] : [],
  }));
}

/**
 * The patient's answers to the questions asked at enrolment, each yes creating
 * its own grant.
 *
 * Given in two places, recorded the same way:
 *
 *   in the app      — the patient (or guardian) answering for themselves;
 *                     `method` in_app, the login as actor and granter.
 *   at the desk     — in the same request that spends the patient's code, so
 *                     the answer travels with the proof the patient is at the
 *                     counter; `method` otp_desk, the desk account as actor,
 *                     the patient's login as granter. The patient sees these
 *                     grants in "Who can see my records?" and can take either
 *                     back.
 *
 * The answer is written first and is unique per consent, so a double tap, two
 * devices, or the desk and the app answering at once produce one answer and
 * the grants of one answer. The grant ids are chosen before anything is
 * written, so the answer can name them.
 */
export async function answerSharingQuestions({
  actor,
  enrollment,
  ownLogs,
  history,
  method = CONSENT_METHOD.IN_APP,
  grantedBy = actor._id,
}) {
  if (!enrollment?.isCurrent?.()) throw conflict('That practice is no longer connected to you.');

  const events = await ConsentEvent.find({ enrollment: enrollment._id }).sort({ at: 1, _id: 1 }).lean();
  const open = unansweredConsent(events);
  if (!open) throw conflict('Those questions have already been answered.');
  if (history && !open.historyApplies) {
    throw badRequest('There is no earlier history to share with this practice: it made this account.');
  }

  const shareLogs = Boolean(ownLogs);
  const shareHistory = Boolean(history);
  const planned = [
    ...(shareLogs ? [{ _id: new mongoose.Types.ObjectId(), categories: [...OWN_LOG_CATEGORIES] }] : []),
    ...(shareHistory ? [{ _id: new mongoose.Types.ObjectId(), categories: [...HISTORY_CATEGORIES] }] : []),
  ];

  let answer;
  try {
    answer = await ConsentEvent.record({
      enrollment: enrollment._id,
      action: planned.length ? CONSENT_ACTION.SHARING_GIVEN : CONSENT_ACTION.SHARING_DECLINED,
      actor: actor._id,
      method,
      answers: open.consent._id,
      ownLogs: shareLogs,
      history: open.historyApplies ? shareHistory : undefined,
      categories: planned.flatMap((p) => p.categories),
      grants: planned.map((p) => p._id),
    });
  } catch (err) {
    if (err?.code === 11000) throw conflict('Those questions have already been answered.');
    throw err;
  }

  const now = new Date();
  const grants = [];
  for (const p of planned) {
    grants.push(
      await ShareGrant.create({
        _id: p._id,
        patient: enrollment.patient,
        practice: enrollment.practice,
        enrollment: enrollment._id,
        categories: p.categories,
        state: GRANT_STATE.ACTIVE,
        origin: GRANT_ORIGIN.ENROLMENT_CONSENT,
        createdBy: actor._id,
        createdByRole: actor.role,
        grantedBy,
        grantedAt: now,
        consentEvent: answer._id,
      }),
    );
  }
  return { answer, grants };
}

/**
 * The same answers, from the app: the enrolment must be one this login decides
 * for, found by its id.
 */
export async function answerSharingQuestionsInApp({ actor, enrollmentId, patientIds, ownLogs, history }) {
  if (!mongoose.isValidObjectId(enrollmentId)) throw notFound('Those questions were not found.');
  const enrollment = await Enrollment.findOne({ _id: enrollmentId, patient: { $in: patientIds } });
  if (!enrollment) throw notFound('Those questions were not found.');
  return answerSharingQuestions({ actor, enrollment, ownLogs, history });
}

/**
 * Tell a patient their new practice is connected, and ask the questions.
 *
 * Fired once, from a confirmation the desk did not answer them in. Nothing
 * waits on it: a push that fails leaves the questions on the sharing screen.
 */
export async function askSharingQuestions(enrollment) {
  const practice = await Practice.findById(enrollment.practice).select('name').lean();
  return notifyPatient(enrollment.patient, {
    title: 'Choose what your clinic can see',
    body: `${practice?.name ?? 'Your new clinic'} is now connected. Choose whether it may see your own health logs and your earlier records.`,
    data: { kind: 'sharing_question' },
  });
}

/* ------------------------------------------------------ what is shown */

function publicGrant(g, names, now = new Date()) {
  return {
    id: String(g._id),
    practice: { id: String(g.practice), name: names.practice.get(String(g.practice)) ?? null },
    doctor: g.doctor ? { id: String(g.doctor), name: names.user.get(String(g.doctor)) ?? null } : null,
    categories: [...(g.categories ?? [])],
    status: grantStatus(g, now),
    origin: g.origin,
    requestNote: g.requestNote ?? null,
    requestedBy: g.origin === GRANT_ORIGIN.PRACTICE_REQUEST ? names.user.get(String(g.createdBy)) ?? null : null,
    grantedAt: g.grantedAt ?? null,
    expiresAt: g.expiresAt ?? null,
    revokedAt: g.revokedAt ?? null,
    revokeReason: g.revokeReason ?? null,
    declinedAt: g.declinedAt ?? null,
    createdAt: g.createdAt,
  };
}

async function namesFor({ practiceIds = [], userIds = [] }) {
  const uniq = (ids) => [...new Set(ids.filter(Boolean).map(String))];
  const [practices, users] = await Promise.all([
    Practice.find({ _id: { $in: uniq(practiceIds) } }).select('name').lean(),
    User.find({ _id: { $in: uniq(userIds) } }).select('name').lean(),
  ]);
  return {
    practice: new Map(practices.map((p) => [String(p._id), p.name])),
    user: new Map(users.map((u) => [String(u._id), u.name])),
  };
}

/**
 * "Who can see my records?" for one patient.
 *
 * Every practice that can read anything, and why: registered there since a
 * date, plus whatever the patient has shared beyond that. Practices waiting on
 * a code and practices whose access ended are listed apart, because neither
 * can see anything new.
 */
export async function sharingOverview(patientId) {
  const now = new Date();
  const [enrollments, grants] = await Promise.all([
    Enrollment.find({ patient: patientId }).sort({ enrolledOn: 1, _id: 1 }).lean(),
    ShareGrant.find({ patient: patientId }).sort({ createdAt: -1 }).lean(),
  ]);
  const names = await namesFor({
    practiceIds: [...enrollments.map((e) => e.practice), ...grants.map((g) => g.practice)],
    userIds: grants.flatMap((g) => [g.doctor, g.createdBy]),
  });
  const practice = (id) => ({ id: String(id), name: names.practice.get(String(id)) ?? null });

  // When each relationship was last consented to — apart from `since`, which
  // a patient who came back keeps from the first time.
  const consents = await ConsentEvent.find({
    enrollment: { $in: enrollments.map((e) => e._id) },
    action: CONSENT_ACTION.GRANTED,
  })
    .sort({ at: 1 })
    .select('enrollment at reconsent')
    .lean();
  const lastConsent = new Map(consents.map((c) => [String(c.enrollment), c]));

  const connected = enrollments.filter(isCurrentRow).map((e) => ({
    enrollmentId: String(e._id),
    practice: practice(e.practice),
    since: e.enrolledOn,
    consentedOn: lastConsent.get(String(e._id))?.at ?? null,
    reconsented: Boolean(lastConsent.get(String(e._id))?.reconsent),
    reason: 'registered',
    shared: grants
      .filter((g) => String(g.enrollment) === String(e._id) && grantStatus(g, now) === GRANT_STATE.ACTIVE)
      .map((g) => publicGrant(g, names, now)),
    requests: grants
      .filter((g) => String(g.enrollment) === String(e._id) && g.state === GRANT_STATE.REQUESTED)
      .map((g) => publicGrant(g, names, now)),
  }));

  return {
    connected,
    waiting: enrollments
      .filter((e) => e.status === ENROLLMENT_STATUS.PENDING)
      .map((e) => ({ enrollmentId: String(e._id), practice: practice(e.practice), askedOn: e.createdAt })),
    ended: enrollments
      .filter((e) => e.status === ENROLLMENT_STATUS.REVOKED || (e.status === ENROLLMENT_STATUS.ACTIVE && e.revokedAt))
      .map((e) => ({ enrollmentId: String(e._id), practice: practice(e.practice), endedOn: e.revokedAt })),
    past: grants
      .filter((g) => g.state !== GRANT_STATE.REQUESTED && grantStatus(g, now) !== GRANT_STATE.ACTIVE)
      .map((g) => publicGrant(g, names, now)),
  };
}

/**
 * Everything that has happened to who can see this patient's record, newest
 * first: connections, withdrawals, what was shared and taken back, requests,
 * and every read a grant allowed.
 */
export async function sharingHistory(patientId, { limit = 200 } = {}) {
  const now = new Date();
  const enrollments = await Enrollment.find({ patient: patientId }).select('_id practice').lean();
  const practiceOfEnrollment = new Map(enrollments.map((e) => [String(e._id), e.practice]));

  const [events, grants, reads] = await Promise.all([
    ConsentEvent.find({ enrollment: { $in: enrollments.map((e) => e._id) } })
      .sort({ at: -1 })
      .limit(limit)
      .lean(),
    ShareGrant.find({ patient: patientId }).lean(),
    AuditLog.find({ subjectPatient: patientId, action: SHARED_READ_ACTION })
      .sort({ at: -1 })
      .limit(limit)
      .lean(),
  ]);

  const names = await namesFor({
    practiceIds: [...enrollments.map((e) => e.practice), ...grants.map((g) => g.practice), ...reads.map((r) => r.meta?.practice)],
    userIds: [
      ...events.map((e) => e.actor),
      ...grants.flatMap((g) => [g.createdBy, g.doctor, g.revokedBy, g.declinedBy]),
      ...reads.map((r) => r.actor),
    ],
  });
  const practice = (id) => (id ? { id: String(id), name: names.practice.get(String(id)) ?? null } : null);
  const person = (id) => (id ? names.user.get(String(id)) ?? null : null);

  const EVENT_KIND = {
    [CONSENT_ACTION.REQUESTED]: 'connection_requested',
    [CONSENT_ACTION.GRANTED]: 'connected',
    [CONSENT_ACTION.REVOKED]: 'disconnected',
    [CONSENT_ACTION.SHARING_GIVEN]: 'sharing_given',
    [CONSENT_ACTION.SHARING_DECLINED]: 'sharing_declined',
  };

  const items = [
    ...events.map((e) => ({
      at: e.at,
      kind: e.action === CONSENT_ACTION.GRANTED && e.reconsent ? 'reconnected' : (EVENT_KIND[e.action] ?? e.action),
      practice: practice(practiceOfEnrollment.get(String(e.enrollment))),
      by: e.method === CONSENT_METHOD.MIGRATION ? null : person(e.actor),
      // Where it was decided: at the desk with the patient's code, or in the app.
      method: e.method,
      categories: e.categories ?? null,
      ...(e.ownLogs !== undefined ? { ownLogs: e.ownLogs } : {}),
      ...(e.history !== undefined ? { history: e.history } : {}),
    })),
    ...grants.flatMap((g) => {
      const base = { practice: practice(g.practice), categories: [...(g.categories ?? [])], grantId: String(g._id) };
      const out = [];
      if (g.origin === GRANT_ORIGIN.PRACTICE_REQUEST) {
        out.push({ ...base, at: g.createdAt, kind: 'share_requested', by: person(g.createdBy), note: g.requestNote ?? null });
      }
      // An answer at enrolment is already in the consent log above.
      if (g.grantedAt && g.origin !== GRANT_ORIGIN.ENROLMENT_CONSENT) {
        out.push({ ...base, at: g.grantedAt, kind: 'shared', doctor: person(g.doctor), expiresAt: g.expiresAt ?? null });
      }
      if (g.declinedAt) out.push({ ...base, at: g.declinedAt, kind: 'request_declined' });
      if (g.revokedAt) {
        out.push({
          ...base,
          at: g.revokedAt,
          kind: g.revokeReason === REVOKE_REASON.ENROLMENT_ENDED ? 'share_ended_with_registration' : 'share_revoked',
        });
      }
      if (g.expiresAt && new Date(g.expiresAt) <= now && (!g.revokedAt || new Date(g.revokedAt) > new Date(g.expiresAt))) {
        out.push({ ...base, at: g.expiresAt, kind: 'share_expired' });
      }
      return out;
    }),
    ...reads.map((r) => ({
      at: r.at,
      kind: 'viewed',
      practice: practice(r.meta?.practice),
      by: person(r.actor),
      categories: r.meta?.category ? [r.meta.category] : null,
      grantId: r.meta?.grant ?? null,
    })),
  ];

  return items.sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

/** The doctors at one practice, for narrowing a grant to one of them. */
export async function doctorsAt(practiceId) {
  const rows = await Membership.find({
    practice: practiceId,
    role: ROLES.DOCTOR,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  })
    .select('user')
    .lean();
  const users = await User.find({ _id: { $in: rows.map((r) => r.user) }, isActive: true })
    .select('name')
    .lean();
  return users.map((u) => ({ id: String(u._id), name: u.name })).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * What one practice has been given for one patient — its own grants and its
 * own open request, and nothing about any other practice — and, for the
 * person asking, what they are not being shown.
 *
 * `notShared` is the clinic being told what it is not seeing: every category
 * no grant in force covers for this caller. A grant narrowed to a colleague
 * does not cover somebody else, so their list says so. `since` is the date the
 * enrolment reads from without any grant.
 */
export async function sharedWithPractice(patientId, practiceId, userId = null) {
  const now = new Date();
  const [grants, enrollment] = await Promise.all([
    ShareGrant.find({
      patient: patientId,
      practice: practiceId,
      state: { $in: [GRANT_STATE.ACTIVE, GRANT_STATE.REQUESTED] },
    })
      .sort({ createdAt: -1 })
      .lean(),
    Enrollment.findOne({ patient: patientId, practice: practiceId }).select('enrolledOn').lean(),
  ]);
  const names = await namesFor({ practiceIds: [practiceId], userIds: grants.flatMap((g) => [g.doctor, g.createdBy]) });

  const covered = new Set(
    grants
      .filter((g) => Object.values(SHARE_CATEGORY).some((category) => grantCovers(g, { category, userId, now })))
      .flatMap((g) => g.categories ?? []),
  );
  const notShared = Object.values(SHARE_CATEGORY).filter((c) => !covered.has(c));

  return {
    since: enrollment?.enrolledOn ?? null,
    shared: grants.filter((g) => grantStatus(g, now) === GRANT_STATE.ACTIVE).map((g) => publicGrant(g, names, now)),
    request: grants.filter((g) => g.state === GRANT_STATE.REQUESTED).map((g) => publicGrant(g, names, now))[0] ?? null,
    notShared,
    ownLogsShared: OWN_LOG_CATEGORIES.every((c) => covered.has(c)),
    historyShared: HISTORY_CATEGORIES.every((c) => covered.has(c)),
  };
}

/** A push to whoever holds the phone for this patient. */
async function notifyPatient(patientId, { title, body, data }) {
  const row = await Patient.findById(patientId).select('login').lean();
  const login = await User.findById(row?.login ?? patientId).select('deviceTokens').lean();
  return deliver({ tokens: login?.deviceTokens ?? [], title, body, data });
}
