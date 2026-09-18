import { CARDIOLOGY_BN } from './translations/cardiology.bn.js';
import { CARDIOLOGY_HI } from './translations/cardiology.hi.js';
import { GENERAL_MEDICINE_BN } from './translations/generalMedicine.bn.js';
import { GENERAL_MEDICINE_HI } from './translations/generalMedicine.hi.js';

/**
 * The Bengali and Hindi versions of the AI-drafted passages, by department and
 * language, each keyed by the English passage's docId.
 *
 * ---- Why separate passages rather than a translated answer ---------------
 *
 * Retrieval already grounds a Bengali or Hindi conversation on English
 * passages and the model answers in the patient's language. That works, but it
 * means the words a Bengali patient reads were written by the model at the
 * moment of asking, from English nobody reviewed in Bengali. A passage in the
 * patient's own language is retrieved first and read by a clinician before it
 * is used, like every other draft.
 *
 * A department added later brings its translations here beside its drafts;
 * one with none is simply English-first, as diabetology mostly is.
 */
export const DRAFT_TRANSLATIONS = Object.freeze({
  cardiology: Object.freeze({ bn: CARDIOLOGY_BN, hi: CARDIOLOGY_HI }),
  general_physician: Object.freeze({ bn: GENERAL_MEDICINE_BN, hi: GENERAL_MEDICINE_HI }),
});

/** The languages a draft may be translated into. English is the original. */
export const TRANSLATED_LANGUAGES = Object.freeze(['bn', 'hi']);
