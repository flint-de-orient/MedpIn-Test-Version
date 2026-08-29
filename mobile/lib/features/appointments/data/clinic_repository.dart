import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/config/app_config.dart';
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

/// The clinic's public phone number that every "Call clinic" action dials,
/// sourced from the clinic the doctor manages (Profile → Clinics & hours).
///
/// Falls back to [AppConfig.clinicPhoneNumber] while the list loads, on any
/// error, or until a clinic actually has a number — so the emergency "Call
/// clinic" button is never left without something to dial. Invalidate it after
/// editing a clinic so the new number takes effect immediately.
final FutureProvider<String> clinicPhoneProvider = FutureProvider<String>((
  ref,
) async {
  try {
    final clinics = await ref.watch(clinicRepositoryProvider).list();
    for (final c in clinics) {
      final phone = c.phone?.trim() ?? '';
      if (c.isActive && phone.isNotEmpty) return phone;
    }
  } catch (_) {
    // Network or parse failure: fall through to the built-in number.
  }
  return AppConfig.clinicPhoneNumber;
});
