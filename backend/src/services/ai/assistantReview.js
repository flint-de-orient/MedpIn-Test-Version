import mongoose from 'mongoose';

import { DoctorDepartment } from '../../models/DoctorDepartment.js';
import { KnowledgeChunk } from '../../models/KnowledgeChunk.js';
import { Membership, MEMBERSHIP_STATUS } from '../../models/Membership.js';
import { Practice } from '../../models/Practice.js';
import { conflict, forbidden, notFound } from '../../middleware/errors.js';
import { departmentForSpecialty } from './assistantAvailability.js';

/**
 * A practice's own copies of the shared guidance passages.
 *
 * There is no approval step for an assistant: its scope is live, and its
 * shared passages are seeded live. What remains here is the knowledge screen's
 * per-passage work — a practice taking its own copy of a shared passage to
 * edit, approve or retire for its patients.
 *
 * ---- Who may approve ---------------------------------------------------------
 *
 * A clinician of that specialty, at the practice whose patients will read it.
 * Specialty, because a general physician approving what the cardiology
 * assistant says about anticoagulants is a sign-off by the wrong person.
 * Practice, because approving for one clinic's patients is a decision about
 * those patients and nobody else's — see the note on `adoptedFrom` in
 * KnowledgeChunk.js.
 *
 * "Of that specialty" means any of: the department their membership at this
 * practice names; a current row in DoctorDepartment for this practice; or, when
 * their membership names no department, the specialty of the practice itself —
 * the cardiologist who owns a cardiology clinic has no department row because a
 * one-doctor practice has nothing to divide.
 *
 * Passages with no department apply across specialties and keep the rule they
 * always had: any doctor of the practice may approve the practice's own.
 */

const oid = (value) => {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = value?._id ?? value;
  return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null;
};

/** The departments this person practises in at this practice, as id strings. */
export async function clinicianDepartmentIds({ userId, practiceId }) {
  const user = oid(userId);
  const practice = oid(practiceId);
  if (!user || !practice) return new Set();

  const membership = await Membership.findOne({
    user,
    practice,
    status: MEMBERSHIP_STATUS.ACTIVE,
    endedOn: null,
  })
    .select('department')
    .lean();
  if (!membership) return new Set();

  const ids = new Set();
  if (membership.department) ids.add(String(membership.department));

  const rows = await DoctorDepartment.find({ doctor: user, practice, endedOn: null }).select('department').lean();
  for (const r of rows) ids.add(String(r.department));

  if (!membership.department) {
    const row = await Practice.findById(practice).select('specialty').lean();
    const specialty = row?.specialty ? await departmentForSpecialty(row.specialty, practice) : null;
    if (specialty) ids.add(String(specialty._id));
  }
  return ids;
}

/** Whether this person may approve guidance filed under this department here. */
export async function isClinicianOf({ userId, practiceId, departmentId }) {
  if (!departmentId) return true;
  return (await clinicianDepartmentIds({ userId, practiceId })).has(String(departmentId));
}

/**
 * A shared AI draft, taken into this practice — approved, or as an editable
 * draft of its own.
 *
 * The shared row is never changed: every other practice keeps reading it. The practice's copy is keyed on (practice, adoptedFrom), so a second
 * approval updates the one copy rather than adding another.
 *
 * Refused when the practice already has a copy whose wording it has changed.
 * Approving the shared draft again would put the draft's words back over the
 * practice's own edits without anybody reading the difference; the edited copy
 * is the one to review.
 *
 * @param {object} opts
 * @param {object} opts.draft      the shared draft, `+embedding` selected
 * @param {boolean} opts.approve   approve now, or copy as pending_review
 * @param {?number} opts.version   the version the clinician read, when the app sends it
 */
export async function adoptSharedDraft({ draft, practiceId, userId, approve, version = null }) {
  // Live shared passages can be copied too: a practice that disagrees with one
  // takes its own copy to edit or retire.
  if (
    !draft ||
    draft.practice != null ||
    draft.origin !== 'ai_draft' ||
    !['draft', 'pending_review', 'approved'].includes(draft.status)
  ) {
    throw notFound('Knowledge entry not found');
  }
  if (!(await isClinicianOf({ userId, practiceId, departmentId: draft.department }))) {
    throw forbidden('Only a clinician of this specialty at your practice can review this draft.');
  }
  if (version != null && Number(version) !== draft.version) {
    throw conflict('This draft has changed since you opened it. Read the current version before approving.', {
      currentVersion: draft.version,
    });
  }

  const practice = oid(practiceId);
  const existing = await KnowledgeChunk.findOne({ practice, adoptedFrom: draft._id }).lean();

  // Already approved in exactly these words: nothing to do.
  if (
    approve &&
    existing?.status === 'approved' &&
    existing.adoptedVersion === draft.version &&
    existing.content === draft.content
  ) {
    return { chunk: existing, created: false, unchanged: true };
  }

  // A copy is written at version 1 and the edit route bumps the version when
  // the wording changes, so anything above 1 is the practice's own writing.
  // A retired copy was withdrawn by the practice, and taking the draft afresh
  // replaces it.
  if (existing && (existing.version ?? 1) > 1 && existing.status !== 'retired') {
    throw conflict('Your practice has edited its own copy of this passage. Review and approve that copy instead.', {
      chunkId: String(existing._id),
    });
  }

  const now = new Date();
  const fields = {
    docId: draft.docId,
    title: draft.title,
    section: draft.section,
    content: draft.content,
    language: draft.language,
    category: draft.category,
    tags: draft.tags ?? [],
    sourceCitation: draft.sourceCitation,
    sources: draft.sources ?? [],
    department: draft.department,
    origin: 'ai_draft',
    adoptedFrom: draft._id,
    adoptedVersion: draft.version,
    version: 1,
    status: approve ? 'approved' : 'pending_review',
    ...(draft.embedding?.length
      ? { embedding: draft.embedding, embeddingModel: draft.embeddingModel, embeddedAt: draft.embeddedAt ?? now }
      : {}),
  };
  const update = approve
    ? { $set: { ...fields, approvedBy: oid(userId), approvedAt: now } }
    : { $set: fields, $unset: { approvedBy: '', approvedAt: '' } };

  // `.exec()` so the write visibly runs where it is built — see
  // queriesActuallyRun.test.js on queries that are built and never executed.
  const write = () =>
    KnowledgeChunk.findOneAndUpdate({ practice, adoptedFrom: draft._id }, update, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    })
      .lean()
      .exec();

  try {
    return { chunk: await write(), created: !existing, unchanged: false };
  } catch (err) {
    // Two approvals at once: the unique index refused the second insert, and
    // the copy the first one made is now there to update.
    if (err?.code !== 11000) throw err;
    return { chunk: await write(), created: false, unchanged: false };
  }
}
