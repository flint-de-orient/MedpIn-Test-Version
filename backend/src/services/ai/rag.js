import mongoose from 'mongoose';

import { KnowledgeChunk } from '../../models/KnowledgeChunk.js';
import { embed } from './gemini.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';

/**
 * Retrieval over the doctor-approved knowledge base.
 *
 * Two backends: Atlas `$vectorSearch` when the deployment supports it, and
 * in-process cosine similarity otherwise. A single clinic's corpus is a few
 * thousand chunks at most, so brute-force scoring is well within budget and
 * keeps local development working against a plain mongod.
 *
 * Invariant: only `status: 'approved'` chunks are ever retrievable.
 */

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** An ObjectId for a valid id however it arrived, and null for anything else. */
function asObjectId(value) {
  if (value == null) return null;
  if (value instanceof mongoose.Types.ObjectId) return value;
  const raw = value?._id ?? value;
  return mongoose.isValidObjectId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null;
}

/**
 * Narrow the candidate set before anything is ranked.
 *
 * The specification is specific about the order: filtered before ranking, not
 * after. A passage ranked and then discarded has already been read — the model
 * saw it, and the retrieval it was cut from is not the retrieval that happened.
 *
 * Both scopes are permissive on null. A chunk with no practice is the
 * platform's and answers everyone; a chunk with no department applies across
 * all of them, because hypoglycaemia advice is as true in cardiology as in
 * diabetology.
 */
function scopeFilter({ practice = null, department = null } = {}) {
  // Ids arrive as strings from the conversation resolver. `find` would cast
  // them against the schema; `$vectorSearch` inside `aggregate` casts nothing,
  // and a string never equals a stored ObjectId — the practice's own passages
  // would silently drop out of Atlas retrieval.
  practice = asObjectId(practice);
  department = asObjectId(department);
  const clauses = [];
  if (practice) clauses.push({ $or: [{ practice: null }, { practice }] });
  else clauses.push({ practice: null });
  if (department) clauses.push({ $or: [{ department: null }, { department }] });
  return clauses.length ? { $and: clauses } : {};
}

async function vectorSearchAtlas(queryVector, { limit, languages, categories, practice, department }) {
  const filter = { status: 'approved', ...scopeFilter({ practice, department }) };
  if (languages?.length) filter.language = { $in: languages };
  if (categories?.length) filter.category = { $in: categories };

  return KnowledgeChunk.aggregate([
    {
      $vectorSearch: {
        index: env.VECTOR_INDEX_NAME,
        path: 'embedding',
        queryVector,
        numCandidates: Math.max(limit * 15, 150),
        limit,
        filter,
      },
    },
    {
      $project: {
        title: 1, section: 1, content: 1, category: 1, language: 1,
        sourceCitation: 1, docId: 1,
        score: { $meta: 'vectorSearchScore' },
      },
    },
  ]);
}

async function vectorSearchInProcess(queryVector, { limit, languages, categories, practice, department }) {
  const filter = { status: 'approved', ...scopeFilter({ practice, department }) };
  if (languages?.length) filter.language = { $in: languages };
  if (categories?.length) filter.category = { $in: categories };

  const chunks = await KnowledgeChunk.find(filter)
    .select('+embedding title section content category language sourceCitation docId')
    .lean();

  return chunks
    .filter((c) => Array.isArray(c.embedding) && c.embedding.length === queryVector.length)
    .map((c) => {
      const { embedding, ...rest } = c;
      return { ...rest, score: cosineSimilarity(queryVector, embedding) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/**
 * Lexical fallback for when embeddings are unavailable entirely.
 *
 * Narrowed exactly as the vector searches are. It only runs once embedding has
 * already failed, which is how it came to be the one path still searching every
 * practice's passages — and an outage is no reason for a patient to be grounded
 * on, and shown the titles of, another clinic's private guidance.
 */
async function textSearch(query, { limit, language, practice = null, department = null }) {
  const filter = { status: 'approved', $text: { $search: query }, ...scopeFilter({ practice, department }) };
  if (language) filter.language = language;
  const results = await KnowledgeChunk.find(filter, { score: { $meta: 'textScore' } })
    .sort({ score: { $meta: 'textScore' } })
    .limit(limit)
    .lean();
  return results.map((r) => ({ ...r, score: r.score ?? 0 }));
}

/**
 * Which languages a conversation in `language` is grounded on.
 *
 * The patient's language and English, ranked together — see the note inside
 * [retrieve] for why. Exported because the assistant's availability check has
 * to count approved guidance in exactly the languages retrieval will read: a
 * count taken any other way would switch an assistant on for a Bengali thread
 * on the strength of passages it can never be shown, or off despite passages it
 * would be.
 */
export function searchLanguagesFor(language) {
  const languages = language && language !== 'en' ? [language, 'en'] : ['en', language].filter(Boolean);
  return [...new Set(languages)];
}

/**
 * @param {string} query
 * @param {object} opts
 * @param {number} [opts.limit=6]
 * @param {string} [opts.language] restrict to one language; falls back to English
 * @param {string[]} [opts.categories] bias retrieval toward specific topics
 * @param {number} [opts.minScore=0.4] drop weak matches rather than grounding on noise
 */
export async function retrieve(
  query,
  // `practice` and `department` narrow the corpus before ranking. Both
  // default to null, which is the single-practice case and the same pool
  // the app has always searched.
  { limit = 6, language, categories, minScore = 0.4, practice = null, department = null } = {},
) {
  // Search the patient's language AND English in one pool, ranked together.
  //
  // Restricting to a single language crippled non-English questions: the
  // corpus is mostly English (the clinic authors in English), so a Bengali
  // question could only ever see the handful of Bengali chunks and never the
  // thyroid, gout, kidney or PCOS material that would actually answer it.
  //
  // Mixing is safe because the reply language is set by the system prompt, not
  // by the language of the grounding — the model is told to answer only in the
  // patient's language whatever it reads.
  const searchLanguages = searchLanguagesFor(language);

  try {
    const queryVector = await embed(query, { taskType: 'RETRIEVAL_QUERY' });
    const results = env.USE_ATLAS_VECTOR_SEARCH
      ? await vectorSearchAtlas(queryVector, {
          limit,
          languages: searchLanguages,
          categories,
          practice,
          department,
        })
      : await vectorSearchInProcess(queryVector, {
          limit,
          languages: searchLanguages,
          categories,
          practice,
          department,
        });

    const scored = results.filter((r) => r.score >= minScore);
    if (scored.length > 0) return scored;

    // Nothing cleared the bar. Rather than answer ungrounded, offer the best
    // near-misses — a weakly-matched but relevant chunk is far more useful to
    // a patient than "I have no guidance on that", and the model is still
    // instructed to decline if the context does not actually cover the
    // question.
    return results.slice(0, Math.min(3, results.length));
  } catch (err) {
    logger.warn({ err: err?.message }, 'vector retrieval failed, falling back to text search');
    // Text scores are on a different scale, so minScore does not apply.
    return textSearch(query, { limit, language, practice, department });
  }
}

/** Renders retrieved chunks into the grounding block for the prompt. */
export function formatContext(chunks) {
  if (!chunks?.length) return null;
  return chunks
    .map((c, i) => {
      const cite = c.sourceCitation ? ` (source: ${c.sourceCitation})` : '';
      return `[${i + 1}] ${c.title}${c.section ? ` — ${c.section}` : ''}${cite}\n${c.content}`;
    })
    .join('\n\n---\n\n');
}
