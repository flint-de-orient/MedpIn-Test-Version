import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/models/paged.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/glucose_reading.dart';
import '../domain/glucose_trends.dart';
import '../../../shared/providers/active_patient.dart';

/// Talks to `/patients/me/glucose*` (API_CONTRACT.md §3).
class GlucoseRepository {
  GlucoseRepository(this._client, this._patient);

  final ApiClient _client;

  /// `me`, or the id of somebody this login looks after. Held rather than read
  /// per call so the provider below rebuilds when the active patient changes,
  /// and everything watching it re-fetches without being told to.
  final String _patient;

  String get _base => '/patients/$_patient/glucose';

  Future<LogGlucoseResult> logReading({
    required num valueMgDl,
    required String context,
    required DateTime measuredAt,
    String? notes,
    String source = 'manual',
  }) async {
    final json = await _client.postJson(
      _base,
      body: {
        'valueMgDl': valueMgDl,
        'context': context,
        'measuredAt': measuredAt.toUtc().toIso8601String(),
        'notes': notes ?? '',
        'source': source,
      },
    );
    return LogGlucoseResult.fromJson(json);
  }

  Future<Paged<GlucoseReading>> getReadings({
    DateTime? from,
    DateTime? to,
    int page = 1,
    int limit = 50,
  }) async {
    final json = await _client.getJson(
      _base,
      query: {
        if (from != null) 'from': from.toUtc().toIso8601String(),
        if (to != null) 'to': to.toUtc().toIso8601String(),
        'page': page,
        'limit': limit,
      },
    );
    return Paged.fromJson(json, GlucoseReading.fromJson);
  }

  Future<void> deleteReading(String id) async {
    await _client.delete('$_base/$id');
  }

  Future<GlucoseTrends> getTrends({int days = 30}) async {
    final json = await _client.getJson('$_base/trends', query: {'days': days});
    return GlucoseTrends.fromJson(json);
  }
}

final Provider<GlucoseRepository> glucoseRepositoryProvider =
    Provider<GlucoseRepository>((ref) {
      return GlucoseRepository(ref.watch(apiClientProvider), ref.watch(patientPathProvider));
    });
