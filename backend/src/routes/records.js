import { Router } from 'express';
import { z } from 'zod';

import { requireAuth, requireClinician, requireDoctor } from '../middleware/auth.js';
import { requirePermission } from '../middleware/authorise.js';
import { validate } from '../middleware/validate.js';
import { asyncHandler, badRequest, notFound, forbidden } from '../middleware/errors.js';
import { audit } from '../middleware/audit.js';
import { practicePatients } from '../middleware/practiceScope.js';
import { PERMISSIONS } from '../models/Membership.js';
import { Prescription } from '../models/Prescription.js';
import { RECORD_STATE } from '../models/plugins/clinicalRecord.js';
import { Patient } from '../models/Patient.js';
import { User, ROLES } from '../models/User.js';
import { ConsentEvent } from '../models/ConsentEvent.js';
import { Enrollment } from '../models/Enrollment.js';

/**
 * Ending a clinical record, and moving a patient to their own login.
 *
 * Two things that look administrative and are not. Both change what a record
 * says about a person, and both were built and left unreachable — which is how
 * a feature ends up tested, documented and impossible to use.
 */
const router = Router();
router.use(requireAuth);

/**
 * Void, correct or supersede a prescription. Never delete one.
 *
 * ---- Why the caller must say which -------------------------------------
 *
 * A prescription **voided** was wrong when it was written and the patient
 * should not act on it. One **corrected** was right in substance and wrong in a
 * detail, and both versions matter because the patient may already have been
 * dispensed against the first. One **superseded** was correct and has simply
 * been replaced.
 *
 * A single "cancel" button would collapse the three, and a pharmacist reading
 * the record afterwards would know only that something changed.
 *
 * Doctor-only and PRESCRIBE-gated: ending a prescription is the same kind of
 * clinical act as writing one, and the desk does neither.
 */
router.post(
  '/prescriptions/:id/end',
  requireDoctor,
  requirePermission(PERMISSIONS.PRESCRIBE),
  validate({
    body: z.object({
      state: z.enum([RECORD_STATE.VOIDED, RECORD_STATE.CORRECTED, RECORD_STATE.SUPERSEDED]),
      // The plugin refuses without one. Asked for here so the message is the
      // route's rather than an exception surfacing from a model.
      reason: z.string().trim().min(5).max(500),
      replacedBy: z.string().optional(),
    }),
  }),
  audit('update', 'Prescription'),
  asyncHandler(async (req, res) => {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) throw notFound('Prescription not found');

    if (!prescription.isCurrent()) {
      throw badRequest(`That prescription is already ${prescription.recordState}.`);
    }

    // A correction or a supersession names its replacement; a voiding does
    // not, because nothing replaced it — it should not have existed.
    if (req.body.state !== RECORD_STATE.VOIDED && !req.body.replacedBy) {
      throw badRequest('A correction or supersession must name the prescription replacing it.');
    }

    prescription.endAs(req.body.state, {
      by: req.user._id,
      reason: req.body.reason,
      replacedBy: req.body.replacedBy ?? null,
    });
    await prescription.save();

    res.json({
      id: String(prescription._id),
      recordState: prescription.recordState,
      endedAt: prescription.endedAt,
      endedReason: prescription.endedReason,
    });
  }),
);

/**
 * Give a dependant their own login.
 *
 * Aarav turns eighteen. His `Patient` row keeps its id, so every reading,
 * prescription and enrolment follows him without moving and the practices see
 * no change at all — only the phone that reaches him changes.
 *
 * ---- Why a clinician does this and not the patient ---------------------
 *
 * The new login has to be a real number that a real person answers, and the
 * only place that is verified is a desk with the person standing at it. A
 * self-service detach would let anybody with the household's phone move a
 * dependant's record onto a number of their choosing.
 */
router.post(
  '/patients/:id/detach',
  requireClinician,
  validate({
    body: z.object({
      // The number the patient will sign in with from now on. Must already be
      // an account — created and verified through the ordinary registration
      // flow, so the code went to the handset that answers it.
      phone: z.string().trim().min(8).max(20),
    }),
  }),
  audit('update', 'Patient'),
  asyncHandler(async (req, res) => {
    /*
     * Scoped to this practice's own patients, which it was not.
     *
     * The worst of the three cross-practice writes the authorisation sweep
     * found, because of what detaching decides: which phone number signs in as
     * this person from now on. `Patient.findById` with no filter meant a
     * clinician at any practice could point somebody else's patient at a
     * number of their choosing — and the patient would find themselves unable
     * to sign in, with a stranger's handset holding their record.
     *
     * `practicePatients` yields `{}` for a practice the enrolment backfill has
     * not reached, so this is no stricter than before for those deployments.
     */
    /*
     * `$and`, not a spread, and the difference is not stylistic.
     *
     * `{ _id: req.params.id, ...practicePatients(req, '_id') }` looks right and
     * is worse than no scoping at all: both keys are `_id`, so the spread
     * silently replaces the requested id with `{ $in: [own patients] }`. The
     * route then finds *a different patient* — one of the caller's own — and
     * detaches them. A guard that operates on the wrong record is a bug the
     * guard introduced.
     *
     * Caught by the cross-tenant test, which expected a 404 and got a 403 from
     * a check further down the handler that could only have been reached with
     * somebody else's row in hand.
     */
    const patient = await Patient.findOne({
      $and: [{ _id: req.params.id }, await practicePatients(req, '_id')],
    });
    if (!patient) throw notFound('Patient not found');

    if (patient.detachedAt) {
      throw badRequest('That patient already has their own login.');
    }

    const login = await User.findByLoginPhone(req.body.phone);
    if (!login) {
      throw badRequest(
        'That number has no account yet. Register it first, so the code goes to the handset that answers it.',
      );
    }
    if (login.role !== ROLES.PATIENT) {
      throw badRequest('That number belongs to a clinical account.');
    }
    if (String(login._id) === String(patient.login)) {
      throw badRequest('That is already the login this patient is under.');
    }

    // Somebody else's own record must not be absorbed by this one.
    const taken = await Patient.findOne({
      login: login._id,
      relationship: 'self',
      isActive: true,
    })
      .select('_id')
      .lean();
    if (taken && String(taken._id) !== String(patient._id)) {
      throw forbidden('That number already has a patient record of its own.');
    }

    patient.detachTo(login._id);
    await patient.save();

    res.json({ patient: patient.toPublic() });
  }),
);

/**
 * Where a consent relationship currently stands, and how it got there.
 *
 * `latestFor` is the projection the enrolment's status is meant to be — asked
 * directly here so a disagreement between the two is visible rather than
 * assumed away.
 */
router.get(
  '/enrolments/:id/consent/latest',
  requireClinician,
  audit('read', 'Enrollment'),
  asyncHandler(async (req, res) => {
    const enrollment = await Enrollment.findById(req.params.id).lean();
    if (!enrollment) throw notFound('That enrolment was not found');

    const latest = await ConsentEvent.latestFor(enrollment._id);
    res.json({
      status: enrollment.status,
      latest: latest ? latest.toPublic() : null,
      // Surfaced rather than reconciled. If the status and the log disagree,
      // something wrote one without the other, and hiding it would make the
      // log useless at the moment it mattered.
      agrees:
        !latest ||
        (latest.action === 'granted' && enrollment.status === 'active') ||
        (latest.action === 'revoked' && enrollment.status === 'revoked') ||
        (latest.action === 'requested' && enrollment.status === 'pending'),
    });
  }),
);

export default router;
