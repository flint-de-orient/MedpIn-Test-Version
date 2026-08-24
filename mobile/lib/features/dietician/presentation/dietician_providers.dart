import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../foodlog/domain/food_log.dart';
import '../data/dietician_repository.dart';
import '../domain/diet_models.dart';

/// The dietician's day at a glance: counts, reviews due, plans not yet sent,
/// and the latest meals their patients logged.
/// The windows the overview offers. Days rather than calendar months: the
/// endpoint takes a day count, and a fortnight is what the clinic reviews on.
enum OverviewWindow {
  d7(7, '7D'),
  d14(14, '14D'),
  d30(30, '30D'),
  d90(90, '3M');

  const OverviewWindow(this.days, this.label);

  final int days;
  final String label;

  String get title => switch (this) {
    OverviewWindow.d7 => 'Nutrition overview (7 days)',
    OverviewWindow.d14 => 'Nutrition overview (14 days)',
    OverviewWindow.d30 => 'Nutrition overview (30 days)',
    OverviewWindow.d90 => 'Nutrition overview (3 months)',
  };
}

/// Which window the dietician is looking at. Survives a dashboard refresh —
/// the screen reloads itself every thirty seconds, and snapping back to the
/// default each time would make the control unusable.
final overviewWindowProvider = StateProvider<OverviewWindow>(
  (ref) => OverviewWindow.d14,
);

final overviewForWindowProvider = FutureProvider.autoDispose.family<
  NutritionOverview,
  OverviewWindow
>((ref, w) => ref.watch(dieticianRepositoryProvider).nutritionOverview(w.days));

final dietDashboardProvider = FutureProvider.autoDispose<DietDashboard>(
  (ref) => ref.watch(dieticianRepositoryProvider).dashboard(),
);

/// One patient's diet plan. Null until a dietician writes one.
final dietPlanProvider = FutureProvider.autoDispose.family<DietPlan?, String>(
  (ref, id) => ref.watch(dieticianRepositoryProvider).dietPlan(id),
);

/// The dietician's assigned-patient worklist.
final dietPatientsProvider = FutureProvider.autoDispose<List<DietPatient>>(
  (ref) => ref.watch(dieticianRepositoryProvider).patients(),
);

/// One patient's nutrition view (medical status + the doctor's medicine list).
final dietOverviewProvider = FutureProvider.autoDispose
    .family<DietPatientOverview, String>(
      (ref, id) => ref.watch(dieticianRepositoryProvider).overview(id),
    );

/// The patient's care thread, as the dietician sees it.
final dietThreadProvider = FutureProvider.autoDispose
    .family<List<DietMessage>, String>(
      (ref, id) => ref.watch(dieticianRepositoryProvider).thread(id),
    );

/// The patient's food log for the dietician to review.
final dietFoodLogProvider = FutureProvider.autoDispose
    .family<List<FoodLogEntry>, String>(
      (ref, id) => ref.watch(dieticianRepositoryProvider).foodLog(id),
    );

/// Plans this patient has been taken off, newest first.
final dietPlanHistoryProvider = FutureProvider.autoDispose
    .family<List<DietPlanRevision>, String>(
      (ref, id) => ref.watch(dieticianRepositoryProvider).dietPlanHistory(id),
    );

/// What is waiting for the dietician right now.
final dietNotificationsProvider = FutureProvider.autoDispose<DietNotifications>(
  (ref) => ref.watch(dieticianRepositoryProvider).notifications(),
);
