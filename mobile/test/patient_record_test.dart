import 'dart:async';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/core/theme/app_theme.dart';
import 'package:akd_care/features/auth/domain/user.dart';
import 'package:akd_care/features/clinician/data/clinician_repository.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/domain/ecg_report.dart';
import 'package:akd_care/features/clinician/domain/patient_summary.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/patient_profile_screen.dart';
import 'package:akd_care/features/medications/domain/medication.dart';
import 'package:akd_care/l10n/gen/app_localizations.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

import 'ui_preview/clinical_fixtures.dart';
import 'ui_preview/preview_harness.dart';

/// The patient record states what is known, in the order the reader's work
/// needs it, and never turns a failure or an absence into a finding.

class _Repo implements ClinicianRepository {
  final stopped = <(String, String, String)>[];

  @override
  Future<void> stopPrescribedMedicine(
    String patientId,
    String medicationId, {
    required String reason,
  }) async => stopped.add((patientId, medicationId, reason));

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

void main() {
  setUpAll(loadPreviewFonts);

  group('parsing', () {
    test('risk reasons arrive as words, whatever shape they come in', () {
      final p = PatientSummary.fromJson({
        'patient': {'id': 'p', 'name': 'A', 'phone': ''},
        'riskReasons': [
          'HbA1c 9.4%',
          {'label': '2 unresolved urgent alerts'},
          {'text': '  '},
          42,
        ],
      });
      expect(p.riskReasons, ['HbA1c 9.4%', '2 unresolved urgent alerts']);
    });

    test('a band nobody worked out is not a finding', () {
      final fresh = PatientSummary.fromJson({
        'patient': {'id': 'p', 'name': 'A', 'phone': ''},
        'profile': {'riskBand': 'low', 'riskScore': 0},
      });
      expect(fresh.riskComputedAt, isNull);

      final worked = PatientSummary.fromJson({
        'patient': {'id': 'p', 'name': 'A', 'phone': ''},
        'profile': {
          'riskBand': 'low',
          'lastRiskComputedAt': '2026-09-01T10:00:00Z',
        },
      });
      expect(worked.riskComputedAt, isNotNull);
    });

    test('a result with no figure is left out, not read as zero', () {
      final p = PatientSummary.fromJson({
        'patient': {'id': 'p', 'name': 'A', 'phone': ''},
        'hba1cHistory': [
          {'testedOn': '2026-09-01'},
          {'percentage': 8.1, 'testedOn': '2026-06-01'},
        ],
        'labResults': [
          {
            'id': 'r',
            'testName': 'Lipid Profile',
            'analytes': [
              {'code': 'ldl', 'label': 'LDL', 'flag': 'normal'},
              {'code': 'hdl', 'label': 'HDL', 'value': 44, 'flag': 'normal'},
            ],
          },
        ],
      });
      expect(p.hba1cHistory.map((h) => h.percentage), [8.1]);
      expect(p.labResults.single.analytes.map((a) => a.code), ['hdl']);
    });

    test('an oddly typed block does not take the record down with it', () {
      final p = PatientSummary.fromJson(<String, dynamic>{
        'patient': <dynamic, dynamic>{'id': 'p', 'name': 'A', 'phone': '1'},
        'latestVitals': <dynamic, dynamic>{
          'systolic': 150,
          'diastolic': 95,
          'at': '2026-09-10T08:00:00Z',
        },
        'trends': {'count': 12, 'days': 90, 'stats': null},
      });
      expect(p.name, 'A');
      expect(p.systolic, 150);
      expect(p.vitalsAt, isNotNull);
      expect(p.glucoseReadingCount, 12);
      expect(p.glucoseAverage, isNull);
    });
  });

  group('screen', () {
    late _Repo repo;

    Future<void> open(
      WidgetTester tester, {
      required FutureOr<PatientSummary> Function(int read) summary,
      FutureOr<List<Medication>> Function()? medicines,
      List<PrescriptionSummary> prescriptions = const [],
      String? department,
      AppUser? user,
    }) async {
      setPhone(tester, height: 1600);
      repo = _Repo();
      final base = await baseOverrides(
        user: user,
        capabilities: previewCapabilities(department: department),
      );
      var reads = 0;
      final area = (user?.role ?? 'doctor') == 'staff' ? 'staff' : 'clinician';
      final router = GoRouter(
        initialLocation: '/$area/patients/p-sunita',
        routes: [
          GoRoute(
            path: '/$area/patients/:id',
            builder:
                (_, s) =>
                    PatientProfileScreen(patientId: s.pathParameters['id']!),
            routes: [
              GoRoute(
                path: 'consult',
                builder: (_, s) => Text('consult ${s.pathParameters['id']}'),
              ),
              GoRoute(
                path: 'prescriptions',
                builder:
                    (_, s) => Text('prescriptions ${s.pathParameters['id']}'),
              ),
              GoRoute(
                path: 'thread',
                builder: (_, s) => Text('thread ${s.pathParameters['id']}'),
              ),
            ],
          ),
        ],
      );
      await tester.pumpWidget(
        ProviderScope(
          overrides: [
            ...base,
            clinicianRepositoryProvider.overrideWithValue(repo),
            patientSummaryProvider.overrideWith(
              (ref, _) async => summary(reads++),
            ),
            patientMedicationsProvider.overrideWith(
              (ref, _) async =>
                  medicines == null ? <Medication>[] : medicines(),
            ),
            patientPrescriptionsProvider.overrideWith(
              (ref, _) async => prescriptions,
            ),
            patientEcgsProvider.overrideWith(
              (ref, _) async => const <EcgReport>[],
            ),
            clinicDieticiansProvider.overrideWith(
              (ref) async => [(id: 'd1', name: 'Moumita Ghosh')],
            ),
          ],
          child: MaterialApp.router(
            theme: AppTheme.light(),
            locale: const Locale('en'),
            localizationsDelegates: AppLocalizations.localizationsDelegates,
            supportedLocales: AppLocalizations.supportedLocales,
            routerConfig: router,
          ),
        ),
      );
      await settle(tester);
    }

    double top(WidgetTester tester, String text) =>
        tester.getTopLeft(find.text(text).first).dy;

    testWidgets('a cardiologist reads the heart first', (tester) async {
      await open(
        tester,
        summary: (_) => cardiologyPatient(),
        department: 'cardiology',
      );
      expect(find.text('Heart and blood pressure'), findsOneWidget);
      expect(find.text('Glucose control'), findsNothing);
      expect(
        top(tester, 'Heart and blood pressure'),
        lessThan(top(tester, 'Medicines')),
      );
      expect(find.text('Above limit'), findsOneWidget);
      await leave(tester);
    });

    testWidgets('a diabetologist reads glucose control first', (tester) async {
      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        medicines: diabetologyMedicines,
        department: 'diabetology',
      );
      expect(
        top(tester, 'Glucose control'),
        lessThan(top(tester, 'Medicines')),
      );
      expect(find.text('Heart and blood pressure'), findsNothing);
      // Blood pressure is still on the record, lower down, once.
      expect(find.text('Blood pressure'), findsOneWidget);
      await leave(tester);
    });

    testWidgets('a general physician reads vitals, then the last visit', (
      tester,
    ) async {
      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        medicines: diabetologyMedicines,
        prescriptions: diabetologyPrescriptions(),
        department: 'general_physician',
      );
      await tester.pump();
      expect(top(tester, 'Vitals'), lessThan(top(tester, 'Last visit')));
      // A diabetic patient keeps glucose control on a general record too.
      await tester.scrollUntilVisible(find.text('Glucose control'), 400);
      expect(find.text('Glucose control'), findsOneWidget);
      await leave(tester);
    });

    testWidgets('an unworked band says nothing; reasons show when sent', (
      tester,
    ) async {
      await open(tester, summary: (_) => newPatient());
      expect(find.text('Low risk'), findsNothing);

      await leave(tester);
      await open(
        tester,
        summary: (_) => diabetologyPatient(riskReasons: const ['HbA1c 8.4%']),
      );
      expect(find.text('High risk'), findsOneWidget);
      expect(find.text('HbA1c 8.4%'), findsOneWidget);
      await leave(tester);
    });

    testWidgets('a new patient is told as empty, never as zeros', (
      tester,
    ) async {
      await open(tester, summary: (_) => newPatient());
      expect(
        find.textContaining('No blood pressure, weight or pulse recorded yet'),
        findsOneWidget,
      );
      expect(find.text('0'), findsNothing);
      expect(find.text('0%'), findsNothing);
      await leave(tester);
    });

    testWidgets('the doctor stops a medicine with a reason', (tester) async {
      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        medicines: diabetologyMedicines,
        department: 'diabetology',
      );
      final stop = find.bySemanticsLabel('Stop Metformin');
      await tester.scrollUntilVisible(stop, 400);
      await tester.tap(stop);
      await tester.pumpAndSettle();
      expect(find.text('Stop Metformin?'), findsOneWidget);

      await tester.enterText(find.byType(TextField), 'HbA1c now at target');
      await tester.pump();
      await tester.tap(find.text('Stop it'));
      await tester.pumpAndSettle();

      expect(repo.stopped, [('p-sunita', 'm1', 'HbA1c now at target')]);
      // What the patient stopped on their own is listed apart, with why.
      expect(find.text('Stopped by the patient'), findsOneWidget);
      expect(find.textContaining('Felt dizzy and shaky'), findsOneWidget);
      await leave(tester);
    });

    testWidgets('the desk records measurements and stops nothing', (
      tester,
    ) async {
      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        medicines: diabetologyMedicines,
        user: previewDesk(),
      );
      expect(find.text('Record measurements'), findsOneWidget);
      expect(find.text('Start consultation'), findsNothing);
      expect(find.bySemanticsLabel(RegExp('^Stop ')), findsNothing);
      await leave(tester);
    });

    testWidgets('medicines that failed to load are not "no medicines"', (
      tester,
    ) async {
      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        medicines: () => Future.error(offline),
        department: 'diabetology',
      );
      await tester.scrollUntilVisible(find.text('Medicines'), 400);
      expect(find.text('Could not load the current medicines'), findsOneWidget);
      expect(find.text('No medicines prescribed.'), findsNothing);
      await leave(tester);
    });

    testWidgets('a refusal says why and offers no retry', (tester) async {
      await open(tester, summary: (_) => Future.error(refusedNotEnrolled));
      expect(find.text('Not a patient of this practice'), findsOneWidget);
      expect(find.text('Try again'), findsNothing);
      await leave(tester);
    });

    testWidgets('a refresh that cannot connect keeps the record', (
      tester,
    ) async {
      await open(
        tester,
        summary:
            (read) => read == 0 ? diabetologyPatient() : Future.error(offline),
      );
      expect(find.text('Sunita Chakraborty'), findsOneWidget);
      await tester.pump(const Duration(seconds: 16));
      await settle(tester);
      expect(find.text('Sunita Chakraborty'), findsOneWidget);
      expect(
        find.textContaining('Could not refresh this record'),
        findsOneWidget,
      );
      await leave(tester);
    });

    testWidgets('consultation and prescriptions open where they should', (
      tester,
    ) async {
      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        prescriptions: diabetologyPrescriptions(),
        department: 'diabetology',
      );
      await tester.tap(find.text('Start consultation'));
      await tester.pumpAndSettle();
      expect(find.text('consult p-sunita'), findsOneWidget);
      await leave(tester);

      await open(
        tester,
        summary: (_) => diabetologyPatient(),
        prescriptions: diabetologyPrescriptions(),
        department: 'diabetology',
      );
      // The last visit comes before the test reports, whose own "View all"
      // opens a sheet rather than the prescriptions.
      await tester.scrollUntilVisible(find.text('Last visit'), 400);
      await tester.tap(find.text('View all').first);
      await tester.pumpAndSettle();
      expect(find.text('prescriptions p-sunita'), findsOneWidget);
      await leave(tester);
    });
  });

  test('Capabilities stay the permissive default before an answer', () {
    // The record hides Start consultation from anyone without PRESCRIBE — but
    // only once the answer has arrived.
    expect(Capabilities.unknown.can(Perm.prescribe), isTrue);
  });
}
