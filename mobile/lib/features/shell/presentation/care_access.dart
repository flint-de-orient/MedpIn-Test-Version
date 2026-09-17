import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/providers/active_patient.dart';
import '../../../shared/providers/core_providers.dart';
import '../../auth/presentation/auth_controller.dart';

/// Whether the patient being looked at is somebody's patient.
///
/// ---- Why the app has to ask ------------------------------------------------
///
/// The patient app drew a Doctor tab and a Dietician tab for everybody, and put
/// a clinic's name and telephone number on the chat header, the emergency card
/// and Profile. The number came from `/auth/me/contact`, which falls back to
/// the practice of an assigned doctor — so a person who had never been
/// enrolled anywhere, or whose enrolment had ended, was shown a clinic they
/// have no relationship with, a conversation with its doctor, and a button to
/// ring its desk.
///
/// Enrolment is the fact that decides it. `GET /enrolments/mine` returns only
/// active, unrevoked enrolments, and that is what this reads. The assistant is
/// not a clinic and stays for everybody.
enum ClinicCare {
  /// Enrolled at one or more practices: the clinic's people, name and number
  /// belong on screen.
  enrolled,

  /// Enrolled nowhere. The neutral assistant only.
  notEnrolled,

  /// Not answered yet, and never answered on this phone before. Treated as
  /// [notEnrolled] by everything that shows a clinic — shown late rather than
  /// shown wrongly.
  unknown,
}

class PatientEnrolment {
  const PatientEnrolment({required this.id, required this.practiceId, this.enrolledOn});

  final String id;
  final String practiceId;
  final DateTime? enrolledOn;

  factory PatientEnrolment.fromJson(Map<String, dynamic> j) => PatientEnrolment(
    id: j['id']?.toString() ?? '',
    practiceId: j['practice']?.toString() ?? '',
    enrolledOn: DateTime.tryParse(j['enrolledOn']?.toString() ?? '')?.toLocal(),
  );
}

/// The active enrolments of the person being looked at — the account holder,
/// or the family member switched to.
///
/// Named by id rather than asked for "mine": without a patient id the server
/// answers for everybody on the login, and a child's enrolment would light up
/// the parent's Doctor tab.
final patientEnrolmentsProvider = FutureProvider<List<PatientEnrolment>>((
  ref,
) async {
  final user = ref.watch(authControllerProvider.select((s) => s.user));
  if (user == null || user.role != 'patient') return const [];
  final patientId = ref.watch(activePatientProvider) ?? user.id;

  final json = await ref
      .read(apiClientProvider)
      .getJson('/enrolments/mine', query: {'patientId': patientId});
  final items =
      (json['items'] as List? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(PatientEnrolment.fromJson)
          .toList();

  // Remembered, so the next cold start draws the right tabs at once instead of
  // drawing four and growing a fifth half a second later.
  try {
    await ref
        .read(sharedPreferencesProvider)
        .setBool(_cacheKey(patientId), items.isNotEmpty);
  } catch (_) {
    // A preference that cannot be written costs one redraw, nothing more.
  }
  return items;
});

/// The answer everything that shows a clinic reads.
///
/// Clinicians are not gated here: the question is about a patient's own care,
/// and a doctor's view of a thread is not a patient's.
final clinicCareProvider = Provider<ClinicCare>((ref) {
  final user = ref.watch(authControllerProvider.select((s) => s.user));
  if (user == null) return ClinicCare.unknown;
  if (user.role != 'patient') return ClinicCare.enrolled;

  // A refresh that fails keeps the last answer the server gave.
  final items = ref.watch(patientEnrolmentsProvider).valueOrNull;
  if (items != null) {
    return items.isEmpty ? ClinicCare.notEnrolled : ClinicCare.enrolled;
  }

  // Not answered yet: the last answer this phone saw for this person.
  final patientId = ref.watch(activePatientProvider) ?? user.id;
  bool? cached;
  try {
    cached = ref.read(sharedPreferencesProvider).getBool(_cacheKey(patientId));
  } catch (_) {
    cached = null;
  }
  if (cached == null) return ClinicCare.unknown;
  return cached ? ClinicCare.enrolled : ClinicCare.notEnrolled;
});

String _cacheKey(String patientId) => 'akd_clinic_care_$patientId';
