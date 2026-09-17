import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/clinician/data/clinician_repository.dart';
import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/features/clinician/presentation/alerts_screen.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/shared/models/paged.dart';
import 'package:medpin/shared/providers/core_providers.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'ui_preview/doctor_home_fixtures.dart';

/// The alerts screen acts on the alert it shows, and says what an empty list
/// means.
///
/// Each card was given `paged.items[i]` for its buttons while it displayed the
/// i-th alert *after* the search and severity filters — so with a filter on,
/// Acknowledge on the second card acknowledged somebody else's alert.
class _Recorder implements ClinicianRepository {
  final acknowledged = <String>[];

  @override
  Future<ClinicalAlert> acknowledgeAlert(String id) async {
    acknowledged.add(id);
    return ClinicalAlert.fromJson({'id': id, 'status': 'acknowledged'});
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

ClinicalAlert _alert(String id, String patient, String title) => ClinicalAlert.fromJson({
  'id': id,
  'severity': 'urgent',
  'type': 'glucose',
  'title': title,
  'status': 'open',
  'patientId': 'p-$id',
  'patientName': patient,
  'createdAt': DateTime.now().toUtc().toIso8601String(),
});

void main() {
  setUpAll(() async {
    final inter = FontLoader('Inter')..addFont(rootBundle.load('assets/fonts/Inter.ttf'));
    await inter.load();
  });

  late _Recorder repo;
  setUp(() => repo = _Recorder());

  Future<void> open(WidgetTester tester, List<ClinicalAlert> items) async {
    tester.view.physicalSize = const Size(1080, 6000);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          secureStoreProvider.overrideWithValue(SignedInStore()),
          imageAuthHeaderProvider.overrideWith((ref) async => const {}),
          clinicianRepositoryProvider.overrideWithValue(repo),
          alertsProvider.overrideWith(
            (ref, q) async => Paged(
              items: [for (final a in items) if (q.status == null || a.status == q.status) a],
              page: 1,
              limit: 100,
              total: items.length,
              hasMore: false,
            ),
          ),
          overviewProvider.overrideWith((ref) async => emptyOverview()),
          attentionPatientsProvider.overrideWith((ref) async => const []),
        ],
        child: MaterialApp(theme: AppTheme.light(), home: const AlertsScreen()),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> leave(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(minutes: 1));
  }

  testWidgets('with a search on, a card acknowledges the alert it shows', (tester) async {
    await open(tester, [
      _alert('a1', 'Farida Begum', 'Sugar 42 mg/dL'),
      _alert('a2', 'Gopal Bhattacharya', 'Sugar above 400 mg/dL'),
      _alert('a3', 'Mitali Pal', 'Blood pressure 168/102'),
    ]);

    await tester.enterText(find.byType(TextField), 'Mitali');
    await tester.pumpAndSettle();
    expect(find.text('Farida Begum'), findsNothing);

    await tester.tap(find.text('Acknowledge'));
    await tester.pumpAndSettle();

    expect(repo.acknowledged, ['a3'], reason: 'a different alert from the one on screen was acknowledged');
    await leave(tester);
  });

  testWidgets('no open alerts says what that means, and offers the resolved ones', (tester) async {
    await open(tester, const []);

    expect(find.text('No open alerts'), findsOneWidget);
    expect(find.textContaining('Nothing is waiting for a clinician.'), findsOneWidget);
    await tester.tap(find.text('Show resolved alerts'));
    await tester.pumpAndSettle();
    expect(find.text('No resolved alerts'), findsOneWidget);
    await leave(tester);
  });

  testWidgets('a search that matches nothing says so, and clears', (tester) async {
    await open(tester, [_alert('a1', 'Farida Begum', 'Sugar 42 mg/dL')]);

    await tester.enterText(find.byType(TextField), 'nobody by this name');
    await tester.pumpAndSettle();
    expect(find.text('No alerts match these filters'), findsOneWidget);
    // Not the reassuring empty: there are open alerts, just not these.
    expect(find.text('No open alerts'), findsNothing);

    await tester.tap(find.text('Clear filters'));
    await tester.pumpAndSettle();
    expect(find.text('Farida Begum'), findsOneWidget);
    await leave(tester);
  });

  testWidgets('severity is a word, in sentence case', (tester) async {
    await open(tester, [_alert('a1', 'Farida Begum', 'Sugar 42 mg/dL')]);
    expect(find.text('Urgent'), findsWidgets);
    expect(find.text('URGENT'), findsNothing);
    await leave(tester);
  });
}
