import 'package:akd_care/core/network/submission_keys.dart';
import 'package:akd_care/features/clinician/data/clinician_repository.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/consult_screen.dart';
import 'package:akd_care/features/medications/domain/medication.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'clinical_fixtures.dart';
import 'preview_harness.dart';

/// What the consultation sends, recorded.
class ConsultRepo implements ClinicianRepository {
  final keys = <SubmissionKeys?>[];
  var prescriptions = 0;

  @override
  Future<void> recordConsultVitals({
    required String patientId,
    String? complaint,
    double? heightCm,
    double? weightKg,
    double? waistCm,
    int? systolic,
    int? diastolic,
    int? pulse,
    int? spo2,
    int? glucoseMgDl,
    SubmissionKeys? submission,
  }) async => keys.add(submission);

  @override
  Future<void> createPrescription({
    required String patientId,
    required List<Map<String, dynamic>> items,
    String? complaint,
    List<String> diagnosis = const [],
    List<String> labTestsAdvised = const [],
    String? generalAdvice,
    DateTime? followUpOn,
    SubmissionKeys? submission,
  }) async {
    keys.add(submission);
    prescriptions++;
  }

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

/// The consultation, one step at a time, and finished.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'consult';

  Future<ConsultRepo> open(
    WidgetTester tester, {
    List<PrescriptionSummary> prescriptions = const [],
    List<Medication> medicines = const [],
    double textScale = 1,
    double height = 2400,
  }) async {
    setPhone(tester, height: height);
    final base = await baseOverrides();
    final repo = ConsultRepo();
    await tester.pumpWidget(
      previewApp(
        textScale: textScale,
        ground: false,
        overrides: [
          ...base,
          clinicianRepositoryProvider.overrideWithValue(repo),
          patientPrescriptionsProvider.overrideWith(
            (ref, _) async => prescriptions,
          ),
          patientMedicationsProvider.overrideWith((ref, _) async => medicines),
        ],
        home: const ConsultScreen(
          patientId: 'p-sunita',
          patientName: 'Sunita Chakraborty',
        ),
      ),
    );
    await settle(tester);
    expect(tester.takeException(), isNull);
    return repo;
  }

  Future<void> next(WidgetTester tester) async {
    await tester.tap(find.text('Next'));
    await settle(tester);
  }

  testWidgets('each step', (tester) async {
    await open(
      tester,
      prescriptions: diabetologyPrescriptions(),
      medicines: diabetologyMedicines(),
      height: 3200,
    );
    await capturePreview(tester, area, 'step1_vitals');
    await next(tester);
    await capturePreview(tester, area, 'step2_diagnosis');
    await next(tester);
    await capturePreview(tester, area, 'step3_prescription');
    expect(tester.takeException(), isNull);
    await leave(tester);
  });

  testWidgets('issuing ends on a finished screen, under one key', (
    tester,
  ) async {
    final repo = await open(tester, height: 1400);
    await next(tester);
    await next(tester);
    await tester.enterText(
      find.widgetWithText(TextField, 'Medicine 1'),
      'Metformin',
    );
    await tester.pump();
    await tester.tap(find.text('Generate prescription'));
    await settle(tester);

    expect(find.text('Prescription issued'), findsOneWidget);
    expect(find.text('Open the prescription'), findsOneWidget);
    expect(repo.prescriptions, 1);
    // The vitals and the prescription go under the same screen's keys, so a
    // retry after a timeout is answered rather than written twice.
    expect(repo.keys, hasLength(2));
    expect(repo.keys.every((k) => k != null), isTrue);
    expect(identical(repo.keys[0], repo.keys[1]), isTrue);
    await capturePreview(tester, area, 'issued');
    await leave(tester);
  });

  testWidgets('a first consultation, text scale 1.3', (tester) async {
    await open(tester, textScale: 1.3, height: 1600);
    await capturePreview(tester, area, 'step1_vitals_text_scale_1_3');
    await leave(tester);
  });
}
