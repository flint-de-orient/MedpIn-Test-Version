import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../features/auth/presentation/auth_controller.dart';

/// Which branch of the app a signed-in person lives in.
///
/// ---- Why this is a table and not a chain of ifs -------------------------
///
/// It was `role == 'staff' ? '/staff' : '/clinician'`, and the router beside it
/// asked `isDoctor`, then `isStaff`, then `isDietician`, and then fell through
/// to the patient app. Three roles named, everything else silently treated as a
/// patient — so a lab technician signing in would have landed on the patient's
/// Assistant tab. Not refused, not warned: in the wrong application.
///
/// That is the same shape as the two other silent defaults the roles work
/// found — a permission preset falling through to the front desk's, and an
/// empty capability exclusion list. All three were "the code ran out of cases",
/// and all three looked like a decision somebody had made.
///
/// So every role is named here, and a role that is not named resolves to null
/// rather than to somebody else's area. `roles.test.js` fails if the server
/// defines one this file has not heard of.
///
/// ---- Why most of them land in /clinician --------------------------------
///
/// That area is not the doctor's panel any more; it is the practice's. It
/// holds the dashboard — which is now composed per person from their role,
/// department, permissions and plan — along with Team, Departments, Export and
/// Billing, which is what a lab manager or a practice manager actually needs.
///
/// The reason staff were moved out of it still stands and is a *screen*
/// problem, not an area one: the More screen showed the doctor's letterhead,
/// professional details and signature to whoever opened it. Those rows are
/// gated on the doctor's own role, where the gate belongs.
///
/// The front desk keeps `/staff` because its work genuinely is a different
/// application — a day sheet and a registration queue, not a caseload.
const Map<String, String> areaForRole = {
  'doctor': '/clinician',
  'staff': '/staff',
  'dietician': '/dietician',

  /// Works the record beside a doctor, so they need the clinical screens.
  /// What they may do in them is decided by their grant, not by the area.
  'doctor_assistant': '/clinician',

  /// The bench. Their dashboard is the laboratory's wherever they are
  /// posted — see ROLE_DEFAULTS in services/uiConfig.js.
  'lab_manager': '/clinician',
  'lab_technician': '/clinician',

  /// Rosters, departments and billing, and no clinical record at all. Their
  /// preset withholds VIEW_PATIENT, so the patient screens in this area
  /// refuse them at the server rather than merely hiding.
  'practice_manager': '/clinician',
};

/// Where this person's home tab lives, per area.
///
/// Beside the table above rather than in the router, so that adding a role
/// cannot land somebody in an area whose entry screen nobody chose.
const Map<String, String> homeForArea = {
  '/clinician': '/clinician/dashboard',
  '/staff': '/staff/today',
  '/dietician': '/dietician/dashboard',
};

/// The area prefix for the signed-in person, or `/clinician` if they have no
/// role at all.
///
/// The fallback is for shared screens asking "where do my links go", not for
/// deciding access — an account with no role does not reach these screens,
/// because the router has already sent it to the patient app.
///
/// Those screens used to push `/clinician/...` outright. For the doctor that
/// was correct and for staff it was a dead end: tapping a patient, or the
/// register button, or finishing a registration, all redirected straight back
/// to Today, and nothing said why. The screen looked broken because half its
/// destinations were in an area its own user is not allowed into.
String areaPrefix(WidgetRef ref) =>
    areaForRole[ref.read(authControllerProvider).user?.role ?? ''] ??
    '/clinician';

/// What to call this person on their own profile.
///
/// The More screen said "Doctor" or "Clinic staff", which was true while there
/// were two kinds of clinician and tells a lab technician the wrong thing
/// about themselves now. Kept beside the area table so a new role cannot get
/// one and not the other.
const Map<String, String> roleLabels = {
  'doctor': 'Doctor',
  'staff': 'Clinic staff',
  'dietician': 'Dietician',
  'doctor_assistant': 'Doctor’s assistant',
  'lab_manager': 'Laboratory manager',
  'lab_technician': 'Laboratory technician',
  'practice_manager': 'Practice manager',
};
