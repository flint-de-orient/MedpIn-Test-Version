import mongoose from 'mongoose';

import { Department } from '../../models/Department.js';
import { conditionsFor, describeForPrompt } from '../patientConditions.js';
import { assistantStatus } from './assistantAvailability.js';

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
 *
 * ---- Written is not the same as approved ----------------------------------
 *
 * A role on the row used to be the switch, so drafting a scope put it in front
 * of patients. Whether a department answers is now decided in one place,
 * assistantAvailability.js: an approved scope for this practice, and enough
 * approved knowledge in the languages the conversation is grounded on. A draft
 * written by anybody — an AI included — does nothing until a clinician of the
 * specialty has approved it.
 */

/**
 * Everything a prompt needs about a department and the patient in front of it.
 *
 * `status` is the availability answer when the caller already has it, so a
 * message does not ask twice.
 *
 * @returns {Promise<null|{department, scope, conditions, promptBlock}>}
 *   null when this department's assistant is not on for this practice and
 *   language — the caller must then not generate a reply at all.
 */
export async function assistantContextFor({
  departmentId = null,
  department = null,
  patientId,
  profile = null,
  language = 'en',
  practiceId = null,
  status = null,
}) {
  const row =
    department ??
    (departmentId && mongoose.isValidObjectId(departmentId) ? await Department.findById(departmentId).lean() : null);
  if (!row) return null;

  const role = row.assistantScope?.role;

  // No scope, no assistant. Returning a general one here is the whole bug this
  // module exists to prevent.
  if (!role) return null;

  // And a scope nobody here has approved, or a department with too little
  // approved guidance to answer from, is no assistant either.
  const availability = status ?? (await assistantStatus({ department: row, practiceId, language }));
  if (!availability.enabled) return null;

  const conditions = await conditionsFor(patientId, { profile });

  return {
    department: {
      id: String(row._id),
      key: row.key,
      name: row.names?.[language] || row.names?.en || row.key,
    },
    scope: {
      role,
      covers: row.assistantScope.covers ?? [],
      refuses: row.assistantScope.refuses ?? [],
      redFlags: row.assistantScope.redFlags ?? [],
    },
    conditions,
    // The rules this department's patients are triaged against. Empty until a
    // clinician in the specialty writes them, and empty is honest — see the
    // note on Department.triageRules.
    triageRules: row.triageRules ?? [],
    promptBlock: buildScopeBlock({
      department: row,
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
 *
 * Exported so the prompt a department produces can be pinned by a test without
 * a database: the diabetology block must read exactly as it did before scopes
 * were reviewed.
 */
export function buildScopeBlock({ department, role, conditions, language }) {
  const name = department.names?.[language] || department.names?.en || department.key;
  const covers = department.assistantScope.covers ?? [];
  const refuses = department.assistantScope.refuses ?? [];
  const redFlags = department.assistantScope.redFlags ?? [];

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

  // The specialty's own emergencies, in the terms its patients use. Only ever a
  // reason to raise urgency: the safety rules below let the model raise the
  // triage verdict and never lower it, and these add to what raises it. Absent
  // for a scope that lists none, so the diabetology block reads as it always
  // has.
  if (redFlags.length) {
    lines.push('## Signs that mean hospital now in this specialty');
    for (const f of redFlags) lines.push(`- ${f}`);
    lines.push(
      'If the patient describes any of these, treat it as an emergency even if the triage',
      'verdict did not: say plainly it needs immediate medical attention and tell them to go',
      'to the nearest hospital emergency department now. Never suggest waiting to see.',
    );
    lines.push('');
  }

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

// Whether a department may answer at all is not asked here any more. A route
// that needs a yes or no asks assistantAvailability.js — `assistantStatus` for a
// department, `conversationAssistant` for a thread — which is the one place the
// answer is computed.
