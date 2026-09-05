import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/patient_prescription.dart';
import '../../../shared/providers/active_patient.dart';

/// Talks to `/patients/me/prescriptions` — the patient's own issued
/// prescriptions and their PDFs.
class PrescriptionsRepository {
  PrescriptionsRepository(this._client, this._patient);

  final ApiClient _client;

  /// `me`, or the id of somebody this login looks after. Held rather than read
  /// per call so the provider rebuilds when the active patient changes, and
  /// everything watching it re-fetches without being told to.
  final String _patient;

  String get _base => '/patients/$_patient/prescriptions';

  Future<List<PatientPrescription>> list() async {
    final json = await _client.getJson(_base, query: {'limit': 50});
    final items = json['items'] as List<dynamic>? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(PatientPrescription.fromJson)
        .toList();
  }

  /// The prescription PDF bytes. [pdfUrl] is the server path from the
  /// prescription (already `/api/v1/...`), so it is joined to the origin, not
  /// the API base.
  Future<List<int>> pdfBytes(String pdfUrl) async {
    return _client.getBytes('${AppConfig.apiOrigin}$pdfUrl');
  }
}

final Provider<PrescriptionsRepository> prescriptionsRepositoryProvider =
    Provider<PrescriptionsRepository>(
      (ref) => PrescriptionsRepository(ref.watch(apiClientProvider), ref.watch(patientPathProvider)),
    );

/// The patient's prescriptions, newest first.
final patientPrescriptionsProvider =
    FutureProvider.autoDispose<List<PatientPrescription>>(
      (ref) => ref.watch(prescriptionsRepositoryProvider).list(),
    );
