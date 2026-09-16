import 'dart:async';

import 'package:akd_care/core/capabilities/capabilities.dart';
import 'package:akd_care/features/clinician/domain/clinician_models.dart';
import 'package:akd_care/features/clinician/domain/ecg_report.dart';
import 'package:akd_care/features/clinician/domain/patient_summary.dart';
import 'package:akd_care/features/clinician/presentation/clinician_providers.dart';
import 'package:akd_care/features/clinician/presentation/patient_profile_screen.dart';
import 'package:akd_care/features/medications/domain/medication.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';

import 'clinical_fixtures.dart';
import 'preview_harness.dart';

/// The patient record, drawn for each specialty and each state it can be in.
void main() {
  setUpAll(loadPreviewFonts);

  const area = 'patient_record';

  Future<void> show(
    WidgetTester tester,
    String name, {
    required String id,
    required FutureOr<PatientSummary> Function() summary,
    FutureOr<List<Medication>> Function()? medicines,
    FutureOr<List<PrescriptionSummary>> Function()? prescriptions,
    FutureOr<List<EcgReport>> Function()? ecgs,
    Capabilities? capabilities,
    bool desk = false,
    double textScale = 1,
    double height = 5200,
  }) async {
    setPhone(tester, height: height);
    final base = await baseOverrides(
      user: desk ? previewDesk() : previewDoctor(),
      capabilities: capabilities,
    );
    await tester.pumpWidget(
      previewApp(
        textScale: textScale,
        ground: false,
        overrides: [
          ...base,
          patientSummaryProvider.overrideWith((ref, _) async => summary()),
          patientMedicationsProvider.overrideWith(
            (ref, _) async => medicines == null ? <Medication>[] : medicines(),
          ),
          patientPrescriptionsProvider.overrideWith(
            (ref, _) async =>
                prescriptions == null
                    ? <PrescriptionSummary>[]
                    : prescriptions(),
          ),
          patientEcgsProvider.overrideWith(
            (ref, _) async => ecgs == null ? <EcgReport>[] : ecgs(),
          ),
          clinicDieticiansProvider.overrideWith(
            (ref) async => [(id: 'd1', name: 'Moumita Ghosh')],
          ),
        ],
        home: PatientProfileScreen(patientId: id),
      ),
    );
    await settle(tester);
    expect(tester.takeException(), isNull);
    await capturePreview(tester, area, name);
    await leave(tester);
  }

  testWidgets('diabetology, rich record', (tester) async {
    await show(
      tester,
      'diabetology_rich',
      id: 'p-sunita',
      capabilities: previewCapabilities(department: 'diabetology'),
      summary: () => diabetologyPatient(
        riskReasons: const [
          'HbA1c 8.4% — above target',
          'Glucose 312 mg/dL yesterday',
          'Missed 27 of 88 doses',
        ],
      ),
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('cardiology', (tester) async {
    await show(
      tester,
      'cardiology',
      id: 'p-arjun',
      capabilities: previewCapabilities(department: 'cardiology'),
      summary: cardiologyPatient,
      ecgs: cardiologyEcgs,
      prescriptions: () => const [],
    );
  });

  testWidgets('general physician', (tester) async {
    await show(
      tester,
      'general_physician',
      id: 'p-sunita',
      capabilities: previewCapabilities(department: 'general_physician'),
      summary: diabetologyPatient,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('new patient, nothing recorded', (tester) async {
    await show(
      tester,
      'new_patient',
      id: 'p-priya',
      height: 2600,
      summary: newPatient,
    );
  });

  testWidgets('loading', (tester) async {
    await show(
      tester,
      'loading',
      id: 'p-x',
      height: 780,
      summary: () => Completer<PatientSummary>().future,
    );
  });

  testWidgets('failed', (tester) async {
    await show(
      tester,
      'failed',
      id: 'p-x',
      height: 780,
      summary: () => Future.error(Exception('offline')),
    );
  });

  testWidgets('medicines failed to load', (tester) async {
    await show(
      tester,
      'medicines_failed',
      id: 'p-sunita',
      summary: diabetologyPatient,
      medicines: () => Future.error(Exception('offline')),
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('text scale 1.3', (tester) async {
    await show(
      tester,
      'text_scale_1_3',
      id: 'p-sunita',
      textScale: 1.3,
      height: 6800,
      summary: diabetologyPatient,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });

  testWidgets('front desk', (tester) async {
    await show(
      tester,
      'desk',
      id: 'p-sunita',
      desk: true,
      summary: diabetologyPatient,
      medicines: diabetologyMedicines,
      prescriptions: diabetologyPrescriptions,
    );
  });
}
