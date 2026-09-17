import mongoose from 'mongoose';

import {
  REVIEW_STATUSES,
  CONTENT_ORIGINS,
  guidanceSourceSchema,
} from './guidanceReview.js';

/**
 * The doctor-approved knowledge base backing RAG. Nothing enters retrieval
 * unless `status === 'approved'` — an unreviewed chunk is invisible to the
 * assistant by design.
 */

/**
 * Every topic a passage can be filed under.
 *
 * Exported so the knowledge routes validate against this list rather than a
 * shorter copy of it. The route kept its own fifteen, so a passage filed under
 * `thyroid` by the seed could not be saved again from the app — the edit was
 * refused as an unknown category.
 */
export const KNOWLEDGE_CATEGORIES = Object.freeze([
  'diabetes_basics',
  'hypoglycaemia',
  'hyperglycaemia',
  'insulin',
  'oral_medication',
  'diet',
  'exercise',
  'foot_care',
  'eye_care',
  'kidney',
  'hypertension',
  'sick_day_rules',
  'emergency',
  'clinic_info',
  // Dr. Dey practises general endocrinology, not diabetes alone. These
  // cover the rest of the clinic's caseload.
  'thyroid',
  'dyslipidaemia',
  'obesity_metabolic',
  'pcos',
  'adrenal',
  'pituitary',
  'bone_metabolism',
  'gout',
  'liver',
  'neuropathy',
  'cardiovascular',
  'pharmacology',
  'lab_interpretation',
  'devices',
  'preventive_care',
  'special_populations',
  'mental_health',
  'sexual_health',
  'general',
  // Cardiology. Blood pressure, cholesterol, medicines, diet and exercise
  // already have categories above and are reused rather than duplicated.
  'heart_failure',
  'atrial_fibrillation',
  'anticoagulation',
  'coronary_heart_disease',
  'cardiac_rehabilitation',
  'cardiac_symptoms',
  'cardiac_tests',
  // General medicine: the short illnesses and injuries a general physician's
  // patients ask about, and the medicines people take for them unprescribed.
  'fever',
  'respiratory_infection',
  'gastrointestinal',
  'urinary',
  'headache',
  'musculoskeletal',
  'minor_injury',
  'pain_relief',
  'antibiotics',
  'vaccination',
  'infectious_disease',
  'heat_illness',
]);

const knowledgeChunkSchema = new mongoose.Schema(
  {
    docId: { type: String, required: true, index: true }, // groups chunks of one source document
    title: { type: String, required: true, trim: true, maxlength: 300 },
    section: { type: String, trim: true, maxlength: 300 },
    chunkIndex: { type: Number, default: 0 },

    content: { type: String, required: true, maxlength: 8000 },
    language: { type: String, enum: ['en', 'bn', 'hi'], default: 'en', index: true },

    /// Who authored this, and who may be answered from it.
    ///
    /// Null means shared — the platform's own clinical content, readable by
    /// every practice. A practice's own passages carry its id and are never
    /// returned to another, because a clinic's approved wording is its clinical
    /// voice and lending it out is putting words in somebody else's mouth.
    practice: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Practice',
      default: null,
      index: true,
    },

    /// Which specialty this belongs to. Null means it applies across all of
    /// them — a practice's opening hours are as true in cardiology as in
    /// diabetology.
    ///
    /// The seeded diabetes and endocrine corpus was written with no department
    /// and so read as cross-specialty: a cardiology patient would have been
    /// grounded on insulin advice. The knowledge seed now files it under
    /// diabetology, where it was always meant to be.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },

    category: {
      type: String,
      enum: KNOWLEDGE_CATEGORIES,
      required: true,
      index: true,
    },
    tags: [{ type: String, trim: true, lowercase: true }],

    embedding: { type: [Number], select: false },
    embeddingModel: String,
    embeddedAt: Date,

    status: {
      type: String,
      enum: REVIEW_STATUSES,
      default: 'draft',
      index: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    version: { type: Number, default: 1 },

    sourceCitation: { type: String, maxlength: 500 }, // e.g. "ADA Standards of Care 2025, §6"

    /// Who wrote it. See CONTENT_ORIGINS. A passage written in the app is a
    /// clinician's; the seed says so for everything it writes.
    origin: { type: String, enum: CONTENT_ORIGINS, default: 'clinician', index: true },

    /// The guidance each statement was checked against — title, organisation,
    /// year, address and the day it was compared. `sourceCitation` stays for
    /// the passages written before this, and for the one-line form the prompt
    /// shows the model.
    sources: { type: [guidanceSourceSchema], default: [] },

    /**
     * The shared draft this practice's copy was taken from, and which version.
     *
     * ---- Why a copy, and not an approval flag on the shared row ----------
     *
     * A shared passage answers every practice. Letting one practice's doctor
     * approve it in place would put that doctor's judgement in front of every
     * other practice's patients — the hole the knowledge scoping closed. So a
     * clinician approving an AI draft approves it for their own practice: the
     * practice gets its own row, retrieval already scopes practice rows to the
     * practice, and the shared draft stays a draft for everybody else.
     *
     * The version is kept so a draft revised after it was approved can be
     * shown as "a newer draft is available" rather than silently replacing
     * words somebody signed off.
     */
    adoptedFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'KnowledgeChunk', default: null },
    adoptedVersion: { type: Number, default: null },
  },
  { timestamps: true },
);

knowledgeChunkSchema.index({ status: 1, language: 1, category: 1 });

/// "How much approved guidance does this department have here, in this
/// language?" — asked on every patient message by the assistant's availability
/// check.
knowledgeChunkSchema.index({ department: 1, status: 1, language: 1, practice: 1 });

/// One copy of a shared draft per practice. Two doctors approving the same
/// draft at the same moment would otherwise give the practice two identical
/// passages, both retrieved, both cited.
knowledgeChunkSchema.index(
  { practice: 1, adoptedFrom: 1 },
  { unique: true, partialFilterExpression: { adoptedFrom: { $type: 'objectId' } } },
);

// Lexical fallback when embeddings are unavailable.
//
// `language_override` is pointed at a field that does not exist on purpose:
// by default Mongo reads the document's `language` field as a text-search
// language, and it rejects 'bn' and 'hi' as unsupported. Redirecting the
// override lets every chunk index under the default analyser regardless of
// which language its content is written in.
knowledgeChunkSchema.index(
  { content: 'text', title: 'text', tags: 'text' },
  { default_language: 'english', language_override: 'textSearchLanguage' },
);

export const KnowledgeChunk = mongoose.model('KnowledgeChunk', knowledgeChunkSchema);
