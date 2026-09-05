import { Department } from '../../models/Department.js';
import { conditionsFor, describeForPrompt } from '../patientConditions.js';

/**
 * The assistant for one department, or none at all.
 *
 * ---- What was wrong --------------------------------------------------------
 *
 * There was one assistant and it was a diabetologist. The system prompt names
 * its areas of practice and then refuses, by name, "a skin rash, a cough or
 * cold, a broken bone, an eye infection, mental-health matters unrelated to
 * diabetes, a child's illness, or anything belonging to another specialty".
 *
 * Exactly right for Dr. Dey, whose patients all have diabetes. Fatal for the
 * dermatology practice whose patients are told their rash is out of scope by an
 * assistant introducing itself as somebody else's doctor.
 *
 * ---- Silence is a feature --------------------------------------------------
 *
 * A department with no `assistantScope` gets no assistant. Not a general one,
 * not a fallback to the diabetes prompt — nothing, and the thread says so.
 *
 * This is the same rule `triageRules` follows and it is the same argument. An
 * assistant improvising cardiology answers out of diabetes guidance is worse
 * than no assistant, because it is fluent: the patient cannot tell it is
 * guessing, and neither can the doctor skimming the thread later. Refusing to
 * answer is legible. Answering wrongly is not.
 *
 * It also matches what the specification already says a patient with no
 * practices should get: "Nothing. No assistant by default."
 */

/**
 * Everything a prompt needs about a department and the patient in front of it.
 *
 * @returns {Promise<null|{department, scope, conditions, promptBlock}>}
 *   null when this department has no assistant — the caller must then not
 *   generate a reply at all.
 */
export async function assistantContextFor({ departmentId, patientId, profile = null, language = 'en' }) {
  if (!departmentId) return null;

  const department = await Department.findById(departmentId).lean();
  const role = department?.assistantScope?.role;

  // No scope, no assistant. Returning a general one here is the whole bug this
  // module exists to prevent.
  if (!role) return null;

  const conditions = await conditionsFor(patientId, { profile });

  return {
    department: {
      id: String(department._id),
      key: department.key,
      name: department.names?.[language] || department.names?.en || department.key,
    },
    scope: {
      role,
      covers: department.assistantScope.covers ?? [],
      refuses: department.assistantScope.refuses ?? [],
    },
    conditions,
    // The rules this department's patients are triaged against. Empty until a
    // clinician in the specialty writes them, and empty is honest — see the
    // note on Department.triageRules.
    triageRules: department.triageRules ?? [],
    promptBlock: buildScopeBlock({
      department,
      role,
      conditions,
      language,
    }),
  };
}

/**
 * The department-specific half of the system prompt.
 *
 * Written as data rather than sentences wherever possible, so a specialty added
 * by an admin next month reads the same way as one seeded today.
 */
function buildScopeBlock({ department, role, conditions, language }) {
  const name = department.names?.[language] || department.names?.en || department.key;
  const covers = department.assistantScope.covers ?? [];
  const refuses = department.assistantScope.refuses ?? [];

  const lines = [`You are ${role} for the ${name} department.`, ''];

  if (covers.length) {
    lines.push('## What you help with');
    for (const c of covers) lines.push(`- ${c}`);
    lines.push('');
  }

  // Always present, even when the department listed none: an assistant with no
  // stated limit is one that will answer anything asked of it.
  lines.push('## What you do NOT help with');
  for (const r of refuses) lines.push(`- ${r}`);
  lines.push(
    '- Anything outside this department. Say warmly that it is not your area, and',
    '  suggest the right specialist or their family doctor. Do not answer it from',
    '  general knowledge.',
  );
  lines.push('');

  // The patient, not a generic one. A four-year-old is not a small adult, and
  // an assistant that does not know which illnesses it is speaking about will
  // give advice for the wrong one.
  const described = describeForPrompt(conditions);
  if (described) {
    lines.push('## This patient');
    lines.push(`Recorded conditions: ${described}.`);
    lines.push('Answer for these, and say so when a question falls outside them.');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Whether a thread in this department may produce an AI reply at all.
 *
 * Separate from [assistantContextFor] so a route can decide whether to show a
 * composer without paying for the patient's conditions.
 */
export async function departmentHasAssistant(departmentId) {
  if (!departmentId) return false;
  const d = await Department.findById(departmentId).select('assistantScope.role').lean();
  return Boolean(d?.assistantScope?.role);
}
