import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/medications/domain/medication.dart';
import 'package:medpin/features/medications/presentation/widgets/medicine_lifecycle.dart';
import 'package:medpin/features/shell/presentation/widgets/patient_kit.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';

/// The patient's side of a medicine's life: stopping it, and what has ended.
///
/// The words matter more than the layout here. "Stop" on a doctor's prescription
/// must not read as deleting it, a finished course must say it finished rather
/// than vanish, and two prescriptions for one drug must be said out loud.
Medication fromJson(Map<String, dynamic> extra) => Medication.fromJson({
  'id': 'm1',
  'name': 'Metformin',
  'form': 'tablet',
  'strength': '500 mg',
  'dose': '1 tablet',
  'schedule': [
    {'time': '08:00', 'relationToMeal': 'after_meal'},
  ],
  'daysOfWeek': [],
  'isActive': true,
  ...extra,
});

void main() {
  test('a server from before the states reads every medicine as prescribed and taken', () {
    final m = fromJson({});
    expect(m.prescriptionState, 'active');
    expect(m.takingState, 'taking');
    expect(m.ownedBy, 'practice');
    expect(m.alsoOnList, isEmpty);
  });

  test('the lifecycle is read as sent', () {
    final m = fromJson({
      'isActive': false,
      'prescriptionState': 'active',
      'takingState': 'stopped_by_patient',
      'stoppedTaking': {'at': '2026-09-12T04:00:00Z', 'reason': 'Ran out'},
      'alsoOnList': [
        {'id': 'm2', 'strength': '1000 mg', 'samePractice': false},
      ],
    });
    expect(m.prescriptionStands, isTrue);
    expect(m.stoppedByPatient, isTrue);
    expect(m.stoppedTaking?.reason, 'Ran out');
    expect(m.alsoOnList.single.samePractice, isFalse);
  });

  // Rendered, since the wording moved into the app's translations: the words
  // come from the list a patient reads, in English.
  group('what ended, in words', () {
    Future<void> past(WidgetTester tester, Medication m) => tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: PastMedicinesList(medicines: [m])),
      ),
    );

    testWidgets('a finished course says it finished', (tester) async {
      await past(tester, fromJson({'prescriptionState': 'completed', 'completedAt': '2026-09-03T10:00:00Z'}));
      expect(find.textContaining('Course finished on'), findsOneWidget);
    });

    testWidgets('a doctor’s stop says it was the doctor, and why', (tester) async {
      await past(
        tester,
        fromJson({
          'prescriptionState': 'stopped_by_doctor',
          'stoppedByDoctor': {'at': '2026-09-05T10:00:00Z', 'reason': 'Switched to insulin'},
        }),
      );
      expect(find.textContaining('Stopped by your doctor'), findsOneWidget);
      expect(find.textContaining('Switched to insulin'), findsOneWidget);
    });

    testWidgets('an old stop nobody recorded is not attributed to anyone', (tester) async {
      await past(tester, fromJson({'prescriptionState': 'ended_legacy', 'isActive': false}));
      expect(find.text('No longer taken'), findsOneWidget);
      expect(find.textContaining('doctor'), findsNothing);
    });
  });

  group('the stop sheet', () {
    Future<void> open(WidgetTester tester, Medication m, void Function(({String? reason})?) onResult) async {
      await tester.pumpWidget(
        MaterialApp(
          locale: const Locale('en'),
          localizationsDelegates: AppLocalizations.localizationsDelegates,
          supportedLocales: AppLocalizations.supportedLocales,
          home: Scaffold(
            body: Builder(
              builder: (context) => TextButton(
                onPressed: () async => onResult(
                  await showModalBottomSheet<({String? reason})>(
                    context: context,
                    isScrollControlled: true,
                    builder: (_) => StopTakingSheet(medication: m),
                  ),
                ),
                child: const Text('Open'),
              ),
            ),
          ),
        ),
      );
      await tester.tap(find.text('Open'));
      await tester.pumpAndSettle();
    }

    testWidgets('on a prescribed medicine it says the prescription stays and the doctor will see', (tester) async {
      await open(tester, fromJson({}), (_) {});
      // Either apostrophe: the translations use a straight one.
      expect(find.textContaining(RegExp("Your doctor[’']s prescription stays as they wrote it")), findsOneWidget);
      expect(find.textContaining('contact your clinic'), findsOneWidget);
    });

    testWidgets('on the patient’s own medicine it makes no claim about a doctor', (tester) async {
      await open(tester, fromJson({'ownedBy': 'patient'}), (_) {});
      // "My doctor told me to" stays as a reason anyone can give; what goes is
      // the claim that a doctor prescribed this and will be told.
      expect(find.textContaining(RegExp("Your doctor[’']s prescription")), findsNothing);
      expect(find.textContaining('they will see'), findsNothing);
      expect(find.textContaining('Its reminders stop'), findsOneWidget);
    });

    testWidgets('a reason is one tap, and comes back with the stop', (tester) async {
      ({String? reason})? result;
      await open(tester, fromJson({}), (r) => result = r);
      await tester.tap(find.text('Side effects'));
      await tester.pump();
      // The patient redesign draws it as the sheet's secondary action.
      await tester.tap(find.widgetWithText(SecondaryAction, 'Stop taking'));
      await tester.pumpAndSettle();
      expect(result?.reason, 'Side effects');
    });

    testWidgets('keeping it returns nothing, and nothing is stopped', (tester) async {
      var called = false;
      ({String? reason})? result = (reason: 'sentinel');
      await open(tester, fromJson({}), (r) {
        called = true;
        result = r;
      });
      await tester.tap(find.text('Keep taking it'));
      await tester.pumpAndSettle();
      expect(called, isTrue);
      expect(result, isNull);
    });
  });

  testWidgets('two prescriptions for one medicine are said out loud', (tester) async {
    final m = fromJson({
      'alsoOnList': [
        {'id': 'm2', 'strength': '1000', 'samePractice': false},
      ],
    });
    await tester.pumpWidget(
      MaterialApp(
        locale: const Locale('en'),
        localizationsDelegates: AppLocalizations.localizationsDelegates,
        supportedLocales: AppLocalizations.supportedLocales,
        home: Scaffold(body: AlsoOnListNote(medication: m)),
      ),
    );
    expect(find.textContaining('Also prescribed by another clinic: Metformin 1000 mg'), findsOneWidget);
    expect(find.textContaining('Ask your doctor before taking both'), findsOneWidget);
  });
}
