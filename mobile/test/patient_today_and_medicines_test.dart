import 'package:medpin/features/glucose/domain/glucose_trends.dart';
import 'package:medpin/features/home/domain/today_plan.dart';
import 'package:medpin/features/home/presentation/widgets/home_glucose_chart.dart';
import 'package:medpin/features/medications/domain/medication.dart';
import 'package:medpin/features/medications/domain/today_doses.dart';
import 'package:medpin/features/medications/presentation/medications_providers.dart';
import 'package:medpin/features/shell/presentation/widgets/patient_kit.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'ui_preview/patient_preview_harness.dart';

/// The patient's day, as Home and the Medicines tab state it — and the promises
/// those screens make about failure: a missed refresh never empties what was on
/// screen, and a dose that did not save never looks recorded.

MedicationScheduleSlot _slot(
  String time, {
  String status = 'pending',
  bool late = false,
  required DateTime day,
}) {
  final parts = time.split(':');
  return MedicationScheduleSlot(
    medicationId: 'm-$time',
    name: 'Metformin 500 mg',
    dose: '1 tablet',
    time: time,
    relationToMeal: 'after_meal',
    status: status,
    late: late,
    scheduledFor: DateTime(
      day.year,
      day.month,
      day.day,
      int.parse(parts[0]),
      int.parse(parts[1]),
    ),
  );
}

void main() {
  final now = DateTime(2026, 9, 17, 14, 0);

  group('today\'s doses, counted as a patient would count them', () {
    final doses = TodayDoses([
      _slot('20:30', day: now),
      _slot('08:00', status: 'taken', day: now),
      _slot('09:00', status: 'taken', late: true, day: now),
      _slot('13:00', status: 'missed', day: now),
      _slot('13:50', day: now),
    ], now);

    test('in time order, whatever order the server sent', () {
      expect(doses.slots.map((s) => s.time), [
        '08:00',
        '09:00',
        '13:00',
        '13:50',
        '20:30',
      ]);
    });

    test('a late dose still counts as taken, and is told apart', () {
      expect(doses.taken, 2);
      expect(doses.takenLate, 1);
      expect(doseStateOf(doses.slots[1], now), DoseState.takenLate);
    });

    test('a day with a missed dose is never "all taken"', () {
      expect(doses.missed, 1);
      expect(doses.allTaken, isFalse);
    });

    test('a dose whose time has passed is due, not "later"', () {
      expect(doseStateOf(doses.slots[3], now), DoseState.due);
      expect(doseStateOf(doses.slots[4], now), DoseState.upcoming);
    });

    test('the next dose is the overdue one, and it can be recorded now', () {
      expect(doses.next?.time, '13:50');
      expect(doses.isLoggableNow(doses.next!), isTrue);
    });

    test('a dose hours away is not offered as "record now"', () {
      expect(doses.isLoggableNow(doses.slots[4]), isFalse);
    });

    test('a dose within half an hour is', () {
      final soon = TodayDoses([_slot('14:20', day: now)], now);
      expect(soon.isLoggableNow(soon.slots.single), isTrue);
    });
  });

  group('a sugar check falls due with the reminder, not on its own clock', () {
    GlucoseTrends withLastReading(DateTime? at) => GlucoseTrends.fromJson({
      'days': 30,
      'count': at == null ? 0 : 1,
      'series': [
        if (at != null) {'at': at.toIso8601String(), 'value': 120},
      ],
      'stats': const <String, dynamic>{},
    });

    test('no readings in the window: due', () {
      expect(checkInDue(withLastReading(null), now), isTrue);
    });

    test('a reading yesterday: not due', () {
      expect(
        checkInDue(withLastReading(now.subtract(const Duration(days: 1))), now),
        isFalse,
      );
    });

    test('a reading three days ago: due', () {
      expect(
        checkInDue(withLastReading(now.subtract(const Duration(days: 3))), now),
        isTrue,
      );
    });
  });

  group('the diet plan\'s calorie target is read whole', () {
    test('"1,600 kcal" is 1600, not 600', () {
      expect(calorieTarget('Keep to about 1,600 kcal a day.'), 1600);
    });

    test('no target written is no target shown', () {
      expect(calorieTarget('Eat slowly and often.'), isNull);
    });

    test('an implausible number is refused rather than shown', () {
      expect(calorieTarget('Take 250 kcal of snacks'), isNull);
    });
  });

  group('a day with no readings is a gap, never a zero', () {
    const day = 86400000.0;
    final spots = [
      const FlSpot(0, 120),
      const FlSpot(day, 130),
      const FlSpot(2 * day, 125),
      // Five days with nothing logged.
      const FlSpot(8 * day, 140),
      const FlSpot(9 * day, 150),
    ];

    test('the line breaks across the gap instead of joining it', () {
      final runs = splitRuns(spots, maxStep: maxJoinStep(spots));
      expect(runs, hasLength(2));
      expect(runs.first.mean.last.x, 2 * day);
      expect(runs.last.mean.first.x, 8 * day);
    });

    test('and no point is invented at zero', () {
      final runs = splitRuns(spots, maxStep: maxJoinStep(spots));
      for (final run in runs) {
        expect(run.mean.every((s) => s.y > 0), isTrue);
      }
    });

    test('an ordinary weekend off does not break a daily logger\'s line', () {
      final daily = [for (var i = 0; i < 10; i++) FlSpot(i * day, 120)]
        ..removeAt(5)
        ..removeAt(5);
      expect(splitRuns(daily, maxStep: maxJoinStep(daily)), hasLength(1));
    });
  });

  group('names and titles', () {
    test('a strength is kept on one line with its unit', () {
      expect(keepUnitsTogether('Metformin 500 mg'), 'Metformin 500 mg');
      expect(keepUnitsTogether('Insulin 18 units'), 'Insulin 18 units');
    });

    test('an avatar initial is the doctor, not "Dr"', () {
      expect(withoutHonorific('Dr. Amit Kumar Dey'), 'Amit Kumar Dey');
      expect(withoutHonorific('Dr Amit'), 'Amit');
      expect(withoutHonorific('Priya Sharma'), 'Priya Sharma');
    });
  });

  group('the Medicines tab under failure', () {
    testWidgets('a dose that did not save says so, and offers to try again', (
      tester,
    ) async {
      final repo = FailingDoseRepository();
      await pumpPatientApp(
        tester,
        location: '/medications',
        overrides: patientOverrides(
          today: dueNowToday(),
          medicationsRepository: repo,
        ),
        size: const Size(360, 1400),
      );

      await tester.tap(find.text('Record this dose'));
      await settle(tester);
      await tester.tap(find.text('Yes, I took it'));
      await settle(tester, frames: 20);

      expect(repo.attempts, 1);
      // A status carries its icon inside the paragraph, so it is found by the
      // words it contains.
      expect(find.textContaining('Not saved: Taken'), findsOneWidget);
      // Never shown as recorded while it is not: that label is the only
      // "Taken" on the screen.
      expect(find.textContaining('Taken'), findsOneWidget);

      await tester.tap(find.widgetWithText(OutlinedButton, 'Try again'));
      await settle(tester, frames: 20);
      expect(repo.attempts, 2, reason: 'retry sends the same answer again');
      expect(find.textContaining('Not saved: Taken'), findsOneWidget);

      await unmount(tester);
    });

    testWidgets('a refresh that fails keeps the medicines on screen', (
      tester,
    ) async {
      final container = await pumpPatientApp(
        tester,
        location: '/medications',
        overrides: patientOverrides(
          medsFailsOnRefresh: true,
          todayFailsOnRefresh: true,
        ),
        size: const Size(360, 3000),
      );
      expect(find.text('Glimepiride 1 mg'), findsWidgets);

      container.invalidate(medicationsListProvider);
      container.invalidate(todayScheduleProvider);
      await settle(tester);

      expect(find.textContaining('Could not refresh'), findsOneWidget);
      // Still the medicines and the doses, not an error or an empty list.
      expect(find.text('Glimepiride 1 mg'), findsWidgets);
      expect(find.text('2 of 4 doses taken'), findsOneWidget);
      expect(find.text('Could not load your medicines.'), findsNothing);

      await unmount(tester);
    });

    testWidgets('a first load that fails is said as a failure, not as empty', (
      tester,
    ) async {
      await pumpPatientApp(
        tester,
        location: '/medications',
        overrides: patientOverrides(
          medsError: Exception('offline'),
          todayError: Exception('offline'),
        ),
        size: const Size(360, 1400),
      );

      expect(find.text('Could not load your medicines.'), findsOneWidget);
      expect(find.text('No medicines yet'), findsNothing);

      await unmount(tester);
    });

    testWidgets('a finished course leaves a note on the list', (tester) async {
      await pumpPatientApp(
        tester,
        location: '/medications',
        overrides: patientOverrides(allMeds: allMedsWithHistory()),
        size: const Size(360, 3000),
      );

      expect(
        find.text('Finished courses now move to Past medicines.'),
        findsOneWidget,
      );
      expect(find.text('Past medicines'), findsOneWidget);
      expect(find.text('Stopped by you'), findsOneWidget);
      expect(find.text('Start again'), findsOneWidget);

      await unmount(tester);
    });

    testWidgets('statuses are words: taken late and missed', (tester) async {
      await pumpPatientApp(
        tester,
        location: '/medications',
        overrides: patientOverrides(),
        size: const Size(360, 3000),
      );

      expect(find.textContaining('Taken late'), findsOneWidget);
      expect(find.textContaining('Missed'), findsOneWidget);
      expect(find.textContaining('1 taken late'), findsOneWidget);

      await unmount(tester);
    });
  });

  group('care surfaces follow enrolment', () {
    testWidgets('a patient enrolled nowhere has no Doctor or Dietician tab', (
      tester,
    ) async {
      await pumpPatientApp(
        tester,
        location: '/home',
        overrides: patientOverrides(enrolled: false),
      );

      expect(find.text('Assistant'), findsOneWidget);
      expect(find.text('Doctor'), findsNothing);
      expect(find.text('Dietician'), findsNothing);
      expect(find.text('From your clinic'), findsNothing);

      await unmount(tester);
    });

    testWidgets('an enrolled patient has both', (tester) async {
      await pumpPatientApp(
        tester,
        location: '/home',
        overrides: patientOverrides(),
      );

      expect(find.text('Doctor'), findsOneWidget);
      expect(find.text('Dietician'), findsOneWidget);

      await unmount(tester);
    });
  });

  group('Home under failure', () {
    testWidgets('a failed refresh keeps today\'s doses and says it is stale', (
      tester,
    ) async {
      final container = await pumpPatientApp(
        tester,
        location: '/home',
        overrides: patientOverrides(todayFailsOnRefresh: true),
        size: const Size(360, 1400),
      );
      expect(find.text('2 of 4 doses taken'), findsOneWidget);

      container.invalidate(todayScheduleProvider);
      await settle(tester);

      expect(find.text('2 of 4 doses taken'), findsOneWidget);
      expect(find.textContaining('Could not refresh'), findsOneWidget);

      await unmount(tester);
    });
  });
}
