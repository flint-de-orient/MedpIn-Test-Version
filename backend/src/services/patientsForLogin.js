import { Patient, RELATIONSHIP } from '../models/Patient.js';
import { User } from '../models/User.js';

/**
 * Who a login looks after.
 *
 * ---- Always a list, never a count ---------------------------------------
 *
 * The specification is explicit: never branch on count in the data layer.
 * Always fetch the list — of practices, of patients, of conditions — because it
 * may have one item and only the screen should care that it does.
 *
 * That rule is why this returns an array even for the overwhelmingly common
 * case of one person on one phone. A service that returned a single patient
 * "for simplicity" would have to be rewritten by every caller the first time a
 * grandmother is added, and one of those callers would be missed.
 *
 * ---- Falls back to the login itself -------------------------------------
 *
 * A login with no patient rows is one the migration has not reached. It gets a
 * synthetic self-patient built from the account, carrying the login's own id —
 * which is exactly what the backfill would have written. So the answer is right
 * before the migration, during it, and after, and no screen has to know which.
 */

/**
 * Every active patient this login is responsible for, the holder first.
 *
 * @returns {Promise<Array<{id:string,name:string,relationship:string,isSelf:boolean}>>}
 */
export async function patientsForLogin(loginId) {
  const rows = await Patient.find({ login: loginId, isActive: true })
    .sort({ createdAt: 1 })
    .lean();

  if (rows.length) {
    return rows
      .map((p) => ({
        id: String(p._id),
        name: p.name,
        dateOfBirth: p.dateOfBirth ?? null,
        gender: p.gender ?? 'undisclosed',
        relationship: p.relationship,
        // The account holder sorts first: it is who the phone belongs to, and
        // the person opening the app is usually themselves.
        isSelf: p.relationship === RELATIONSHIP.SELF,
      }))
      .sort((a, b) => Number(b.isSelf) - Number(a.isSelf));
  }

  return fallback(loginId);
}

/**
 * The pre-migration answer: the account is the patient.
 *
 * Carries the login's own id, because that is the id every clinical row for
 * this person already holds — and the id the backfill will give them.
 */
async function fallback(loginId) {
  const u = await User.findById(loginId).select('name dateOfBirth gender').lean();
  if (!u) return [];

  return [
    {
      id: String(loginId),
      name: u.name,
      dateOfBirth: u.dateOfBirth ?? null,
      gender: u.gender ?? 'undisclosed',
      relationship: RELATIONSHIP.SELF,
      isSelf: true,
    },
  ];
}

/**
 * Whether this login may act for this patient.
 *
 * The check behind every "switch to Aarav" request. Permissive in exactly one
 * direction: a login always may act for itself, because that is true before the
 * migration and stays true after.
 */
export async function loginMayAccess(loginId, patientId) {
  if (String(loginId) === String(patientId)) return true;

  const row = await Patient.findOne({ _id: patientId, login: loginId, isActive: true })
    .select('_id')
    .lean();
  return Boolean(row);
}
