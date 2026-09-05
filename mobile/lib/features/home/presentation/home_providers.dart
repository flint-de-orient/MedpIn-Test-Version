import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../shared/providers/core_providers.dart';
import '../domain/care_summary.dart';
import '../../../shared/providers/active_patient.dart';

/// The patient's home screen, in one request. `/dashboard` already fans its
/// queries out in parallel server-side, so the screen arrives whole rather than
/// filling in section by section on a weak connection.
final careSummaryProvider = FutureProvider.autoDispose<CareSummary>((
  ref,
) async {
  // Whose record. `me` for the account holder, a patient id for somebody this
  // login looks after — watched, so switching in the household picker
  // re-fetches this and everything downstream of it.
  final patient = ref.watch(patientPathProvider);
  // Mounted at /patients/:patientId/dashboard, and `me` resolves to the signed-
  // in patient. A bare /dashboard is a 404 — which is what "could not load your
  // care summary" was.
  final json = await ref
      .read(apiClientProvider)
      .getJson('/patients/$patient/dashboard');
  return CareSummary.fromJson(json);
});
