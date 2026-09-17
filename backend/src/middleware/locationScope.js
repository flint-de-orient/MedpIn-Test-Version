import { ROLES } from '../models/User.js';
import { AppError } from './errors.js';
import { membershipOf } from './authorise.js';
import { recordDenial } from './recordDenial.js';

/**
 * Which of a practice's locations somebody may run.
 *
 * ---- Practice, role, permission — and location ----------------------------
 *
 * practiceScope.js answers "which practice", and the permission set answers
 * "may they do this there". Neither answered "where". A receptionist hired for
 * the Salt Lake branch could edit Behala's opening hours, close Behala, cancel
 * Behala's appointments and check people into Behala's waiting room, because
 * the practice was the smallest thing access could be granted on.
 *
 * `Membership.locations` narrows that, and this file is the only place it is
 * read for a request.
 *
 * ---- Narrows, never widens -------------------------------------------------
 *
 * Every query these helpers take part in still carries the practice filter, and
 * that filter runs first: another practice's location is refused by it, in the
 * words used for a location that does not exist, before anything here is asked.
 * So a location list on a membership can only ever take places away.
 *
 * ---- Empty is every location ----------------------------------------------
 *
 * Every membership written before this existed has no list, and those people
 * run every location of their practice today. Empty keeps that; the owner is
 * never narrowed. See `Membership.locations`.
 *
 * ---- Fails closed ----------------------------------------------------------
 *
 * A member of staff with no current membership runs nothing, and a patient runs
 * nothing — a patient's places are the ones they are enrolled at, which
 * `patientClinics` answers, and that is a different question from this one. A
 * route that forgets which caller it has gets an empty answer, not the practice.
 */

/** The error code for work at a location the caller does not run. */
export const LOCATION_NOT_MANAGED = 'LOCATION_NOT_MANAGED';

const isPatient = (req) => req.user?.role === ROLES.PATIENT;
const idOf = (value) => String(value?._id ?? value);

export function locationNotManaged(message = 'You do not manage that location.') {
  return new AppError(403, LOCATION_NOT_MANAGED, message);
}


/**
 * The locations this caller runs: `null` for every location of their practice,
 * otherwise the ids, as strings. `[]` is nowhere.
 *
 * Cached on the request, like the practice it is read from.
 */
export async function managedLocationIds(req) {
  if (req._managedLocationIds !== undefined) return req._managedLocationIds;

  let ids = [];
  if (req.user && !isPatient(req)) {
    const membership = await membershipOf(req);
    ids = membership ? membership.locationScope() : [];
  }

  req._managedLocationIds = ids;
  return ids;
}

/** Whether the caller runs this location. The membership answers; see `worksAt`. */
export async function managesLocation(req, location) {
  if (!location || !req.user || isPatient(req)) return false;
  const membership = await membershipOf(req);
  return Boolean(membership?.worksAt(idOf(location)));
}

/**
 * Refuse work at a location the caller does not run.
 *
 * A 403 with its own code rather than a 404: the location is their own
 * practice's, it is on the list they can read, and "not found" would be a lie
 * that sends them looking for a typo.
 */
export async function assertManagesLocation(req, location) {
  if (await managesLocation(req, location)) return;
  recordDenial(req, { reason: 'location_not_managed', location: idOf(location) });
  throw locationNotManaged();
}

/**
 * Route guard for the acts that concern every location at once — opening a new
 * one, and deciding who runs which. Somebody narrowed to particular locations
 * does neither: each would reach past the places they were given.
 */
export async function requireEveryLocation(req, res, next) {
  try {
    if ((await managedLocationIds(req)) === null) return next();
    recordDenial(req, { reason: 'location_not_managed', location: 'all' });
    // Said as what it is. "You do not manage that location" about a location
    // that does not exist yet would send somebody looking for which one.
    return next(
      locationNotManaged(
        'You manage particular locations of this practice. This is for somebody who manages all of them.',
      ),
    );
  } catch (err) {
    return next(err);
  }
}

/**
 * A filter fragment keeping a list to the locations the caller runs.
 *
 * `{}` for somebody who runs all of them, which is almost everybody. Otherwise
 * rows at their locations — and, with `includeUnplaced`, rows at no location at
 * all: a teleconsult, a request not yet given a time, a solo doctor's
 * appointment at a practice with no locations. Those are the practice's, not any
 * building's, and narrowing a person to Salt Lake is not a reason to hide them.
 *
 * Returns an `$or`, so combine it with `$and` rather than spreading it into a
 * filter that may already have one.
 */
export async function managedLocationFilter(req, field = 'clinic', { includeUnplaced = true } = {}) {
  const ids = await managedLocationIds(req);
  if (ids === null) return {};
  const here = { [field]: { $in: ids } };
  return includeUnplaced ? { $or: [here, { [field]: null }] } : here;
}
