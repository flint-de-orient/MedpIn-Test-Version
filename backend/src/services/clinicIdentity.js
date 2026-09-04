import { Clinic } from '../models/Clinic.js';
// Imported for the side effect only: populating `practice` below needs the
// model registered with mongoose, and nothing else on this path imports it.
import '../models/Practice.js';
import { env } from '../config/env.js';

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

/** Cached briefly: this is read on every prescription and every AI turn. */
let cache = null;
let cachedAt = 0;
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
 * The active clinic's identity, falling back to the environment.
 *
 * Takes an optional clinic id so a prescription issued at one location prints
 * that location. With none, the primary clinic is used — which is every case
 * until there is a second one.
 */
export async function clinicIdentity(clinicId = null) {
  if (!clinicId && cache && Date.now() - cachedAt < TTL_MS) return cache;

  const doc = clinicId
    ? await Clinic.findById(clinicId).populate('practice').lean()
    : await Clinic.findOne({ isActive: true })
        .sort({ sortIndex: 1, createdAt: 1 })
        .populate('practice')
        .lean();

  const identity = resolveIdentity(doc, env);

  if (!clinicId) {
    cache = identity;
    cachedAt = Date.now();
  }
  return identity;
}

/**
 * Drop the cache after an edit, so the settings screen shows its own change
 * rather than up to a minute of the previous name.
 */
export function forgetClinicIdentity() {
  cache = null;
  cachedAt = 0;
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
export async function identitySnapshot(clinicId = null) {
  const id = await clinicIdentity(clinicId);
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
  };
}
