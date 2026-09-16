import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, forbidden, notFound } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { Enrollment } from '../models/Enrollment.js';
import { Patient } from '../models/Patient.js';
import { ConsentEvent, CONSENT_ACTION } from '../models/ConsentEvent.js';
import { confirmEnrolment } from '../services/enrolByPhone.js';
import { revokeEnrolment, consentHistory, practicesFor } from '../services/enrollments.js';
import { loginMayAccess } from '../services/patientsForLogin.js';
import { practiceOf } from '../middleware/practiceScope.js';

/**
 * The second half of enrolling somebody, and the patient's side of it.
 *
 * Its own router because the two audiences are different. A desk confirms a
 * code it just caused to be sent; a patient revokes a practice they no longer
 * want reading their record. Mounted together only because they act on the
 * same row.
 *
 * ---- Who may do what -----------------------------------------------------
 *
 * Confirming is the desk's, because the patient is standing at the counter
 * reading a code aloud. Revoking is the patient's alone — a clinic able to
 * revoke on a patient's behalf could also decline to, and both directions
 * belong to the person the record is about.
 */
const router = Router();
router.use(requireAuth);

/**
 * Everybody this practice has registered who has not yet said yes.
 *
 * ---- Why this had to exist -----------------------------------------------
 *
 * A pending enrolment grants nothing and is scoped out of every clinical list,
 * which is correct — the practice is reaching for a record it did not create
 * and the patient has not agreed. It also meant the row was invisible to the
 * practice that made it. A desk that registered somebody and did not get the
 * code read back on the spot had a patient in limbo, no screen anywhere
 * showing it, and no way to find them again except remembering the phone
 * number and typing it in a second time.
 *
 * "I added one patient but it did not show any patient" is what that looks
 * like from the counter.
 *
 * ---- Only what the desk typed ----------------------------------------------
 *
 * This said "a name, a number and a date: what the desk typed", and returned
 * the name and primary number stored on the *account*, and its id. For a number
 * that already belonged to somebody that is exactly the account's identity,
 * handed to a practice the owner has not agreed to — and for a mistyped number,
 * a stranger's name on the desk's screen.
 *
 * So the name and number now come from the request the desk made, and nothing
 * comes from the account until its owner reads back the code. A request from
 * before the desk's words were kept has none to show, and says so.
 */
router.get(
  '/pending',
  requireClinician,
  audit('read', 'Enrollment'),
  asyncHandler(async (req, res) => {
    const practiceId = await practiceOf(req);
    // No practice means no relationships to be waiting on. An empty list, not
    // an error: this is a screen that loads on every visit to the register.
    if (!practiceId) return res.json({ items: [] });

    const rows = await Enrollment.find({ practice: practiceId, status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(50)
      .select('_id createdAt')
      .lean();

    const requests = await ConsentEvent.find({
      enrollment: { $in: rows.map((r) => r._id) },
      action: CONSENT_ACTION.REQUESTED,
    })
      .sort({ at: 1, _id: 1 })
      .select('enrollment requestedName requestedPhone at')
      .lean();
    // The latest request for each: the words the desk used most recently, and
    // the number the live code went to.
    const latest = new Map(requests.map((e) => [String(e.enrollment), e]));

    res.json({
      items: rows.map((r) => {
        const asked = latest.get(String(r._id));
        return {
          id: String(r._id),
          name: asked?.requestedName ?? null,
          // The number the code went to, so the desk can tell two people with
          // the same name apart and check they typed it correctly.
          phone: asked?.requestedPhone ?? null,
          registeredOn: r.createdAt,
          lastAskedOn: asked?.at ?? r.createdAt,
        };
      }),
    });
  }),
);

/**
 * The patient reads back their code and the enrolment becomes real.
 *
 * Until this succeeds the row is PENDING and grants nothing, which is the
 * point: a mistyped number at the counter creates something inert rather than
 * attaching a practice to a stranger's record.
 */
router.post(
  '/:id/confirm',
  requireClinician,
  validate({ body: z.object({ code: z.string().trim().regex(/^\d{4,8}$/) }) }),
  audit('update', 'Enrollment'),
  asyncHandler(async (req, res) => {
    // Only the practice that asked may finish asking. With no practice there
    // is nothing this caller could have asked for.
    const practiceId = await practiceOf(req);
    if (!practiceId) throw notFound('That enrolment was not found');

    const enrollment = await confirmEnrolment({
      enrollmentId: req.params.id,
      code: req.body.code,
      confirmedBy: req.user._id,
      practiceId,
    });
    req.auditResourceId = enrollment._id;

    // The patient has said yes, so the practice may now know who it has
    // enrolled — and the desk needs the record to open. Before this moment the
    // desk has only ever been shown what it typed itself.
    const patient = enrollment.isCurrent()
      ? await Patient.findById(enrollment.patient).select('name').lean()
      : null;
    res.json({
      enrollment: enrollment.toPublic(),
      patient: patient ? { id: String(patient._id), name: patient.name } : null,
    });
  }),
);

/**
 * The consent history for one relationship.
 *
 * Who granted it, when, and by what method — the question a status field
 * cannot answer, because it is overwritten at exactly the moment it becomes
 * worth having.
 *
 * Readable by the practice the enrolment names and by the patient it is about,
 * and nobody else: a clinic has no business reading the consent trail of a
 * relationship it is not part of.
 */
router.get(
  '/:id/consent',
  audit('read', 'Enrollment'),
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findById(req.params.id).lean();
    if (!enrollment) throw notFound('That enrolment was not found');

    await assertMayTouch(req, enrollment);
    res.json({ events: await consentHistory(enrollment._id) });
  }),
);

/**
 * The patient withdrawing a practice's access.
 *
 * Ends future access and deletes nothing. The prescriptions already written
 * remain and remain readable by the practice that wrote them, because a record
 * one party can erase is not a record. What stops is anything new.
 */
router.post(
  '/:id/revoke',
  validate({ body: z.object({ note: z.string().trim().max(500).optional() }) }),
  audit('update', 'Enrollment'),
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findById(req.params.id).lean();
    if (!enrollment) throw notFound('That enrolment was not found');

    // Only the patient. A clinic that could revoke on somebody's behalf could
    // also decline to, and neither is theirs to decide.
    const mine = await patientIdsFor(req.user._id);
    if (!mine.some((id) => String(id) === String(enrollment.patient))) {
      throw forbidden('Only the patient can withdraw a practice’s access.');
    }

    const updated = await revokeEnrolment({
      enrollmentId: enrollment._id,
      actor: req.user._id,
      inApp: true,
      note: req.body.note ?? null,
    });
    res.json({ enrollment: updated.toPublic() });
  }),
);

/**
 * Every practice this login's patients are enrolled at.
 *
 * `patientId` narrows it to one person in the household — the request behind
 * switching to a child's record. Checked with `loginMayAccess` rather than
 * trusted: without it a login could name any patient id and be served their
 * practices.
 */
router.get(
  '/mine',
  validate({ query: z.object({ patientId: z.string().optional() }) }),
  asyncHandler(async (req, res) => {
    const asked = req.query.patientId;

    if (asked) {
      if (!(await loginMayAccess(req.user._id, asked))) {
        throw forbidden('That is not someone you look after.');
      }
      return res.json({ items: await practicesFor(asked) });
    }

    const mine = await patientIdsFor(req.user._id);
    const groups = await Promise.all(mine.map((id) => practicesFor(id)));
    res.json({ items: groups.flat() });
  }),
);

/**
 * The bodies this login is responsible for.
 *
 * Includes the login's own id, because a patient who predates the Patient table
 * has no row and their clinical records are filed under the login — see the
 * note in Patient.js about why the two ids are the same value.
 */
async function patientIdsFor(loginId) {
  const rows = await Patient.find({ login: loginId, isActive: true }).select('_id').lean();
  const ids = rows.map((r) => r._id);
  if (!ids.some((id) => String(id) === String(loginId))) ids.push(loginId);
  return ids;
}

/**
 * The practice named on the enrolment, or the patient it is about.
 *
 * "Unknown practice permits" was the rule here, and every patient is a caller
 * with no practice — so any signed-in patient could read the consent trail of
 * any enrolment on the platform by its id: who asked, which desk account, and
 * the reason somebody gave for withdrawing. No practice is nobody's practice.
 */
async function assertMayTouch(req, enrollment) {
  const mine = await patientIdsFor(req.user._id);
  if (mine.some((id) => String(id) === String(enrollment.patient))) return;

  const practiceId = await practiceOf(req);
  if (practiceId && String(practiceId) === String(enrollment.practice)) return;

  throw forbidden('That enrolment belongs to another practice.');
}

export default router;
