import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/clinician/domain/appointment.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/presentation/widgets/dashboard_sections.dart';
import 'package:akd_care/features/clinician/presentation/widgets/home_actions.dart';
import 'package:akd_care/features/clinician/presentation/widgets/todays_clinic.dart';
import 'package:akd_care/features/clinician/presentation/widgets/triage_queue.dart';
import 'package:akd_care/shared/widgets/user_avatar.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

/// The pieces of the doctor's home, each on a phone-width screen, and the
/// arithmetic behind the numbers they print.
void main() {
  final now = DateTime.now();
  DateTime day(int ago) => DateTime(now.year, now.month, now.day).subtract(Duration(days: ago));

  Future<void> pump(WidgetTester tester, Widget child) async {
    tester.view.physicalSize = const Size(1080, 3600);
    tester.view.devicePixelRatio = 3.0;
    addTearDown(tester.view.reset);
    await tester.pumpWidget(
      ProviderScope(
        child: MaterialApp(
          theme: AppTheme.light(),
          home: Scaffold(
            body: ListView(padding: const EdgeInsets.all(16), children: [child]),
          ),
        ),
      ),
    );
    await tester.pump();
  }

  group('glucose in range', () {
    test('no readings is no percentage — not zero', () {
      final s = inRangeSummary(const [], days: 14);
      expect(s.percent, isNull);
      expect(s.readings, 0);
      expect(s.change, isNull);

      // A fortnight of days on which nobody logged anything is the same fact.
      final empty = inRangeSummary(
        [for (var i = 0; i < 14; i++) ControlPoint(date: day(i), low: 0, inRange: 0, high: 0, total: 0)],
        days: 14,
      );
      expect(empty.percent, isNull);
    });

    test('the change compares the window’s two halves, in points', () {
      final s = inRangeSummary(
        [
          // The earlier week: 50 of 100 in range.
          ControlPoint(date: day(10), low: 10, inRange: 50, high: 40, total: 100),
          // The recent week: 60 of 100.
          ControlPoint(date: day(2), low: 10, inRange: 60, high: 30, total: 100),
        ],
        days: 14,
        now: now,
      );
      expect(s.percent, 55);
      expect(s.change, 10);
    });

    test('a half with no readings gives no change rather than a made-up one', () {
      final s = inRangeSummary(
        [ControlPoint(date: day(1), low: 0, inRange: 7, high: 3, total: 10)],
        days: 14,
        now: now,
      );
      expect(s.percent, 70);
      expect(s.change, isNull);
    });

    testWidgets('an empty window is said in words, and draws no 0%', (tester) async {
      await pump(
        tester,
        GlucoseInRangeCard(
          analytics: const AsyncValue.data(ClinicAnalytics()),
          days: 14,
          onDaysChanged: (_) {},
          onRetry: () {},
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('No glucose readings logged in the last 14 days.'), findsOneWidget);
      expect(find.textContaining('0%'), findsNothing);
    });
  });

  group('who needs attention', () {
    PatientListItem patient(String name, String band, {int alerts = 0, num? hba1c, bool overdue = false, int? delta}) =>
        PatientListItem(
          id: name,
          name: name,
          phone: '',
          riskScore: 50,
          riskBand: band,
          openAlertCount: alerts,
          hba1c: hba1c,
          checkInOverdue: overdue,
          trendDelta: delta,
          lastReadingAt: now.subtract(const Duration(days: 19)),
        );

    test('only the high-risk and those with open alerts are on the card, worst first', () {
      final ranked = rankForAttention([
        patient('Low with alert', 'low', alerts: 1),
        patient('High', 'high'),
        patient('Moderate', 'moderate'),
        patient('Critical', 'critical'),
      ].where(needsAttention));
      expect(ranked.map((p) => p.name), ['Critical', 'High', 'Low with alert']);
    });

    test('the reason is said once, and never claims what nothing checked', () {
      expect(triageReason(patient('A', 'high', alerts: 2)).text, '2 open alerts');
      expect(triageReason(patient('B', 'high', hba1c: 9.4)).text, 'HbA1c 9.4%');
      expect(triageReason(patient('C', 'high', delta: 38)).text, 'Sugars up 38 mg/dL on average');
      expect(triageReason(patient('D', 'high', overdue: true)).text, 'No reading for 19 days');
      // It said "All readings in range" whenever nothing else matched.
      expect(triageReason(patient('E', 'high')).text, startsWith('Last reading'));
    });

    testWidgets('a calm caseload is calm: no red, no zeros, one sentence', (tester) async {
      await pump(
        tester,
        TriageQueue(
          patients: AsyncValue.data([patient('Well', 'low'), patient('Watch', 'moderate')]),
          openAlerts: 0,
        ),
      );
      expect(tester.takeException(), isNull);
      expect(find.text('Nobody is at high risk or has an open alert.'), findsOneWidget);
      expect(find.text('0'), findsNothing);
      expect(find.text('Critical'), findsNothing);
      // The names of patients who do not need attention are not listed.
      expect(find.text('Well'), findsNothing);
    });

    testWidgets('a failed load is not "nobody"', (tester) async {
      await pump(
        tester,
        TriageQueue(patients: AsyncValue.error(Exception('offline'), StackTrace.empty), openAlerts: null),
      );
      expect(find.textContaining('Nobody'), findsNothing);
      expect(find.text('Could not load who needs attention.'), findsOneWidget);
    });
  });

  group('the day', () {
    Appointment appt(String id, String status, {String doctor = 'me', int minutes = 0}) => Appointment.fromJson({
      'id': id,
      'patientId': 'p-$id',
      'patientName': 'Patient $id',
      'doctorId': doctor,
      'doctorName': doctor == 'me' ? 'Dr Me' : 'Dr Colleague',
      'scheduledFor': DateTime(now.year, now.month, now.day, 9).add(Duration(minutes: minutes)).toUtc().toIso8601String(),
      'status': status,
      'mode': 'in_clinic',
    });

    test('counts by status, and offers only this doctor’s waiting patient', () {
      final counts = TodayCounts.of([
        appt('1', 'completed'),
        appt('2', 'checked_in', doctor: 'colleague', minutes: 5),
        appt('3', 'checked_in', minutes: 10),
        appt('4', 'in_consultation'),
        appt('5', 'confirmed', minutes: 30),
        appt('6', 'cancelled'),
        appt('7', 'no_show'),
      ], me: 'me');
      expect(counts.booked.length, 6, reason: 'a cancellation was counted as booked');
      expect(counts.waiting.length, 2);
      expect(counts.nextForMe?.id, '3');
      expect(counts.seen.length, 1);
      expect(counts.noShow.length, 1);
      expect(counts.next.length, 1);
    });

    test('nobody waiting for this doctor offers no patient by name', () {
      final counts = TodayCounts.of([appt('2', 'checked_in', doctor: 'colleague')], me: 'me');
      expect(counts.nextForMe, isNull);
    });
  });

  group('actions', () {
    test('actions that open the same screen are drawn once', () {
      expect(
        HomeActions.distinct(['START_CONSULTATION', 'ADD_PATIENT', 'RECORD_VITALS', 'WRITE_PRESCRIPTION', 'VIEW_ALERTS']),
        ['START_CONSULTATION', 'ADD_PATIENT', 'VIEW_ALERTS'],
      );
      // And the alerts action steps aside where the triage card links them.
      expect(HomeActions.distinct(['START_CONSULTATION', 'VIEW_ALERTS'], alertsOnScreen: true), ['START_CONSULTATION']);
    });
  });

  group('initials', () {
    test('without the title, first and last', () {
      expect(initialsOf('Dr. Amit Kumar Dey'), 'AD');
      expect(initialsOf('Dr Amit Dey'), 'AD');
      expect(initialsOf('Prof. Ritu Sen'), 'RS');
      expect(initialsOf('Rahul'), 'R');
      expect(initialsOf('Dr.'), 'D');
      expect(initialsOf(''), '?');
      expect(initialsOf('  farida   begum '), 'FB');
    });
  });

  group('nutrition', () {
    test('due means today, tomorrow or past its review', () {
      NutritionReview r(int day) =>
          NutritionReview(patientId: '$day', name: 'P$day', day: day, intervalDays: 30, mealsThisWeek: 3);
      expect(NutritionCard.due([r(10), r(29), r(30), r(35)]).map((e) => e.day), [29, 30, 35]);
    });
  });
}
