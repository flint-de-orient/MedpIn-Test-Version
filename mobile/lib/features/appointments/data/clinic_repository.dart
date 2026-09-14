import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/clinic.dart';

/// Talks to `/clinics`. Reads are open to any authenticated user; writes are
/// clinician-only (the server enforces the role, this just exposes them).
class ClinicRepository {
  ClinicRepository(this._client);

  final ApiClient _client;

  Future<List<Clinic>> list() async {
    final json = await _client.getJson('/clinics');
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(Clinic.fromJson)
        .toList();
  }

  Future<Clinic> get(String id) async {
    final json = await _client.getJson('/clinics/$id');
    return Clinic.fromJson(json['clinic'] as Map<String, dynamic>);
  }

  Future<SlotDay> slots(String clinicId, String date) async {
    final json = await _client.getJson(
      '/clinics/$clinicId/slots',
      query: {'date': date},
    );
    return SlotDay.fromJson(json);
  }

  Future<Clinic> create(Map<String, dynamic> body) async {
    final json = await _client.postJson('/clinics', body: body);
    return Clinic.fromJson(json['clinic'] as Map<String, dynamic>);
  }

  Future<Clinic> update(String id, Map<String, dynamic> body) async {
    final json = await _client.patchJson('/clinics/$id', body: body);
    return Clinic.fromJson(json['clinic'] as Map<String, dynamic>);
  }

  /// Soft-delete: the server marks it inactive so booked appointments keep a
  /// valid clinic.
  Future<void> deactivate(String id) async {
    await _client.delete('/clinics/$id');
  }
}

final Provider<ClinicRepository> clinicRepositoryProvider =
    Provider<ClinicRepository>((ref) {
      return ClinicRepository(ref.watch(apiClientProvider));
    });

// The number a patient rings is not worked out here any more. It was the first
// location on this list with a phone, or a placeholder compiled into the app —
// another practice's desk, or nobody. See shared/data/care_contact.dart.
