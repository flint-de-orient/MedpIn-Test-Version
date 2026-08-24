import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/network/api_client.dart';
import '../../../shared/providers/core_providers.dart';
import '../../foodlog/domain/food_log.dart';
import '../domain/diet_models.dart';

/// Talks to `/dietician/*` — the dietician panel API. A dietician only ever sees
/// the patients a doctor has assigned to them.
class DieticianRepository {
  DieticianRepository(this._client);

  final ApiClient _client;

  Future<DietDashboard> dashboard() async {
    return DietDashboard.fromJson(
      await _client.getJson('/dietician/dashboard'),
    );
  }

  Future<DietPlan?> dietPlan(String patientId) async {
    final json = await _client.getJson('/dietician/patients/$patientId/diet');
    final plan = json['plan'];
    return plan is Map<String, dynamic> ? DietPlan.fromJson(plan) : null;
  }

  Future<DietPlan> saveDietPlan(String patientId, DietPlan plan) async {
    final json = await _client.putJson(
      '/dietician/patients/$patientId/diet',
      body: plan.toJson(),
    );
    return DietPlan.fromJson(json['plan'] as Map<String, dynamic>? ?? const {});
  }

  /// Plans this patient has been on before, newest first.
  Future<List<DietPlanRevision>> dietPlanHistory(String patientId) async {
    final json = await _client.getJson(
      '/dietician/patients/$patientId/diet/history',
    );
    return (json['revisions'] as List? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(DietPlanRevision.fromJson)
        .toList();
  }

  /// Files the current plan as history and clears the working one, so the next
  /// plan is written on a blank page with the old one still readable.
  Future<void> startNewDietPlan(String patientId) async {
    await _client.postJson('/dietician/patients/$patientId/diet/new');
  }

  /// Pushes the saved plan into the patient's care thread. Separate from saving
  /// on purpose: a dietician mid-edit should not be notifying the patient.
  Future<void> sendDietPlan(String patientId) async {
    await _client.postJson('/dietician/patients/$patientId/diet/send');
  }

  /// What is waiting for this dietician: unread messages, lapsed reviews and
  /// patients with no plan.
  Future<DietNotifications> notifications() async {
    final json = await _client.getJson('/dietician/notifications');
    return DietNotifications.fromJson(json);
  }

  /// Marks unread patient messages as seen — called when the list is opened, so
  /// the badge clears because somebody looked rather than because something was
  /// delivered.
  Future<void> markNotificationsSeen() async {
    await _client.postJson('/dietician/notifications/seen');
  }

  Future<List<DietPatient>> patients() async {
    final json = await _client.getJson('/dietician/patients');
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(DietPatient.fromJson)
        .toList();
  }

  Future<DietPatientOverview> overview(String patientId) async {
    final json = await _client.getJson(
      '/dietician/patients/$patientId/overview',
    );
    return DietPatientOverview.fromJson(json);
  }

  Future<List<DietMessage>> thread(String patientId) async {
    final json = await _client.getJson('/dietician/patients/$patientId/thread');
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(DietMessage.fromJson)
        .toList();
  }

  Future<List<FoodLogEntry>> foodLog(String patientId) async {
    final json = await _client.getJson(
      '/dietician/patients/$patientId/food-log',
    );
    final items = json['items'] as List? ?? const [];
    return items
        .whereType<Map<String, dynamic>>()
        .map(FoodLogEntry.fromJson)
        .toList();
  }

  /// Ticks one meal off, or puts it back.
  ///
  /// Per meal rather than per patient: a dietician scanning a week needs to be
  /// able to say "these three are fine, this one we should talk about", and
  /// while review was welded to replying, saying that was impossible.
  Future<void> reviewFoodLog(
    String patientId,
    String logId, {
    bool reviewed = true,
  }) async {
    await _client.postJson(
      '/dietician/patients/$patientId/food-log/$logId/review',
      body: {'reviewed': reviewed},
    );
  }

  /// Clears everything still outstanding on this record in one call.
  Future<int> reviewAllFoodLogs(String patientId) async {
    final json = await _client.postJson(
      '/dietician/patients/$patientId/food-log/review-all',
    );
    return (json['reviewed'] as num?)?.toInt() ?? 0;
  }

  Future<void> sendMessage(
    String patientId, {
    String content = '',
    List<String> attachments = const [],
    String? replyTo,
  }) async {
    await _client.postJson(
      '/dietician/patients/$patientId/message',
      body: {
        'content': content,
        'attachments': attachments,
        if (replyTo != null) 'replyTo': replyTo,
      },
    );
  }
}

final Provider<DieticianRepository> dieticianRepositoryProvider =
    Provider<DieticianRepository>((ref) {
      return DieticianRepository(ref.watch(apiClientProvider));
    });
