import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/core/network/api_exception.dart';
import 'package:medpin/features/clinician/data/daily_report_repository.dart';
import 'package:medpin/features/clinician/domain/daily_report.dart';
import 'package:medpin/features/clinician/presentation/daily_report_screen.dart';

/// The doctor's daily report, previewed before anything leaves the phone.
///
/// The promises worth pinning:
///
///   - the preview is the server's summary, field for field, and what is
///     missing is said rather than hidden;
///   - opening the screen fetches no PDF — a file exists, and the audit log
///     records one, only when the doctor taps to open or share it;
///   - an empty day says so and offers nothing to share;
///   - a refusal from the server (a suspended practice, say) is shown as what
///     it is, not as a lost connection.
class _FakeRepository implements DailyReportRepository {
  _FakeRepository(this.report);

  DailyReport? report;
  Object? error;
  final pdfCalls = <DailyReportPurpose>[];

  @override
  Future<DailyReport> preview(String date) async {
    if (error != null) throw error!;
    return report!;
  }

  @override
  Future<List<int>> pdf(String date, DailyReportPurpose purpose) async {
    pdfCalls.add(purpose);
    return const [];
  }
}

Map<String, dynamic> serverReport({List<Map<String, dynamic>>? patients}) => {
  'report': {
    'date': '2026-09-16',
    'generatedAt': '2026-09-17T04:00:00.000Z',
    'practice': {'name': 'Lake Town Heart Centre', 'tagline': null},
    'doctor': {'name': 'Dr. Meera Iyer'},
    'patients':
        patients ??
        [
          {
            'name': 'Rahul Das',
            'age': 55,
            'sex': 'Male',
            'seenAt': '2026-09-16T05:00:00.000Z',
            'visit': 'completed',
            'complaint': {'text': 'Chest tightness on exertion', 'source': 'prescription'},
            'diagnosis': ['Stable angina', 'Hypertension'],
            'vitals': [
              {'at': '2026-09-16T05:05:00.000Z', 'bloodPressure': '150/94', 'pulse': 88},
            ],
            'glucose': [
              {'at': '2026-09-16T05:06:00.000Z', 'valueMgDl': 162, 'context': 'random'},
            ],
            'prescriptions': [
              {
                'source': 'composed',
                'standing': true,
                'items': [
                  {'name': 'Atorvastatin', 'strength': '20 mg', 'frequency': 'HS', 'durationDays': 30},
                ],
                'investigations': ['Lipid profile'],
              },
            ],
            'voidedPrescriptions': 1,
            'advice': 'Avoid exertion until reviewed.',
            'followUpOn': '2026-09-30T04:30:00.000Z',
          },
          {
            'name': 'Priya Nair',
            'age': null,
            'sex': null,
            'complaint': {'text': 'Sugar review', 'source': 'appointment'},
            'diagnosis': [],
            'vitals': [],
            'glucose': [],
            'prescriptions': [],
            'voidedPrescriptions': 0,
            'advice': null,
            'followUpOn': null,
          },
        ],
    'totals': {'patients': 2, 'prescriptions': 1},
  },
};

void main() {
  group('the report as the server describes it', () {
    test('reads every field, and invents none', () {
      final report = DailyReport.fromJson(serverReport());
      expect(report.date, '2026-09-16');
      expect(report.practiceName, 'Lake Town Heart Centre');
      expect(report.patients, hasLength(2));
      expect(report.prescriptionCount, 1);

      final rahul = report.patients.first;
      expect(rahul.demographics, '55 yrs · Male');
      expect(rahul.complaint, 'Chest tightness on exertion');
      expect(rahul.complaintBooked, isFalse);
      expect(rahul.vitals.single.summary, 'BP 150/94 mmHg · Pulse 88/min');
      expect(rahul.prescriptions.single.items.single.line, 'Atorvastatin 20 mg — HS · 30 days');
      expect(rahul.voidedPrescriptions, 1);

      final priya = report.patients.last;
      expect(priya.demographics, '', reason: 'an age or sex was invented');
      expect(priya.complaintBooked, isTrue);
      expect(priya.followUpOn, isNull);
    });

    test('a calendar day is its own parts, never a clock', () {
      expect(reportDate(DateTime(2026, 3, 1)), '2026-03-01');
      expect(reportDate(DateTime(2026, 12, 31, 23, 59)), '2026-12-31');
    });
  });

  group('the screen', () {
    Future<_FakeRepository> pump(WidgetTester tester, {DailyReport? report, Object? error}) async {
      tester.view.physicalSize = const Size(360 * 3, 3200 * 3);
      tester.view.devicePixelRatio = 3.0;
      addTearDown(tester.view.reset);
      final repo = _FakeRepository(report)..error = error;
      await tester.pumpWidget(
        ProviderScope(
          overrides: [dailyReportRepositoryProvider.overrideWithValue(repo)],
          child: const MaterialApp(home: DailyReportScreen()),
        ),
      );
      await tester.pumpAndSettle();
      return repo;
    }

    testWidgets('previews the day, says what is missing, and makes no file on its own', (tester) async {
      final repo = await pump(tester, report: DailyReport.fromJson(serverReport()));

      expect(find.text('2 patients seen · 1 prescription'), findsOneWidget);
      expect(find.text('Rahul Das'), findsOneWidget);
      expect(find.text('Stable angina; Hypertension'), findsOneWidget);
      expect(find.textContaining('BP 150/94 mmHg'), findsOneWidget);
      expect(find.textContaining('Atorvastatin 20 mg'), findsOneWidget);
      expect(find.textContaining('voided — not shown'), findsOneWidget);
      expect(find.text('Reason booked'), findsOneWidget, reason: 'a booking reason passed off as a recorded complaint');
      expect(find.text('None recorded this day'), findsOneWidget);
      expect(find.text('None issued'), findsOneWidget);
      expect(find.text('Share PDF'), findsOneWidget);
      expect(find.text('Open PDF'), findsOneWidget);

      expect(repo.pdfCalls, isEmpty, reason: 'a PDF was generated without the doctor asking');
    });

    testWidgets('an empty day says so and offers nothing to share', (tester) async {
      await pump(tester, report: DailyReport.fromJson(serverReport(patients: [])));
      expect(find.text('No patients seen on this date.'), findsOneWidget);
      expect(find.text('Share PDF'), findsNothing);
    });

    testWidgets('a refusal is shown as the server said it, not as a lost connection', (tester) async {
      await pump(
        tester,
        error: const ApiException(
          code: 'PRACTICE_SUSPENDED',
          message: 'This practice has been suspended on MedPin.',
          statusCode: 403,
        ),
      );
      expect(find.text('This practice has been suspended on MedPin.'), findsOneWidget);
      expect(find.textContaining('could not reach the server'), findsNothing);
    });
  });
}
