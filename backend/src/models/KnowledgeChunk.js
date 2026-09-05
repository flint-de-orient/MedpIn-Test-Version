import mongoose from 'mongoose';

/**
 * The doctor-approved knowledge base backing RAG. Nothing enters retrieval
 * unless `status === 'approved'` — an unreviewed chunk is invisible to the
 * assistant by design.
 */
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
    /// them — hypoglycaemia advice is as true in cardiology as in diabetology.
    department: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Department',
      default: null,
      index: true,
    },

    category: {
      type: String,
      enum: [
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
      ],
      required: true,
      index: true,
    },
    tags: [{ type: String, trim: true, lowercase: true }],

    embedding: { type: [Number], select: false },
    embeddingModel: String,
    embeddedAt: Date,

    status: {
      type: String,
      enum: ['draft', 'pending_review', 'approved', 'retired'],
      default: 'draft',
      index: true,
    },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: Date,
    version: { type: Number, default: 1 },

    sourceCitation: { type: String, maxlength: 500 }, // e.g. "ADA Standards of Care 2025, §6"
  },
  { timestamps: true },
);

knowledgeChunkSchema.index({ status: 1, language: 1, category: 1 });

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
