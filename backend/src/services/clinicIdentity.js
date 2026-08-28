import { Clinic } from '../models/Clinic.js';
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
 */

/** Cached briefly: this is read on every prescription and every AI turn. */
let cache = null;
let cachedAt = 0;
const TTL_MS = 60_000;

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
    ? await Clinic.findById(clinicId).lean()
    : await Clinic.findOne({ isActive: true }).sort({ sortIndex: 1, createdAt: 1 }).lean();

  const identity = {
    id: doc?._id ?? null,
    // `||`, not `??`: a clinic saved with an empty name should fall back to the
    // configured one rather than print a blank letterhead.
    clinicName: doc?.name || env.CLINIC_NAME,
    tagline: doc?.tagline || null,
    doctorName: doc?.doctorDisplayName || env.DOCTOR_DISPLAY_NAME,
    phone: doc?.phone || null,
    altPhone: doc?.altPhone || null,
    addressLine: doc?.addressLine || null,
    city: doc?.city || null,
    registrationNo: doc?.registrationNo || null,
    logoLightAssetId: doc?.logoLightAssetId ?? null,
    logoDarkAssetId: doc?.logoDarkAssetId ?? null,
    logoNeedsDarkChip: Boolean(doc?.logoNeedsDarkChip),
  };

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
