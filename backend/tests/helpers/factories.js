import { User, ROLES } from '../../src/models/User.js';
import { Patient, RELATIONSHIP } from '../../src/models/Patient.js';
import { Practice, PRACTICE_STATUS, VERIFICATION } from '../../src/models/Practice.js';
import { Membership, MEMBERSHIP_STATUS, presetFor } from '../../src/models/Membership.js';
import { Enrollment, ENROLLMENT_STATUS } from '../../src/models/Enrollment.js';
import { signAccessToken } from '../../src/services/tokens.js';

/**
 * Two practices that have never heard of each other.
 *
 * Deliberately thin. A factory that quietly sets a sensible default is a
 * factory that can make a test pass for a reason the test does not state — and
 * every leak in this codebase was a default nobody had looked at. What a test
 * depends on, a test says.
 *
 * The one non-obvious thing encoded here is that a patient's `Patient._id` is
 * its `User._id`. That is how the migration wrote them, so the twenty-odd
 * collections pointing at a patient needed no data migration, and a fixture
 * that used two different ids would be testing a shape production does not have.
 */

let n = 0;

/** Unique and syntactically valid. Indexes are unique on phone. */
function nextPhone() {
  n += 1;
  return `+9199${String(Date.now()).slice(-6)}${String(n).padStart(2, '0')}`;
}

export async function makePractice(name, extra = {}) {
  return Practice.create({
    name,
    status: PRACTICE_STATUS.ACTIVE,
    verification: VERIFICATION.VERIFIED,
    ...extra,
  });
}

/**
 * Somebody who works at a practice, with a membership and a signed token.
 *
 * `permissions` defaults to the role preset — the same resolution the app does
 * — rather than to everything or nothing, because both of those are states a
 * real member is never in.
 */
export async function makeMember(
  practice,
  { name, role = ROLES.DOCTOR, isOwner = false, permissions = null, department = null } = {},
) {
  const user = await User.create({
    name,
    phone: nextPhone(),
    role,
    isActive: true,
  });

  const membership = await Membership.create({
    user: user._id,
    practice: practice._id,
    role,
    isOwner,
    permissions: permissions ?? presetFor({ role, isOwner }),
    status: MEMBERSHIP_STATUS.ACTIVE,
    ...(department ? { department } : {}),
  });

  return { user, membership, token: signAccessToken(user), name };
}

/**
 * A patient, enrolled at zero or more practices.
 *
 * Enrolled at none is a real state — somebody who has an account and has not
 * been taken on by anybody — and it is the one where a permissive guard is most
 * likely to hand them to whoever asks.
 */
export async function makePatient({ name, practices = [], primaryDoctor = null } = {}) {
  const user = await User.create({
    name,
    phone: nextPhone(),
    role: ROLES.PATIENT,
    isActive: true,
  });

  const patient = await Patient.create({
    _id: user._id,
    login: user._id,
    name,
    relationship: RELATIONSHIP.SELF,
  });

  const enrollments = [];
  for (const practice of practices) {
    enrollments.push(
      await Enrollment.create({
        patient: patient._id,
        practice: practice._id,
        status: ENROLLMENT_STATUS.ACTIVE,
        ...(primaryDoctor ? { primaryDoctor: primaryDoctor._id } : {}),
      }),
    );
  }

  return { user, patient, enrollments, token: signAccessToken(user), name };
}
