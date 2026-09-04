import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../domain/practice.dart';

/// Talks to `/practices`. The server enforces doctor-only on the write.
class PracticeRepository {
  PracticeRepository(this._client);

  final ApiClient _client;

  /// The caller's practice with its readiness, locations and head count.
  ///
  /// Returns null when the deployment has not been backfilled yet — an ordinary
  /// state with its own answer on screen, not an error.
  Future<PracticeOverview?> mine() async {
    final json = await _client.getJson('/practices/mine');
    if (json['practice'] == null) return null;
    return PracticeOverview.fromJson(json);
  }

  Future<void> update(String id, Map<String, dynamic> changes) async {
    await _client.patchJson('/practices/$id', body: changes);
  }
}

final practiceRepositoryProvider = Provider<PracticeRepository>(
  (ref) => PracticeRepository(ref.watch(apiClientProvider)),
);

/// Null means "no practice yet", which the screen renders deliberately.
final practiceOverviewProvider = FutureProvider.autoDispose<PracticeOverview?>(
  (ref) => ref.watch(practiceRepositoryProvider).mine(),
);
