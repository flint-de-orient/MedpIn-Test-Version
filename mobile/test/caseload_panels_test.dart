import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:medpin/features/clinician/domain/caseload_panels.dart';
import 'package:medpin/features/clinician/presentation/clinician_providers.dart';
import 'package:medpin/features/clinician/presentation/widgets/caseload_panels.dart';

/// The caseload panels on a general physician's and a cardiologist's home.
///
/// Three things each must never get wrong: a panel that failed to load must not
/// say the reassuring thing ("nobody in crisis"); an answered empty must say
/// what it counted; and every band carries its word, not only its colour.
void main() {
  Future<void> pump(WidgetTester tester, Widget child, List<Override> overrides) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: overrides,
        child: MaterialApp(home: Scaffold(body: SingleChildScrollView(child: child))),
      ),
    );
    await tester.pump();
  }

  BpControl bp({Map<String, int> bands = const {}, int caseload = 5, int without = 1, List<Map<String, dynamic>> attention = const []}) =>
      BpControl.fromJson({
        'days': 90,
        'caseload': caseload,
        'withReading': caseload - without,
        'withoutReading': without,
        'bands': bands,
        'attention': attention,
        'attentionTotal': attention.length,
      });

  group('blood pressure control', () {
    testWidgets('names the patient in crisis, with the band in words', (tester) async {
      await pump(tester, const BpControlCard(), [
        bpControlProvider(BpControlCard.days).overrideWith(
          (ref) async => bp(
            bands: {'hypertensive_crisis': 1, 'normal': 3},
            attention: [
              {
                'patientId': 'p1',
                'name': 'Rahul Bose',
                'systolic': 190,
                'diastolic': 120,
                'band': 'hypertensive_crisis',
                'recordedAt': '2026-09-15T10:00:00Z',
              },
            ],
          ),
        ),
      ]);

      expect(find.text('Rahul Bose'), findsOneWidget);
      expect(find.textContaining('190/120 · Crisis'), findsOneWidget);
      expect(find.text('Crisis 1'), findsOneWidget, reason: 'the band is only a colour');
      expect(find.textContaining('1 not measured in 90 days'), findsOneWidget);
    });

    testWidgets('a panel that did not load says so, not that everyone is fine', (tester) async {
      await pump(tester, const BpControlCard(), [
        bpControlProvider(BpControlCard.days).overrideWith((ref) async => throw Exception('offline')),
      ]);

      expect(find.textContaining('Could not load blood pressure'), findsOneWidget);
      expect(find.textContaining('Nobody'), findsNothing, reason: 'a failed load was read as a calm caseload');
    });

    testWidgets('while loading it claims nothing', (tester) async {
      final never = Completer<BpControl>();
      await pump(tester, const BpControlCard(), [
        bpControlProvider(BpControlCard.days).overrideWith((ref) => never.future),
      ]);

      expect(find.byType(CircularProgressIndicator), findsOneWidget);
      expect(find.textContaining('Nobody'), findsNothing);
    });

    testWidgets('an answered empty says what it counted', (tester) async {
      await pump(tester, const BpControlCard(), [
        bpControlProvider(BpControlCard.days).overrideWith((ref) async => bp(bands: {'normal': 4})),
      ]);
      expect(find.textContaining('Nobody’s latest reading is in crisis, stage 2 or low'), findsOneWidget);
      expect(find.textContaining('4 of 5 patients measured'), findsOneWidget);
    });
  });

  group('follow-ups due', () {
    testWidgets('overdue is its own heading, above what is due', (tester) async {
      await pump(tester, const FollowUpsDueCard(), [
        followUpsProvider(FollowUpsDueCard.days).overrideWith(
          (ref) async => FollowUps.fromJson({
            'days': 7,
            'overdue': [
              {'patientId': 'p1', 'name': 'Three Days Late', 'followUpOn': '2026-09-13T00:00:00Z', 'doctorName': 'Dr Sen'},
            ],
            'overdueTotal': 1,
            'due': [
              {'patientId': 'p2', 'name': 'Due Tomorrow', 'followUpOn': '2026-09-17T00:00:00Z'},
            ],
            'dueTotal': 1,
          }),
        ),
      ]);

      expect(find.text('1 overdue'), findsOneWidget);
      expect(find.text('Three Days Late'), findsOneWidget);
      expect(find.text('1 due in the next 7 days'), findsOneWidget);
      final overdue = tester.getTopLeft(find.text('Three Days Late')).dy;
      final due = tester.getTopLeft(find.text('Due Tomorrow')).dy;
      expect(overdue, lessThan(due), reason: 'what is late was listed after what is merely due');
    });

    testWidgets('nothing due says so', (tester) async {
      await pump(tester, const FollowUpsDueCard(), [
        followUpsProvider(FollowUpsDueCard.days).overrideWith(
          (ref) async => FollowUps.fromJson({'days': 7, 'overdue': [], 'overdueTotal': 0, 'due': [], 'dueTotal': 0}),
        ),
      ]);
      expect(find.textContaining('No follow-ups are due in the next 7 days'), findsOneWidget);
    });
  });

  group('the condition register', () {
    testWidgets('counts each condition and states who has none recorded', (tester) async {
      await pump(tester, const ConditionRegisterCard(), [
        conditionRegisterProvider('en').overrideWith(
          (ref) async => ConditionRegister.fromJson({
            'caseload': 3,
            'conditions': [
              {'key': 'hypertension', 'name': 'Hypertension', 'count': 2},
            ],
            'withoutCondition': 1,
          }),
        ),
      ]);
      expect(find.text('Hypertension'), findsOneWidget);
      expect(find.text('2'), findsOneWidget);
      expect(find.textContaining('1 patients have no diagnosed condition recorded'), findsOneWidget);
    });
  });

  group('heart rate', () {
    testWidgets('names the pulses outside the limits, with the limits in words', (tester) async {
      await pump(tester, const HeartRateFlagsCard(), [
        heartRateFlagsProvider(HeartRateFlagsCard.days).overrideWith(
          (ref) async => HeartRateFlags.fromJson({
            'days': 30,
            'limits': {'low': 50, 'high': 120},
            'withReading': 3,
            'withoutReading': 0,
            'low': [
              {'patientId': 'p1', 'name': 'Slow Pulse', 'pulse': 44, 'recordedAt': '2026-09-15T10:00:00Z'},
            ],
            'lowTotal': 1,
            'high': [],
            'highTotal': 0,
          }),
        ),
      ]);
      expect(find.text('1 below 50 bpm'), findsOneWidget);
      expect(find.text('Slow Pulse'), findsOneWidget);
      expect(find.textContaining('44 bpm'), findsOneWidget);
    });
  });

  group('ECGs', () {
    EcgPanel ecg({Map<String, int> impressions = const {}, List<Map<String, dynamic>> flagged = const [], int withEcg = 3, int withoutEcg = 2}) =>
        EcgPanel.fromJson({
          'days': 180,
          'withEcg': withEcg,
          'withoutEcg': withoutEcg,
          'impressions': impressions,
          'flagged': flagged,
          'flaggedTotal': flagged.length,
        });

    testWidgets('names abnormal above borderline, with the impression in words', (tester) async {
      await pump(tester, const RecentEcgsCard(), [
        ecgPanelProvider(RecentEcgsCard.days).overrideWith(
          (ref) async => ecg(
            impressions: {'abnormal': 1, 'borderline': 1, 'normal': 1},
            flagged: [
              {
                'patientId': 'p1',
                'name': 'Fast Irregular',
                'impression': 'abnormal',
                'rhythm': 'atrial_fibrillation',
                'heartRate': 118,
                'recordedOn': '2026-09-10T10:00:00Z',
              },
              {'patientId': 'p2', 'name': 'Long QT', 'impression': 'borderline', 'rhythm': 'sinus', 'recordedOn': '2026-09-12T10:00:00Z'},
            ],
          ),
        ),
      ]);

      expect(find.text('Abnormal 1'), findsOneWidget, reason: 'the impression is only a colour');
      expect(find.text('Abnormal · Atrial fibrillation · 118 bpm'), findsOneWidget);
      expect(find.textContaining('3 of 5 patients have an ECG'), findsOneWidget);
      final abnormal = tester.getTopLeft(find.text('Fast Irregular')).dy;
      final borderline = tester.getTopLeft(find.text('Long QT')).dy;
      expect(abnormal, lessThan(borderline), reason: 'a borderline tracing was listed above an abnormal one');
    });

    testWidgets('tracings filed without a reading are counted, not hidden', (tester) async {
      await pump(tester, const RecentEcgsCard(), [
        ecgPanelProvider(RecentEcgsCard.days).overrideWith((ref) async => ecg(impressions: {'unknown': 2, 'normal': 1})),
      ]);
      expect(find.text('Not yet read 2'), findsOneWidget);
      expect(find.text('2 filed without a reading yet.'), findsOneWidget);
      expect(find.text('No latest ECG was read as abnormal or borderline.'), findsOneWidget);
    });

    testWidgets('a panel that did not load does not say no ECG was abnormal', (tester) async {
      await pump(tester, const RecentEcgsCard(), [
        ecgPanelProvider(RecentEcgsCard.days).overrideWith((ref) async => throw Exception('offline')),
      ]);
      expect(find.textContaining('Could not load ECGs'), findsOneWidget);
      expect(find.textContaining('No latest ECG'), findsNothing);
    });
  });

  group('LDL', () {
    testWidgets('names who is above the catalog’s limit, and says where the numbers came from', (tester) async {
      await pump(tester, const LipidControlCard(), [
        lipidControlProvider(LipidControlCard.days).overrideWith(
          (ref) async => LipidControl.fromJson({
            'days': 365,
            'source': 'uploaded lab reports',
            'target': {'analyte': 'LDL', 'unit': 'mg/dL', 'high': 100},
            'withResult': 3,
            'withoutResult': 1,
            'atOrBelow': 1,
            'above': [
              {'patientId': 'p1', 'name': 'High LDL', 'ldl': 190.5, 'testedOn': '2026-08-01T00:00:00Z'},
            ],
            'aboveTotal': 2,
          }),
        ),
      ]);

      expect(find.textContaining('Read automatically from uploaded lab reports'), findsOneWidget);
      expect(find.text('2 above 100 mg/dL'), findsOneWidget);
      expect(find.text('High LDL'), findsOneWidget);
      expect(find.text('LDL 190.5 mg/dL'), findsOneWidget);
      expect(find.text('+1 more above 100 mg/dL'), findsOneWidget);
      expect(find.text('1 at or below 100 mg/dL.'), findsOneWidget);
    });

    testWidgets('without a limit from the server it names no number of its own', (tester) async {
      await pump(tester, const LipidControlCard(), [
        lipidControlProvider(LipidControlCard.days).overrideWith(
          (ref) async => LipidControl.fromJson({
            'days': 365,
            'withResult': 1,
            'withoutResult': 0,
            'atOrBelow': 0,
            'above': [
              {'patientId': 'p1', 'name': 'High LDL', 'ldl': 160},
            ],
            'aboveTotal': 1,
          }),
        ),
      ]);
      expect(find.text('1 above target'), findsOneWidget);
      expect(find.textContaining('100'), findsNothing, reason: 'a limit the server never sent was drawn');
    });

    testWidgets('a panel that did not load claims nothing about anyone’s LDL', (tester) async {
      await pump(tester, const LipidControlCard(), [
        lipidControlProvider(LipidControlCard.days).overrideWith((ref) async => throw Exception('offline')),
      ]);
      expect(find.textContaining('Could not load LDL results'), findsOneWidget);
      expect(find.textContaining('No latest LDL'), findsNothing);
    });
  });
}
