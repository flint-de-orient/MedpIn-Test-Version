import { Enrollment, ENROLLMENT_STATUS } from '../models/Enrollment.js';
import { PatientProfile } from '../models/PatientProfile.js';
import { memberIdsOf } from '../middleware/practiceScope.js';
import { activeDieticianIds } from './dieticianAssignment.js';

/**
 * Who at a practice answers for each of these patients.
 *
 * The patient's assigned doctor, the doctor the practice enrolled them under,
 * and the dietician this practice assigned them — each only while they are a
 * current member of this practice. A doctor who has left answers for nobody
 * here, and an assignment made at another practice decides nothing at this
 * one: the dietician is read off this practice's enrolment, and must still be
 * an active dietician here.
 *
 * ---- An empty set is a real answer ------------------------------------------
 *
 * It is a patient nobody at the practice has taken on. Callers treat that
 * patient as everybody's: "my patients" narrows what somebody sees, and it must
 * never be the reason a patient nobody has taken on reaches nobody.
 *
 * @returns {Promise<Map<string, Set<string>>>} patient id → responsible user ids
 */
export async function responsibleFor({ practiceId, patientIds }) {
  const wanted = [...new Set((patientIds ?? []).map(String))];
  const out = new Map(wanted.map((id) => [id, new Set()]));
  if (!practiceId || !wanted.length) return out;

  const [memberIds, dieticianIds, profiles, enrolments] = await Promise.all([
    memberIdsOf(practiceId),
    activeDieticianIds(practiceId),
    PatientProfile.find({ user: { $in: wanted } }).select('user assignedDoctor').lean(),
    Enrollment.find({
      practice: practiceId,
      patient: { $in: wanted },
      status: ENROLLMENT_STATUS.ACTIVE,
      revokedAt: null,
    })
      .select('patient primaryDoctor dietician')
      .lean(),
  ]);
  const members = new Set((memberIds ?? []).map(String));
  const dieticians = new Set(dieticianIds.map(String));

  const add = (patient, person, allowed = members) => {
    if (person && allowed.has(String(person))) out.get(String(patient))?.add(String(person));
  };
  for (const p of profiles) add(p.user, p.assignedDoctor);
  for (const e of enrolments) {
    add(e.patient, e.primaryDoctor);
    add(e.patient, e.dietician, dieticians);
  }

  return out;
}

/** The patients, of those given, that this person answers for — or nobody does. */
export function answeredBy(responsible, userId) {
  const me = String(userId);
  return [...responsible.entries()]
    .filter(([, people]) => !people.size || people.has(me))
    .map(([patient]) => patient);
}
