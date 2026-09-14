import { Clinic } from '../models/Clinic.js';
// Registered for `populate('practice')` below, and read directly for a practice
// that has no location yet.
import { Practice } from '../models/Practice.js';
import { env } from '../config/env.js';
import { callablePhone, clinicEmergencyPhone } from './clinicContact.js';

/**
 * Who the clinic says it is — one answer, read from the database.
 *
 * The clinic's name and the doctor's printed name were `CLINIC_NAME` and
 * `DOCTOR_DISPLAY_NAME` in the environment, read directly by the AI prompts,
 * the prescription PDF, the lab reader and the vision service. Two consequences
 * followed from that, and both are why this exists.
 *
 * Renaming the clinic took a redeploy, so "let the staff edit it" was not
 * possible however good the settings screen was. And one process can hold one
 * value, so a second clinic could never have a different name — the multi-
 * department plan was blocked by an env var.
 *
 * The env vars survive as the seed for a clinic that has not filled its profile
 * in yet, which keeps an existing deployment working unchanged on the day this
 * ships.
 *
 * ---- Three places a value can come from ---------------------------------
 *
 * Location, then practice, then the environment. First non-empty wins.
 *
 * The order is the load-bearing part. The settings screen the clinic uses today
 * writes to the Clinic row; if the practice won, saving that screen would look
 * like it had done nothing. And it is the right semantics besides — the
 * practice brand is the default every branch inherits, and a branch with its
 * own phone number overrides it.
 *
 * A clinic with no practice resolves exactly as it did before this existed,
 * which is what makes the backfill safe to run and safe to half-run.
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
 * Fold a location, its practice and the environment into one identity.
 *
 * Pure, and exported for that reason: the fallback order is the part of this
 * file most likely to be got wrong in a hurry, and a test for it should not
 * need a database.
 *
 * `doc` is a lean Clinic with `practice` populated, or not populated, or
 * absent entirely. All three are ordinary.
 */
export function resolveIdentity(doc, fallbacks = {}) {
  // Only when it was populated. An unpopulated ref is an ObjectId, and reading
  // `.name` off one gives undefined — which would silently fall through to the
  // env var and print the wrong clinic's name on a prescription.
  const practice = doc?.practice && typeof doc.practice === 'object' && doc.practice.name !== undefined
    ? doc.practice
    : null;

  // `||` throughout, not `??`: a field saved as an empty string should fall
  // through to the next source rather than print a blank letterhead.
  return {
    id: doc?._id ?? null,
    practiceId: practice?._id ?? doc?.practice ?? null,
    clinicName: doc?.name || practice?.name || fallbacks.CLINIC_NAME,
    tagline: doc?.tagline || practice?.tagline || null,
    doctorName:
      doc?.doctorDisplayName || practice?.doctorDisplayName || fallbacks.DOCTOR_DISPLAY_NAME,
    // Address and phone belong to the place and have no practice-level answer.
    // A branch that has not filled its phone in has no phone, and inheriting
    // head office's would send patients to the wrong building.
    phone: doc?.phone || null,
    altPhone: doc?.altPhone || null,
    addressLine: doc?.addressLine || null,
    city: doc?.city || null,
    /// What this practice treats. Null on every practice created before the
    /// field, and null is a real answer — nothing may fill it with a guess.
    specialty: practice?.specialty || null,
    registrationNo: doc?.registrationNo || practice?.registrationNo || null,
    logoLightAssetId: doc?.logoLightAssetId ?? practice?.logoLightAssetId ?? null,
    logoDarkAssetId: doc?.logoDarkAssetId ?? practice?.logoDarkAssetId ?? null,
    // Reads from whichever row supplied the artwork. Taking the flag from the
    // practice while the logo came from the location would put a dark chip
    // behind a mark drawn for a white background.
    logoNeedsDarkChip: doc?.logoLightAssetId
      ? Boolean(doc.logoNeedsDarkChip)
      : Boolean(practice?.logoNeedsDarkChip ?? doc?.logoNeedsDarkChip),
  };
}

/**
 * Who a patient's clinic is, and the number they are told to ring.
 *
 * ---- Whose ----------------------------------------------------------------
 *
 * A location by id when the caller has one. Otherwise the practice's own first
 * active location, or — for a practice that has not added one yet — the
 * practice itself. With neither, the platform's first active location, which
 * is every case in a deployment that does not know its practices yet.
 *
 * That last fallback used to be the only answer, and every caller took it: the
 * assistant, the nutrition assistant, the foot and eye readers, lab extraction
 * and the prescription letterhead all introduced a second practice's patients
 * to the first practice's doctor. Callers that know the practice now say so.
 */
export async function clinicIdentity(clinicId = null, { practiceId = null } = {}) {
  const key = clinicId ? `clinic:${clinicId}` : practiceId ? `practice:${practiceId}` : 'primary';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.identity;

  let doc;
  if (clinicId) {
    doc = await Clinic.findById(clinicId).populate('practice').lean();
  } else if (practiceId) {
    doc =
      (await Clinic.findOne({ practice: practiceId, isActive: true })
        .sort({ sortIndex: 1, createdAt: 1 })
        .populate('practice')
        .lean()) ?? (await practiceWithoutLocation(practiceId));
  } else {
    doc = await Clinic.findOne({ isActive: true })
      .sort({ sortIndex: 1, createdAt: 1 })
      .populate('practice')
      .lean();
  }

  const identity = {
    ...resolveIdentity(doc, env),
    emergencyPhone: emergencyPhoneFor(doc, { known: Boolean(clinicId || practiceId) }),
  };

  cache.set(key, { identity, at: Date.now() });
  return identity;
}

/** A practice with no location yet still has a name, and it is not somebody else's. */
async function practiceWithoutLocation(practiceId) {
  const practice = await Practice.findById(practiceId).lean();
  return practice ? { practice } : null;
}

/**
 * The number this patient is told to ring in an emergency, or null.
 *
 * `CLINIC_EMERGENCY_PHONE` is one value for the process, and it is the founding
 * clinic's. It stays the answer for the founding practice, for a location that
 * predates practices, and for any caller that did not say whose patient this
 * is — which is exactly what it answered before.
 *
 * Any other practice gets its own location's number if somebody could ring it,
 * or none. Never the configured one: that is a stranger's switchboard, given to
 * somebody with chest pain. No number drops the "or call ..." clause, and "go
 * to the nearest hospital" on its own is still the correct advice.
 */
function emergencyPhoneFor(doc, { known }) {
  if (!known) return clinicEmergencyPhone();
  const practice =
    doc?.practice && typeof doc.practice === 'object' && doc.practice.name !== undefined
      ? doc.practice
      : null;
  if (!practice) return clinicEmergencyPhone();
  if (practice.isFounding) return clinicEmergencyPhone() ?? callablePhone(doc?.phone);
  return callablePhone(doc?.phone);
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
