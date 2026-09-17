import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/clinician_models.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/widgets/panel_ui.dart';
import 'package:medpin/features/home/presentation/home_screen.dart';
import 'package:medpin/features/medications/domain/medication.dart';
import 'package:medpin/features/medications/presentation/widgets/medication_slot_tile.dart';
import 'package:medpin/l10n/gen/app_localizations.dart';
import 'package:medpin/shared/widgets/notification_list_sheet.dart';

/// The second batch of bugs fixed inside the previous design.
void main() {
  Widget app(Widget home, {List<Override> overrides = const []}) => ProviderScope(
    overrides: overrides,
    child: MaterialApp(
      locale: const Locale('en'),
      localizationsDelegates: AppLocalizations.localizationsDelegates,
      supportedLocales: AppLocalizations.supportedLocales,
      home: Scaffold(body: home),
    ),
  );

  group('a diet plan’s calorie target', () {
    test('"1,600 kcal" is 1600, not 600', () {
      expect(calorieTargetIn('Target 1,600 kcal a day'), 1600);
      expect(calorieTargetIn('2,000kcal'), 2000);
    });
    test('without a comma it still reads', () {
      expect(calorieTargetIn('1600 kcal'), 1600);
      expect(calorieTargetIn('1800 cal'), 1800);
    });
    test('no figure, or one that cannot be a daily target, is nothing', () {
      expect(calorieTargetIn('Eat more vegetables'), isNull);
      expect(calorieTargetIn('12,000 kcal'), isNull);
    });
  });

  group('a prescription that no longer stands says so', () {
    PrescriptionSummary rx(Map<String, dynamic> extra) =>
        PrescriptionSummary.fromJson({'id': 'r1', 'items': [], ...extra});

    test('voided, replaced, corrected, with the reason', () {
      expect(rx({'recordState': 'voided', 'endedReason': 'Wrong patient'}).endedLabel, 'Voided — Wrong patient');
      expect(rx({'recordState': 'superseded'}).endedLabel, 'Replaced by a newer prescription');
      expect(rx({'recordState': 'corrected'}).endedLabel, 'Corrected');
    });
    test('an older server that only says it is not active', () {
      expect(rx({'isActive': false}).endedLabel, 'No longer in force');
    });
    test('a current one says nothing', () {
      expect(rx({'recordState': 'current', 'isActive': true}).endedLabel, isNull);
      expect(rx({}).endedLabel, isNull);
    });
  });

  testWidgets('a dose taken more than two hours late says "Taken late"', (tester) async {
    MedicationScheduleSlot slot({required bool late}) => MedicationScheduleSlot(
      medicationId: 'm1',
      name: 'Metformin',
      dose: '500 mg',
      time: '08:00',
      relationToMeal: 'after_meal',
      status: 'taken',
      late: late,
    );
    await tester.pumpWidget(app(Column(children: [MedicationSlotTile(slot: slot(late: true), onTap: () {})])));
    expect(find.text('Taken late'), findsOneWidget);
    await tester.pumpWidget(app(Column(children: [MedicationSlotTile(slot: slot(late: false), onTap: () {})])));
    expect(find.text('Taken late'), findsNothing);
    expect(find.text('Taken'), findsOneWidget);
  });

  testWidgets('the bell counts what its sheet lists as unread', (tester) async {
    await tester.pumpWidget(
      app(
        PanelNotificationBell(onTap: () {}),
        overrides: [
          clinicianNotificationsProvider.overrideWith(
            (ref) async => (unread: 3, messages: 5, alerts: 2, requests: 1, items: const <PanelNotification>[]),
          ),
        ],
      ),
    );
    await tester.pump();
    expect(find.text('3'), findsOneWidget);
    // Unmount, so the bell's refresh timer is cancelled.
    await tester.pumpWidget(const SizedBox());
  });

  test('every prescription the app sends carries a retry key', () {
    // The record's own form sent none, so a send retried after a lost answer
    // issued a second prescription.
    final calls = <String>[];
    for (final file in Directory('lib').listSync(recursive: true).whereType<File>()) {
      if (!file.path.endsWith('.dart')) continue;
      final src = file.readAsStringSync();
      var at = src.indexOf('.createPrescription(');
      while (at >= 0) {
        final end = src.indexOf(');', at);
        final call = src.substring(at, end < 0 ? src.length : end);
        if (!call.contains('submission:')) calls.add(file.path);
        at = src.indexOf('.createPrescription(', at + 1);
      }
    }
    expect(calls, isEmpty, reason: 'a prescription is sent without an Idempotency-Key');
  });
}
