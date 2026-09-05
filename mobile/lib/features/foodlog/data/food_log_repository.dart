import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/food_log.dart';
import '../../../shared/providers/active_patient.dart';

/// Talks to `/patients/me/food-log` — the patient's own meal log.
class FoodLogRepository {
  FoodLogRepository(this._client, this._patient);

  final ApiClient _client;
  /// `me`, or the id of somebody this login looks after. Held rather than read
  /// per call so the provider rebuilds when the active patient changes, and
  /// everything watching it re-fetches without being told to.
  final String _patient;

  String get _base => '/patients/$_patient/food-log';

  Future<List<FoodLogEntry>> list() async {
    final json = await _client.getJson(_base);
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(FoodLogEntry.fromJson)
        .toList();
  }

  /// Removes a meal the patient logged by mistake. Hard delete: a photo of the
  /// wrong plate is an error, not history, and the dietician should not be
  /// planning around a meal that never happened.
  Future<void> delete(String id) async {
    await _client.delete('$_base/$id');
  }

  Future<void> create({
    required String mealType,
    String note = '',
    String? photo,
  }) async {
    await _client.postJson(
      _base,
      body: {
        'mealType': mealType,
        if (note.isNotEmpty) 'note': note,
        if (photo != null) 'photo': photo,
      },
    );
  }
}

final foodLogRepositoryProvider = Provider<FoodLogRepository>((ref) {
  return FoodLogRepository(ref.watch(apiClientProvider), ref.watch(patientPathProvider));
});
