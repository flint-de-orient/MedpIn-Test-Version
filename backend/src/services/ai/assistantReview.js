import { createHash } from 'node:crypto';
import mongoose from 'mongoose';

import { Department } from '../../models/Department.js';
import { DoctorDepartment } from '../../models/DoctorDepartment.js';
import { KnowledgeChunk } from '../../models/KnowledgeChunk.js';
import { Membership, MEMBERSHIP_STATUS } from '../../models/Membership.js';
import { Practice } from '../../models/Practice.js';
import { User } from '../../models/User.js';
import { scopeVersionOf } from '../../models/guidanceReview.js';
import { conflict, forbidden, notFound } from '../../middleware/errors.js';
import { departmentForSpecialty, LEGACY_DEPARTMENT_KEY } from './assistantAvailability.js';

/**
 * How an AI-drafted scope or passage becomes something a patient can be told.
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
 * The shared row is never changed: it is still a draft for every other
 * practice. The practice's copy is keyed on (practice, adoptedFrom), so a second
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
  if (!draft || draft.practice != null || draft.origin !== 'ai_draft' || !['draft', 'pending_review'].includes(draft.status)) {
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

/**
 * The department's knowledge base, as one version a doctor can approve.
 *
 * A digest of every shared passage filed under the department that is not
 * retired — each docId at its version — so "the knowledge I read" and "the
 * knowledge I am approving" can be compared the way a scope's version is.
 * Practice copies are not in it: they are what an approval produces, and a
 * practice's own writing is approved passage by passage on the knowledge
 * screen. The diabetology corpus seeded before departments existed may still
 * be filed under none, and is counted as diabetology's, as availability does.
 */
export async function knowledgeVersionFor(department) {
  const legacy = department.key === LEGACY_DEPARTMENT_KEY;
  const rows = await KnowledgeChunk.find({
    practice: null,
    department: legacy ? { $in: [department._id, null] } : department._id,
    status: { $ne: 'retired' },
  })
    .select('docId version')
    .lean();
  const lines = rows.map((r) => `${r.docId}@${r.version ?? 1}`).sort();
  return createHash('sha256').update(lines.join('\n')).digest('hex').slice(0, 12);
}

/**
 * Approve the version of a department's assistant scope a clinician read, for
 * their practice.
 *
 * The version is required: a scope revised between opening it and pressing
 * approve would otherwise be approved in words nobody read. The write is one
 * update that replaces this practice's approval and conditions on the version,
 * so a concurrent revision makes it match nothing rather than approve the new
 * text.
 *
 * Approving what is already approved here — same wording, same knowledge,
 * not withdrawn — changes nothing and says so, so a double tap is not a
 * second approval on the record.
 */
export async function approveScope({ departmentId, practiceId, userId, version, knowledgeVersion = null }) {
  const department = oid(departmentId) ? await Department.findById(oid(departmentId)).lean() : null;
  const practice = oid(practiceId);
  if (!department || (department.practice != null && String(department.practice) !== String(practice))) {
    throw notFound('Department not found');
  }

  const scope = department.assistantScope ?? {};
  if (!scope.role) throw notFound('This department has no assistant scope to review.');
  if (scope.status === 'retired') throw conflict('This assistant scope has been retired.');
  if (!(await isClinicianOf({ userId, practiceId, departmentId: department._id }))) {
    throw forbidden('Only a clinician of this specialty at your practice can approve its assistant.');
  }
  const current = scopeVersionOf(scope);
  if (Number(version) !== current) {
    throw conflict('This scope has changed since you opened it. Read the current version before approving.', {
      currentVersion: current,
    });
  }

  const existing = (scope.approvals ?? []).find((a) => String(a.practice) === String(practice));
  if (
    existing &&
    !existing.withdrawnAt &&
    existing.version === current &&
    (existing.knowledgeVersion ?? null) === (knowledgeVersion ?? null)
  ) {
    return { ...existing, unchanged: true };
  }

  const approver = await User.findById(oid(userId)).select('name').lean();
  const approval = {
    practice,
    version: current,
    knowledgeVersion,
    approvedBy: oid(userId),
    approvedByName: approver?.name ?? null,
    approvedAt: new Date(),
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawnByName: null,
  };
  const res = await Department.updateOne(
    {
      _id: department._id,
      // A scope with no version is at version 1; `null` matches the missing field.
      'assistantScope.version': scope.version ?? null,
      'assistantScope.status': { $ne: 'retired' },
    },
    [
      {
        $set: {
          'assistantScope.approvals': {
            $concatArrays: [
              {
                $filter: {
                  input: { $ifNull: ['$assistantScope.approvals', []] },
                  cond: { $ne: ['$$this.practice', practice] },
                },
              },
              [approval],
            ],
          },
        },
      },
    ],
  );
  if (!res.matchedCount) {
    throw conflict('This scope changed while you were approving it. Read the current version and approve again.');
  }
  return { ...approval, unchanged: false };
}

/**
 * Approve & turn on: the department's knowledge base and its scope, together,
 * as the doctor read them.
 *
 * ---- One decision, in the order that keeps it safe ----------------------
 *
 * The doctor reviews one assistant — what it covers, refuses and escalates,
 * and the guidance it answers from — and approves it once. Behind that, each
 * shared draft passage is taken into this practice as an approved copy (the
 * same adoption the knowledge screen does one passage at a time), and then
 * the scope is approved. Knowledge first: the scope is the switch, so a
 * failure part-way leaves the assistant off, and trying again finishes the
 * job — every step is idempotent.
 *
 * Both versions are checked first. A draft revised, or a passage added,
 * between the doctor opening the screen and pressing the button is not
 * approved on their behalf.
 *
 * A passage this practice has edited is left as its own copy for the doctor to
 * review on the knowledge screen; it is counted, not overwritten.
 */
export async function approveAssistant({ departmentId, practiceId, userId, version, knowledgeVersion }) {
  const department = oid(departmentId) ? await Department.findById(oid(departmentId)).lean() : null;
  const practice = oid(practiceId);
  if (!department || (department.practice != null && String(department.practice) !== String(practice))) {
    throw notFound('Department not found');
  }
  if (!department.assistantScope?.role) throw notFound('This department has no assistant to approve.');
  if (department.assistantScope.status === 'retired') throw conflict('This assistant has been retired.');
  if (!(await isClinicianOf({ userId, practiceId, departmentId: department._id }))) {
    throw forbidden('Only a clinician of this specialty at your practice can approve its assistant.');
  }
  const currentKnowledge = await knowledgeVersionFor(department);
  if (knowledgeVersion !== currentKnowledge) {
    throw conflict('This assistant’s knowledge has changed since you opened it. Review it again before approving.', {
      currentKnowledgeVersion: currentKnowledge,
    });
  }

  const drafts = await KnowledgeChunk.find({
    practice: null,
    department: department._id,
    origin: 'ai_draft',
    status: { $in: ['draft', 'pending_review'] },
  })
    .select('+embedding')
    .lean();

  const knowledge = { adopted: 0, alreadyApproved: 0, keptPracticeEdits: 0 };
  for (const draft of drafts) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const outcome = await adoptSharedDraft({ draft, practiceId, userId, approve: true, version: draft.version });
      if (outcome.unchanged) knowledge.alreadyApproved += 1;
      else knowledge.adopted += 1;
    } catch (err) {
      if (err?.status === 409 && err?.details?.chunkId) {
        knowledge.keptPracticeEdits += 1;
        continue;
      }
      throw err;
    }
  }

  const approval = await approveScope({
    departmentId: department._id,
    practiceId,
    userId,
    version,
    knowledgeVersion: currentKnowledge,
  });
  return { department, approval, knowledge };
}

/**
 * Withdraw this practice's approval. The assistant goes quiet at once: every
 * patient message asks for the status afresh, so there is nothing cached to
 * outlive this write.
 *
 * Kept on the record as withdrawn — by whom and when — rather than deleted.
 * Withdrawing what is not approved here changes nothing.
 */
export async function withdrawScope({ departmentId, practiceId, userId }) {
  const department = oid(departmentId) ? await Department.findById(oid(departmentId)).lean() : null;
  const practice = oid(practiceId);
  if (!department || (department.practice != null && String(department.practice) !== String(practice))) {
    throw notFound('Department not found');
  }
  if (!(await isClinicianOf({ userId, practiceId, departmentId: department._id }))) {
    throw forbidden('Only a clinician of this specialty at your practice can withdraw its assistant.');
  }
  const who = await User.findById(oid(userId)).select('name').lean();
  const res = await Department.updateOne(
    {
      _id: department._id,
      'assistantScope.approvals': { $elemMatch: { practice, withdrawnAt: null } },
    },
    {
      $set: {
        'assistantScope.approvals.$.withdrawnAt': new Date(),
        'assistantScope.approvals.$.withdrawnBy': oid(userId),
        'assistantScope.approvals.$.withdrawnByName': who?.name ?? null,
      },
    },
  );
  return { department, withdrawn: res.modifiedCount > 0 };
}
