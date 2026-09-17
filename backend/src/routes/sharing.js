import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireRole, requireClinician, resolvePatientScope } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate, q } from '../middleware/validate.js';
import { asyncHandler, forbidden, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { idempotencyKey } from '../middleware/idempotency.js';
import { practiceOf } from '../middleware/practiceScope.js';
import { PERMISSIONS } from '../models/Membership.js';
import { ROLES } from '../models/User.js';
import { Patient } from '../models/Patient.js';
import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { SHARE_CATEGORY } from '../models/ShareGrant.js';
import { loginMayAccess } from '../services/patientsForLogin.js';
import {
  createGrant,
  revokeGrant,
  requestShare,
  answerRequest,
  pendingSharingQuestions,
  answerSharingQuestionsInApp,
  sharingOverview,
  sharingHistory,
  doctorsAt,
  sharedWithPractice,
} from '../services/sharing.js';

/**
 * Who can see a patient's record, and the patient deciding.
 *
 * ---- Two audiences, one rule ---------------------------------------------
 *
 * The patient's half — "Who can see my records?", sharing, taking it back, the
 * history, answering a practice's request and the one-time question about
 * earlier records — is guarded by role: patients only, acting for themselves or
 * for somebody in their household, checked against the Patient table on every
 * call rather than trusted from the request.
 *
 * The practice's half is smaller on purpose. A practice may see what it has
 * been given, and a member holding SHARE_RECORDS may ask for more. Nothing here
 * lets a practice share, approve, extend or revoke anything: those are the
 * patient's, and a clinic able to grant itself access would have an enrolment
 * meaning something the patient never agreed to.
 */
const router = Router();
router.use(requireAuth);

const categories = z.array(z.enum(Object.values(SHARE_CATEGORY))).min(1).max(10);
const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Not a valid id');

/**
 * Which patient in the caller's household this request is about.
 *
 * Their own record unless they name somebody, and a named somebody must be a
 * person this login looks after — the same check the household switcher uses.
 */
async function patientFor(req, requested) {
  const id = requested && requested !== 'me' ? requested : String(req.user._id);
  if (!(await loginMayAccess(req.user._id, id))) {
    throw forbidden('That is not someone you look after.');
  }
  // What the audit row names: the person, not the phone that asked.
  req.patientId = id;
  return id;
}

/** Every patient this login may decide for — for acting on a row by its own id. */
async function householdOf(loginId) {
  const rows = await Patient.find({ login: loginId, isActive: true }).select('_id').lean();
  const ids = rows.map((r) => String(r._id));
  if (!ids.includes(String(loginId))) ids.push(String(loginId));
  return ids;
}

/* ------------------------------------------------------ the patient's side */

/** "Who can see my records?" */
router.get(
  '/',
  requireRole(ROLES.PATIENT),
  validate({ query: z.object({ patientId: z.string().optional() }) }),
  audit('read', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const patientId = await patientFor(req, q(req).patientId);
    const patient = await Patient.findById(patientId).select('name').lean();
    res.json({
      patient: { id: patientId, name: patient?.name ?? req.user.name },
      categories: Object.values(SHARE_CATEGORY),
      ...(await sharingOverview(patientId)),
    });
  }),
);

/** Everything that has happened to who can see the record, newest first. */
router.get(
  '/history',
  requireRole(ROLES.PATIENT),
  validate({ query: z.object({ patientId: z.string().optional() }) }),
  audit('read', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const patientId = await patientFor(req, q(req).patientId);
    res.json({ items: await sharingHistory(patientId) });
  }),
);

/**
 * The doctors at one of the patient's own practices, for narrowing a grant to
 * one of them. Refused for a practice the patient is not currently with: the
 * staff list of a clinic somebody has no relationship with is not theirs to
 * browse.
 */
router.get(
  '/practices/:practiceId/doctors',
  requireRole(ROLES.PATIENT),
  validate({ params: z.object({ practiceId: objectId }), query: z.object({ patientId: z.string().optional() }) }),
  audit('read', 'Membership'),
  asyncHandler(async (req, res) => {
    const patientId = await patientFor(req, q(req).patientId);
    const enrolled = await Enrollment.exists({
      patient: patientId,
      practice: req.params.practiceId,
      status: ENROLLMENT_STATUS.ACTIVE,
      revokedAt: null,
    });
    if (!enrolled) throw notFound('That practice was not found.');
    res.json({ items: await doctorsAt(req.params.practiceId) });
  }),
);

/** Share some of the record with one of the patient's practices. */
router.post(
  '/grants',
  requireRole(ROLES.PATIENT),
  idempotencyKey(),
  validate({
    body: z.object({
      patientId: z.string().optional(),
      practiceId: objectId,
      doctorId: objectId.nullish(),
      categories,
      expiresAt: z.coerce.date().nullish(),
    }),
  }),
  audit('create', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const patientId = await patientFor(req, req.body.patientId);
    const { grant, replayed } = await createGrant({
      actor: req.user,
      patientId,
      practiceId: req.body.practiceId,
      doctorId: req.body.doctorId ?? null,
      categories: req.body.categories,
      expiresAt: req.body.expiresAt ?? null,
      idempotency: req.idempotency,
    });
    req.auditResourceId = grant._id;
    res.status(replayed ? 200 : 201).json({ grant: grant.toPublic() });
  }),
);

/** Take a grant back. Effective on the next read. */
router.post(
  '/grants/:id/revoke',
  requireRole(ROLES.PATIENT),
  audit('update', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const grant = await revokeGrant({
      actor: req.user,
      grantId: req.params.id,
      patientIds: await householdOf(req.user._id),
    });
    req.auditResourceId = grant._id;
    req.patientId = grant.patient;
    res.json({ grant: grant.toPublic() });
  }),
);

/**
 * The questions still waiting, asked once per consent: "share my own health
 * logs with this clinic" and — when the desk connected an account that already
 * existed — "share my earlier history with this clinic".
 */
router.get(
  '/prompts',
  requireRole(ROLES.PATIENT),
  audit('read', 'ConsentEvent'),
  asyncHandler(async (req, res) => {
    res.json({ items: await pendingSharingQuestions(await householdOf(req.user._id)) });
  }),
);

/**
 * The patient's answers. Once per consent; a second answer is refused, and so
 * is one arriving after the desk recorded the answers given at the counter.
 */
router.post(
  '/prompts/:enrollmentId',
  requireRole(ROLES.PATIENT),
  validate({ body: z.object({ ownLogs: z.boolean(), history: z.boolean() }) }),
  audit('create', 'ConsentEvent'),
  asyncHandler(async (req, res) => {
    const { answer, grants } = await answerSharingQuestionsInApp({
      actor: req.user,
      enrollmentId: req.params.enrollmentId,
      patientIds: await householdOf(req.user._id),
      ownLogs: req.body.ownLogs,
      history: req.body.history,
    });
    req.auditResourceId = answer._id;
    res.status(201).json({ answer: answer.action, grants: grants.map((g) => g.toPublic()) });
  }),
);

/** Approve a practice's request — all of it, or less. */
router.post(
  '/requests/:id/approve',
  requireRole(ROLES.PATIENT),
  validate({
    body: z.object({ categories: categories.optional(), expiresAt: z.coerce.date().nullish() }),
  }),
  audit('update', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const grant = await answerRequest({
      actor: req.user,
      requestId: req.params.id,
      patientIds: await householdOf(req.user._id),
      approve: true,
      categories: req.body.categories ?? null,
      expiresAt: req.body.expiresAt ?? null,
    });
    req.auditResourceId = grant._id;
    req.patientId = grant.patient;
    res.json({ grant: grant.toPublic() });
  }),
);

/** Say no to a practice's request. */
router.post(
  '/requests/:id/decline',
  requireRole(ROLES.PATIENT),
  audit('update', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const grant = await answerRequest({
      actor: req.user,
      requestId: req.params.id,
      patientIds: await householdOf(req.user._id),
      approve: false,
    });
    req.auditResourceId = grant._id;
    req.patientId = grant.patient;
    res.json({ grant: grant.toPublic() });
  }),
);

/* ----------------------------------------------------- the practice's side */

/**
 * What this practice has been given for one patient, whether it has asked, and
 * what the person asking is not being shown.
 *
 * Its own grants only. Which other practices a patient shares with is the
 * patient's business and nobody else's.
 */
router.get(
  '/patients/:patientId',
  requireClinician,
  requirePermission(PERMISSIONS.VIEW_PATIENT),
  resolvePatientScope,
  audit('read', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    res.json(await sharedWithPractice(req.patientId, await practiceOf(req), req.user._id));
  }),
);

/**
 * Ask the patient to share some of their earlier records with this practice.
 *
 * SHARE_RECORDS, beside the clinician role guard and the patient scope: asking
 * names a patient, so it needs somebody who may open that patient, at a
 * practice that patient is enrolled with, holding the grant that says this
 * person may ask on the practice's behalf.
 */
router.post(
  '/patients/:patientId/requests',
  requireClinician,
  requirePermission(PERMISSIONS.SHARE_RECORDS),
  resolvePatientScope,
  validate({
    body: z.object({
      categories,
      doctorId: objectId.nullish(),
      note: z.string().trim().max(300).optional(),
    }),
  }),
  audit('create', 'ShareGrant'),
  asyncHandler(async (req, res) => {
    const request = await requestShare({
      requester: req.user,
      patientId: req.patientId,
      practiceId: await practiceOf(req),
      categories: req.body.categories,
      doctorId: req.body.doctorId ?? null,
      note: req.body.note ?? null,
    });
    req.auditResourceId = request._id;
    res.status(201).json({ request: request.toPublic() });
  }),
);

export default router;
