import { Enrollment, ENROLLMENT_STATUS, DIETICIAN_SOURCE } from '../models/Enrollment.js';
import { User, ROLES } from '../models/User.js';
import { memberIdsOf } from '../middleware/practiceScope.js';
import { AppError, notFound } from '../middleware/errors.js';
import { logger } from '../config/logger.js';

/**
 * Who looks after a patient's nutrition, at each practice that cares for them.
 *
 * ---- Where the answer lives ------------------------------------------------
 *
 * On the enrolment: the row that already says "this patient, at this
 * practice". It was one field on the patient's profile, so a patient enrolled
 * at two practices could be held by one practice's dietician at a time — the
 * second practice's assignment overwrote the first, and the first practice's
 * dietician lost the patient without anybody at that practice doing anything.
 * An assignment is a fact about a relationship, and a patient has one
 * relationship per practice.
 *
 * ---- The rule, by how many people could do it ------------------------------
 *
 *   none     — nobody is assigned; there is nobody to assign
 *   one      — they are assigned by default, and the doctor can unassign
 *   several  — the doctor chooses; the first row the database returns is not
 *              an answer to a clinical allocation, so nothing here picks
 *
 * ---- A decision is recorded, including "nobody" ---------------------------
 *
 * `dieticianSource` is null until something is decided for the relationship,
 * and the default only ever fills a relationship nobody has decided. So a
 * doctor who unassigns the practice's only dietician has made a decision, and
 * neither the backfill, nor the patient consenting again, nor the next hire
 * puts the patient back behind them.
 *
 * ---- A dietician who stops working here ------------------------------------
 *
 * Nothing is rewritten. Their assignments stay on the record as what they
 * were — the doctor's screen shows who held the patient and that they are no
 * longer active — and nobody else inherits the patient: a transfer is a
 * decision the doctor makes. What stops is the work. The caseload is read at
 * the practice a request is for, and somebody suspended, departed or switched
 * off cannot make one there; everything else that reaches a dietician about a
 * patient — the push about their messages, the name on their screen, who
 * answers for them — asks `activeDieticianIds`. And the doctor's count of
 * patients needing a dietician includes theirs.
 */

/** A relationship that grants anything now. */
const CURRENT = Object.freeze({ status: ENROLLMENT_STATUS.ACTIVE, revokedAt: null });

/** Nothing has been decided for this relationship yet — matches a field never written, too. */
const UNDECIDED = Object.freeze({ dieticianSource: null });

/**
 * The dieticians who can take on work at a practice today: a current
 * membership there as a dietician, on an account that is switched on.
 *
 * Both halves. A membership ends when somebody leaves or is suspended; an
 * account is switched off by the person themselves or by the platform, and
 * leaves the membership standing. Either one means no new work.
 *
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export async function activeDieticianIds(practiceId) {
  if (!practiceId) return [];
  // `null` is a platform with no memberships at all, which has no dietician
  // anybody could be handed to.
  const members = (await memberIdsOf(practiceId, ROLES.DIETICIAN)) ?? [];
  if (!members.length) return [];

  const people = await User.find({ _id: { $in: members }, role: ROLES.DIETICIAN, isActive: true })
    .select('_id')
    .lean();
  return people.map((p) => p._id);
}

/**
 * The default, for one relationship: when the patient joins a practice, or
 * consents to it, its only active dietician takes them on.
 *
 * Only a current, undecided enrolment is touched, in one conditional write —
 * so a doctor's decision made a moment earlier, a pending enrolment, and a
 * practice with any number of dieticians but one all leave it as it is.
 *
 * @returns {Promise<import('mongoose').Types.ObjectId|null>} who was assigned, if anybody
 */
export async function autoAssignDietician(patientId, practiceId) {
  if (!patientId || !practiceId) return null;

  const dieticians = await activeDieticianIds(practiceId);
  if (dieticians.length !== 1) return null;
  const [only] = dieticians;

  const result = await Enrollment.updateOne(
    { patient: patientId, practice: practiceId, ...CURRENT, ...UNDECIDED },
    {
      $set: {
        dietician: only,
        dieticianSource: DIETICIAN_SOURCE.AUTO,
        dieticianSince: new Date(),
        dieticianBy: null,
      },
    },
  );
  return result.modifiedCount ? only : null;
}

/**
 * The same default, for the moment a practice's only dietician arrives.
 *
 * Called when a dietician joins or returns. If that leaves exactly one active
 * dietician here, every current relationship nobody has decided for is theirs
 * — the patients who joined while the practice had nobody. A second dietician
 * arriving changes nothing: with two, the choice is the doctor's, and the
 * patients already assigned stay where they are.
 *
 * Deliberately not called when a dietician leaves. Patients left undecided
 * while there were two were left for the doctor, and a suspension should not
 * make that decision for them.
 *
 * @returns {Promise<{dietician: import('mongoose').Types.ObjectId|null, assigned: number}>}
 */
export async function assignUndecidedToOnlyDietician(practiceId) {
  const dieticians = await activeDieticianIds(practiceId);
  if (dieticians.length !== 1) return { dietician: null, assigned: 0 };
  const [only] = dieticians;

  const result = await Enrollment.updateMany(
    { practice: practiceId, ...CURRENT, ...UNDECIDED },
    {
      $set: {
        dietician: only,
        dieticianSource: DIETICIAN_SOURCE.AUTO,
        dieticianSince: new Date(),
        dieticianBy: null,
      },
    },
  );
  return { dietician: only, assigned: result.modifiedCount ?? 0 };
}

/**
 * Somebody has just started at a practice, or come back, in `role`.
 *
 * For a dietician, the default above. Called by the practice's own routes that
 * add or restore a member of staff — `/team` and `/practices/:id/members` — so
 * a practice's first dietician finds the patients who were waiting for one on
 * their first list. (The operator console restoring a membership does not call
 * it; the doctor's home still counts those patients.)
 *
 * Never throws. The membership has already been written, and refusing the
 * request that made it would tell the doctor a hire failed that did not; the
 * doctor's home counts every patient still waiting for a dietician.
 */
export async function dieticianArrived(practiceId, role) {
  if (role !== ROLES.DIETICIAN || !practiceId) return { dietician: null, assigned: 0 };
  try {
    return await assignUndecidedToOnlyDietician(practiceId);
  } catch (err) {
    logger.error({ err, practiceId: String(practiceId) }, 'could not give the waiting patients to a new dietician');
    return { dietician: null, assigned: 0 };
  }
}

/**
 * A doctor's decision for one relationship: this dietician, or nobody.
 *
 * ---- History, not overwrite ------------------------------------------------
 *
 * Whatever stood before is pushed onto `dieticianHistory` with when it ended
 * and who ended it, so "who looked after this patient in March" still has an
 * answer after the patient moves on.
 *
 * ---- Two doctors at once ---------------------------------------------------
 *
 * The write is conditional on the state that was read, so it lands only on
 * what this doctor decided against. If somebody changed it in between:
 *
 *   - to the same choice, this request changed nothing and says so — two
 *     identical requests are one change: one entry in the history at most,
 *     and one push;
 *   - to anything else, it is refused with DIETICIAN_CHANGED. The doctor sees
 *     what their colleague chose before choosing over it, rather than the
 *     later of two clicks silently winning.
 *
 * `expected` is the dietician the doctor's screen was showing — an id, or
 * null for nobody. Given, the same refusal covers a screen opened before a
 * colleague's change, which no race inside one request can see. Omitted, as
 * older builds of the app do, only the race is caught.
 *
 * Choosing what is already there is not a change: no history, and the caller
 * is told nothing changed, which is what stops a second push to the dietician.
 *
 * @returns {Promise<{changed: boolean, dietician: import('mongoose').Types.ObjectId|null}>}
 */
export async function chooseDietician({ enrollmentId, dieticianId = null, by = null, expected }) {
  const wanted = dieticianId ? String(dieticianId) : null;
  const holderOf = (row) => (row?.dietician ? String(row.dietician) : null);

  const current = await Enrollment.findById(enrollmentId)
    .select('dietician dieticianSource dieticianSince dieticianBy')
    .lean();
  if (!current) throw notFound('Patient not found');

  // Already what this doctor wants, whatever their screen showed: nothing to
  // change, and nobody's choice is being overridden.
  const decided = current.dieticianSource != null;
  if (decided && holderOf(current) === wanted) return { changed: false, dietician: current.dietician ?? null };

  if (expected !== undefined && (expected ? String(expected) : null) !== holderOf(current)) {
    throw dieticianChanged();
  }

  const now = new Date();
  const update = {
    $set: {
      dietician: dieticianId ?? null,
      dieticianSource: DIETICIAN_SOURCE.DOCTOR,
      dieticianSince: now,
      dieticianBy: by,
    },
  };
  // An undecided relationship has no state to keep: nothing stood.
  if (decided) {
    update.$push = {
      dieticianHistory: {
        dietician: current.dietician ?? null,
        source: current.dieticianSource,
        since: current.dieticianSince ?? null,
        by: current.dieticianBy ?? null,
        endedAt: now,
        endedBy: by,
      },
    };
  }

  const written = await Enrollment.updateOne(
    {
      _id: enrollmentId,
      dietician: current.dietician ?? null,
      dieticianSource: current.dieticianSource ?? null,
      dieticianSince: current.dieticianSince ?? null,
    },
    update,
  );
  if (written.modifiedCount) return { changed: true, dietician: dieticianId ?? null };

  // Somebody decided in between. The same decision was theirs and is ours; a
  // different one is theirs, and this doctor is told rather than overriding it.
  const now2 = await Enrollment.findById(enrollmentId).select('dietician dieticianSource').lean();
  if (now2?.dieticianSource != null && holderOf(now2) === wanted) {
    return { changed: false, dietician: now2.dietician ?? null };
  }
  throw dieticianChanged();
}

/** The refusal for a choice made against a state that no longer stands. */
function dieticianChanged() {
  return new AppError(
    409,
    'DIETICIAN_CHANGED',
    'Somebody changed this patient’s dietician a moment ago. Look at who holds them now before changing it.',
  );
}

/**
 * The relationships this dietician holds at a practice, with when each began —
 * the caseload, and the window each patient's record is read through.
 *
 * Only current enrolments: a patient who withdrew this practice's access is
 * nobody's work here, and returns to the list if they consent again.
 */
export async function caseloadOf({ practiceId, dieticianId }) {
  if (!practiceId || !dieticianId) return [];
  return Enrollment.find({ practice: practiceId, dietician: dieticianId, ...CURRENT })
    .select('_id patient practice enrolledOn')
    .lean();
}

/**
 * The dietician actively looking after this patient at this practice, or null —
 * for the push about a patient's message and the name on the patient's screen.
 *
 * Null for a dietician who is no longer active here, rather than their name:
 * both of those are future work, and a person who has left does neither.
 */
export async function activeDieticianOf({ practiceId, patientId }) {
  if (!practiceId || !patientId) return null;
  const enrollment = await Enrollment.findOne({ patient: patientId, practice: practiceId, ...CURRENT })
    .select('dietician')
    .lean();
  if (!enrollment?.dietician) return null;

  const active = await activeDieticianIds(practiceId);
  return active.some((id) => String(id) === String(enrollment.dietician)) ? enrollment.dietician : null;
}

/**
 * The doctor's view of one relationship: who holds it, whether they still work
 * here, how it was decided, and everyone who held it before.
 *
 * Names and nothing more for the history. A dietician who has left is a name
 * on a record, not a phone number to hand out.
 */
export async function describeNutritionCare(enrollment) {
  const practiceId = enrollment?.practice;
  const active = new Set((await activeDieticianIds(practiceId)).map(String));

  const history = [...(enrollment?.dieticianHistory ?? [])].sort(
    (x, y) => new Date(y.endedAt ?? 0) - new Date(x.endedAt ?? 0),
  );
  const ids = new Set(
    [
      enrollment?.dietician,
      enrollment?.dieticianBy,
      ...history.flatMap((h) => [h.dietician, h.by, h.endedBy]),
    ]
      .filter(Boolean)
      .map(String),
  );
  const people = ids.size
    ? await User.find({ _id: { $in: [...ids] } }).select('name phone avatarAssetId').lean()
    : [];
  const byId = new Map(people.map((p) => [String(p._id), p]));
  const nameOf = (id) => (id ? { id: String(id), name: byId.get(String(id))?.name ?? null } : null);

  const current = enrollment?.dietician ? byId.get(String(enrollment.dietician)) : null;

  return {
    dietician: enrollment?.dietician
      ? {
          id: String(enrollment.dietician),
          name: current?.name ?? null,
          phone: current?.phone ?? null,
          avatarUrl: current?.avatarAssetId ? `/api/v1/uploads/${current.avatarAssetId}/raw` : null,
          // Still working here. False keeps the name on the record and says
          // the patient needs somebody else — nobody was moved on their behalf.
          active: active.has(String(enrollment.dietician)),
        }
      : null,
    // Whether anybody has decided for this relationship. A patient with no
    // dietician and `decided: true` was deliberately left without one.
    decided: enrollment?.dieticianSource != null,
    source: enrollment?.dieticianSource ?? null,
    since: enrollment?.dieticianSince ?? null,
    decidedBy: nameOf(enrollment?.dieticianBy),
    activeDieticians: active.size,
    history: history.map((h) => ({
      dietician: nameOf(h.dietician),
      source: h.source ?? null,
      since: h.since ?? null,
      until: h.endedAt ?? null,
      by: nameOf(h.by),
      endedBy: nameOf(h.endedBy),
    })),
  };
}

/**
 * How well a practice's patients are covered, for the doctor's home.
 *
 * `needsChoice` is the prompt, not the decision: relationships nobody has
 * decided for, and those held by a dietician who is no longer active here.
 * Zero while the practice has no active dietician — there is nobody to choose.
 */
export async function nutritionCoverage(practiceId) {
  if (!practiceId) return { activeDieticians: 0, withActiveDietician: 0, needsChoice: 0 };
  const active = await activeDieticianIds(practiceId);

  const [withActiveDietician, needsChoice] = await Promise.all([
    active.length
      ? Enrollment.countDocuments({ practice: practiceId, ...CURRENT, dietician: { $in: active } })
      : 0,
    active.length
      ? Enrollment.countDocuments({
          practice: practiceId,
          ...CURRENT,
          $or: [UNDECIDED, { dietician: { $ne: null, $nin: active } }],
        })
      : 0,
  ]);

  return { activeDieticians: active.length, withActiveDietician, needsChoice };
}
