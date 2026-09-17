import 'package:medpin/core/capabilities/capabilities.dart';
import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/core/theme/app_theme.dart';
import 'package:medpin/features/clinician/data/clinician_repository.dart';
import 'package:medpin/features/clinician/domain/patient_summary.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/patient_detail_screen.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The dietician section of a patient's record.
///
/// It said "Covered by clinic dietician" for anybody nobody had assigned, and
/// offered to "Restrict" — the model from when every dietician covered every
/// patient. The caseload is the assignments now, per practice, so an
/// unassigned patient is looked after by nobody, a dietician who has left is
/// nobody's dietician, and two doctors choosing at once must see each other.

/// The assignment routes, recorded.
class _Repo implements ClinicianRepository {
  final assigned = <({String patientId, String? dieticianId, Object? expected})>[];
  Object? assignFails;

  @override
  Future<List<({String id, String name})>> dieticians() async => const [
    (id: 'roy', name: 'Ms Roy'),
    (id: 'bose', name: 'Mr Bose'),
  ];

  @override
  Future<void> assignDietician(
    String patientId, {
    String? dieticianId,
    Object? expectedDieticianId = #unset,
    Object? reviewIntervalDays = #unset,
  }) async {
    if (assignFails != null) throw assignFails!;
    assigned.add((patientId: patientId, dieticianId: dieticianId, expected: expectedDieticianId));
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

PatientSummary _summary({Map<String, dynamic>? care, Map<String, dynamic>? legacyDietician}) =>
    PatientSummary.fromJson({
      'patient': {'id': 'p1', 'name': 'Rina Das', 'phone': '+919830000001'},
      'profile': {if (legacyDietician != null) 'assignedDietician': legacyDietician},
      if (care != null) 'nutritionCare': care,
    });

Map<String, dynamic> _care({
  Map<String, dynamic>? dietician,
  bool decided = false,
  String? source,
  String? decidedBy,
  int activeDieticians = 2,
  List<Map<String, dynamic>> history = const [],
  bool mayChange = true,
}) => {
  'dietician': dietician,
  'decided': decided,
  'source': source,
  'since': '2026-09-01T09:00:00Z',
  'decidedBy': decidedBy == null ? null : {'id': 'd1', 'name': decidedBy},
  'activeDieticians': activeDieticians,
  'history': history,
  'mayChange': mayChange,
};

void main() {
  late _Repo repo;

  setUp(() => repo = _Repo());

  Future<void> open(
    WidgetTester tester,
    PatientSummary summary, {
    TextScaler textScaler = TextScaler.noScaling,
  }) async {
    // A 360dp phone.
    tester.view.physicalSize = const Size(1080, 4200);
    tester.view.devicePixelRatio = 3;
    addTearDown(tester.view.reset);

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          clinicianRepositoryProvider.overrideWithValue(repo),
          capabilitySetProvider.overrideWithValue(Capabilities.unknown),
          patientEcgsProvider.overrideWith((ref, id) async => const []),
          patientPrescriptionsProvider.overrideWith((ref, id) async => const []),
        ],
        child: MaterialApp(
          theme: AppTheme.light(),
          builder: (context, child) => MediaQuery(
            data: MediaQuery.of(context).copyWith(textScaler: textScaler),
            child: child!,
          ),
          home: Scaffold(
            body: SingleChildScrollView(
              padding: const EdgeInsets.all(16),
              child: PatientRecordSections(summary: summary, patientId: 'p1'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();
  }

  Future<void> tapVisible(WidgetTester tester, Finder target) async {
    await tester.ensureVisible(target);
    await tester.pumpAndSettle();
    await tester.tap(target);
    await tester.pumpAndSettle();
  }

  group('what it says', () {
    testWidgets('a dietician assigned by default, with how they came to hold the patient', (tester) async {
      await open(
        tester,
        _summary(care: _care(dietician: {'id': 'roy', 'name': 'Ms Roy', 'active': true}, decided: true, source: 'auto')),
      );

      expect(find.text('Ms Roy'), findsOneWidget);
      expect(find.textContaining('Assigned automatically'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Change'), findsOneWidget);
      // The old model's words are gone.
      expect(find.textContaining('Covered by clinic dietician'), findsNothing);
      expect(find.text('Restrict'), findsNothing);
    });

    testWidgets('a dietician who has left is named, said to have left, and not presented as cover', (tester) async {
      await open(
        tester,
        _summary(care: _care(dietician: {'id': 'gone', 'name': 'Ms Gone', 'active': false}, decided: true, source: 'doctor')),
      );

      expect(find.text('Ms Gone'), findsOneWidget);
      expect(find.text('No longer works here'), findsOneWidget);
      expect(find.textContaining('Nobody else was given this patient'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Choose'), findsOneWidget);
    });

    testWidgets('nobody decided, with a choice to make: says so in words', (tester) async {
      await open(tester, _summary(care: _care()));

      expect(find.text('Not assigned'), findsOneWidget);
      expect(find.text('Needs a choice'), findsOneWidget);
      expect(find.textContaining('This practice has 2 dieticians'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Assign'), findsOneWidget);
    });

    testWidgets('left without one on purpose: a decision, and whose', (tester) async {
      await open(tester, _summary(care: _care(decided: true, source: 'doctor', decidedBy: 'Dr Sen')));

      expect(find.text('No dietician'), findsOneWidget);
      expect(find.text('Left without one by Dr Sen.'), findsOneWidget);
      expect(find.text('Needs a choice'), findsNothing);
    });

    testWidgets('a practice with no dietician: a fact, and nothing to press', (tester) async {
      await open(tester, _summary(care: _care(activeDieticians: 0)));

      expect(find.text('No dietician'), findsOneWidget);
      expect(find.text('Nobody at this practice provides nutrition care yet.'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Assign'), findsNothing);
    });

    testWidgets('somebody who may not change it is offered nothing to press', (tester) async {
      await open(tester, _summary(care: _care(mayChange: false)));

      expect(find.text('Not assigned'), findsOneWidget);
      expect(find.widgetWithText(TextButton, 'Assign'), findsNothing);
    });

    testWidgets('a server from before per-practice assignment still shows its name', (tester) async {
      await open(tester, _summary(legacyDietician: {'_id': 'roy', 'name': 'Ms Roy'}));
      expect(find.text('Ms Roy'), findsOneWidget);
    });

    testWidgets('the earlier dieticians are a tap away', (tester) async {
      await open(
        tester,
        _summary(
          care: _care(
            dietician: {'id': 'bose', 'name': 'Mr Bose', 'active': true},
            decided: true,
            source: 'doctor',
            decidedBy: 'Dr Sen',
            history: [
              {
                'dietician': {'id': 'roy', 'name': 'Ms Roy'},
                'source': 'auto',
                'since': '2026-06-01T09:00:00Z',
                'until': '2026-09-01T09:00:00Z',
                'endedBy': {'id': 'd1', 'name': 'Dr Sen'},
              },
            ],
          ),
        ),
      );

      await tapVisible(tester, find.text('Earlier: 1 change'));
      expect(find.text('Who looked after nutrition before'), findsOneWidget);
      expect(find.text('Ms Roy'), findsOneWidget);
      expect(find.text('Changed by Dr Sen'), findsOneWidget);
    });

    testWidgets('fits a phone at twice the text size', (tester) async {
      await open(
        tester,
        _summary(care: _care(dietician: {'id': 'gone', 'name': 'Ms Gone', 'active': false}, decided: true, source: 'doctor')),
        textScaler: const TextScaler.linear(2),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('No longer works here'), findsOneWidget);
    });
  });

  group('choosing', () {
    testWidgets('sends who the screen showed, so a colleague’s change is not replaced unseen', (tester) async {
      await open(
        tester,
        _summary(care: _care(dietician: {'id': 'roy', 'name': 'Ms Roy', 'active': true}, decided: true, source: 'auto')),
      );

      await tapVisible(tester, find.widgetWithText(TextButton, 'Change'));
      await tapVisible(tester, find.text('Mr Bose'));
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Save'));

      expect(repo.assigned.single, (patientId: 'p1', dieticianId: 'bose', expected: 'roy'));
      expect(find.text('Nutrition care updated'), findsOneWidget);
    });

    testWidgets('choosing nobody for a patient nobody decided for is a decision, sent as one', (tester) async {
      await open(tester, _summary(care: _care()));

      await tapVisible(tester, find.widgetWithText(TextButton, 'Assign'));
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Save'));

      expect(repo.assigned.single, (patientId: 'p1', dieticianId: null, expected: null));
    });

    testWidgets('a colleague’s change made meanwhile is reported, not reported as saved', (tester) async {
      repo.assignFails = const ApiException(
        code: 'DIETICIAN_CHANGED',
        message: 'Somebody changed this patient’s dietician a moment ago.',
        statusCode: 409,
      );
      await open(tester, _summary(care: _care()));

      await tapVisible(tester, find.widgetWithText(TextButton, 'Assign'));
      await tapVisible(tester, find.text('Ms Roy'));
      await tapVisible(tester, find.widgetWithText(FilledButton, 'Save'));

      expect(find.textContaining('Somebody changed this patient’s dietician a moment ago'), findsOneWidget);
      expect(find.text('Nutrition care updated'), findsNothing);
      // The sheet closed, so the reloaded record is what the doctor reads next.
      expect(find.widgetWithText(FilledButton, 'Save'), findsNothing);
    });

    testWidgets('keeping who already holds the patient is not offered as a save', (tester) async {
      await open(
        tester,
        _summary(care: _care(dietician: {'id': 'roy', 'name': 'Ms Roy', 'active': true}, decided: true, source: 'doctor')),
      );

      await tapVisible(tester, find.widgetWithText(TextButton, 'Change'));
      final save = tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'Save'));
      expect(save.onPressed, isNull);
    });
  });
}
