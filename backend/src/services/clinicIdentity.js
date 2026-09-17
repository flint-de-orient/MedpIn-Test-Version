import { Clinic } from '../models/Clinic.js';
// Registered for `populate('practice')` below, and read directly for a practice
// that has no location yet.
import { Practice } from '../models/Practice.js';
import { callablePhone } from './clinicContact.js';

/**
 * Who the clinic says it is — one answer, read from the database.
 *
 * The clinic's name and the doctor's printed name were `CLINIC_NAME` and
 * `DOCTOR_DISPLAY_NAME` in the environment, read directly by the AI prompts,
 * the prescription PDF, the lab reader and the vision service. One process can
 * hold one value, so every practice on the platform was introduced as the
 * founding clinic and its doctor, and those two variables defaulted to
 * Dr. Amit Kumar Dey's name for anybody who had not set them.
 *
 * ---- Practice → Location → Head Doctor ----------------------------------
 *
 * An identity starts from the practice, because the practice is the tenant: a
 * location belongs to one, and a doctor is somebody's only through one.
 *
 *   the name        the practice's, then the location's — "Meridian Heart
 *                   Centre", not "Park Street"; a branch is where the practice
 *                   is, not who it is
 *   the doctor      the practice's printed name, then the location's, then the
 *                   head doctor's own account name
 *   tagline, logo,  the location's where it has set its own, then the
 *   registration    practice's — the branch override the practice screen
 *                   describes (`overridesBrand`)
 *   address, phone  the location's alone; a branch with no phone has no phone,
 *                   and inheriting head office's sends patients to the wrong
 *                   building
 *
 * ---- No practice is nobody --------------------------------------------------
 *
 * With no practice there is no identity to borrow: every field is null and
 * `neutral` is true. Callers say "your doctor" and "your clinic" rather than a
 * name, and print no letterhead name rather than somebody else's. There is no
 * environment fallback and no "first clinic on the platform" — both were how a
 * second practice's patients met the founding clinic's doctor.
 */

/**
 * Cached briefly: this is read on every prescription and every AI turn.
 *
 * Per location and per practice. It was one slot, which made it one answer for
 * the whole platform — and the answer it held was whichever practice owned the
 * first clinic.
 */
const cache = new Map();
const TTL_MS = 60_000;

/**
 * The identity of nobody in particular.
 *
 * Frozen and complete, so a caller can read any field off it and get null
 * rather than undefined — undefined is what used to fall through to an env var.
 */
export const NEUTRAL_IDENTITY = Object.freeze({
  id: null,
  practiceId: null,
  neutral: true,
  clinicName: null,
  locationName: null,
  tagline: null,
  doctorName: null,
  phone: null,
  altPhone: null,
  addressLine: null,
  city: null,
  specialty: null,
  registrationNo: null,
  logoLightAssetId: null,
  logoDarkAssetId: null,
  logoNeedsDarkChip: false,
  emergencyPhone: null,
});

/** A populated ref, or null. An unpopulated one is an id, and has no `.name`. */
function populated(ref) {
  return ref && typeof ref === 'object' && ref.name !== undefined ? ref : null;
}

/**
 * Fold a location and its practice into one identity.
 *
 * Pure, and exported for that reason: the order is the part of this file most
 * likely to be got wrong in a hurry, and a test for it should not need a
 * database.
 *
 * `doc` is a lean Clinic with `practice` (and the practice's `headDoctor`)
 * populated, a bare `{ practice }` for a practice with no location yet, or null.
 * A location whose practice did not populate supplies its own fields and never
 * borrows a brand from anywhere else.
 */
export function resolveIdentity(doc) {
  if (!doc) return { ...NEUTRAL_IDENTITY };

  const practice = populated(doc.practice);
  const head = populated(practice?.headDoctor);
  const location = doc.name !== undefined || doc._id ? doc : null;

  // `||` throughout, not `??`: a field saved as an empty string falls through to
  // the next source rather than printing a blank line.
  const identity = {
    id: location?._id ?? null,
    practiceId: practice?._id ?? (practice ? null : doc.practice ?? null),
    clinicName: practice?.name || location?.name || null,
    locationName: location?.name || null,
    tagline: location?.tagline || practice?.tagline || null,
    doctorName:
      practice?.doctorDisplayName || location?.doctorDisplayName || head?.name || null,
    phone: location?.phone || null,
    altPhone: location?.altPhone || null,
    addressLine: location?.addressLine || null,
    city: location?.city || null,
    /// What this practice treats. Null on every practice created before the
    /// field, and null is a real answer — nothing may fill it with a guess.
    specialty: practice?.specialty || null,
    registrationNo: location?.registrationNo || practice?.registrationNo || null,
    logoLightAssetId: location?.logoLightAssetId ?? practice?.logoLightAssetId ?? null,
    logoDarkAssetId: location?.logoDarkAssetId ?? practice?.logoDarkAssetId ?? null,
    // Reads from whichever row supplied the artwork. Taking the flag from the
    // practice while the logo came from the location would put a dark chip
    // behind a mark drawn for a white background.
    logoNeedsDarkChip: location?.logoLightAssetId
      ? Boolean(location.logoNeedsDarkChip)
      : Boolean(practice?.logoNeedsDarkChip ?? location?.logoNeedsDarkChip),
  };

  return { ...identity, neutral: !practice && !identity.clinicName };
}

/** The practice, populated the way resolveIdentity reads it. */
const WITH_PRACTICE = { path: 'practice', populate: { path: 'headDoctor', select: 'name' } };

/**
 * Who a patient's clinic is, and the number they are told to ring.
 *
 * ---- Whose ----------------------------------------------------------------
 *
 * A location by id when the caller has one. Otherwise the practice's own first
 * active location, or — for a practice that has not added one yet — the
 * practice itself. With neither, nobody: the neutral identity.
 *
 * That last answer used to be the platform's first active location, and every
 * caller that did not say whose patient this was took it — the assistant, the
 * nutrition assistant, the foot and eye readers, lab extraction and the
 * prescription letterhead all introduced a second practice's patients to the
 * first practice's doctor.
 */
export async function clinicIdentity(clinicId = null, { practiceId = null } = {}) {
  if (!clinicId && !practiceId) return { ...NEUTRAL_IDENTITY };

  const key = clinicId ? `clinic:${clinicId}` : `practice:${practiceId}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.identity;

  let doc;
  if (clinicId) {
    doc = await Clinic.findById(clinicId).populate(WITH_PRACTICE).lean();
  } else {
    doc =
      (await Clinic.findOne({ practice: practiceId, isActive: true })
        .sort({ sortIndex: 1, createdAt: 1 })
        .populate(WITH_PRACTICE)
        .lean()) ?? (await practiceWithoutLocation(practiceId));
  }

  const identity = {
    ...resolveIdentity(doc),
    emergencyPhone: await emergencyPhoneFor(doc, { clinicId, practiceId }),
  };

  cache.set(key, { identity, at: Date.now() });
  return identity;
}

/** A practice with no location yet still has a name, and it is not somebody else's. */
async function practiceWithoutLocation(practiceId) {
  const practice = await Practice.findById(practiceId).populate('headDoctor', 'name').lean();
  return practice ? { practice } : null;
}

/**
 * The number this patient is told to ring, or null.
 *
 * ---- One rule, for every practice ------------------------------------------
 *
 *   1. the practice's own `emergencyPhone`;
 *   2. the location the caller named, when it named one;
 *   3. otherwise the practice's only active location — only, never first;
 *   4. otherwise none.
 *
 * `CLINIC_EMERGENCY_PHONE` is in none of those. It was the answer for the
 * founding practice and for any caller that did not say whose patient this is,
 * which made the founding clinic's switchboard the default for anybody the
 * code could not place. It is nobody's practice's number now — the backfill
 * script copies it onto the practice it belongs to, once, on purpose.
 *
 * No number drops the "or call ..." clause, and the app draws no call button:
 * "go to the nearest hospital" on its own is correct advice, and a number that
 * rings nowhere, or rings a stranger, is worse than none.
 */
async function emergencyPhoneFor(doc, { clinicId, practiceId }) {
  const practice = populated(doc?.practice);

  const own = callablePhone(practice?.emergencyPhone);
  if (own) return own;

  if (clinicId) return callablePhone(doc?.phone);

  if (practiceId) {
    // Two answers is no answer. A practice with two branches and no number of
    // its own has not said which desk its patients should ring, and the one
    // that sorts first is not a decision anybody made.
    const locations = await Clinic.find({ practice: practiceId, isActive: true })
      .select('phone')
      .limit(2)
      .lean();
    return locations.length === 1 ? callablePhone(locations[0].phone) : null;
  }

  return null;
}

/**
 * Drop the cache after an edit, so the settings screen shows its own change
 * rather than up to a minute of the previous name.
 */
export function forgetClinicIdentity() {
  cache.clear();
}

/**
 * The identity to stamp onto a document being issued now.
 *
 * A prescription is a record of what was printed on a particular day. If it
 * rendered the clinic's *current* name and logo every time it was opened, then
 * editing the clinic profile would silently re-letterhead every prescription
 * ever issued — rewriting history from a settings screen. So the identity is
 * copied onto the prescription at issue and read back from there afterwards.
 */
export async function identitySnapshot(clinicId = null, { practiceId = null } = {}) {
  const id = await clinicIdentity(clinicId, { practiceId });
  return {
    clinicName: id.clinicName,
    tagline: id.tagline,
    doctorName: id.doctorName,
    phone: id.phone,
    altPhone: id.altPhone,
    addressLine: id.addressLine,
    city: id.city,
    registrationNo: id.registrationNo,
    logoAssetId: id.logoLightAssetId,
    emergencyPhone: id.emergencyPhone,
  };
}

/**
 * The words a patient-facing sentence uses when there is no name to use.
 *
 * Per language, because "your doctor" dropped into a Bengali sentence is an
 * English phrase in the middle of it. Used by the assistant's prompts and its
 * outage replies; the app has its own copy in its localisations.
 */
export const NEUTRAL_WORDS = Object.freeze({
  doctor: Object.freeze({ en: 'your doctor', bn: 'আপনার চিকিৎসক', hi: 'अपने डॉक्टर' }),
  clinic: Object.freeze({ en: 'your clinic', bn: 'আপনার ক্লিনিক', hi: 'आपका क्लिनिक' }),
});

/** The doctor's name for a sentence, or the neutral words in that language. */
export function doctorNameOr(identity, language = 'en') {
  return identity?.doctorName || NEUTRAL_WORDS.doctor[language] || NEUTRAL_WORDS.doctor.en;
}

/** The clinic's name for a sentence, or the neutral words in that language. */
export function clinicNameOr(identity, language = 'en') {
  return identity?.clinicName || NEUTRAL_WORDS.clinic[language] || NEUTRAL_WORDS.clinic.en;
}
