import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/features/clinician/presentation/widgets/dashboard_sections.dart';
import 'package:medpin/features/clinician/presentation/widgets/triage_queue.dart';

/// The doctor's home stopped rendering everything below Live Triage, and the
/// blank was silent — no crash, no message, just background where four sections
/// should have been. These pump each section on a phone-width viewport so a
/// section that cannot lay itself out fails here instead of on the doctor's
/// screen.
void main() {
  const overview = ClinicOverview(
    patientCount: 7,
    activeToday: 2,
    appointmentsToday: 0,
    completedToday: 0,
    pendingReviews: 1,
    unreadMessages: 9,
    unreadNutrition: 2,
    urgentUnread: 2,
    emergencyAlerts: 0,
    urgentAlerts: 1,
    warningAlerts: 1,
    totalOpenAlerts: 2,
    riskLow: 4,
    riskModerate: 1,
    riskHigh: 1,
    riskCritical: 1,
    nutritionReviews: [
      NutritionReview(
        patientId: 'p1',
        name: 'Rahul Das',
        day: 30,
        intervalDays: 30,
        mealsThisWeek: 4,
      ),
    ],
  );

  final analytics = ClinicAnalytics(
    controlTrend: [
      for (var i = 0; i < 14; i++)
        ControlPoint(
          date: DateTime(2026, 8, i + 1),
          low: 1,
          inRange: 8,
          high: 1,
          total: 10,
        ),
    ],
    overdueCheckIns: 3,
  );

  Future<void> pump(WidgetTester tester, Widget child) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
    // ProviderScope because UserAvatar is a ConsumerWidget. Without it the
    // avatar throws and Flutter substitutes an error box, which reports a
    // nonsense intrinsic width — a "99790 pixel overflow" that is the harness
    // failing, not the widget.
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          home: Scaffold(
            body: ListView(
              padding: const EdgeInsets.all(16),
              children: [child],
            ),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  testWidgets('the clinic snapshot lays out on a phone', (tester) async {
    await pump(
      tester,
      ClinicSnapshot(analytics: analytics, days: 14, onDaysChanged: (_) {}),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Clinic snapshot'), findsOneWidget);
  });

  testWidgets('the action queue lays out on a phone', (tester) async {
    await pump(tester, ActionQueue(overview: overview, analytics: analytics));
    expect(tester.takeException(), isNull);
    expect(find.text('Action Queue'), findsOneWidget);
  });

  testWidgets('the nutrition queue lays out on a phone', (tester) async {
    await pump(
      tester,
      NutritionReviewQueue(reviews: overview.nutritionReviews),
    );
    expect(tester.takeException(), isNull);
    expect(find.text('Nutrition Review'), findsOneWidget);
  });

  testWidgets('the nutrition queue survives an empty list', (tester) async {
    await pump(tester, const NutritionReviewQueue(reviews: []));
    expect(tester.takeException(), isNull);
    expect(find.text('Nothing due for review'), findsOneWidget);
  });

  testWidgets('live activity lays out on a phone', (tester) async {
    final events = LiveActivity.from(
      patients: const [],
      reviews: overview.nutritionReviews,
    );
    await pump(tester, LiveActivity(events: events));
    expect(tester.takeException(), isNull);
  });

  testWidgets('the triage queue shows a busy patient without clipping', (
    tester,
  ) async {
    // The worst case the real queue produces: a long name, an open alert, a
    // stale last-reading, an HbA1c and a sparkline all on one row. This is what
    // rendered as "High risk · 1 alert · …" over "Average u…" on a phone.
    final patients = [
      PatientListItem(
        id: 'p1',
        name: 'Ankit Kumar Singh',
        phone: '+919830000013',
        riskScore: 80,
        riskBand: 'high',
        openAlertCount: 1,
        lastReadingAt: DateTime.now().subtract(const Duration(days: 28)),
        hba1c: 8.4,
        spark: const [7.0, 7.4, 8.0, 8.4],
        trend: 'up',
      ),
    ];
    await pump(tester, TriageQueue(patients: patients, updatedAt: DateTime.now()));
    expect(tester.takeException(), isNull);

    // No ellipsis anywhere in the row: every Text either fits or wraps.
    final clipped = tester
        .widgetList<Text>(find.byType(Text))
        .where((t) => (t.data ?? '').contains('…'));
    expect(clipped, isEmpty, reason: 'a triage row is still truncating');

    // And the facts a doctor triages on are actually present.
    expect(find.textContaining('1 alert'), findsOneWidget);
    expect(find.textContaining('8.4%'), findsOneWidget);
  });
}
